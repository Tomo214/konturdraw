// .kwk und Rasterbild-Import (architecture.md §5, Spec §11).
use kw_core::{kwk, raster, Images};
use std::io::{Cursor, Write};

fn png(w: u32, h: u32, f: impl Fn(u32, u32) -> [u8; 4]) -> Vec<u8> {
    let img = image::RgbaImage::from_fn(w, h, |x, y| image::Rgba(f(x, y)));
    let mut out = Vec::new();
    img.write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
        .unwrap();
    out
}

fn zip_with(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, data) in entries {
        z.start_file(*name, zip::write::SimpleFileOptions::default())
            .unwrap();
        z.write_all(data).unwrap();
    }
    z.finish().unwrap().into_inner()
}

const DOC: &str = r#"{"schemaVersion":1,"pages":[]}"#;

#[test]
fn kwk_roundtrip_ist_verlustfrei() {
    let a = raster::import(&png(3, 2, |x, _| [x as u8 * 80, 0, 0, 255])).unwrap();
    let images = Images::from([(a.hash.clone(), a.png.clone())]);
    let file = kwk::pack(DOC, &images).unwrap();
    let (doc, back) = kwk::unpack(&file).unwrap();
    assert_eq!(doc, DOC);
    assert_eq!(back, images);
}

#[test]
fn kwk_lehnt_kaputte_dateien_ab() {
    assert!(kwk::unpack(b"kein zip").is_err());
    assert!(kwk::unpack(&zip_with(&[("images/x.png", b"")]))
        .unwrap_err()
        .contains("document.json"));
    assert!(kwk::unpack(&zip_with(&[("document.json", b"[1,2]")])).is_err());
    // Neuere Version: lieber ablehnen als still Teile verlieren.
    let newer = zip_with(&[("document.json", br#"{"schemaVersion":2}"#)]);
    assert!(kwk::unpack(&newer).unwrap_err().contains("neueren"));
    // Bild passt nicht zu seinem Hash → beschädigt.
    let bad = zip_with(&[
        ("document.json", DOC.as_bytes()),
        ("images/0123456789abcdef.png", b"anders"),
    ]);
    assert!(kwk::unpack(&bad).unwrap_err().contains("beschädigt"));
}

#[test]
fn png_bleibt_byte_gleich() {
    let data = png(4, 3, |x, y| [x as u8, y as u8, 7, 200]);
    let r = raster::import(&data).unwrap();
    assert_eq!((r.width, r.height), (4, 3));
    assert_eq!(r.png, data);
    assert_eq!(r.hash.len(), 16);
    assert_eq!(r.hash, raster::import(&data).unwrap().hash);
}

#[test]
fn jpg_wird_png_mit_gleichen_massen() {
    let img = image::RgbImage::from_pixel(8, 5, image::Rgb([200, 40, 40]));
    let mut jpg = Vec::new();
    img.write_to(&mut Cursor::new(&mut jpg), image::ImageFormat::Jpeg)
        .unwrap();
    let r = raster::import(&jpg).unwrap();
    assert_eq!((r.width, r.height), (8, 5));
    let back = image::load_from_memory_with_format(&r.png, image::ImageFormat::Png)
        .unwrap()
        .to_rgb8();
    let p = back.get_pixel(4, 2).0;
    assert!(p[0].abs_diff(200) < 8 && p[1].abs_diff(40) < 8, "{p:?}");
}

#[test]
fn exif_drehung_wird_angewendet() {
    // 2×1 px, links rot; Orientierung 6 = 90° im Uhrzeigersinn → 1×2, oben rot.
    let img = image::RgbImage::from_fn(2, 1, |x, _| {
        if x == 0 {
            image::Rgb([255, 0, 0])
        } else {
            image::Rgb([0, 0, 255])
        }
    });
    let exif =
        [b"MM\0\x2a\0\0\0\x08\0\x01\x01\x12\0\x03\0\0\0\x01\0\x06\0\0\0\0\0\0".as_slice()].concat();
    let mut data = Vec::new();
    let mut enc = image::codecs::png::PngEncoder::new(&mut data);
    image::ImageEncoder::set_exif_metadata(&mut enc, exif).unwrap();
    image::ImageEncoder::write_image(enc, img.as_raw(), 2, 1, image::ExtendedColorType::Rgb8)
        .unwrap();
    let r = raster::import(&data).unwrap();
    assert_eq!((r.width, r.height), (1, 2));
    let back = image::load_from_memory(&r.png).unwrap().to_rgb8();
    assert_eq!(back.get_pixel(0, 0).0, [255, 0, 0]);
}

#[test]
fn unbekanntes_format_meldet_fehler() {
    assert!(raster::import(b"GIF89a....").is_err());
    assert!(raster::import(b"").is_err());
}

#[test]
fn pixelbild_wird_szene_in_96_dpi() {
    use kw_core::scene::{Item, IDENTITY};
    let imp = raster::import_scene(&png(96, 48, |_, _| [1, 2, 3, 255])).unwrap();
    assert_eq!((imp.scene.width, imp.scene.height), (25.4, 12.7));
    let [Item::Image {
        matrix,
        width,
        height,
        image,
        ..
    }] = &imp.scene.items[..]
    else {
        panic!("{:?}", imp.scene.items)
    };
    assert_eq!((*matrix, *width, *height), (IDENTITY, 25.4, 12.7));
    assert!(imp.images.contains_key(image) && imp.warnings.is_empty());
}
