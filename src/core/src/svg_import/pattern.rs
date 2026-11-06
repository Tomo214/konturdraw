//! Musterfüllung aus SVG `<pattern>` (8c), ausgelagert aus svg_import.rs.
use super::{group, mat, Ctx};
use crate::scene::{mul, Pattern, PatternKind, IDENTITY};

/// Kachel (0, 0)–(width, height) wie resvg: Inhalt beginnt an der Kachelecke, Matrix =
/// patternTransform · translate(x, y). Kontur im Inhalt in Kachel-Einheiten.
pub(super) fn convert(cx: &mut Ctx, p: &usvg::Pattern) -> Pattern {
    let r = p.rect();
    let corner = [1.0, 0.0, 0.0, 1.0, r.x() as f64, r.y() as f64];
    Pattern {
        kind: PatternKind::Pattern,
        width: r.width() as f64,
        height: r.height() as f64,
        matrix: mul(&mat(p.transform()), &corner),
        items: group(cx, p.root(), &IDENTITY, 1.0),
    }
}
