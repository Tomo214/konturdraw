//! Kontur-Werkzeug (Effekt wie im Vorbild, statisch): parallele Umrisse in festem Abstand nach außen,
//! innen oder bis zur Mitte. Geprüft über Flächen, Anzahl der Schritte und Kurven-Erhalt.
use kw_core::boolean::contour::{contour, Direction, MAX_STEPS};
use kw_core::boolean::Shape;
use kw_core::scene::{Join, NodeType, PathPoint, Point, Subpath};
use std::f64::consts::PI;

const K: f64 = 0.552_284_749_8;

fn pt(x: f64, y: f64) -> PathPoint {
    PathPoint {
        x,
        y,
        kind: NodeType::Corner,
        handle_in: None,
        handle_out: None,
    }
}
fn line(p: &[(f64, f64)]) -> Subpath {
    Subpath {
        closed: false,
        nodes: p.iter().map(|&(x, y)| pt(x, y)).collect(),
    }
}
fn rect(x: f64, y: f64, w: f64, h: f64) -> Subpath {
    Subpath {
        closed: true,
        ..line(&[(x, y), (x + w, y), (x + w, y + h), (x, y + h)])
    }
}
fn circle(r: f64) -> Subpath {
    let nodes = (0..4).map(|i| {
        let a = i as f64 * std::f64::consts::FRAC_PI_2;
        let (x, y, tx, ty) = (r * a.cos(), r * a.sin(), -a.sin() * K * r, a.cos() * K * r);
        PathPoint {
            x,
            y,
            kind: NodeType::Smooth,
            handle_in: Some(Point { x: x - tx, y: y - ty }),
            handle_out: Some(Point { x: x + tx, y: y + ty }),
        }
    });
    Subpath {
        closed: true,
        nodes: nodes.collect(),
    }
}
fn shape(subpaths: Vec<Subpath>) -> Shape {
    Shape {
        subpaths,
        even_odd: false,
    }
}
/// Fläche aus fein abgetasteten Kurven; Löcher laufen gegen und ziehen ab.
fn area(sps: &[Subpath]) -> f64 {
    let mut sum = 0.0;
    for sp in sps {
        let n = sp.nodes.len();
        let mut p = vec![(sp.nodes[0].x, sp.nodes[0].y)];
        for i in 0..n {
            let (a, b) = (&sp.nodes[i], &sp.nodes[(i + 1) % n]);
            let p1 = a.handle_out.map_or((a.x, a.y), |h| (h.x, h.y));
            let p2 = b.handle_in.map_or((b.x, b.y), |h| (h.x, h.y));
            for k in 1..=64 {
                let t = k as f64 / 64.0;
                let u = 1.0 - t;
                let f = |q0: f64, q1: f64, q2: f64, q3: f64| u * u * u * q0 + 3.0 * u * u * t * q1 + 3.0 * u * t * t * q2 + t * t * t * q3;
                p.push((f(a.x, p1.0, p2.0, b.x), f(a.y, p1.1, p2.1, b.y)));
            }
        }
        sum += (0..p.len()).map(|i| p[i].0 * p[(i + 1) % p.len()].1 - p[(i + 1) % p.len()].0 * p[i].1).sum::<f64>() / 2.0;
    }
    sum.abs()
}
fn areas(r: &[Vec<Subpath>]) -> Vec<f64> {
    r.iter().map(|s| (area(s) * 1000.0).round() / 1000.0).collect()
}
fn sq() -> Vec<Shape> {
    vec![shape(vec![rect(0.0, 0.0, 10.0, 10.0)])]
}

#[test]
fn aussen_drei_schritte_mit_spitzen_ecken() {
    let r = contour(&sq(), 1.0, 3, Direction::Outside, Join::Miter).unwrap();
    assert_eq!(areas(&r), vec![144.0, 196.0, 256.0], "12², 14², 16²");
    assert!(r.iter().all(|s| s.len() == 1));
}

#[test]
fn aussen_runde_ecken() {
    let r = contour(&sq(), 1.0, 1, Direction::Outside, Join::Round).unwrap();
    let want = 100.0 + 40.0 + PI;
    assert!((area(&r[0]) - want).abs() < 0.01, "Fläche {} statt {want}", area(&r[0]));
}

