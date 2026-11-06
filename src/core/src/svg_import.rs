//! SVG-Import über usvg (Spec §11): Gruppen bleiben Gruppen, Formen → Bézier-Pfade, Text → Kurven,
//! eingebettete PNG/JPG → Bilder. Nicht Abbildbares wird vereinfacht oder übersprungen und gemeldet.
use crate::scene::{
    apply, leaves, mul, Cap, Color, Fill, FillRule, Gradient, GradientKind, GradientStop, Item,
    Join, Mat, NodeType, PathPoint, Point, Scene, Stroke, Subpath, IDENTITY,
};
use crate::{raster, Images};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use usvg::tiny_skia_path::{self as tsp, PathSegment};

const K: f64 = 25.4 / 96.0; // CSS-px → mm

pub struct Imported {
    pub scene: Scene,
    pub images: Images,
    pub warnings: Vec<String>,
}

struct Ctx {
    images: Images,
    warnings: Vec<String>,
}

impl Ctx {
    fn warn(&mut self, w: &str) {
        if !self.warnings.iter().any(|x| x == w) {
            self.warnings.push(w.into());
        }
    }
}

fn mat(t: usvg::Transform) -> Mat {
    [t.sx, t.ky, t.kx, t.sy, t.tx, t.ty].map(f64::from)
}

fn pt(p: tsp::Point) -> Point {
    Point {
        x: p.x as f64,
        y: p.y as f64,
    }
}

pub fn import(data: &[u8]) -> Result<Imported, String> {
    // Unlesbare eingebettete Bilder lässt usvg stumm fallen → zählen und melden.
    let lost = Arc::new(AtomicUsize::new(0));
    let seen = lost.clone();
    let default = usvg::ImageHrefResolver::default_data_resolver();
    // Text wird zu Kurven
    let opt = usvg::Options {
        fontdb: crate::text::system_fonts(),
        image_href_resolver: usvg::ImageHrefResolver {
            // libcdr liefert Bitmaps aus .cdr-Dateien als BMP, usvg kennt kein BMP → hier zu PNG.
            resolve_data: Box::new(move |mime, data, opt| {
                let kind = if mime == "image/bmp" {
                    bmp_png(&data).map(|p| usvg::ImageKind::PNG(Arc::new(p)))
                } else {
                    default(mime, data, opt)
                };
                if kind.is_none() {
                    seen.fetch_add(1, Ordering::Relaxed);
                }
                kind
            }),
            ..Default::default()
        },
        ..Default::default()
    };
    let tree = usvg::Tree::from_data(data, &opt).map_err(|e| format!("SVG nicht lesbar: {e}"))?;
    let mut cx = Ctx {
        images: Images::new(),
        warnings: Vec::new(),
    };
    // Eine Gruppe fürs ganze SVG; viewBox steckt in usvg schon in einer Kind-Gruppe.
    let top = mul(&[K, 0.0, 0.0, K, 0.0, 0.0], &mat(tree.root().transform()));
    let children = group(&mut cx, tree.root(), &top, 1.0);
    if lost.load(Ordering::Relaxed) > 0 {
        cx.warn("Eingebettetes Bild in unbekanntem Format übersprungen.");
    }
    let size = tree.size();
    let scene = Scene {
        width: size.width() as f64 * K,
        height: size.height() as f64 * K,
        items: vec![Item::Group {
            matrix: top,
            children,
        }],
    };
    Ok(Imported {
        scene,
        images: cx.images,
        warnings: cx.warnings,
    })
}

/// `alpha` = Produkt der Gruppen-Deckkräfte darüber; wirkt auf jedes Objekt einzeln (Konturwerk-Modell).
fn group(cx: &mut Ctx, g: &usvg::Group, world: &Mat, alpha: f64) -> Vec<Item> {
    let mut out = Vec::new();
    for node in g.children() {
        match node {
            usvg::Node::Group(c) => {
                if c.mask().is_some() {
                    cx.warn("Maske ignoriert.");
                }
                if !c.filters().is_empty() {
                    cx.warn("Filter ignoriert.");
                }
                let o = c.opacity().get() as f64;
                if let Some(sub) = sub_group(cx, c, world, alpha * o) {
                    if o < 1.0 && overlaps(&sub) {
                        cx.warn("Gruppen-Deckkraft auf die einzelnen Objekte verteilt – Überlappungen wirken dichter.");
                    }
                    out.push(sub);
                }
            }
            usvg::Node::Path(p) => out.extend(path(cx, p, world, alpha)),
            usvg::Node::Image(i) => out.extend(image(cx, i, alpha)),
            usvg::Node::Text(t) => out.extend(sub_group(cx, t.flattened(), world, alpha)),
        }
    }
    out
}

