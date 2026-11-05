// Text (3e): Glyphen-Positionen gegen usvgs eigene Textstrecke als Referenz, Text auf Pfad gegen Geometrie.
use kurbo::{BezPath, Shape};
use kw_core::scene::{segments, NodeType, PathPoint, Point, Seg, Subpath};
use kw_core::text::{families, layout, Layout, TextSpec};
use serde_json::{json, Value};
use std::f64::consts::{FRAC_PI_2, PI};
use std::sync::{Arc, OnceLock};
use usvg::fontdb::Database;

/// 72 pt = 1 Zoll = 25,4 mm
const MM: f64 = 25.4;

fn db() -> Arc<Database> {
    static DB: OnceLock<Arc<Database>> = OnceLock::new();
    DB.get_or_init(|| {
        let mut db = Database::new();
        db.load_font_file(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/fixtures/fonts/Tuffy.ttf"
        ))
        .unwrap();
        Arc::new(db)
    })
    .clone()
}

/// Format wie TextNode in model/types.ts; extra überschreibt Felder.
fn spec(text: &str, extra: Value) -> TextSpec {
    let mut v = json!({
        "text": text,
        "font": { "family": "Tuffy", "weight": 400, "italic": false, "size": 72.0 },
        "tracking": 0.0, "lineSpacing": 100.0, "align": "left"
    });
    v.as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    serde_json::from_value(v).unwrap()
}

fn run(text: &str, extra: Value) -> Layout {
    layout(&db(), &spec(text, extra)).unwrap()
}

fn find_text(g: &usvg::Group) -> Option<&usvg::Text> {
    g.children().iter().find_map(|n| match n {
        usvg::Node::Text(t) => Some(t.as_ref()),
        usvg::Node::Group(g) => find_text(g),
        _ => None,
    })
}

/// Dieselbe Zeile als SVG-Text durch usvg (Einheit = mm, Grundlinie bei y = 50).
fn reference(text: &str) -> (Vec<(f64, f64)>, [f64; 4]) {
    let svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="500" height="100"><text x="0" y="50" font-family="Tuffy" font-size="{MM}">{text}</text></svg>"#
    );
    let tree = usvg::Tree::from_str(
        &svg,
        &usvg::Options {
            fontdb: db(),
            ..Default::default()
        },
    )
    .unwrap();
    let t = find_text(tree.root()).expect("kein Text");
    let pos = t
        .layouted()
        .iter()
        .flat_map(|s| &s.positioned_glyphs)
        .map(|g| (g.transform().tx as f64, g.transform().ty as f64 - 50.0));
    let b = t.flattened().abs_bounding_box();
    (
        pos.collect(),
        [
            b.left() as f64,
            b.top() as f64 - 50.0,
            b.right() as f64,
            b.bottom() as f64 - 50.0,
        ],
    )
}

/// Enge Hülle der Kurven (nicht nur der Knoten).
fn bbox(sps: &[Subpath]) -> [f64; 4] {
    let mut p = BezPath::new();
    let kp = |q: Point| kurbo::Point::new(q.x, q.y);
    for sp in sps {
        p.move_to((sp.nodes[0].x, sp.nodes[0].y));
        for s in segments(sp) {
            match s {
                Seg::Line(e) => p.line_to(kp(e)),
                Seg::Cubic(a, b, e) => p.curve_to(kp(a), kp(b), kp(e)),
            }
        }
    }
    let r = p.bounding_box();
    [r.x0, r.y0, r.x1, r.y1]
}

fn corner(x: f64, y: f64) -> PathPoint {
    PathPoint {
        x,
        y,
        kind: NodeType::Corner,
        handle_in: None,
        handle_out: None,
    }
}

fn line(x0: f64, y0: f64, x1: f64, y1: f64) -> Value {
    json!(Subpath {
        closed: false,
        nodes: vec![corner(x0, y0), corner(x1, y1)]
    })
}

