// Druck in Kacheln: Seite größer als das Papier → mehrseitige PDF, ein Blatt je Seite, 1:1.
use kw_core::color::Cms;
use kw_core::pdf_export::{self, Sheet, Sheets};
use kw_core::scene::{Color, Fill, Item, NodeType, PathPoint, Point, Scene, Subpath, IDENTITY};
use kw_core::Images;
use miniz_oxide::inflate::decompress_to_vec_zlib;

const PT: f64 = 72.0 / 25.4;

fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Item {
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
        fill: Some(Fill::Color(Color::rgb(0.0, 0.0, 0.0))),
        stroke: None,
        fill_rule: None,
        opacity: 1.0,
    }
}

/// 400 × 250 mm, schwarzer Balken quer über die ganze Seite.
fn scene() -> Scene {
    Scene {
        width: 400.0,
        height: 250.0,
        items: vec![rect(0.0, 100.0, 400.0, 150.0)],
    }
}

/// A4 hoch, 5 mm Rand, 10 mm Überlappung: drei Blätter nebeneinander (wie tests/model/tiles.test.ts).
fn sheets(marks: bool) -> Sheets {
    let p = |x, y| Point { x, y };
    let sheet = |x: f64, label: &str, at: Vec<Point>| Sheet {
        x,
        y: 0.0,
        label: if marks { label.into() } else { String::new() },
        marks: if marks { at } else { vec![] },
    };
    Sheets {
        paper: [210.0, 297.0],
        margin: 5.0,
        area: [200.0, 287.0],
        mark: 2.5,
        tiles: vec![
            sheet(0.0, "A1", vec![p(195.0, 10.0), p(195.0, 240.0)]),
            sheet(190.0, "B1", vec![p(195.0, 10.0), p(195.0, 240.0), p(385.0, 10.0), p(385.0, 240.0)]),
            sheet(380.0, "C1", vec![p(385.0, 10.0), p(385.0, 240.0)]),
        ],
    }
}

/// Entpackte Ströme in Reihenfolge (hier nur Seiteninhalte), dazu die PDF als Text.
fn streams(pdf: &[u8]) -> (String, Vec<String>) {
    let find = |hay: &[u8], needle: &[u8]| hay.windows(needle.len()).position(|w| w == needle);
    let mut out = Vec::new();
    let mut at = 0;
    while let Some(i) = find(&pdf[at..], b"stream\n") {
        let start = at + i + 7;
        let Some(len) = find(&pdf[start..], b"\nendstream") else {
            break;
        };
        if let Ok(data) = decompress_to_vec_zlib(&pdf[start..start + len]) {
            out.push(String::from_utf8_lossy(&data).into_owned());
        }
        at = start + len + b"\nendstream".len();
    }
    (String::from_utf8_lossy(pdf).into_owned(), out)
}

/// Operanden aller Zeilen mit diesem Operator, z. B. "cm" oder "re".
fn ops(content: &str, op: &str) -> Vec<Vec<f64>> {
    content
        .lines()
        .filter_map(|l| l.strip_suffix(&format!(" {op}")))
        .map(|l| l.split_whitespace().map(|v| v.parse().unwrap()).collect())
        .collect()
}

fn near(a: &[f64], b: &[f64]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| (x - y).abs() < 0.01)
}

#[test]
fn ein_blatt_je_seite_in_papiergroesse() {
    let pdf = pdf_export::tiled(&scene(), &Images::new(), &Cms::default(), &sheets(true)).unwrap();
    let (raw, pages) = streams(&pdf);
    assert!(raw.contains("/Count 3"));
    assert_eq!(pages.len(), 3);
    let boxes: Vec<&str> = raw.match_indices("/MediaBox [").map(|(i, _)| &raw[i..]).collect();
    assert_eq!(boxes.len(), 3);
    for b in boxes {
        let v: Vec<f64> = b[11..b.find(']').unwrap()].split_whitespace().map(|s| s.parse::<f64>().unwrap() / PT).collect();
        assert!(near(&v, &[0.0, 0.0, 210.0, 297.0]), "{v:?}");
    }
}

#[test]
fn ausschnitt_versetzt_und_auf_blatt_und_seite_begrenzt() {
    let pdf = pdf_export::tiled(&scene(), &Images::new(), &Cms::default(), &sheets(true)).unwrap();
    let (_, pages) = streams(&pdf);
    for (page, (x, w)) in pages.iter().zip([(0.0, 200.0), (190.0, 200.0), (380.0, 20.0)]) {
        // mm, y nach unten; Blattursprung = Seitenpunkt (x, 0) in der Ecke der bedruckbaren Fläche.
        let cm = &ops(page, "cm")[0];
        assert!(near(cm, &[PT, 0.0, 0.0, -PT, (5.0 - x) * PT, (297.0 - 5.0) * PT]), "{cm:?}");
        // Begrenzung zuerst: Blattfläche ∩ Seite.
        let clip = &ops(page, "re")[0];
        assert!(near(clip, &[x, 0.0, w, 250.0]), "{clip:?}");
    }
}

#[test]
fn passkreuze_und_blattnamen_nur_mit_kachelmarken() {
    let pdf = pdf_export::tiled(&scene(), &Images::new(), &Cms::default(), &sheets(true)).unwrap();
    let (raw, pages) = streams(&pdf);
    assert!(raw.contains("/BaseFont /Helvetica"));
    for (page, label) in pages.iter().zip(["(A1  1/3) Tj", "(B1  2/3) Tj", "(C1  3/3) Tj"]) {
        assert!(page.contains(label), "{label} fehlt");
    }
    // Kreuz = waagerechter + senkrechter Strich um den Punkt, Halbgröße 2,5 mm.
    assert!(pages[1].contains("192.5 10 m\n197.5 10 l\n195 7.5 m\n195 12.5 l"));
    assert!(pages[1].contains("385 237.5 m\n385 242.5 l"));
    assert!(!pages[0].contains("385 7.5 m"));

    let pdf = pdf_export::tiled(&scene(), &Images::new(), &Cms::default(), &sheets(false)).unwrap();
    let (_, pages) = streams(&pdf);
    assert!(pages.iter().all(|p| !p.contains(" Tj") && !p.contains("192.5 10 m")));
}