/// Mehr als ein Objekt (oder Füllung + Kontur): Deckkraft je Objekt ≠ Deckkraft der ganzen Gruppe.
fn overlaps(g: &Item) -> bool {
    match leaves(std::slice::from_ref(g)).as_slice() {
        [(_, Item::Path { fill, stroke, .. })] => fill.is_some() && stroke.is_some(),
        l => l.len() > 1,
    }
}

fn sub_group(cx: &mut Ctx, g: &usvg::Group, world: &Mat, alpha: f64) -> Option<Item> {
    let m = mat(g.transform());
    let mut children = group(cx, g, &mul(world, &m), alpha);
    if let (Some(c), false) = (g.clip_path(), children.is_empty()) {
        children = vec![frame(cx, c, children)];
    }
    (!children.is_empty()).then_some(Item::Group {
        matrix: m,
        children,
    })
}

/// Beschneidung → Rahmen: alle Pfade des clipPath als ein Umriss (Gruppen-Matrizen eingerechnet).
/// Mehrere Pfade = nonzero, exakt solange sie sich nicht gegenläufig überlappen.
fn frame(cx: &mut Ctx, c: &usvg::ClipPath, children: Vec<Item>) -> Item {
    fn outline(
        cx: &mut Ctx,
        g: &usvg::Group,
        ts: usvg::Transform,
        out: &mut Vec<(Vec<Subpath>, bool)>,
    ) {
        for node in g.children() {
            match node {
                usvg::Node::Path(p) if p.is_visible() => {
                    if let Some(d) = p.data().clone().transform(ts) {
                        let even_odd = p
                            .fill()
                            .is_some_and(|f| f.rule() == usvg::FillRule::EvenOdd);
                        out.push((subpaths(&d), even_odd));
                    }
                }
                usvg::Node::Group(c) => {
                    if c.clip_path().is_some() {
                        cx.warn("Beschneidung einer Beschneidung ignoriert.");
                    }
                    outline(cx, c, ts.pre_concat(c.transform()), out)
                }
                usvg::Node::Text(t) => outline(cx, t.flattened(), ts, out),
                _ => {}
            }
        }
    }
    if c.clip_path().is_some() {
        cx.warn("Beschneidung einer Beschneidung ignoriert.");
    }
    let mut parts = Vec::new();
    outline(cx, c.root(), usvg::Transform::default(), &mut parts);
    let even_odd = matches!(parts.as_slice(), [(_, true)]);
    Item::Clip {
        matrix: mat(c.transform()),
        subpaths: parts.into_iter().flat_map(|p| p.0).collect(),
        fill_rule: even_odd.then_some(FillRule::EvenOdd),
        children,
    }
}

/// Füllung und Kontur mit verschiedener Deckkraft → zwei Pfade (Füllung, darüber Kontur).
fn path(cx: &mut Ctx, p: &usvg::Path, world: &Mat, alpha: f64) -> Vec<Item> {
    if !p.is_visible() {
        return Vec::new();
    }
    let subpaths = subpaths(p.data());
    let fill_alpha = p.fill().map_or(1.0, |f| {
        f.opacity().get() as f64 * stop_alpha(cx, f.paint())
    });
    let stroke_alpha = p.stroke().map_or(1.0, |s| {
        s.opacity().get() as f64 * stop_alpha(cx, s.paint())
    });
    let fill = p.fill().and_then(|f| paint(cx, f.paint()));
    let stroke = p.stroke().and_then(|s| {
        let color = match paint(cx, s.paint())? {
            Fill::Color(c) => c,
            Fill::Gradient(g) => {
                cx.warn("Verlauf in Kontur als Vollton übernommen.");
                g.stops[0].color.clone()
            }
        };
        // Breite in Seiten-mm; bei ungleichmäßiger Skalierung gemittelt.
        let det = world[0] * world[3] - world[1] * world[2];
        let k = det.abs().sqrt();
        Some(Stroke {
            color,
            width: s.width().get() as f64 * k,
            // usvg verdoppelt ungerade Listen schon (SVG-Regel)
            dash: s
                .dasharray()
                .map(|d| d.iter().map(|x| *x as f64 * k).collect())
                .unwrap_or_default(),
            cap: match s.linecap() {
                usvg::LineCap::Butt => Cap::Butt,
                usvg::LineCap::Round => Cap::Round,
                usvg::LineCap::Square => Cap::Square,
            },
            join: match s.linejoin() {
                usvg::LineJoin::Miter | usvg::LineJoin::MiterClip => Join::Miter,
                usvg::LineJoin::Round => Join::Round,
                usvg::LineJoin::Bevel => Join::Bevel,
            },
        })
    });
    let fill_rule = p
        .fill()
        .filter(|f| matches!(f.rule(), usvg::FillRule::EvenOdd))
        .map(|_| FillRule::EvenOdd);
    if subpaths.is_empty() {
        return Vec::new();
    }
    let item = |fill, stroke, opacity| Item::Path {
        matrix: IDENTITY,
        subpaths: subpaths.clone(),
        fill,
        stroke,
        fill_rule,
        opacity,
    };
    let (fa, sa) = (alpha * fill_alpha, alpha * stroke_alpha);
    // 0 % Deckkraft = Teil fehlt (libcdr schreibt „keine Füllung“ als fill-opacity 0).
    let fill = fill.filter(|_| fa > 1e-6);
    let stroke = stroke.filter(|_| sa > 1e-6);
    match (fill, stroke) {
        (None, None) => Vec::new(),
        (Some(f), Some(s)) if (fa - sa).abs() > 1e-6 => {
            vec![item(Some(f), None, fa), item(None, Some(s), sa)]
        }
        (f, s) => {
            let o = if f.is_some() { fa } else { sa };
            vec![item(f, s, o)]
        }
    }
}

