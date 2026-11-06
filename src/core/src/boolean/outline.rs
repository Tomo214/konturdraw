//! Kontur in Objekt (5c): die gezeichnete Kontur als geschlossene Fläche. kurbo legt den Umriss des
//! Stifts (Enden, Ecken, Gehrungsgrenze 10 wie Anzeige und Exporte), i_overlay vereinigt Überlappungen
//! nonzero, recover macht aus den Polygonkanten wieder die Kurvenstücke von kurbo.
use super::cut::polys_of;
use super::recover::Index;
use super::{check, path_segs};
use crate::scene::{dash_pattern, Cap, Join, Subpath};
use i_overlay::core::fill_rule::FillRule;
use i_overlay::float::simplify::SimplifyShape;
use kurbo::{BezPath, ParamCurve, StrokeOpts};

/// Gehrungsgrenze wie Canvas, PDF, SVG und PNG (svg_export.rs, pdf_export.rs, png_export.rs).
const MITER_LIMIT: f64 = 10.0;

/// Umriss der Kontur mit runder, gleichmäßiger Feder der Breite width (gleiche Koordinaten wie subpaths).
pub fn outline(subpaths: &[Subpath], width: f64, cap: Cap, join: Join) -> Result<Vec<Subpath>, String> {
    outline_dashed(subpaths, width, cap, join, &[])
}

/// Wie outline, mit Strichmuster (Strich, Lücke, … in denselben Koordinaten; leer = durchgehend):
/// jeder Strich wird eine eigene Fläche.
pub fn outline_dashed(
    subpaths: &[Subpath],
    width: f64,
    cap: Cap,
    join: Join,
    dash: &[f64],
) -> Result<Vec<Subpath>, String> {
    if !(width.is_finite() && width > 0.0) {
        return Err("Die Konturbreite muss größer als 0 sein.".into());
    }
    let mut bez = BezPath::new();
    for sp in subpaths {
        check(sp)?;
        if sp.nodes.len() < 2 {
            continue;
        }
        let segs = path_segs(sp);
        bez.move_to(segs[0].start());
        for s in &segs {
            bez.push(s.as_path_el());
        }
        if sp.closed {
            bez.close_path();
        }
    }
    let stroke = kurbo::Stroke::new(width)
        .with_caps(match cap {
            Cap::Butt => kurbo::Cap::Butt,
            Cap::Round => kurbo::Cap::Round,
            Cap::Square => kurbo::Cap::Square,
        })
        .with_join(match join {
            Join::Miter => kurbo::Join::Miter,
            Join::Round => kurbo::Join::Round,
            Join::Bevel => kurbo::Join::Bevel,
        })
        .with_miter_limit(MITER_LIMIT)
        .with_dashes(0.0, dash_pattern(dash).unwrap_or(&[]).iter().copied());
    let path = kurbo::stroke(bez, &stroke, &StrokeOpts::default(), 1e-3);
    let mut segs = Vec::new();
    let polys = polys_of(&path, &mut segs);
    if polys.is_empty() {
        return Ok(vec![]);
    }
    let index = Index::new(&segs);
    Ok(polys
        .simplify_shape(FillRule::NonZero)
        .iter()
        .flatten()
        .map(|c| index.contour(c))
        .collect())
}
