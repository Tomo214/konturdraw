//! Boolesche Formen-Befehle (3d, spec.md §7): i_overlay rechnet ganzzahlig robust auf Polygonen,
//! recover.rs führt die Ergebnis-Kanten auf Teilstücke der Original-Segmente zurück (Kurven bleiben Kurven).
pub mod cut;
pub mod outline;
mod recover;

use crate::scene::{segments, Seg, Subpath};
use i_overlay::core::fill_rule::FillRule;
use i_overlay::core::overlay_rule::OverlayRule;
use i_overlay::float::simplify::SimplifyShape;
use i_overlay::float::single::SingleFloatOverlay;
use kurbo::{CubicBez, Line, ParamCurve, PathSeg, Point};
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Op {
    /// alle vereinigt
    Union,
    /// gemeinsame Fläche aller
    Intersect,
    /// erste minus alle übrigen
    Difference,
}

/// Eine Form in gemeinsamen Koordinaten; offene Teilpfade gelten als geschlossen.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shape {
    pub subpaths: Vec<Subpath>,
    #[serde(default)]
    pub even_odd: bool,
}

/// Höchste Abweichung der Polygon-Näherung von der Kurve in mm.
pub(super) const TOL: f64 = 0.002;

pub(super) type Polys = Vec<Vec<[f64; 2]>>;

/// Ergebnis als geschlossene Teilpfade, Löcher gegenläufig (nonzero und gerade/ungerade gleich).
pub fn apply(op: Op, shapes: &[Shape]) -> Result<Vec<Subpath>, String> {
    let mut segs = Vec::new();
    let polys = shapes
        .iter()
        .map(|s| flatten(s, &mut segs))
        .collect::<Result<Vec<_>, _>>()?;
    let op_rule = match op {
        Op::Union => OverlayRule::Union,
        Op::Intersect => OverlayRule::Intersect,
        Op::Difference => OverlayRule::Difference,
    };
    let mut acc: Option<Vec<Polys>> = None;
    for (shape, p) in shapes.iter().zip(&polys) {
        // jede Form erst nach ihrer eigenen Füllregel bereinigen, dann einheitlich nonzero verknüpfen
        let own = p.simplify_shape(rule(shape));
        acc = Some(match acc {
            None => own,
            Some(a) => a.overlay(&own, op_rule, FillRule::NonZero),
        });
    }
    let index = recover::Index::new(&segs);
    Ok(acc
        .unwrap_or_default()
        .iter()
        .flatten()
        .map(|c| index.contour(c))
        .collect())
}

pub(super) fn rule(shape: &Shape) -> FillRule {
    if shape.even_odd {
        FillRule::EvenOdd
    } else {
        FillRule::NonZero
    }
}

pub(super) fn check(sp: &Subpath) -> Result<(), String> {
    let finite = |x: f64, y: f64| x.is_finite() && y.is_finite();
    let ok = sp.nodes.iter().all(|n| {
        finite(n.x, n.y)
            && [n.handle_in, n.handle_out]
                .iter()
                .flatten()
                .all(|h| finite(h.x, h.y))
    });
    if ok {
        Ok(())
    } else {
        Err("Ungültige Koordinate im Pfad (keine endliche Zahl).".into())
    }
}

/// Segmente eines Teilpfads als kurbo-Stücke; geschlossen samt Schlusskante.
pub(super) fn path_segs(sp: &Subpath) -> Vec<PathSeg> {
    let k = |p: crate::scene::Point| Point::new(p.x, p.y);
    sp.nodes
        .iter()
        .zip(segments(sp))
        .map(|(n, seg)| {
            let p0 = Point::new(n.x, n.y);
            match seg {
                Seg::Line(q) => PathSeg::Line(Line::new(p0, k(q))),
                Seg::Cubic(a, b, q) => PathSeg::Cubic(CubicBez::new(p0, k(a), k(b), k(q))),
            }
        })
        .collect()
}

/// Abtastung ohne Endpunkt anhängen (der ist der Anfang des nächsten Segments).
pub(super) fn push_samples(seg: &PathSeg, poly: &mut Vec<[f64; 2]>) {
    let s = samples(seg);
    poly.extend(s[..s.len() - 1].iter().map(|(_, p)| [p.x, p.y]));
}

pub(super) fn flatten(shape: &Shape, segs: &mut Vec<PathSeg>) -> Result<Polys, String> {
    let mut out = Vec::new();
    for sp in &shape.subpaths {
        check(sp)?;
        let closed = Subpath {
            closed: true,
            nodes: sp.nodes.clone(),
        };
        let mut poly = Vec::new();
        for seg in path_segs(&closed) {
            push_samples(&seg, &mut poly);
            segs.push(seg);
        }
        out.push(poly);
    }
    Ok(out)
}

/// Gleichmäßig in t abgetastet, Enden eingeschlossen; Schrittzahl nach Wang, Abweichung ≤ TOL.
pub(super) fn samples(seg: &PathSeg) -> Vec<(f64, Point)> {
    let n = match seg {
        PathSeg::Cubic(c) => {
            let d = |a: Point, b: Point, c: Point| {
                (a.to_vec2() - 2.0 * b.to_vec2() + c.to_vec2()).hypot()
            };
            let l = d(c.p0, c.p1, c.p2).max(d(c.p1, c.p2, c.p3));
            ((0.75 * l / TOL).sqrt().ceil() as usize).clamp(1, 1000)
        }
        _ => 1,
    };
    (0..=n)
        .map(|j| (j as f64 / n as f64, seg.eval(j as f64 / n as f64)))
        .collect()
}
