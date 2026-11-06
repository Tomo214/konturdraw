// Musterfüllung (8c): Export je Format (PNG direkt, SVG über resvg, PDF über CoreGraphics) und SVG-Import.
use kw_core::color::Cms;
use kw_core::scene::{leaves, Color, Fill, Item, Scene, IDENTITY};
use kw_core::{pdf_export, png_export, svg_export, svg_import, Images};
use tiny_skia::{Pixmap, Transform};

/// Farbe an (x, y) mm auf weißem Grund.
fn color_at(pm: &Pixmap, mm: f64, x: f64, y: f64) -> [u8; 3] {
    let p = pm
        .pixel((x * mm).floor() as u32, (y * mm).floor() as u32)
        .unwrap();
    let white = 255 - p.alpha(); // vormultipliziert: Farbe + (1 − α) · Weiß
    [p.red() + white, p.green() + white, p.blue() + white]
}

fn render_svg(svg: &str, mm: f64) -> Pixmap {
    let tree = resvg::usvg::Tree::from_str(svg, &Default::default()).unwrap();
    let (w, h) = (
        tree.size().width() * 25.4 / 96.0,
        tree.size().height() * 25.4 / 96.0,
    ); // px → mm
    let mut pm = Pixmap::new(
        (w * mm as f32).round() as u32,
        (h * mm as f32).round() as u32,
    )
    .unwrap();
    let s = pm.width() as f32 / tree.size().width();
    resvg::render(&tree, Transform::from_scale(s, s), &mut pm.as_mut());
    pm
}

