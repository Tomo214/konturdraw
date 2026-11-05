//! Plotter/Laser (3g-2): DXF R12 und HPGL. Nur Konturen sichtbarer Pfade (Füllung oder Kontur),
//! Kurven als Polylinien mit 0,01 mm Toleranz; Bilder und Strichstärken entfallen. y zeigt nach oben.
use crate::scene::{apply, leaves, segments, Item, Point, Scene, Seg};
use kurbo::{BezPath, PathEl};
use serde::Deserialize;
use std::fmt::Write;

const TOLERANCE: f64 = 0.01; // mm

/// Linienzüge in Seitenkoordinaten (mm, y nach unten); geschlossen ohne doppelten Endpunkt.
fn polylines(scene: &Scene) -> Vec<(Vec<Point>, bool)> {
    let mut out = Vec::new();
    for (m, it) in leaves(&scene.items) {
        let Item::Path {
            subpaths,
            fill,
            stroke,
            ..
        } = it
        else {
            continue;
        };
        if fill.is_none() && stroke.is_none() {
            continue;
        }
        for sp in subpaths {
            let Some(first) = sp.nodes.first() else {
                continue;
            };
            let p = |q: Point| {
                let w = apply(&m, q);
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
