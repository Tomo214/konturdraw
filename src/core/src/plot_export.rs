//! Plotter/Laser (3g-2): DXF R12 und HPGL. Nur Konturen sichtbarer Pfade (Füllung oder Kontur), am Rahmen geschnitten,
//! Kurven als Polylinien mit 0,01 mm Toleranz; Bilder und Strichstärken entfallen. y zeigt nach oben.
use crate::scene::{apply, clipped_leaves, segments, Item, Mat, Point, Scene, Seg, Subpath};
use kurbo::{BezPath, PathEl};
use serde::Deserialize;
use std::fmt::Write;

const TOLERANCE: f64 = 0.01; // mm

/// Teilpfade als Linienzüge in Seitenkoordinaten (mm, y nach unten); geschlossen ohne doppelten Endpunkt.
fn flatten(m: &Mat, subpaths: &[Subpath]) -> Vec<(Vec<Point>, bool)> {
    let mut out = Vec::new();
    for sp in subpaths {
        let Some(first) = sp.nodes.first() else {
            continue;
        };
        let p = |q: Point| {
            let w = apply(m, q);
            kurbo::Point::new(w.x, w.y)
        };
        let mut bez = BezPath::new();
        bez.move_to(p(Point {
            x: first.x,
            y: first.y,
        }));
        for s in segments(sp) {
            match s {
                Seg::Line(e) => bez.line_to(p(e)),
                Seg::Cubic(a, b, e) => bez.curve_to(p(a), p(b), p(e)),
            }
        }
        let mut pts: Vec<Point> = Vec::new();
        kurbo::flatten(bez, TOLERANCE, |el| {
            if let PathEl::MoveTo(q) | PathEl::LineTo(q) = el {
                pts.push(Point { x: q.x, y: q.y });
            }
        });
        if sp.closed && pts.len() > 1 && pts.first() == pts.last() {
            pts.pop();
        }
        if pts.len() > 1 {
            out.push((pts, sp.closed));
        }
    }
    out
}

/// Schnittpunkt von a→b mit c→d als Anteil auf a→b (echt innen), sonst None.
fn cross(a: Point, b: Point, c: Point, d: Point) -> Option<f64> {
    let (rx, ry, sx, sy) = (b.x - a.x, b.y - a.y, d.x - c.x, d.y - c.y);
    let den = rx * sy - ry * sx;
    if den.abs() < 1e-12 {
        return None;
    }
    let (qx, qy) = (c.x - a.x, c.y - a.y);
    let t = (qx * sy - qy * sx) / den;
    let u = (qx * ry - qy * rx) / den;
    (t > 0.0 && t < 1.0 && (0.0..=1.0).contains(&u)).then_some(t)
}

fn inside(p: Point, rings: &[Vec<Point>], even_odd: bool) -> bool {
    let mut wind = 0;
    for ring in rings {
        for j in 0..ring.len() {
            let (a, b) = (ring[j], ring[(j + 1) % ring.len()]);
            if (a.y <= p.y) != (b.y <= p.y) && a.x + (p.y - a.y) / (b.y - a.y) * (b.x - a.x) > p.x {
                wind += if b.y > a.y { 1 } else { -1 };
            }
        }
    }
    if even_odd {
        wind % 2 != 0
    } else {
        wind != 0
    }
}

/// Linienzug am Umriss schneiden: Stücke innerhalb bleiben, ganz innen bleibt er unverändert.
fn clip_line(
    (pts, closed): (Vec<Point>, bool),
    rings: &[Vec<Point>],
    even_odd: bool,
) -> Vec<(Vec<Point>, bool)> {
    let n = pts.len();
    let lerp = |a: Point, b: Point, t: f64| Point {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
    };
    let (mut pieces, mut cur): (Vec<Vec<Point>>, Vec<Point>) = (Vec::new(), Vec::new());
    let (mut split, mut first_in) = (false, None);
    for i in 0..if closed { n } else { n - 1 } {
        let (a, b) = (pts[i], pts[(i + 1) % n]);
        let mut ts = vec![0.0, 1.0];
        for ring in rings {
            for j in 0..ring.len() {
                ts.extend(cross(a, b, ring[j], ring[(j + 1) % ring.len()]));
            }
        }
        ts.sort_by(f64::total_cmp);
        ts.dedup_by(|x, y| (*x - *y).abs() < 1e-9);
        for w in ts.windows(2) {
            let keep = inside(lerp(a, b, (w[0] + w[1]) / 2.0), rings, even_odd);
            first_in.get_or_insert(keep);
            if keep {
                if cur.is_empty() {
                    cur.push(lerp(a, b, w[0]));
                }
                cur.push(lerp(a, b, w[1]));
            } else {
                split = true;
                if cur.len() > 1 {
                    pieces.push(std::mem::take(&mut cur));
                }
                cur.clear();
            }
        }
    }
    if !split {
        return vec![(pts, closed)];
    }
    // Geschlossen und am Anfang wie am Ende innen: letztes und erstes Stück sind eines.
    if closed && first_in == Some(true) && !cur.is_empty() && !pieces.is_empty() {
        let head = pieces.remove(0);
        cur.extend(&head[1..]);
    }
    if cur.len() > 1 {
        pieces.push(cur);
    }
    pieces.into_iter().map(|p| (p, false)).collect()
}