/// PDF über CoreGraphics (sips) rastern, längste Seite = `max_px`; None außerhalb von macOS.
fn render_pdf(pdf: &[u8], max_px: u32, name: &str) -> Option<Pixmap> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let dir = std::env::temp_dir().join(format!("kw-core-{}-{name}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let (src, out) = (dir.join("in.pdf"), dir.join("out.png"));
    std::fs::write(&src, pdf).unwrap();
    let st = std::process::Command::new("sips")
        // Ohne matchTo rendert sips in den Bildschirm-Farbraum (Display P3).
        .args([
            "-s",
            "format",
            "png",
            "-Z",
            &max_px.to_string(),
            "--matchTo",
            "/System/Library/ColorSync/Profiles/sRGB Profile.icc",
        ])
        .args([src.to_str()?, "--out", out.to_str()?])
        .stdout(std::process::Stdio::null())
        .status()
        .unwrap();
    assert!(
        st.success(),
        "CoreGraphics konnte die PDF nicht lesen ({st})"
    );
    let pm = Pixmap::decode_png(&std::fs::read(&out).unwrap()).unwrap();
    std::fs::remove_dir_all(&dir).ok();
    Some(pm)
}

/// Musterfüllung (8c): Streifen rot/blau je 5 mm, Kachel-Objekt mit eigener Matrix; rechts
/// dasselbe Muster um 90° gedreht in einem um (20, 2,5) verschobenen Objekt, daneben bleibt die Seite frei.
fn pattern_scene() -> Scene {
    use serde_json::json;
    let sq = |x0: f64, y0: f64, x1: f64, y1: f64| {
        let n = |x: f64, y: f64| json!({ "x": x, "y": y, "type": "corner" });
        json!({ "closed": true, "nodes": [n(x0, y0), n(x1, y0), n(x1, y1), n(x0, y1)] })
    };
    let tile = json!([
        { "kind": "path", "matrix": IDENTITY, "subpaths": [sq(0.0, 0.0, 1.0, 1.0)], "fill": { "model": "rgb", "values": [0, 0, 1] }, "stroke": null },
        { "kind": "path", "matrix": [0.5, 0, 0, 1, 0, 0], "subpaths": [sq(0.0, 0.0, 1.0, 1.0)], "fill": { "model": "rgb", "values": [1, 0, 0] }, "stroke": null }
    ]);
    let pattern = |m: [f64; 6]| json!({ "kind": "pattern", "width": 1, "height": 1, "matrix": m, "items": tile });
    let left = json!({ "kind": "path", "matrix": IDENTITY, "subpaths": [sq(0.0, 0.0, 20.0, 20.0)], "fill": pattern([10.0, 0.0, 0.0, 10.0, 0.0, 0.0]), "stroke": null });
    let right = json!({ "kind": "path", "matrix": [1, 0, 0, 1, 20, 2.5], "subpaths": [sq(0.0, 0.0, 15.0, 17.5)], "fill": pattern([0.0, 10.0, -10.0, 0.0, 0.0, 0.0]), "stroke": null });
    serde_json::from_value(json!({ "width": 40, "height": 20, "items": [left, right] })).unwrap()
}

fn check_pattern(pm: &Pixmap, mm: f64, what: &str) {
    let (red, blue, white) = ([255, 0, 0], [0, 0, 255], [255, 255, 255]);
    let probes = [
        ("1. Streifen", 2.5, 5.0, red),
        ("2. Streifen", 7.5, 5.0, blue),
        ("Wiederholung", 12.5, 15.0, red),
        ("Wiederholung 2", 17.5, 15.0, blue),
        ("über dem Objekt", 30.0, 1.0, white),
        ("gedreht, mit Objekt verschoben", 30.0, 6.0, red),
        ("gedreht 2. Streifen", 30.0, 11.0, blue),
        ("gedreht Wiederholung", 25.0, 16.0, red),
        ("außerhalb des Objekts", 37.5, 10.0, white),
    ];
    let fails: Vec<_> = probes
        .iter()
        .filter_map(|(name, x, y, want)| {
            let got = color_at(pm, mm, *x, *y);
            (0..3)
                .any(|i| got[i].abs_diff(want[i]) > 3)
                .then(|| format!("{name}: {got:?} statt {want:?}"))
        })
        .collect();
    assert!(fails.is_empty(), "{what}: {fails:#?}");
}

#[test]
fn muster_kachelt_in_allen_formaten() {
    let (scene, images, cms) = (pattern_scene(), Images::new(), Cms::default());
    let png = png_export::export(&scene, &images, 254.0, &cms).unwrap();
    check_pattern(&Pixmap::decode_png(&png).unwrap(), 10.0, "PNG");
    let svg = svg_export::export(&scene, &images, &cms).unwrap();
    assert_eq!(svg.matches("<pattern ").count(), 2, "{svg}");
    check_pattern(&render_svg(&svg, 10.0), 10.0, "SVG");
    let back = svg_import::import(svg.as_bytes()).unwrap();
    assert!(back.warnings.is_empty(), "{:?}", back.warnings);
    let png = png_export::export(&back.scene, &back.images, 254.0, &cms).unwrap();
    check_pattern(
        &Pixmap::decode_png(&png).unwrap(),
        10.0,
        "SVG → Import → PNG",
    );
    let pdf = pdf_export::export(&scene, &images, &cms).unwrap();
    if let Some(pm) = render_pdf(&pdf, 400, "muster") {
        check_pattern(&pm, 10.0, "PDF");
    }
}

/// Musterfüllung (8c): Kachel-Inhalt in Kachel-Einheiten, Matrix = patternTransform · (x, y).
#[test]
fn muster_wird_als_kachel_uebernommen() {
    let r = svg_import::import(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="20mm" viewBox="0 0 40 20">
<defs><pattern id="p" patternUnits="userSpaceOnUse" x="2" y="3" width="10" height="5" patternTransform="rotate(90)">
<rect width="5" height="5" fill="#ff0000" stroke="#000000" stroke-width="1"/></pattern></defs>
<rect width="40" height="20" fill="url(#p)"/></svg>"##
            .as_bytes(),
    )
    .unwrap();
    assert!(r.warnings.is_empty(), "{:?}", r.warnings);
    let l = leaves(&r.scene.items);
    let [(
        _,
        Item::Path {
            fill: Some(Fill::Pattern(p)),
            ..
        },
    )] = l.as_slice()
    else {
        panic!("{:#?}", r.scene)
    };
    assert_eq!((p.width, p.height), (10.0, 5.0));
    let want = [0.0, 1.0, -1.0, 0.0, -3.0, 2.0];
    assert!(
        p.matrix.iter().zip(want).all(|(a, b)| (a - b).abs() < 1e-5),
        "{:?}",
        p.matrix
    );
    let tile = leaves(&p.items);
    let [(
        _,
        Item::Path {
            fill: Some(Fill::Color(c)),
            stroke: Some(s),
            ..
        },
    )] = tile.as_slice()
    else {
        panic!("{:#?}", p.items)
    };
    assert_eq!(c, &Color::rgb(1.0, 0.0, 0.0));
    assert!(
        (s.width - 1.0).abs() < 1e-6,
        "Kontur in Kachel-Einheiten: {}",
        s.width
    );
}

/// „Muster aus Auswahl“ mit Bild: Kachel 1 × 1 mit Bild (rot | blau) in der linken Hälfte, rechts frei;
/// alle Formate kacheln das Bild, SVG-Import bringt es samt Bilddaten zurück.
#[test]
fn bild_in_der_kachel_in_allen_formaten() {
    use serde_json::json;
    use std::io::Cursor;
    let img = image::RgbaImage::from_fn(8, 1, |x, _| {
        image::Rgba(if x < 4 {
            [255, 0, 0, 255]
        } else {
            [0, 0, 255, 255]
        })
    });
    let mut bytes = Vec::new();
    img.write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Png)
        .unwrap();
    let images = Images::from([("bild".to_string(), bytes)]);
    let n = |x: f64, y: f64| json!({ "x": x, "y": y, "type": "corner" });
    let tile = json!([{ "kind": "image", "matrix": IDENTITY, "width": 0.5, "height": 1, "image": "bild" }]);
    let fill = json!({ "kind": "pattern", "width": 1, "height": 1, "matrix": [10, 0, 0, 10, 0, 0], "items": tile });
    let shape = json!({ "kind": "path", "matrix": IDENTITY, "subpaths": [{ "closed": true, "nodes": [n(0.0, 0.0), n(20.0, 0.0), n(20.0, 10.0), n(0.0, 10.0)] }], "fill": fill, "stroke": null });
    let scene: Scene =
        serde_json::from_value(json!({ "width": 20, "height": 10, "items": [shape] })).unwrap();
    let check = |pm: &Pixmap, what: &str| {
        let (red, blue, white) = ([255, 0, 0], [0, 0, 255], [255, 255, 255]);
        for (x, want) in [
            (1.25, red),
            (3.75, blue),
            (7.5, white),
            (11.25, red),
            (13.75, blue),
        ] {
            let got = color_at(pm, 10.0, x, 5.0);
            assert!(
                (0..3).all(|i| got[i].abs_diff(want[i]) <= 3),
                "{what} bei x = {x}: {got:?} statt {want:?}"
            );
        }
    };
    let cms = Cms::default();
    let png = png_export::export(&scene, &images, 254.0, &cms).unwrap();
    check(&Pixmap::decode_png(&png).unwrap(), "PNG");
    let svg = svg_export::export(&scene, &images, &cms).unwrap();
    check(&render_svg(&svg, 10.0), "SVG");
    let back = svg_import::import(svg.as_bytes()).unwrap();
    assert!(back.warnings.is_empty(), "{:?}", back.warnings);
    let png = png_export::export(&back.scene, &back.images, 254.0, &cms).unwrap();
    check(&Pixmap::decode_png(&png).unwrap(), "SVG → Import → PNG");
    let pdf = pdf_export::export(&scene, &images, &cms).unwrap();
    if let Some(pm) = render_pdf(&pdf, 200, "muster-bild") {
        check(&pm, "PDF");
    }
}
