//! PNG/JPG-Import (Spec §11, Vorlage fürs Nachzeichnen). Abgelegt wird immer PNG.
use crate::scene::{Item, Scene, IDENTITY};
use crate::svg_import::Imported;
use crate::Images;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader};
use sha2::{Digest, Sha256};
use std::io::Cursor;

pub struct Raster {
    pub hash: String,
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Inhalts-Hash als Dateiname in der Bildablage (64 Bit, hex).
pub fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)[..8]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub fn import(data: &[u8]) -> Result<Raster, String> {
    let reader = ImageReader::new(Cursor::new(data))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let format = reader.format();
    if !matches!(format, Some(ImageFormat::Png | ImageFormat::Jpeg)) {
        return Err("Nur PNG und JPG werden unterstützt.".into());
    }
    let err = |e: image::ImageError| format!("Bild nicht lesbar: {e}");
    let mut decoder = reader.into_decoder().map_err(err)?;
    // Handyfotos: Drehung steht oft nur in den EXIF-Daten.
    let orientation = decoder.orientation().map_err(err)?;
    let mut img = DynamicImage::from_decoder(decoder).map_err(err)?;
    let turned = orientation != image::metadata::Orientation::NoTransforms;
    img.apply_orientation(orientation);

    let png = if format == Some(ImageFormat::Png) && !turned {
        data.to_vec()
    } else {
        let mut out = Vec::new();
        img.write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
            .map_err(err)?;
        out
    };
    Ok(Raster {
        hash: hash(&png),
        png,
        width: img.width(),
        height: img.height(),
    })
}

/// Pixelbild als eigene Szene in Bildgröße; 96 dpi wie CSS-Pixel im SVG-Import.
pub fn import_scene(data: &[u8]) -> Result<Imported, String> {
    let r = import(data)?;
    let (w, h) = (r.width as f64 / 96.0 * 25.4, r.height as f64 / 96.0 * 25.4);
    let item = Item::Image {
        matrix: IDENTITY,
        width: w,
        height: h,
        image: r.hash.clone(),
        opacity: 1.0,
    };
    let scene = Scene {
        width: w,
        height: h,
        items: vec![item],
    };
    Ok(Imported {
        scene,
        images: Images::from([(r.hash, r.png)]),
        warnings: vec![],
    })
}