/// Kreis um den Ursprung aus vier Bézier-Bögen, Start rechts, im Uhrzeigersinn (y nach unten).
fn circle(r: f64) -> Value {
    let k = 0.552_284_75 * r;
    let n = |x: f64, y: f64, i: (f64, f64), o: (f64, f64)| PathPoint {
        x,
        y,
        kind: NodeType::Symmetric,
        handle_in: Some(Point {
            x: x + i.0,
            y: y + i.1,
        }),
        handle_out: Some(Point {
            x: x + o.0,
            y: y + o.1,
        }),
    };
    json!(Subpath {
        closed: true,
        nodes: vec![
            n(r, 0.0, (0.0, -k), (0.0, k)),
            n(0.0, r, (k, 0.0), (-k, 0.0)),
            n(-r, 0.0, (0.0, k), (0.0, -k)),
            n(0.0, -r, (-k, 0.0), (k, 0.0)),
        ],
    })
}

fn on_path(path: Value, offset: f64, distance: f64, side: &str) -> Value {
    json!({ "onPath": { "path": path, "offset": offset, "distance": distance, "side": side } })
}

#[test]
fn glyphen_positionen_wie_referenz() {
    for text in ["AVATAR Wasser", "Tattoo – Äöü ß", "fi fl ffi 0123"] {
        let l = run(text, json!({}));
        let (r, _) = reference(text);
        assert_eq!(l.glyphs.len(), r.len(), "{text}");
        for (g, (x, y)) in l.glyphs.iter().zip(r) {
            assert!(
                (g.x - x).abs() < 1e-3 && (g.y - y).abs() < 1e-3,
                "{text}: {:?} statt {:?}",
                (g.x, g.y),
                (x, y)
            );
        }
    }
}

#[test]
fn umriss_deckt_sich_mit_referenz() {
    let l = run("Tinte Wasser", json!({}));
    let (_, r) = reference("Tinte Wasser");
    for (a, b) in bbox(&l.outline).iter().zip(r) {
        assert!((a - b).abs() < 1e-2, "{:?} statt {r:?}", bbox(&l.outline));
    }
}

#[test]
fn index_zaehlt_utf16_wie_das_textfeld() {
    let l = run("Äß😀A", json!({}));
    assert_eq!(
        l.glyphs.iter().map(|g| g.index).collect::<Vec<_>>(),
        [0, 1, 2, 4]
    );
}

#[test]
fn zeilen_und_zeilenabstand() {
    let a = run("A\nA", json!({}));
    let b = run("A\nA", json!({ "lineSpacing": 200.0 }));
    let h = a.glyphs[1].y - a.glyphs[0].y;
    assert_eq!(
        (a.glyphs[0].y, a.glyphs[1].x),
        (0.0, 0.0),
        "Grafiktext: erste Grundlinie im Ursprung"
    );
    assert!(h > 0.8 * MM && h < 1.6 * MM, "Zeilenhöhe {h}");
    assert!((b.glyphs[1].y - 2.0 * h).abs() < 1e-9);
    assert_eq!(a.lines.len(), 2);
}

#[test]
fn laufweite_in_prozent_des_leerzeichens() {
    let space = run(" ", json!({})).glyphs[0].advance;
    let a = run("Tinte", json!({}));
    let b = run("Tinte", json!({ "tracking": 50.0 }));
    for (i, (p, q)) in a.glyphs.iter().zip(&b.glyphs).enumerate() {
        assert!(
            (q.x - p.x - i as f64 * 0.5 * space).abs() < 1e-9,
            "Glyphe {i}"
        );
    }
}

#[test]
fn ausrichtung_mittig_und_rechts() {
    let left = run("AAAA\nA", json!({}));
    let gap = (left.lines[0].x1 - left.lines[0].x0) - (left.lines[1].x1 - left.lines[1].x0);
    for (align, f) in [("center", 0.5), ("right", 1.0)] {
        let l = run("AAAA\nA", json!({ "align": align }));
        assert_eq!(l.lines[0].x0, 0.0, "{align}");
        assert!((l.lines[1].x0 - f * gap).abs() < 1e-9, "{align}");
        assert!((l.glyphs[4].x - l.lines[1].x0).abs() < 1e-9, "{align}");
    }
}

