//! SVG-Import über usvg (Spec §11): Gruppen bleiben Gruppen, Formen → Bézier-Pfade, Text → Kurven,
//! eingebettete PNG/JPG → Bilder. Nicht Abbildbares wird vereinfacht oder übersprungen und gemeldet.
use crate::scene::{
    apply, mul, Cap, Color, Fill, FillRule, Gradient, GradientKind, GradientStop, Item, Join, Mat,
    NodeType, PathPoint, Point, Scene, Stroke, Subpath, IDENTITY,
};
use crate::{raster, Images};
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
    // Text wird zu Kurven
    let opt = usvg::Options {
        fontdb: crate::text::system_fonts(),
        ..Default::default()
    };
    let tree = usvg::Tree::from_data(data, &opt).map_err(|e| format!("SVG nicht lesbar: {e}"))?;
    let mut cx = Ctx {
        images: Images::new(),
        warnings: Vec::new(),
    };
    // Eine Gruppe fürs ganze SVG; viewBox steckt in usvg schon in einer Kind-Gruppe.
    let top = mul(&[K, 0.0, 0.0, K, 0.0, 0.0], &mat(tree.root().transform()));
    let children = group(&mut cx, tree.root(), &top);
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

fn group(cx: &mut Ctx, g: &usvg::Group, world: &Mat) -> Vec<Item> {
    let mut out = Vec::new();
    for node in g.children() {
        match node {
            usvg::Node::Group(c) => {
                if c.clip_path().is_some() {
                    cx.warn("Beschneidung (clip-path) ignoriert.");
                }
                if c.mask().is_some() {
                    cx.warn("Maske ignoriert.");
                }
                if !c.filters().is_empty() {
                    cx.warn("Filter ignoriert.");
                }
                if c.opacity().get() < 1.0 {
                    cx.warn("Deckkraft unter 100 % ignoriert.");
                }
                out.extend(sub_group(cx, c, world));
            }
            usvg::Node::Path(p) => out.extend(path(cx, p, world)),
            usvg::Node::Image(i) => out.extend(image(cx, i)),
            usvg::Node::Text(t) => out.extend(sub_group(cx, t.flattened(), world)),
        }
    }
    out
}

fn sub_group(cx: &mut Ctx, g: &usvg::Group, world: &Mat) -> Option<Item> {
    let m = mat(g.transform());
    let children = group(cx, g, &mul(world, &m));
    (!children.is_empty()).then_some(Item::Group {
        matrix: m,
        children,
    })
}

fn path(cx: &mut Ctx, p: &usvg::Path, world: &Mat) -> Option<Item> {
    if !p.is_visible() {
        return None;
    }
    let subpaths = subpaths(p.data());
    let fill = p.fill().and_then(|f| {
        if f.opacity().get() < 1.0 {
            cx.warn("Deckkraft unter 100 % ignoriert.");
        }
        paint(cx, f.paint())
    });
    let stroke = p.stroke().and_then(|s| {
        if s.dasharray().is_some() {
            cx.warn("Gestrichelte Kontur als durchgehende übernommen.");
        }
        if s.opacity().get() < 1.0 {
            cx.warn("Deckkraft unter 100 % ignoriert.");
        }
        let color = match paint(cx, s.paint())? {
            Fill::Color(c) => c,
            Fill::Gradient(g) => {
                cx.warn("Verlauf in Kontur als Vollton übernommen.");
                g.stops[0].color.clone()
            }
        };
        // Breite in Seiten-mm; bei ungleichmäßiger Skalierung gemittelt.
        let det = world[0] * world[3] - world[1] * world[2];
        Some(Stroke {
            color,
            width: s.width().get() as f64 * det.abs().sqrt(),
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
    (!subpaths.is_empty()).then_some(Item::Path {
        matrix: IDENTITY,
        subpaths,
        fill,
        stroke,
        fill_rule,
    })
}

/// Eingebettetes PNG/JPG; Platz und Größe stecken in der Gruppenmatrix davor.
fn image(cx: &mut Ctx, i: &usvg::Image) -> Option<Item> {
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
        opacity: 1.0,
    })
}

fn color(c: usvg::Color) -> Color {
    Color::rgb(
        c.red as f64 / 255.0,
        c.green as f64 / 255.0,
        c.blue as f64 / 255.0,
    )
}

fn stops(cx: &mut Ctx, s: &[usvg::Stop]) -> Vec<GradientStop> {
    if s.iter().any(|s| s.opacity().get() < 1.0) {
        cx.warn("Deckkraft unter 100 % ignoriert.");
    }
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
