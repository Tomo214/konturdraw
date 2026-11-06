//! PNG-Export über tiny-skia: DPI wählbar, transparenter Hintergrund (Spec §11).
use crate::color::{byte, Cms};
use crate::scene::{
    apply, clipped_leaves, segments, Cap, ClipRef, Color, Fill, FillRule, GradientKind, Item, Join,
    Mat, Point, Scene, Seg, Subpath,
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

fn rule(r: Option<FillRule>) -> sk::FillRule {
    if r.is_some() {
        sk::FillRule::EvenOdd
    } else {
        sk::FillRule::Winding
    }
}

/// Schnittmenge der Umrisse als Maske; None = unbeschnitten, leerer Umriss verdeckt alles.
fn clip_mask(clips: &[ClipRef], w: u32, h: u32, page: sk::Transform) -> Option<sk::Mask> {
    if clips.is_empty() {
        return None;
    }
    let mut mask = sk::Mask::new(w, h)?;
    for (i, c) in clips.iter().enumerate() {
        let Some(p) = path(&c.matrix, c.subpaths) else {
            return sk::Mask::new(w, h);
        };
        if i == 0 {
            mask.fill_path(&p, rule(c.fill_rule), true, page);
        } else {
            mask.intersect_path(&p, rule(c.fill_rule), true, page);
        }
    }
    Some(mask)
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
    // Maske je Beschneidungskette, neu nur wenn die Kette wechselt.
    let mut mask: (Vec<usize>, Option<sk::Mask>) = (Vec::new(), None);
    for leaf in clipped_leaves(&scene.items) {
        let chain: Vec<usize> = leaf.clips.iter().map(|c| c.id).collect();
        if chain != mask.0 {
            mask = (chain, clip_mask(&leaf.clips, w, h, page));
        }
        let clip = mask.1.as_ref();
        let (m, it) = (leaf.matrix, leaf.item);
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
                    let mut fp = paint(f, &m, cms);
                    fp.shader.apply_opacity(*opacity as f32);
                    pm.fill_path(&p, &fp, rule(*fill_rule), page, clip);
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
                    pm.stroke_path(&p, &sp, &st, page, clip);
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
                    clip,
                );
            }
            Item::Group { .. } | Item::Clip { .. } => {
                unreachable!("clipped_leaves löst Gruppen und Rahmen auf")
            }
        }
    }
    pm.encode_png()
        .map_err(|e| format!("PNG konnte nicht geschrieben werden: {e}"))
}
