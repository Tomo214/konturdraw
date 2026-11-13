//! Kontur-Werkzeug (statisch, spec.md §5): parallele Umrisse im festen Abstand. Jeder Schritt k wird
//! direkt aus dem Original gerechnet (Abstand k × offset), damit sich keine Fehler aufsummieren:
//! außen = Fläche ∪ Stift der Breite 2·d um ihren Rand, innen = Fläche ∖ derselbe Stift.
use super::outline::outline;
use super::{apply, Op, Shape};
use crate::scene::{Cap, Join, Subpath};
use serde::Deserialize;

/// Obergrenze der Schritte (auch für „zur Mitte“ mit sehr kleinem Abstand).
pub const MAX_STEPS: usize = 250;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Outside,
    Inside,
    /// nach innen, bis nichts mehr passt; die Schrittzahl zählt nicht
    Center,
}

/// Ein Ergebnis je Schritt (geschlossene Teilpfade, Löcher gegenläufig), vom Original weg sortiert.
/// Alle Formen zählen als eine Fläche (Gruppe = gemeinsamer Umriss); offene Linien nur nach außen.
pub fn contour(shapes: &[Shape], offset: f64, steps: usize, dir: Direction, join: Join) -> Result<Vec<Vec<Subpath>>, String> {
    if !(offset.is_finite() && offset > 0.0) {
        return Err("Der Konturabstand muss größer als 0 sein.".into());
    }
    if steps == 0 || steps > MAX_STEPS {
        return Err(format!("Die Schrittzahl muss zwischen 1 und {MAX_STEPS} liegen."));
    }
    let closed: Vec<Shape> = shapes
        .iter()
        .map(|s| Shape {
            subpaths: s.subpaths.iter().filter(|sp| sp.closed).cloned().collect(),
            even_odd: s.even_odd,
        })
        .filter(|s| !s.subpaths.is_empty())
        .collect();
    let open: Vec<Subpath> = shapes
        .iter()
        .flat_map(|s| &s.subpaths)
        .filter(|sp| !sp.closed && sp.nodes.len() > 1)
        .cloned()
        .collect();
    let region = if closed.is_empty() { vec![] } else { apply(Op::Union, &closed)? };
    if dir != Direction::Outside && region.is_empty() {
        return Ok(vec![]);
    }
    let limit = if dir == Direction::Center { MAX_STEPS } else { steps };
    let cap = if join == Join::Round { Cap::Round } else { Cap::Square };
    let as_shape = |subpaths: Vec<Subpath>| Shape { subpaths, even_odd: false };
    let mut out = Vec::new();
    for k in 1..=limit {
        let width = 2.0 * k as f64 * offset;
        let ring = if region.is_empty() { vec![] } else { outline(&region, width, Cap::Butt, join)? };
        let step = if dir == Direction::Outside {
            let lines = if open.is_empty() { vec![] } else { outline(&open, width, cap, join)? };
            let parts: Vec<Shape> = [region.clone(), ring, lines].into_iter().filter(|p| !p.is_empty()).map(as_shape).collect();
            apply(Op::Union, &parts)?
        } else {
            apply(Op::Difference, &[as_shape(region.clone()), as_shape(ring)])?
        };
        if step.is_empty() {
            break;
        }
        out.push(step);
    }
    Ok(out)
}