/// Linienzüge aller sichtbaren Pfade (Füllung oder Kontur), am Rahmen geschnitten.
fn polylines(scene: &Scene) -> Vec<(Vec<Point>, bool)> {
    let leaves = clipped_leaves(&scene.items);
    // Rahmen (Füllung unter, Kontur über dem Inhalt) = zweimal derselbe Umriss → einmal schneiden.
    let frames: Vec<(Mat, &[Subpath])> = leaves
        .iter()
        .flat_map(|l| l.clips.iter().map(|c| (c.matrix, c.subpaths)))
        .collect();
    let mut done: Vec<(Mat, &[Subpath])> = Vec::new();
    let mut out = Vec::new();
    for leaf in &leaves {
        let Item::Path {
            subpaths,
            fill,
            stroke,
            ..
        } = leaf.item
        else {
            continue;
        };
        if fill.is_none() && stroke.is_none() {
            continue;
        }
        let me = (leaf.matrix, subpaths.as_slice());
        if frames.contains(&me) {
            if done.contains(&me) {
                continue;
            }
            done.push(me);
        }
        let mut lines = flatten(&leaf.matrix, subpaths);
        for c in &leaf.clips {
            let rings: Vec<Vec<Point>> = flatten(&c.matrix, c.subpaths)
                .into_iter()
                .map(|(p, _)| p)
                .collect();
            let even_odd = c.fill_rule.is_some();
            lines = lines
                .into_iter()
                .flat_map(|l| clip_line(l, &rings, even_odd))
                .collect();
        }
        out.extend(lines);
    }
    out
}

/// Zahl mit höchstens 4 Nachkommastellen (0,1 µm), ohne Nullen am Ende.
fn num(v: f64) -> String {
    let s = format!("{v:.4}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s == "-0" {
        "0".into()
    } else {
        s.into()
    }
}

/// DXF R12 (AC1009): POLYLINE/VERTEX auf Ebene 0, Einheit mm; Ursprung = linke untere Seitenecke.
pub fn dxf(scene: &Scene) -> String {
    let mut s = String::from(
        "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n",
    );
    s.push_str("0\nSECTION\n2\nENTITIES\n");
    for (pts, closed) in polylines(scene) {
        let _ = write!(
            s,
            "0\nPOLYLINE\n8\n0\n66\n1\n10\n0\n20\n0\n30\n0\n70\n{}\n",
            u8::from(closed)
        );
        for q in pts {
            let _ = write!(
                s,
                "0\nVERTEX\n8\n0\n10\n{}\n20\n{}\n30\n0\n",
                num(q.x),
                num(scene.height - q.y)
            );
        }
        s.push_str("0\nSEQEND\n8\n0\n");
    }
    s.push_str("0\nENDSEC\n0\nEOF\n");
    s
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    /// Linke untere Seitenecke (übliche Schneideplotter)
    #[default]
    LowerLeft,
    /// Seitenmitte
    Center,
}

#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct Plot {
    /// Plottereinheiten je mm; HPGL-Standard 40 (= 1016 je Zoll)
    pub units_per_mm: f64,
    pub origin: Origin,
}

impl Default for Plot {
    fn default() -> Self {
        Plot {
            units_per_mm: 40.0,
            origin: Origin::LowerLeft,
        }
    }
}

/// HPGL: PU zum Anfang, PD durch alle Punkte (geschlossen zurück zum Anfang), Stift 1.
pub fn hpgl(scene: &Scene, plot: &Plot) -> Result<String, String> {
    let u = plot.units_per_mm;
    if !(1.0..=1000.0).contains(&u) {
        return Err("Plottereinheiten je mm: 1 bis 1000 (Standard 40).".into());
    }
    let (ox, oy) = match plot.origin {
        Origin::LowerLeft => (0.0, scene.height),
        Origin::Center => (scene.width / 2.0, scene.height / 2.0),
    };
    let xy = |q: &Point| {
        format!(
            "{},{}",
            ((q.x - ox) * u).round() as i64,
            ((oy - q.y) * u).round() as i64
        )
    };
    let mut s = String::from("IN;SP1;");
    for (pts, closed) in polylines(scene) {
        let mut rest: Vec<String> = pts[1..].iter().map(xy).collect();
        if closed {
            rest.push(xy(&pts[0]));
        }
        let _ = write!(s, "PU{};PD{};", xy(&pts[0]), rest.join(","));
    }
    s.push_str("PU;SP0;");
    Ok(s)
}
