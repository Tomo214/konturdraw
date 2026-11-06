// 3g-2: druckfertiges PDF (PDF/X-4) – Rahmen, Beschnitt, Schnittmarken, Output-Intent, Metadaten, alles CMYK.
use kw_core::color::{Cms, ColorMode, ColorSettings, RenderIntent};
use kw_core::pdf_print::{self, Print, Stamp};
use kw_core::scene::{Color, Fill, Item, NodeType, PathPoint, Scene, Subpath, IDENTITY};
use kw_core::{pdf_export, Images};
use miniz_oxide::inflate::decompress_to_vec_zlib;
use std::io::Cursor;
use tiny_skia::Pixmap;

const GENERIC_CMYK: &str = "/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc";
const PT: f64 = 72.0 / 25.4;
/// Rand um die Endformat-Seite bei 3 mm Beschnitt mit Marken: Beschnitt + 2 mm Abstand + 5 mm Marke.
const MARGIN: f64 = 10.0;

fn rect(x0: f64, y0: f64, x1: f64, y1: f64, color: Color) -> Item {
    let node = |x: f64, y: f64| PathPoint {
        x,
        y,
        kind: NodeType::Corner,
        handle_in: None,
        handle_out: None,
    };
    Item::Path {
        matrix: IDENTITY,
        subpaths: vec![Subpath {
            nodes: vec![node(x0, y0), node(x1, y0), node(x1, y1), node(x0, y1)],
            closed: true,
        }],
        fill: Some(Fill::Color(color)),
        stroke: None,
        fill_rule: None,
        opacity: 1.0,
    }
}

/// 40 × 20 mm, rote Fläche ragt 5 mm über jede Kante (Hintergrund bis in den Beschnitt).
fn scene() -> Scene {
    Scene {
        width: 40.0,
        height: 20.0,
        items: vec![rect(-5.0, -5.0, 45.0, 25.0, Color::rgb(1.0, 0.0, 0.0))],
    }
}

/// Halb deckendes, halb transparentes RGB-Bild 4 × 2 px über 20 × 10 mm.
fn image_scene() -> (Scene, Images) {
    let mut img = image::RgbaImage::from_pixel(4, 2, image::Rgba([0, 120, 255, 255]));
    img.put_pixel(0, 0, image::Rgba([0, 0, 0, 0]));
    let mut png = Vec::new();
    img.write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
        .unwrap();
    let item = Item::Image {
        matrix: IDENTITY,
        width: 20.0,
        height: 10.0,
        image: "bild".into(),
        opacity: 1.0,
    };
    (
        Scene {
            width: 40.0,
            height: 20.0,
            items: vec![item],
        },
        Images::from([("bild".into(), png)]),
    )
}

fn cms(mode: ColorMode) -> Option<Cms> {
    let icc = std::fs::read(GENERIC_CMYK).ok()?;
    let settings = ColorSettings {
        mode,
        intent: RenderIntent::Relative,
        ..Default::default()
    };
    Some(Cms::new(&settings, Some(&icc)).unwrap())
}

fn print(marks: bool) -> Print {
    Print {
        bleed: 3.0,
        marks,
        title: "Logo & Co".into(),
        time: Stamp::from_unix(1_793_698_215),
    }
}

