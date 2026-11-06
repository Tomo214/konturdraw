//! Eingebettete Bilder im SVG-Import, ausgelagert aus svg_import.rs.
use super::{group, mat, Ctx};
use crate::raster;
use crate::scene::{mul, Item, Mat, IDENTITY};

/// BMP → PNG (usvg kennt kein BMP).
pub(super) fn bmp_png(data: &[u8]) -> Option<Vec<u8>> {
    let img = image::load_from_memory_with_format(data, image::ImageFormat::Bmp).ok()?;
    let mut out = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .ok()?;
    Some(out)
}

/// Eingebettetes PNG/JPG; Platz und Größe stecken in der Gruppenmatrix davor.
/// Eingebettetes SVG (z. B. CDR-Vollfarbmuster über libcdr) bleibt Vektor: usvg hat es schon
/// auf seine eigene Größe gebracht, die Gruppenmatrix davor skaliert es wie ein Bild.
pub(super) fn image(cx: &mut Ctx, i: &usvg::Image, world: &Mat, alpha: f64) -> Option<Item> {
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
        usvg::ImageKind::SVG(t) => {
            let m = mat(t.root().transform());
            let children = group(cx, t.root(), &mul(world, &m), alpha);
            return (!children.is_empty()).then_some(Item::Group {
                matrix: m,
                children,
            });
        }
        _ => {
            cx.warn("Nur PNG/JPG/SVG-Bilder übernommen (GIF/WebP übersprungen).");
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