#[test]
fn fliesstext_bricht_an_wortgrenzen_um() {
    let text = "Tinte und Nadel im Rahmen";
    let width = run(text, json!({})).lines[0].x1 * 0.45;
    let l = run(
        text,
        json!({ "frame": { "width": width, "height": 500.0 } }),
    );
    assert!(l.lines.len() >= 3, "{} Zeilen", l.lines.len());
    assert!(
        (l.lines[0].baseline - l.ascent).abs() < 1e-9,
        "erste Grundlinie = Oberlänge unter der Rahmenkante"
    );
    for (i, line) in l.lines.iter().enumerate() {
        assert!(line.x1 <= width + 1e-9, "Zeile {i} zu breit");
        if i > 0 {
            assert_eq!(
                text.as_bytes()[line.start - 1],
                b' ',
                "Zeile {i} beginnt mitten im Wort"
            );
        }
    }
    assert!(!l.overflow);
    assert!(run(text, json!({ "frame": { "width": width, "height": 10.0 } })).overflow);
}

#[test]
fn text_auf_waagerechter_linie_wie_grafiktext() {
    let plain = run("Tinte", json!({}));
    let on = run(
        "Tinte",
        on_path(line(0.0, 0.0, 300.0, 0.0), 0.0, 0.0, "above"),
    );
    for (p, q) in plain.glyphs.iter().zip(&on.glyphs) {
        assert!((p.x - q.x).abs() < 1e-6 && q.y.abs() < 1e-6 && q.angle.abs() < 1e-9);
    }
    assert!((bbox(&plain.outline)[3] - bbox(&on.outline)[3]).abs() < 1e-6);
}

#[test]
fn text_auf_senkrechter_linie_mit_versatz_und_abstand() {
    let plain = run("Tinte", json!({}));
    let on = run(
        "Tinte",
        on_path(line(0.0, 0.0, 0.0, 300.0), 5.0, 2.0, "above"),
    );
    for (p, q) in plain.glyphs.iter().zip(&on.glyphs) {
        assert!((q.angle - FRAC_PI_2).abs() < 1e-9);
        assert!(
            (q.x - 2.0).abs() < 1e-6 && (q.y - (p.x + 5.0)).abs() < 1e-6,
            "{:?}",
            (q.x, q.y)
        );
    }
}

#[test]
fn text_auf_kreis_folgt_der_kurve() {
    let r = 50.0;
    let l = run("Tattoo Studio", on_path(circle(r), 0.0, 0.0, "above"));
    for g in &l.glyphs {
        let (c, s) = (g.angle.cos(), g.angle.sin());
        let (mx, my) = (g.x + c * g.advance / 2.0, g.y + s * g.advance / 2.0);
        assert!(
            ((mx * mx + my * my).sqrt() - r).abs() < 0.02,
            "Mitte {:?} nicht auf dem Kreis",
            (mx, my)
        );
        // Bézier-Kreis: Radiusfehler bis 2,7e-4·r schwankt viermal je Umlauf → Tangente weicht bis ~1,2e-3 rad ab
        assert!(
            (mx * c + my * s).abs() < 2e-3 * r,
            "Glyphe nicht tangential: {:?}",
            (mx, my, g.angle)
        );
    }
    // Im Uhrzeigersinn ab rechts: erste Glyphe unten rechts, Schrift außen
    assert!(l.glyphs[1].y > 0.0 && l.glyphs[1].x > 0.0);
    let b = bbox(&l.outline);
    assert!(b[2] > r + 5.0, "Schrift liegt außen");
}

#[test]
fn andere_seite_laeuft_rueckwaerts_unter_der_linie() {
    let l = run(
        "Tinte",
        on_path(line(0.0, 0.0, 300.0, 0.0), 0.0, 0.0, "below"),
    );
    assert!((l.glyphs[0].x - 300.0).abs() < 1e-6);
    assert!(l.glyphs.windows(2).all(|w| w[1].x < w[0].x));
    assert!(l.glyphs.iter().all(|g| (g.angle.abs() - PI).abs() < 1e-9));
    let b = bbox(&l.outline);
    assert!(
        b[1] > -1.0 && b[3] > 10.0,
        "Schrift hängt unter der Linie: {b:?}"
    );
}

#[test]
fn fehlende_schrift_meldet_namen() {
    let s = spec(
        "A",
        json!({ "font": { "family": "Gibtsnicht", "weight": 400, "italic": false, "size": 12.0 } }),
    );
    assert!(layout(&db(), &s).unwrap_err().contains("Gibtsnicht"));
}

#[test]
fn schriftliste_nennt_jede_familie_einmal() {
    let mut db = (*db()).clone();
    db.load_font_file(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/fixtures/fonts/Tuffy.ttf"
    ))
    .unwrap();
    assert_eq!(families(&db), ["Tuffy"]);
}
