//! PNG-Export über tiny-skia: DPI wählbar, transparenter Hintergrund (Spec §11).
use crate::color::{byte, Cms};
use crate::scene::{
    apply, leaves, segments, Cap, Color, Fill, GradientKind, Item, Join, Mat, Point, Scene, Seg,
    Subpath,
};
use crate::Images;
use tiny_skia as sk;

fn path(m: &Mat, subpaths: &[Subpath]) -> Option<sk::Path> {
    let mut pb = sk::PathBuilder::new();
    let p = |q: Point| {
        let w = apply(m, q);
        (w.x as f32, w.y as f32)
    };
    for sp in subpaths {
        let Some(first) = sp.nodes.first() else {
            continue;
        };
        let (x, y) = p(Point {
            x: first.x,
            y: first.y,
        });
        pb.move_to(x, y);
        for s in segments(sp) {
            match s {
                Seg::Line(e) => {
                    let (x, y) = p(e);
                    pb.line_to(x, y)
                }
                Seg::Cubic(a, b, e) => {
                    let ((ax, ay), (bx, by), (ex, ey)) = (p(a), p(b), p(e));
                    pb.cubic_to(ax, ay, bx, by, ex, ey)
                }
            }
        }
        if sp.closed {
            pb.close();
        }
    }
    pb.finish()
}

fn color(c: &Color, cms: &Cms) -> sk::Color {
    let [r, g, b] = cms.srgb(c).map(byte);
    sk::Color::from_rgba8(r, g, b, 255)
}

fn transform(m: &Mat) -> sk::Transform {
    let m = m.map(|v| v as f32);
    sk::Transform::from_row(m[0], m[1], m[2], m[3], m[4], m[5])
}

fn paint(fill: &Fill, m: &Mat, cms: &Cms) -> sk::Paint<'static> {
    let mut paint = sk::Paint::default();
    match fill {
        Fill::Color(c) => paint.set_color(color(c, cms)),
        Fill::Gradient(g) => {
            let stops = g
                .stops
                .iter()
                .map(|s| sk::GradientStop::new(s.offset as f32, color(&s.color, cms)))
                .collect();
            let (a, b) = (
                sk::Point::from_xy(g.from.x as f32, g.from.y as f32),
                sk::Point::from_xy(g.to.x as f32, g.to.y as f32),
            );
            let shader = match g.kind {
                GradientKind::Linear => {
                    sk::LinearGradient::new(a, b, stops, sk::SpreadMode::Pad, transform(m))
                }
                GradientKind::Radial => sk::RadialGradient::new(
                    a,
                    0.0,
                    a,
                    a.distance(b),
                    stops,
                    sk::SpreadMode::Pad,
                    transform(m),
                ),
            };
            // Entarteter Verlauf (Länge 0): wie Canvas mit der letzten Farbe füllen.
            match shader {
                Some(s) => paint.shader = s,
                None => paint.set_color(
                    g.stops
                        .last()
                        .map(|s| color(&s.color, cms))
                        .unwrap_or(sk::Color::TRANSPARENT),
                ),
            }
        }
    }
    paint.anti_alias = true;
    paint
}

pub fn export(scene: &Scene, images: &Images, dpi: f64, cms: &Cms) -> Result<Vec<u8>, String> {
    let k = dpi / 25.4; // Pixel je mm
    let (w, h) = (
        (scene.width * k).round().max(1.0) as u32,
        (scene.height * k).round().max(1.0) as u32,
    );
    let mut pm =
        sk::Pixmap::new(w, h).ok_or_else(|| format!("Bild mit {w} × {h} px ist zu groß."))?;
    let page = sk::Transform::from_scale(k as f32, k as f32);
    for (m, it) in leaves(&scene.items) {
        match it {
            Item::Path {
                subpaths,
                fill,
                stroke,
                fill_rule,
                opacity,
                ..
            } => {
                let Some(p) = path(&m, subpaths) else {
                    continue;
                };
                if let Some(f) = fill {
                    let rule = if fill_rule.is_some() {
                        sk::FillRule::EvenOdd
                    } else {
                        sk::FillRule::Winding
                    };
                    let mut fp = paint(f, &m, cms);
                    fp.shader.apply_opacity(*opacity as f32);
                    pm.fill_path(&p, &fp, rule, page, None);
                }
                if let Some(s) = stroke {
                    let st = sk::Stroke {
                        width: s.width as f32,
                        miter_limit: 10.0,
                        line_cap: match s.cap {
                            Cap::Butt => sk::LineCap::Butt,
                            Cap::Round => sk::LineCap::Round,
                            Cap::Square => sk::LineCap::Square,
                        },
                        line_join: match s.join {
                            Join::Miter => sk::LineJoin::Miter,
                            Join::Round => sk::LineJoin::Round,
                            Join::Bevel => sk::LineJoin::Bevel,
                        },
                        dash: s.dash_pattern().and_then(|d| {
                            sk::StrokeDash::new(d.iter().map(|x| *x as f32).collect(), 0.0)
                        }),
                    };
                    let mut sp = paint(&Fill::Color(s.color.clone()), &m, cms);
                    sp.shader.apply_opacity(*opacity as f32);
                    pm.stroke_path(&p, &sp, &st, page, None);
                }
            }
            Item::Image {
                width,
                height,
                image,
                opacity,
                ..
            } => {
                let png = images
                    .get(image)
                    .ok_or_else(|| format!("Bild {image} fehlt in der Ablage."))?;
                let img = sk::Pixmap::decode_png(png)
                    .map_err(|e| format!("Bild {image} nicht lesbar: {e}"))?;
                let fit = sk::Transform::from_scale(
                    (*width / img.width() as f64) as f32,
                    (*height / img.height() as f64) as f32,
                );
                // Bilinear wie Canvas-Vorgabe (imageSmoothingQuality "low").
                let q = sk::PixmapPaint {
                    quality: sk::FilterQuality::Bilinear,
                    opacity: *opacity as f32,
                    ..Default::default()
                };
                pm.draw_pixmap(
                    0,
                    0,
                    img.as_ref(),
                    &q,
                    page.pre_concat(transform(&m)).pre_concat(fit),
                    None,
                );
            }
            Item::Group { .. } => unreachable!("leaves löst Gruppen auf"),
        }
    }
    pm.encode_png()
        .map_err(|e| format!("PNG konnte nicht geschrieben werden: {e}"))
}