fn bmp_png(data: &[u8]) -> Option<Vec<u8>> {
    let img = image::load_from_memory_with_format(data, image::ImageFormat::Bmp).ok()?;
    let mut out = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .ok()?;
    Some(out)
}

/// Eingebettetes PNG/JPG; Platz und Größe stecken in der Gruppenmatrix davor.
fn image(cx: &mut Ctx, i: &usvg::Image, alpha: f64) -> Option<Item> {
    if !i.is_visible() {
        return None;
    }
    let r = match i.kind() {
        usvg::ImageKind::PNG(d) | usvg::ImageKind::JPEG(d) => match raster::import(d) {
            Ok(r) => r,
            Err(e) => {
                cx.warn(&format!("Bild übersprungen: {e}"));
                return None;
            }
        },
        _ => {
            cx.warn("Nur PNG/JPG-Bilder übernommen (GIF/WebP/SVG übersprungen).");
            return None;
        }
    };
    let size = i.size();
    cx.images.insert(r.hash.clone(), r.png);
    Some(Item::Image {
        matrix: IDENTITY,
        width: size.width() as f64,
        height: size.height() as f64,
        image: r.hash,
        opacity: alpha,
    })
}

fn color(c: usvg::Color) -> Color {
    Color::rgb(
        c.red as f64 / 255.0,
        c.green as f64 / 255.0,
        c.blue as f64 / 255.0,
    )
}

/// Gleiche Deckkraft aller Verlaufsstopps wirkt wie Objekt-Deckkraft; wechselnde gibt es im Modell nicht.
fn stop_alpha(cx: &mut Ctx, p: &usvg::Paint) -> f64 {
    let s = match p {
        usvg::Paint::LinearGradient(g) => g.stops(),
        usvg::Paint::RadialGradient(g) => g.stops(),
        _ => return 1.0,
    };
    let first = s.first().map_or(1.0, |s| s.opacity().get() as f64);
    let uniform = s
        .iter()
        .all(|s| (s.opacity().get() as f64 - first).abs() < 1e-6);
    if uniform {
        first
    } else {
        cx.warn("Verlauf mit wechselnder Deckkraft: Deckkraft ignoriert.");
        1.0
    }
}

fn stops(_cx: &mut Ctx, s: &[usvg::Stop]) -> Vec<GradientStop> {
    s.iter()
        .map(|s| GradientStop {
            offset: s.offset().get() as f64,
            color: color(s.color()),
        })
        .collect()
}

