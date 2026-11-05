//! Kontur in Objekt (5c, spec.md §6): die Kontur wird eine Fläche, die genauso aussieht wie die
//! gezeichnete Kontur (runder Stift, Enden, Ecken, Gehrungsgrenze 10). Geprüft: Fläche, Ecken, Kurven-Erhalt.
use kw_core::boolean::outline::outline;
use kw_core::scene::{Cap, Join, NodeType, PathPoint, Point, Subpath};

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

/// Punkte entlang des Teilpfads (Kurven fein abgetastet).
fn trace(sp: &Subpath) -> Vec<(f64, f64)> {
    let n = sp.nodes.len();
    let mut out = vec![(sp.nodes[0].x, sp.nodes[0].y)];
    for i in 0..n {
        let (a, b) = (&sp.nodes[i], &sp.nodes[(i + 1) % n]);
        let p1 = a.handle_out.map_or((a.x, a.y), |h| (h.x, h.y));
        let p2 = b.handle_in.map_or((b.x, b.y), |h| (h.x, h.y));
        for k in 1..=64 {
            let t = k as f64 / 64.0;
            let u = 1.0 - t;
            let f = |q0: f64, q1: f64, q2: f64, q3: f64| u * u * u * q0 + 3.0 * u * u * t * q1 + 3.0 * u * t * t * q2 + t * t * t * q3;
            out.push((f(a.x, p1.0, p2.0, b.x), f(a.y, p1.1, p2.1, b.y)));
        }
    }
    out
}
/// Fläche; Löcher laufen gegen und ziehen ab.
fn area(sps: &[Subpath]) -> f64 {
    sps.iter()
        .map(|sp| {
            let p = trace(sp);
            (0..p.len()).map(|i| {
                let (a, b) = (p[i], p[(i + 1) % p.len()]);
                a.0 * b.1 - b.0 * a.1
            }).sum::<f64>() / 2.0
        })
        .sum::<f64>()
        .abs()
}
fn max_x(sps: &[Subpath]) -> f64 {
    sps.iter().flat_map(trace).map(|p| p.0).fold(f64::MIN, f64::max)
}
fn has_corner(sps: &[Subpath], x: f64, y: f64) -> bool {
    sps.iter().flat_map(|s| &s.nodes).any(|n| (n.x - x).abs() < 1e-9 && (n.y - y).abs() < 1e-9)
}
fn curved(sps: &[Subpath]) -> bool {
    sps.iter().flat_map(|s| &s.nodes).any(|n| n.handle_in.is_some() || n.handle_out.is_some())
}

#[test]
fn geschlossenes_quadrat_wird_ring_mit_exakten_ecken() {
    let r = outline(&[rect(0.0, 0.0, 10.0, 10.0)], 2.0, Cap::Butt, Join::Miter).unwrap();
    assert_eq!(r.len(), 2, "außen + Loch");
    assert!((area(&r) - 80.0).abs() < 1e-6, "Fläche {}", area(&r));
    for (x, y) in [(-1.0, -1.0), (11.0, 11.0), (1.0, 1.0), (9.0, 9.0)] {
        assert!(has_corner(&r, x, y), "Ecke {x},{y}");
    }
}

#[test]
fn offene_linie_mit_linienenden() {
    let l = [line(&[(0.0, 0.0), (10.0, 0.0)])];
    let a = |cap| area(&outline(&l, 2.0, cap, Join::Round).unwrap());
    assert!((a(Cap::Butt) - 20.0).abs() < 1e-6);
    assert!((a(Cap::Square) - 24.0).abs() < 1e-6);
    let round = outline(&l, 2.0, Cap::Round, Join::Round).unwrap();
    assert!((area(&round) - (20.0 + std::f64::consts::PI)).abs() < 0.01, "rund {}", area(&round));
    assert!(curved(&round), "runde Enden bleiben Kurven");
}

#[test]
fn gehrungsgrenze_wie_anzeige_und_exporte() {
    // 17° Spitze: Gehrungsverhältnis 1/sin(8,5°) ≈ 6,8 – unter 10 spitz, bei kurbos Vorgabe 4 abgeschrägt.
    let tip = [line(&[(0.0, 0.0), (10.0, 0.0), (0.0, 10.0 * 17f64.to_radians().tan())])];
    assert!(max_x(&outline(&tip, 2.0, Cap::Butt, Join::Miter).unwrap()) > 15.0);
    assert!(max_x(&outline(&tip, 2.0, Cap::Butt, Join::Bevel).unwrap()) < 11.5);
}

#[test]
fn ueberlappungen_werden_eine_flaeche() {
    // enges U: die Kontur überdeckt sich selbst, das Ergebnis ist ein einziger Umriss ohne Innenkanten.
    // Fläche: Band 10×4 + rechts 1,5×1 + zwei Viertelkreise r 1,5 (runde Ecken außen)
    let u = [line(&[(0.0, 0.0), (10.0, 0.0), (10.0, 1.0), (0.0, 1.0)])];
    let r = outline(&u, 3.0, Cap::Butt, Join::Round).unwrap();
    assert_eq!(r.len(), 1);
    let want = 41.5 + 1.125 * std::f64::consts::PI;
    assert!((area(&r) - want).abs() < 0.02, "Fläche {} statt {want}", area(&r));
}

#[test]
fn kreis_bleibt_kurve() {
    let r = outline(&[circle(10.0)], 2.0, Cap::Butt, Join::Miter).unwrap();
    assert_eq!(r.len(), 2);
    let want = std::f64::consts::PI * (11.0 * 11.0 - 9.0 * 9.0);
    assert!((area(&r) - want).abs() < 0.05, "Fläche {} statt {want}", area(&r));
    assert!(curved(&r));
    let nodes: usize = r.iter().map(|s| s.nodes.len()).sum();
    assert!(nodes < 40, "{nodes} Knoten – Kurven statt Polygon");
}

#[test]
fn ungueltige_breite_und_leere_pfade() {
    assert!(outline(&[rect(0.0, 0.0, 1.0, 1.0)], 0.0, Cap::Butt, Join::Miter).is_err());
    assert!(outline(&[rect(0.0, 0.0, 1.0, 1.0)], f64::NAN, Cap::Butt, Join::Miter).is_err());
    assert!(outline(&[line(&[(5.0, 5.0)])], 1.0, Cap::Round, Join::Round).unwrap().is_empty());
}
