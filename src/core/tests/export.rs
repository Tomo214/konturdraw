// Export PNG/SVG/PDF gegen die Golden-Szene des Browser-Renderers (tests/fixtures/golden-scene.json, aus vitest).
// Jedes Format wird von einem eigenen Leser gerastert: PNG direkt, SVG über resvg, PDF über CoreGraphics (macOS).
use kw_core::color::Cms;
use kw_core::scene::{Item, Scene, IDENTITY};
use kw_core::{pdf_export, png_export, svg_export, Images};
use serde::Deserialize;
use std::io::Cursor;
use tiny_skia::{Pixmap, Transform};

#[derive(Deserialize)]
struct Fixture {
    scene: Scene,
    probes: Vec<(String, f64, f64, [u8; 3], u8)>,
}

fn fixture() -> Fixture {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/fixtures/golden-scene.json"
    );
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

const MM: f64 = 4.0; // Pixel je mm wie im Browser-Golden

/// Farbe an (x, y) mm auf weißem Grund.
fn color_at(pm: &Pixmap, mm: f64, x: f64, y: f64) -> [u8; 3] {
    let p = pm
        .pixel((x * mm).floor() as u32, (y * mm).floor() as u32)
        .unwrap();
    let white = 255 - p.alpha(); // vormultipliziert: Farbe + (1 − α) · Weiß
    [p.red() + white, p.green() + white, p.blue() + white]
}