/// Alle Flate-Ströme entpackt (Seiteninhalt), dazu die PDF selbst als Text.
fn texts(pdf: &[u8]) -> (String, String) {
    let mut content = String::new();
    let mut at = 0;
    while let Some(i) = find(&pdf[at..], b"stream\n") {
        let start = at + i + 7;
        let Some(len) = find(&pdf[start..], b"\nendstream") else {
            break;
        };
        if let Ok(data) = decompress_to_vec_zlib(&pdf[start..start + len]) {
            content.push_str(&String::from_utf8_lossy(&data));
            content.push('\n');
        }
        at = start + len + b"\nendstream".len(); // sonst passt "stream\n" in "endstream\n"
    }
    (String::from_utf8_lossy(pdf).into_owned(), content)
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

/// Zahlen eines Seitenrahmens, z. B. "/TrimBox [a b c d]", in mm.
fn page_box(raw: &str, name: &str) -> [f64; 4] {
    let at = raw
        .find(&format!("/{name} ["))
        .unwrap_or_else(|| panic!("{name} fehlt"))
        + name.len()
        + 3;
    let end = at + raw[at..].find(']').unwrap();
    let v: Vec<f64> = raw[at..end]
        .split_whitespace()
        .map(|s| s.parse::<f64>().unwrap() / PT)
        .collect();
    [v[0], v[1], v[2], v[3]]
}

fn near(a: [f64; 4], b: [f64; 4]) -> bool {
    a.iter().zip(b).all(|(x, y)| (x - y).abs() < 0.01)
}

#[test]
fn zeitstempel_aus_unixzeit() {
    let s = |t| {
        let v = Stamp::from_unix(t);
        (v.year, v.month, v.day, v.hour, v.minute, v.second)
    };
    assert_eq!(s(0), (1970, 1, 1, 0, 0, 0));
    assert_eq!(s(1_709_251_199), (2024, 2, 29, 23, 59, 59));
    assert_eq!(s(1_793_698_215), (2026, 11, 3, 9, 30, 15));
}

#[test]
fn rahmen_beschnitt_und_marken() {
    let Some(cms) = cms(ColorMode::Rgb) else {
        return;
    };
    let pdf = pdf_print::export(&scene(), &Images::new(), &cms, &print(true)).unwrap();
    let (raw, _) = texts(&pdf);
    let m = MARGIN;
    assert!(near(
        page_box(&raw, "MediaBox"),
        [0.0, 0.0, 40.0 + 2.0 * m, 20.0 + 2.0 * m]
    ));
    assert!(near(page_box(&raw, "TrimBox"), [m, m, m + 40.0, m + 20.0]));
    assert!(near(
        page_box(&raw, "BleedBox"),
        [m - 3.0, m - 3.0, m + 43.0, m + 23.0]
    ));

    // Ohne Marken reicht das Blatt genau bis zum Beschnitt.
    let pdf = pdf_print::export(&scene(), &Images::new(), &cms, &print(false)).unwrap();
    let (raw, _) = texts(&pdf);
    assert!(near(page_box(&raw, "MediaBox"), [0.0, 0.0, 46.0, 26.0]));
    assert!(near(page_box(&raw, "TrimBox"), [3.0, 3.0, 43.0, 23.0]));
}

#[test]
fn pdfx4_kennung_output_intent_und_metadaten() {
    let Some(cms) = cms(ColorMode::Rgb) else {
        return;
    };
    let pdf = pdf_print::export(&scene(), &Images::new(), &cms, &print(true)).unwrap();
    let (raw, _) = texts(&pdf);
    assert!(
        raw.starts_with("%PDF-1.6"),
        "PDF/X-4 verlangt höchstens PDF 1.6"
    );
    for needle in [
        "/S /GTS_PDFX",
        "/OutputConditionIdentifier",
        "/DestOutputProfile",
        "/GTS_PDFXVersion (PDF/X-4)",
        "/Trapped /False",
        "/CreationDate (D:20261103093015Z)",
        "/ModDate (D:20261103093015Z)",
        "/Title (Logo & Co)",
        "/Type /Metadata",
        "<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>",
        "<pdf:Trapped>False</pdf:Trapped>",
        "<xmp:CreateDate>2026-11-03T09:30:15Z</xmp:CreateDate>",
        "<xmp:ModifyDate>2026-11-03T09:30:15Z</xmp:ModifyDate>",
        "<rdf:li xml:lang=\"x-default\">Logo &amp; Co</rdf:li>",
        "<xmpMM:RenditionClass>default</xmpMM:RenditionClass>",
        "/ID [",
    ] {
        assert!(raw.contains(needle), "fehlt: {needle}");
    }
    // Das eingebettete Profil ist genau das Dokumentprofil.
    let icc = std::fs::read(GENERIC_CMYK).unwrap();
    assert!(
        find(&pdf, &icc).is_some(),
        "Profil nicht unverändert eingebettet"
    );
    // Gleiche Eingabe → gleiche Datei (Kennungen aus dem Inhalt abgeleitet).
    assert_eq!(
        pdf,
        pdf_print::export(&scene(), &Images::new(), &cms, &print(true)).unwrap()
    );
}

/// PDF/X-4 erlaubt Transparenz, verlangt dann eine Mischgruppe der Seite mit Farbraum (hier CMYK).
#[test]
fn transparentes_bild_mit_mischgruppe_in_cmyk() {
    let Some(cms) = cms(ColorMode::Rgb) else {
        return;
    };
    let (mut s, images) = image_scene();
    let Item::Image { opacity, .. } = &mut s.items[0] else { unreachable!() };
    *opacity = 0.4;
    let pdf = pdf_print::export(&s, &images, &cms, &print(false)).unwrap();
    let (raw, content) = texts(&pdf);
    assert!(raw.contains("/Group <<") && raw.contains("/S /Transparency") && raw.contains("/CS /DeviceCMYK"), "Mischgruppe fehlt");
    assert!(raw.contains("/ca 0.4") && content.contains("/Gs1 gs"), "Deckkraft fehlt");
    assert!(!raw.contains("/DeviceRGB"));
}

#[test]
fn nur_cmyk_auch_bei_rgb_dokument_und_bildern() {
    let Some(cms) = cms(ColorMode::Rgb) else {
        return;
    };
    let (s, images) = image_scene();
    let mut s2 = scene();
    s2.items.extend(s.items);
    let pdf = pdf_print::export(&s2, &images, &cms, &print(true)).unwrap();
    let (raw, content) = texts(&pdf);
    assert!(
        !raw.contains("/DeviceRGB"),
        "DeviceRGB ist in PDF/X-4 nicht erlaubt"
    );
    let ops: Vec<&str> = content.split_whitespace().collect();
    assert!(
        !ops.contains(&"rg") && !ops.contains(&"RG"),
        "RGB-Farboperator im Inhalt"
    );
    assert!(ops.contains(&"k"), "Füllung nicht in CMYK");
    assert!(raw.contains("/ColorSpace /DeviceCMYK") && raw.contains("/SMask"));
}

#[test]
fn cmyk_modus_wandelt_auch_bilder_im_einfachen_pdf() {
    let Some(cms) = cms(ColorMode::Cmyk) else {
        return;
    };
    let (s, images) = image_scene();
    let pdf = pdf_export::export(&s, &images, &cms).unwrap();
    let (raw, _) = texts(&pdf);
    assert!(!raw.contains("/DeviceRGB") && raw.contains("/ColorSpace /DeviceCMYK"));
}

#[test]
fn ohne_profil_kein_druckfertiges_pdf() {
    let err =
        pdf_print::export(&scene(), &Images::new(), &Cms::default(), &print(true)).unwrap_err();
    assert!(err.contains("CMYK-Profil"), "{err}");
}

/// PDF über CoreGraphics (sips) rastern, längste Seite = `max_px`; None außerhalb von macOS.
fn render_pdf(pdf: &[u8], max_px: u32) -> Option<Pixmap> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let dir = std::env::temp_dir().join(format!("kw-core-{}-print", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let (src, out) = (dir.join("in.pdf"), dir.join("out.png"));
    std::fs::write(&src, pdf).unwrap();
    let st = std::process::Command::new("sips")
        .args(["-s", "format", "png", "-Z", &max_px.to_string()])
        .args([
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
fn beschnitt_sichtbar_rest_weiss_marken_an_den_ecken() {
    let Some(cms) = cms(ColorMode::Rgb) else {
        return;
    };
    let pdf = pdf_print::export(&scene(), &Images::new(), &cms, &print(true)).unwrap();
    // Blatt 60 × 40 mm → 10 px/mm
    let Some(pm) = render_pdf(&pdf, 600) else {
        return;
    };
    let px = |x: f64, y: f64| {
        let p = pm
            .pixel(((x + MARGIN) * 10.0) as u32, ((y + MARGIN) * 10.0) as u32)
            .unwrap();
        // sips lässt leeres Blatt transparent → auf Weiß legen (Werte sind vormultipliziert).
        [p.red(), p.green(), p.blue()].map(|v| v + (255 - p.alpha()))
    };
    let is_red = |c: [u8; 3]| c[0] > 150 && c[1] < 120 && c[2] < 120;
    assert!(is_red(px(20.0, 10.0)), "Seite {:?}", px(20.0, 10.0));
    assert!(is_red(px(-1.5, 10.0)), "Beschnitt {:?}", px(-1.5, 10.0));
    assert!(
        is_red(px(41.5, 21.5)),
        "Beschnitt unten rechts {:?}",
        px(41.5, 21.5)
    );
    assert_eq!(px(-4.5, 10.0), [255; 3], "außerhalb des Beschnitts weiß");
    assert_eq!(px(20.0, 24.5), [255; 3], "außerhalb des Beschnitts weiß");
    // Marke: dunkelster Wert über 3 px quer zur Linie.
    let dark = |x: f64, y: f64, horizontal: bool| {
        (-1..=1)
            .map(|d| {
                let o = d as f64 / 10.0;
                let c = if horizontal {
                    px(x, y + o)
                } else {
                    px(x + o, y)
                };
                *c.iter().max().unwrap()
            })
            .min()
            .unwrap()
    };
    for (x, y, h) in [
        (-7.5, 0.0, true),
        (0.0, -7.5, false),
        (47.5, 20.0, true),
        (40.0, 27.5, false),
    ] {
        assert!(
            dark(x, y, h) < 170,
            "Marke bei ({x}, {y}) fehlt: {}",
            dark(x, y, h)
        );
    }
}