#[test]
fn innen_endet_wenn_nichts_mehr_passt() {
    let r = contour(&sq(), 1.0, 3, Direction::Inside, Join::Miter).unwrap();
    assert_eq!(areas(&r), vec![64.0, 36.0, 16.0]);
    // 6 Schritte gewünscht, ab Abstand 5 ist die Fläche weg
    let r = contour(&sq(), 1.0, 6, Direction::Inside, Join::Miter).unwrap();
    assert_eq!(areas(&r), vec![64.0, 36.0, 16.0, 4.0]);
}

#[test]
fn zur_mitte_fuellt_bis_nichts_mehr_passt() {
    let r = contour(&sq(), 1.0, 1, Direction::Center, Join::Miter).unwrap();
    assert_eq!(areas(&r), vec![64.0, 36.0, 16.0, 4.0], "Schritte zählen nicht");
    let r = contour(&sq(), 3.0, 1, Direction::Center, Join::Miter).unwrap();
    assert_eq!(areas(&r), vec![16.0]);
}

#[test]
fn loecher_wachsen_und_schrumpfen_mit() {
    // Rahmen 10×10 mit Loch 4×4 (gegenläufig)
    let mut hole = rect(3.0, 3.0, 4.0, 4.0);
    hole.nodes.reverse();
    let frame = vec![shape(vec![rect(0.0, 0.0, 10.0, 10.0), hole])];
    let out = contour(&frame, 1.0, 1, Direction::Outside, Join::Miter).unwrap();
    assert_eq!(areas(&out), vec![140.0], "12² − 2²");
    assert_eq!(out[0].len(), 2);
    let inn = contour(&frame, 1.0, 1, Direction::Inside, Join::Miter).unwrap();
    assert_eq!(areas(&inn), vec![28.0], "8² − 6²");
}

#[test]
fn gruppe_wird_als_ein_umriss_konturiert() {
    // zwei überlappende Rechtecke = 15 × 10; innen 1 mm → 13 × 8, nicht zwei einzelne kleinere Rechtecke
    let g = vec![shape(vec![rect(0.0, 0.0, 10.0, 10.0)]), shape(vec![rect(5.0, 0.0, 10.0, 10.0)])];
    let r = contour(&g, 1.0, 1, Direction::Inside, Join::Miter).unwrap();
    assert_eq!(areas(&r), vec![104.0]);
}

#[test]
fn offene_linie_nur_nach_aussen() {
    let l = vec![shape(vec![line(&[(0.0, 0.0), (10.0, 0.0)])])];
    let r = contour(&l, 1.0, 1, Direction::Outside, Join::Round).unwrap();
    assert!((area(&r[0]) - (20.0 + PI)).abs() < 0.01, "Fläche {}", area(&r[0]));
    assert!(contour(&l, 1.0, 1, Direction::Inside, Join::Round).unwrap().is_empty());
}

#[test]
fn kreis_bleibt_kurve() {
    let r = contour(&[shape(vec![circle(10.0)])], 2.0, 1, Direction::Outside, Join::Round).unwrap();
    let want = PI * 144.0;
    assert!((area(&r[0]) - want).abs() < 0.1, "Fläche {} statt {want}", area(&r[0]));
    let nodes: usize = r[0].iter().map(|s| s.nodes.len()).sum();
    assert!(nodes < 40, "{nodes} Knoten – Kurven statt Polygon");
}

#[test]
fn ungueltige_werte() {
    assert!(contour(&sq(), 0.0, 1, Direction::Outside, Join::Miter).is_err());
    assert!(contour(&sq(), f64::NAN, 1, Direction::Outside, Join::Miter).is_err());
    assert!(contour(&sq(), 1.0, 0, Direction::Outside, Join::Miter).is_err());
    assert!(contour(&sq(), 1.0, MAX_STEPS + 1, Direction::Outside, Join::Miter).is_err());
    // zur Mitte mit winzigem Abstand bricht an der Obergrenze ab
    assert_eq!(contour(&sq(), 0.001, 1, Direction::Center, Join::Miter).unwrap().len(), MAX_STEPS);
}
