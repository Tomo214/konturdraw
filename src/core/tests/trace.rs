//! Nachzeichnen (Spec §8, 3h): Umriss s/w und Mittellinie an synthetischen Bildern mit bekannter Geometrie.
use kw_core::color::Cms;
use kw_core::png_export;
use kw_core::scene::{segments, Color, Fill, Item, Scene, Seg, Subpath, IDENTITY};
use kw_core::trace::{trace, Mode, Params};
use kw_core::Images;
use tiny_skia::{FillRule, Paint, PathBuilder, Pixmap, Rect, Transform};

fn params(mode: Mode) -> Params {
    Params {
        mode,
        threshold: 128,
        speckle: 16,
        smooth: 0.5,
        ..Params::default()
    }
}

fn paint(v: u8) -> Paint<'static> {
    let mut p = Paint::default();
    p.set_color_rgba8(v, v, v, 255);
    p
}

/// Weißes (oder transparentes) Bild, darauf zeichnet `draw`.
fn png(w: u32, h: u32, white: bool, draw: impl FnOnce(&mut Pixmap)) -> Vec<u8> {
    let mut pm = Pixmap::new(w, h).unwrap();
    if white {
        pm.fill(tiny_skia::Color::WHITE);
    }
    draw(&mut pm);
    pm.encode_png().unwrap()
}

fn rect(pm: &mut Pixmap, x: f32, y: f32, w: f32, h: f32, v: u8) {
    pm.fill_rect(
        Rect::from_xywh(x, y, w, h).unwrap(),
        &paint(v),
        Transform::identity(),
        None,
    );
}

/// Begrenzungsrahmen aller Knoten (Anfasser liegen bei Spuren am Rand innerhalb).
fn bbox(sps: &[Subpath]) -> [f64; 4] {
    let mut b = [f64::MAX, f64::MAX, f64::MIN, f64::MIN];
    for n in sps.iter().flat_map(|s| &s.nodes) {
        b = [b[0].min(n.x), b[1].min(n.y), b[2].max(n.x), b[3].max(n.y)];
    }
    b
}

fn near(a: [f64; 4], b: [f64; 4], tol: f64) -> bool {
    a.iter().zip(b).all(|(x, y)| (x - y).abs() <= tol)
}

#[test]
fn umriss_quadrat_in_mm() {
    let img = png(200, 200, true, |pm| rect(pm, 50.0, 50.0, 100.0, 100.0, 0));
    let sps = trace(&img, &params(Mode::Outline), 200.0, 200.0).unwrap();
    assert_eq!(sps.len(), 1);
    assert!(sps[0].closed);
    assert!(
        near(bbox(&sps), [50.0, 50.0, 150.0, 150.0], 1.0),
        "{:?}",
        bbox(&sps)
    );
    // Bildgröße 100 × 50 mm: Pixel → mm je Achse
    let mm = trace(&img, &params(Mode::Outline), 100.0, 50.0).unwrap();
    assert!(
        near(bbox(&mm), [25.0, 12.5, 75.0, 37.5], 0.5),
        "{:?}",
        bbox(&mm)
    );
}

#[test]
fn umriss_ring_loch_bleibt_weiss() {
    let img = png(200, 200, true, |pm| {
        let mut pb = PathBuilder::new();
        pb.push_circle(100.0, 100.0, 60.0);
        pb.push_circle(100.0, 100.0, 30.0);
        pm.fill_path(
            &pb.finish().unwrap(),
            &paint(0),
            FillRule::EvenOdd,
            Transform::identity(),
            None,
        );
    });
    let sps = trace(&img, &params(Mode::Outline), 200.0, 200.0).unwrap();
    assert_eq!(sps.len(), 2);
    // Ausgabe wie gespeichert rendern (nonzero, transparenter Grund): Loch frei, Ring deckend
    let item = Item::Path {
        matrix: IDENTITY,
        subpaths: sps,
        fill: Some(Fill::Color(Color::rgb(0.0, 0.0, 0.0))),
        stroke: None,
        fill_rule: None,
    };
    let out = png_export::export(
        &Scene {
            width: 200.0,
            height: 200.0,
            items: vec![item],
        },
        &Images::new(),
        25.4,
        &Cms::default(),
    )
    .unwrap();
    let img = image::load_from_memory(&out).unwrap().to_rgba8();
    let alpha = |x, y| img.get_pixel(x, y).0[3];
    assert_eq!(
        (
            alpha(100, 100),
            alpha(145, 100),
            alpha(100, 55),
            alpha(5, 5)
        ),
        (0, 255, 255, 0)
    );
}

#[test]
fn umriss_rauschfilter_schwellwert_transparenz() {
    // transparenter Grund zählt als weiß; Fleck 3 × 3 < 16 px weg; Grau 150 nur mit hohem Schwellwert
    let img = png(200, 100, false, |pm| {
        rect(pm, 10.0, 10.0, 40.0, 40.0, 0);
        rect(pm, 70.0, 10.0, 3.0, 3.0, 0);
        rect(pm, 120.0, 10.0, 40.0, 40.0, 150);
    });
    let p = params(Mode::Outline);
    let sps = trace(&img, &p, 200.0, 100.0).unwrap();
    assert!(
        sps.len() == 1 && near(bbox(&sps), [10.0, 10.0, 50.0, 50.0], 1.0),
        "{:?}",
        bbox(&sps)
    );
    let hell = trace(
        &img,
        &Params {
            threshold: 200,
            ..p
        },
        200.0,
        100.0,
    )
    .unwrap();
    assert_eq!(hell.len(), 2);
    let ohne_filter = trace(
        &img,
        &Params {
            threshold: 200,
            speckle: 0,
            ..p
        },
        200.0,
        100.0,
    )
    .unwrap();
    assert_eq!(ohne_filter.len(), 3);
}

#[test]
fn umriss_kurven_statt_treppen() {
    let img = png(200, 200, true, |pm| {
        let pb = PathBuilder::from_circle(100.0, 100.0, 80.0).unwrap();
        pm.fill_path(
            &pb,
            &paint(0),
            FillRule::Winding,
            Transform::identity(),
            None,
        );
    });
    let sps = trace(&img, &params(Mode::Outline), 200.0, 200.0).unwrap();
    let segs = segments(&sps[0]);
    assert!(segs.iter().all(|s| matches!(s, Seg::Cubic(..))));
    assert!(segs.len() <= 16, "{} Segmente für einen Kreis", segs.len());
    for n in &sps[0].nodes {
        let r = ((n.x - 100.0).powi(2) + (n.y - 100.0).powi(2)).sqrt();
        assert!((r - 80.0).abs() <= 1.0, "Knoten bei r = {r}");
    }
}

#[test]
fn kaputtes_bild_meldet_fehler() {
    assert!(trace(b"kein png", &params(Mode::Outline), 1.0, 1.0)
        .unwrap_err()
        .contains("Bild"));
}
