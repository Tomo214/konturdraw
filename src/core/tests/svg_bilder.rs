// SVG-Import eingebetteter Bilder (PNG, BMP aus CDR, Transparenz) + Roundtrip mit Bild.
use base64::Engine;
use kw_core::color::Cms;
use kw_core::scene::{leaves, Item, Mat, Point, Scene};
use kw_core::{svg_export, svg_import, Images};
use std::io::Cursor;

const K: f64 = 25.4 / 96.0; // SVG-px → mm

fn import(svg: &str) -> svg_import::Imported {
    svg_import::import(svg.as_bytes()).unwrap()
}

fn apply(m: &Mat, p: Point) -> Point {
    Point {
        x: m[0] * p.x + m[2] * p.y + m[4],
        y: m[1] * p.x + m[3] * p.y + m[5],
    }
}

fn near(a: f64, b: f64, tol: f64) -> bool {
    (a - b).abs() <= tol
}

fn png(w: u32, h: u32) -> Vec<u8> {
    let img = image::RgbaImage::from_fn(w, h, |x, _| image::Rgba([x as u8 * 100, 0, 0, 255]));
    let mut out = Vec::new();
    img.write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
        .unwrap();
    out
}

#[test]
fn eingebettetes_png_wird_bild() {
    let data = png(3, 2);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    let imp = import(&format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><image x="96" y="0" width="30" height="20" href="data:image/png;base64,{b64}"/></svg>"#
    ));
    let imgs: Vec<_> = leaves(&imp.scene.items)
        .into_iter()
        .filter(|(_, it)| matches!(it, Item::Image { .. }))
        .collect();
    assert_eq!(imgs.len(), 1);
    let (
        m,
        Item::Image {
            width,
            height,
            image,
            ..
        },
    ) = &imgs[0]
    else {
        unreachable!()
    };
    assert_eq!(
        imp.images.get(image),
        Some(&data),
        "PNG byte-gleich übernommen"
    );
    let (a, b) = (
        apply(m, Point { x: 0.0, y: 0.0 }),
        apply(
            m,
            Point {
                x: *width,
                y: *height,
            },
        ),
    );
    assert!(
        near(a.x, 25.4, 1e-3) && near(b.x - a.x, 30.0 * K, 1e-3) && near(b.y - a.y, 20.0 * K, 1e-3),
        "{a:?} {b:?}"
    );
}

/// BMP wie libcdr Bitmaps aus .cdr-Dateien liefert: 32 bit, BI_RGB, Zeilen von unten, viertes Byte 0.
fn bmp32(w: u32, h: u32, rgb: impl Fn(u32, u32) -> [u8; 3]) -> Vec<u8> {
    let mut px = Vec::new();
    for y in (0..h).rev() {
        for x in 0..w {
            let [r, g, b] = rgb(x, y);
            px.extend([b, g, r, 0]);
        }
    }
    let mut v = b"BM".to_vec();
    for n in [54 + px.len() as u32, 0, 54, 40, w, h] {
        v.extend(n.to_le_bytes());
    }
    v.extend(1u16.to_le_bytes());
    v.extend(32u16.to_le_bytes());
    for n in [0, px.len() as u32, 2835, 2835, 0, 0] {
        v.extend(n.to_le_bytes());
    }
    v.extend(px);
    v
}

#[test]
fn eingebettetes_bmp_aus_cdr_wird_bild() {
    let data = bmp32(2, 1, |x, _| if x == 0 { [255, 0, 0] } else { [0, 0, 255] });
    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    let imp = import(&format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><image width="20" height="10" href="data:image/bmp;base64,{b64}"/></svg>"#
    ));
    let imgs: Vec<_> = leaves(&imp.scene.items)
        .into_iter()
        .filter_map(|(_, it)| match it {
            Item::Image { image, .. } => Some(image.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(imgs.len(), 1, "{:?}", imp.warnings);
    let px = image::load_from_memory(&imp.images[&imgs[0]])
        .unwrap()
        .to_rgba8();
    assert_eq!(px.dimensions(), (2, 1));
    assert_eq!(
        px.get_pixel(0, 0).0,
        [255, 0, 0, 255],
        "deckend, nicht durchsichtig"
    );
    assert_eq!(px.get_pixel(1, 0).0, [0, 0, 255, 255]);
}

#[test]
fn bmp_mit_transparenz_aus_cdr_bleibt_durchsichtig() {
    // libcdr mit Masken-Patch: BITMAPV4HEADER, BI_BITFIELDS, Alpha im vierten Byte
    let px = [0, 0, 255, 255, 255, 0, 0, 0u8]; // links rot deckend, rechts blau durchsichtig
    let mut data = b"BM".to_vec();
    for n in [122 + px.len() as u32, 0, 122, 108, 2, 1] {
        data.extend(n.to_le_bytes());
    }
    data.extend(1u16.to_le_bytes());
    data.extend(32u16.to_le_bytes());
    for n in [
        3,
        px.len() as u32,
        0,
        0,
        0,
        0,
        0xff0000,
        0xff00,
        0xff,
        0xff000000,
        0x73524742,
    ] {
        data.extend((n as u32).to_le_bytes());
    }
    data.extend([0u8; 48]);
    data.extend(px);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    let imp = import(&format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><image width="20" height="10" href="data:image/bmp;base64,{b64}"/></svg>"#
    ));
    let img = leaves(&imp.scene.items)
        .into_iter()
        .find_map(|(_, it)| match it {
            Item::Image { image, .. } => Some(image.clone()),
            _ => None,
        })
        .expect("Bild fehlt");
    let px = image::load_from_memory(&imp.images[&img])
        .unwrap()
        .to_rgba8();
    assert_eq!(px.get_pixel(0, 0).0, [255, 0, 0, 255]);
    assert_eq!(px.get_pixel(1, 0).0[3], 0, "Transparenz verloren");
}

#[test]
fn unlesbares_bild_wird_gemeldet() {
    let imp = import(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><image width="10" height="10" href="data:image/tiff;base64,AAAA"/></svg>"#,
    );
    assert!(
        imp.warnings.join(" ").contains("Bild"),
        "{:?}",
        imp.warnings
    );
}

#[test]
fn roundtrip_bild() {
    let data = png(2, 1);
    let item = Item::Image {
        matrix: [2.0, 0.0, 0.0, 2.0, 5.0, 3.0],
        width: 10.0,
        height: 5.0,
        image: "x".into(),
        opacity: 1.0,
    };
    let scene = Scene {
        width: 40.0,
        height: 20.0,
        items: vec![item],
    };
    let imp = import(
        &svg_export::export(
            &scene,
            &Images::from([("x".to_string(), data.clone())]),
            &Cms::default(),
        )
        .unwrap(),
    );
    let found = leaves(&imp.scene.items)
        .into_iter()
        .find_map(|(m, it)| match it {
            Item::Image {
                width,
                height,
                image,
                ..
            } => Some((
                apply(
                    &m,
                    Point {
                        x: *width,
                        y: *height,
                    },
                ),
                imp.images[image].clone(),
            )),
            _ => None,
        });
    let (corner, bytes) = found.expect("Bild fehlt");
    assert_eq!(bytes, data);
    assert!(
        near(corner.x, 25.0, 1e-3) && near(corner.y, 13.0, 1e-3),
        "{corner:?}"
    );
}