/// `slack`: Zusatztoleranz des Lesers (sips rechnet sRGB → P3 → sRGB, Rundung ≤ 3).
fn check(pm: &Pixmap, mm: f64, f: &Fixture, slack: u8) {
    let fails: Vec<_> = f
        .probes
        .iter()
        .filter_map(|(name, x, y, want, tol)| {
            let got = color_at(pm, mm, *x, *y);
            (0..3)
                .any(|i| got[i].abs_diff(want[i]) > tol + slack)
                .then(|| format!("{name}: {got:?} statt {want:?}"))
        })
        .collect();
    assert!(
        fails.is_empty(),
        "{} von {} Proben falsch: {fails:#?}",
        fails.len(),
        f.probes.len()
    );
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

#[test]
fn png_trifft_golden_proben() {
    let f = fixture();
    let pm = Pixmap::decode_png(
        &png_export::export(&f.scene, &Images::new(), MM * 25.4, &Cms::default()).unwrap(),
    )
    .unwrap();
    assert_eq!((pm.width(), pm.height()), (800, 560));
    check(&pm, MM, &f, 0);
}

#[test]
fn png_dpi_waehlbar_hintergrund_transparent() {
    let f = fixture();
    let pm = Pixmap::decode_png(
        &png_export::export(&f.scene, &Images::new(), 300.0, &Cms::default()).unwrap(),
    )
    .unwrap();
    assert_eq!((pm.width(), pm.height()), (2362, 1654)); // 200 × 140 mm bei 300 dpi
    assert_eq!(pm.pixel(1, 1).unwrap().alpha(), 0);
}

#[test]
fn svg_trifft_golden_proben() {
    let f = fixture();
    let svg = svg_export::export(&f.scene, &Images::new(), &Cms::default()).unwrap();
    assert!(
        svg.contains(r#"width="200mm""#) && svg.contains(r#"viewBox="0 0 200 140""#),
        "{}",
        &svg[..200]
    );
    check(&render_svg(&svg, MM), MM, &f, 0);
}

#[test]
fn pdf_trifft_golden_proben() {
    let f = fixture();
    let pdf = pdf_export::export(&f.scene, &Images::new(), &Cms::default()).unwrap();
    assert!(pdf.starts_with(b"%PDF-"));
    if let Some(pm) = render_pdf(&pdf, 800, "golden") {
        assert_eq!((pm.width(), pm.height()), (800, 560));
        check(&pm, MM, &f, 3);
    }
}

// Bild 2×1 px (links rot, rechts blau) auf 20 × 10 mm gestreckt, um 5 mm verschoben.
fn image_scene() -> (Scene, Images) {
    // 8 px breit: Proben liegen > 2 px von der Farbgrenze, auch bikubisch filternde Leser bleiben sauber.
    let img = image::RgbaImage::from_fn(8, 1, |x, _| {
        image::Rgba(if x < 4 {
            [255, 0, 0, 255]
        } else {
            [0, 0, 255, 255]
        })
    });
    let mut png = Vec::new();
    img.write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
        .unwrap();
    let item = Item::Image {
        matrix: [1.0, 0.0, 0.0, 1.0, 5.0, 0.0],
        width: 20.0,
        height: 10.0,
        image: "bild".into(),
        opacity: 1.0,
    };
    let group = Item::Group {
        matrix: IDENTITY,
        children: vec![item],
    };
    (
        Scene {
            width: 30.0,
            height: 10.0,
            items: vec![group],
        },
        Images::from([("bild".to_string(), png)]),
    )
}

fn check_image(pm: &Pixmap, mm: f64, what: &str) {
    let got = [
        color_at(pm, mm, 2.0, 5.0),
        color_at(pm, mm, 9.0, 5.0),
        color_at(pm, mm, 21.0, 5.0),
    ];
    let want = [[255, 255, 255], [255, 0, 0], [0, 0, 255]];
    for (g, w) in got.iter().zip(want) {
        assert!(
            (0..3).all(|i| g[i].abs_diff(w[i]) <= 2),
            "{what}: {got:?} statt {want:?}"
        );
    }
}

#[test]
fn bild_in_allen_formaten_an_richtiger_stelle() {
    let (scene, images) = image_scene();
    check_image(
        &Pixmap::decode_png(&png_export::export(&scene, &images, 254.0, &Cms::default()).unwrap())
            .unwrap(),
        10.0,
        "PNG",
    );
    check_image(
        &render_svg(
            &svg_export::export(&scene, &images, &Cms::default()).unwrap(),
            10.0,
        ),
        10.0,
        "SVG",
    );
    if let Some(pm) = render_pdf(
        &pdf_export::export(&scene, &images, &Cms::default()).unwrap(),
        300,
        "bild",
    ) {
        check_image(&pm, 10.0, "PDF");
    }
}

/// Transparenz 50 % über Weiß: Rot → (255, 128, 128), Blau → (128, 128, 255).
#[test]
fn bild_mit_transparenz_in_allen_formaten() {
    let (mut scene, images) = image_scene();
    let Item::Group { children, .. } = &mut scene.items[0] else { unreachable!() };
    let Item::Image { opacity, .. } = &mut children[0] else { unreachable!() };
    *opacity = 0.5;
    let want = [[255, 255, 255], [255, 128, 128], [128, 128, 255]];
    let probe = |pm: &Pixmap, what: &str| {
        let got = [2.0, 9.0, 21.0].map(|x| color_at(pm, 10.0, x, 5.0));
        let ok = got.iter().zip(want).all(|(g, w)| (0..3).all(|i| g[i].abs_diff(w[i]) <= 4));
        assert!(ok, "{what}: {got:?} statt {want:?}");
    };
    let png = png_export::export(&scene, &images, 254.0, &Cms::default()).unwrap();
    probe(&Pixmap::decode_png(&png).unwrap(), "PNG");
    let svg = svg_export::export(&scene, &images, &Cms::default()).unwrap();
    probe(&render_svg(&svg, 10.0), "SVG");
    if let Some(pm) = render_pdf(&pdf_export::export(&scene, &images, &Cms::default()).unwrap(), 300, "transparenz") {
        probe(&pm, "PDF");
    }
}

#[test]
fn fehlendes_bild_ist_ein_fehler() {
    let (scene, _) = image_scene();
    assert!(png_export::export(&scene, &Images::new(), 72.0, &Cms::default()).is_err());
    assert!(svg_export::export(&scene, &Images::new(), &Cms::default()).is_err());
    assert!(pdf_export::export(&scene, &Images::new(), &Cms::default()).is_err());
}

/// Testseite für den Druck (3h): SVG-Import → PDF → Raster bei 10 px/mm; Linie und Quadratkante je 100 mm (+ 0,2 mm Kontur).
#[test]
fn testseite_100mm_im_pdf() {
    let svg = std::fs::read("../../tests/fixtures/testseite-100mm.svg").unwrap();
    let imp = kw_core::svg_import::import(&svg).unwrap();
    assert_eq!(
        (imp.scene.width.round(), imp.scene.height.round()),
        (210.0, 297.0)
    );
    // gespiegelt wie beim Druck (src/io/files.ts printPage): Maße bleiben, das F wandert nach rechts
    let mirrored = Scene {
        items: vec![Item::Group {
            matrix: [-1.0, 0.0, 0.0, 1.0, 210.0, 0.0],
            children: imp.scene.items.clone(),
        }],
        ..imp.scene.clone()
    };
    for (scene, name, f_mm) in [
        (&imp.scene, "testseite", 20.0),
        (&mirrored, "testseite-gespiegelt", 190.0),
    ] {
        let pdf = pdf_export::export(scene, &imp.images, &Cms::default()).unwrap();
        let Some(pm) = render_pdf(&pdf, 2970, name) else {
            return;
        };
        assert_eq!((pm.width(), pm.height()), (2100, 2970));
        // transparenter Grund: deckend + dunkel = Strich
        let dark = |row: u32| -> Vec<u32> {
            (0..pm.width())
                .filter(|&x| {
                    pm.pixel(x, row)
                        .is_some_and(|p| p.alpha() > 128 && p.red() < 128)
                })
                .collect()
        };
        for (row, what) in [(400, "Linie"), (1100, "Quadrat")] {
            let d = dark(row);
            let mm = (d[d.len() - 1] - d[0] + 1) as f64 / 10.0;
            assert!((mm - 100.2).abs() <= 0.3, "{name} {what}: {mm} mm");
        }
        // Senkrechte des F (x = 20 mm, 1 mm stark) auf Höhe 30 mm
        let d = dark(300);
        let x = (d[0] + d[d.len() - 1] + 1) as f64 / 20.0;
        assert!((x - f_mm).abs() <= 0.3, "{name} F bei {x} mm");
    }
}

/// 3f: CMYK-Modus mit Sonderfarbe ist eine gültige PDF; die Sonderfarbe erscheint in ihrem Ersatzwert.
#[test]
fn cmyk_pdf_mit_sonderfarbe_rendert() {
    use kw_core::color::{ColorMode, ColorSettings};
    let spot: kw_core::scene::Color =
        serde_json::from_str(r#"{"model":"cmyk","values":[0.5,1,0,0],"spot":"Stencil-Violett"}"#)
            .unwrap();
    let mut f = fixture();
    let Some(Item::Path { fill, .. }) = f.scene.items.first_mut() else {
        panic!("Pfad erwartet")
    };
    *fill = Some(kw_core::scene::Fill::Color(spot));
    let cms = Cms::new(
        &ColorSettings {
            mode: ColorMode::Cmyk,
            ..Default::default()
        },
        None,
    )
    .unwrap();
    let pdf = pdf_export::export(&f.scene, &Images::new(), &cms).unwrap();
    let Some(pm) = render_pdf(&pdf, 800, "cmyk") else {
        return;
    };
    let (name, x, y, _, _) = &f.probes[0];
    let [r, g, b] = color_at(&pm, MM, *x, *y);
    assert!(
        r > g + 60 && b > g + 60,
        "{name}: {:?} ist nicht violett",
        [r, g, b]
    );
}

#[test]
fn strichmuster_bleibt_nach_transparentem_pfad_richtig() {
    use kw_core::scene::{Cap, Color, Join, NodeType, PathPoint, Stroke, Subpath};
    let line = |y: f64, dash: Vec<f64>, opacity: f64| {
        let node = |x: f64| PathPoint {
            x,
            y,
            kind: NodeType::Corner,
            handle_in: None,
            handle_out: None,
        };
        Item::Path {
            matrix: IDENTITY,
            subpaths: vec![Subpath {
                nodes: vec![node(0.0), node(30.0)],
                closed: false,
            }],
            fill: None,
            stroke: Some(Stroke {
                color: Color::rgb(0.0, 0.0, 0.0),
                width: 2.0,
                dash,
                cap: Cap::Butt,
                join: Join::Miter,
            }),
            fill_rule: None,
            opacity,
        }
    };
    // gestrichelt deckend → durchgezogen halbtransparent → durchgezogen deckend: die letzte Linie hat keine Lücke.
    let scene = Scene {
        width: 30.0,
        height: 10.0,
        items: vec![
            line(2.0, vec![2.0, 2.0], 1.0),
            line(5.0, vec![], 0.5),
            line(8.0, vec![], 1.0),
        ],
    };
    let pdf = pdf_export::export(&scene, &Images::new(), &Cms::default()).unwrap();
    if let Some(pm) = render_pdf(&pdf, 300, "strich") {
        assert_eq!(
            color_at(&pm, 10.0, 3.0, 2.0),
            [255, 255, 255],
            "Lücke der gestrichelten Linie"
        );
        let solid = color_at(&pm, 10.0, 3.0, 8.0);
        assert!(
            solid.iter().all(|v| *v <= 3),
            "letzte Linie durchgezogen: {solid:?}"
        );
    }
}