fn paint(cx: &mut Ctx, p: &usvg::Paint) -> Option<Fill> {
    let last = |s: &[usvg::Stop]| s.last().map(|s| Fill::Color(color(s.color())));
    match p {
        usvg::Paint::Color(c) => Some(Fill::Color(color(*c))),
        usvg::Paint::LinearGradient(g) => {
            if g.spread_method() != usvg::SpreadMethod::Pad {
                cx.warn("Verlauf-Wiederholung (reflect/repeat) als pad übernommen.");
            }
            let t = mat(g.transform());
            let (a, b) = (
                Point {
                    x: g.x1() as f64,
                    y: g.y1() as f64,
                },
                Point {
                    x: g.x2() as f64,
                    y: g.y2() as f64,
                },
            );
            // Exakt ohne Verlaufsmatrix: Farbe hängt nur von (p − A)·w ab, w = L⁻ᵀ·v.
            let (v, det) = (
                Point {
                    x: b.x - a.x,
                    y: b.y - a.y,
                },
                t[0] * t[3] - t[1] * t[2],
            );
            let w = Point {
                x: (t[3] * v.x - t[1] * v.y) / det,
                y: (t[0] * v.y - t[2] * v.x) / det,
            };
            let (vv, ww) = (v.x * v.x + v.y * v.y, w.x * w.x + w.y * w.y);
            if det.abs() < 1e-12 || ww < 1e-18 {
                return last(g.stops());
            }
            let from = apply(&t, a);
            let to = Point {
                x: from.x + w.x * vv / ww,
                y: from.y + w.y * vv / ww,
            };
            Some(Fill::Gradient(Gradient {
                kind: GradientKind::Linear,
                from,
                to,
                stops: stops(cx, g.stops()),
            }))
        }
        usvg::Paint::RadialGradient(g) => {
            if g.spread_method() != usvg::SpreadMethod::Pad {
                cx.warn("Verlauf-Wiederholung (reflect/repeat) als pad übernommen.");
            }
            if g.fx() != g.cx() || g.fy() != g.cy() || g.fr().get() > 0.0 {
                cx.warn("Brennpunkt im radialen Verlauf ignoriert.");
            }
            let t = mat(g.transform());
            // Ungleichmäßig skaliert → Ellipse; Modell kennt nur Kreise.
            let (sx, sy, skew) = (
                t[0].hypot(t[1]),
                t[2].hypot(t[3]),
                t[0] * t[2] + t[1] * t[3],
            );
            if (sx - sy).abs() > 1e-6 * sx.max(sy) || skew.abs() > 1e-6 * sx * sy {
                cx.warn("Elliptischer radialer Verlauf als Kreis angenähert.");
            }
            let from = apply(
                &t,
                Point {
                    x: g.cx() as f64,
                    y: g.cy() as f64,
                },
            );
            let r = g.r().get() as f64 * (t[0] * t[3] - t[1] * t[2]).abs().sqrt();
            let to = Point {
                x: from.x + r,
                y: from.y,
            };
            Some(Fill::Gradient(Gradient {
                kind: GradientKind::Radial,
                from,
                to,
                stops: stops(cx, g.stops()),
            }))
        }
        usvg::Paint::Pattern(_) => {
            cx.warn("Muster als Grau übernommen.");
            Some(Fill::Color(Color::rgb(0.5, 0.5, 0.5)))
        }
    }
}

/// Anfasser auf dem Knoten = kein Anfasser (Gerade bleibt Gerade).
fn handle(h: Point, n: &PathPoint) -> Option<Point> {
    ((h.x - n.x).abs() > 1e-9 || (h.y - n.y).abs() > 1e-9).then_some(h)
}

pub(crate) fn subpaths(d: &tsp::Path) -> Vec<Subpath> {
    let node = |p: tsp::Point| PathPoint {
        x: p.x as f64,
        y: p.y as f64,
        kind: NodeType::Corner,
        handle_in: None,
        handle_out: None,
    };
    let mut out: Vec<Subpath> = Vec::new();
    for seg in d.segments() {
        if let PathSegment::MoveTo(p) = seg {
            out.push(Subpath {
                closed: false,
                nodes: vec![node(p)],
            });
            continue;
        }
        let Some(sp) = out.last_mut() else { continue };
        let Some(prev) = sp.nodes.last_mut() else {
            continue;
        };
        match seg {
            PathSegment::LineTo(p) => sp.nodes.push(node(p)),
            PathSegment::QuadTo(q, p) => {
                // Quadratisch → kubisch: Kontrollpunkte 2/3 Richtung q.
                let (s, q, e) = (
                    Point {
                        x: prev.x,
                        y: prev.y,
                    },
                    pt(q),
                    pt(p),
                );
                let c1 = Point {
                    x: s.x + 2.0 / 3.0 * (q.x - s.x),
                    y: s.y + 2.0 / 3.0 * (q.y - s.y),
                };
                let c2 = Point {
                    x: e.x + 2.0 / 3.0 * (q.x - e.x),
                    y: e.y + 2.0 / 3.0 * (q.y - e.y),
                };
                prev.handle_out = handle(c1, prev);
                let mut n = node(p);
                n.handle_in = handle(c2, &n);
                sp.nodes.push(n);
            }
            PathSegment::CubicTo(a, b, p) => {
                prev.handle_out = handle(pt(a), prev);
                let mut n = node(p);
                n.handle_in = handle(pt(b), &n);
                sp.nodes.push(n);
            }
            PathSegment::Close => {
                sp.closed = true;
                // Schlusspunkt = Startpunkt → zusammenlegen, sein Anfasser wird handle_in des Starts.
                let (f, l) = (&sp.nodes[0], &sp.nodes[sp.nodes.len() - 1]);
                if sp.nodes.len() > 1 && (f.x - l.x).abs() < 1e-4 && (f.y - l.y).abs() < 1e-4 {
                    let l = sp.nodes.pop().unwrap();
                    sp.nodes[0].handle_in = l.handle_in;
                }
            }
            PathSegment::MoveTo(_) => unreachable!(),
        }
    }
    out
}
