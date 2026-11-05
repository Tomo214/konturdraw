//! Messer und Radierer (4f, spec.md §5): Teilen entlang eines Schnitts, Wegradieren mit Spitze.
//! Geprüft werden Flächen, Stückzahl, exakte Ecken und Kurven-Erhalt.
use kw_core::boolean::cut::{erase, knife};
use kw_core::boolean::Shape;
use kw_core::scene::{NodeType, PathPoint, Point, Subpath};

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
fn circle(cx: f64, cy: f64, r: f64) -> Subpath {
    let nodes = (0..4).map(|i| {
        let a = i as f64 * std::f64::consts::FRAC_PI_2;
        let (x, y, tx, ty) = (cx + r * a.cos(), cy + r * a.sin(), -a.sin() * K * r, a.cos() * K * r);
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

/// Punkte entlang des Teilpfads (Kurven fein abgetastet), für Fläche und Länge.
fn trace(sp: &Subpath) -> Vec<(f64, f64)> {
    let n = sp.nodes.len();
    let segs = if sp.closed { n } else { n - 1 };
    let mut out = vec![(sp.nodes[0].x, sp.nodes[0].y)];
    for i in 0..segs {
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
/// Fläche mit Vorzeichen: Löcher laufen gegen und ziehen ab.
fn area(sps: &[Subpath]) -> f64 {
    sps.iter()
        .map(|sp| {
            let p = trace(sp);
            (0..p.len()).map(|i| {
                let (a, b) = (p[i], p[(i + 1) % p.len()]);
                a.0 * b.1 - b.0 * a.1
            }).sum::<f64>() / 2.0
        })
        .sum()
}
fn length(sp: &Subpath) -> f64 {
    trace(sp).windows(2).map(|w| (w[1].0 - w[0].0).hypot(w[1].1 - w[0].1)).sum()
}
fn near(a: f64, b: f64, tol: f64) -> bool {
    (a - b).abs() <= tol
}
fn has_corner(sps: &[Subpath], x: f64, y: f64) -> bool {
    sps.iter().flat_map(|s| &s.nodes).any(|n| n.x == x && n.y == y)
}

#[test]
fn messer_teilt_rechteck_in_zwei_mit_exakten_ecken() {
    let r = knife(&shape(vec![rect(0.0, 0.0, 10.0, 10.0)]), &line(&[(4.0, -5.0), (4.0, 15.0)])).unwrap().unwrap();
    assert_eq!(r.len(), 2);
    let mut a: Vec<f64> = r.iter().map(|g| area(g).abs()).collect();
    a.sort_by(f64::total_cmp);
    assert!(near(a[0], 40.0, 1e-6) && near(a[1], 60.0, 1e-6), "Flächen {a:?}");
    assert!(r.iter().all(|g| g.len() == 1 && g[0].closed && g[0].nodes.len() == 4));
    assert!(has_corner(&r[0], 0.0, 0.0) || has_corner(&r[1], 0.0, 0.0), "Original-Ecke exakt");
}

#[test]
fn messer_halbiert_kreis_kurven_bleiben_kurven() {
    let r = knife(&shape(vec![circle(0.0, 0.0, 10.0)]), &line(&[(-20.0, 0.0), (20.0, 0.0)])).unwrap().unwrap();
    assert_eq!(r.len(), 2);
    let half = std::f64::consts::PI * 100.0 / 2.0;
    for g in &r {
        assert!(near(area(g).abs(), half, 0.05), "Halbkreis {}", area(g));
        assert!(g[0].nodes.len() <= 4, "zu viele Knoten: {}", g[0].nodes.len());
        assert!(g[0].nodes.iter().any(|n| n.handle_out.is_some()), "Bogen als Kurve");
    }
}

#[test]
fn messer_ohne_treffer_oder_ohne_durchgang_aendert_nichts() {
    let s = shape(vec![rect(0.0, 0.0, 10.0, 10.0)]);
    assert!(knife(&s, &line(&[(20.0, -5.0), (20.0, 15.0)])).unwrap().is_none(), "daneben");
    assert!(knife(&s, &line(&[(4.0, -5.0), (4.0, 5.0)])).unwrap().is_none(), "endet im Objekt");
}

#[test]
fn messer_ordnet_unberuehrte_teile_ihrer_seite_zu() {
    // Kombiniertes Objekt: links geschnittenes Rechteck, rechts ein unberührtes.
    let s = shape(vec![rect(0.0, 0.0, 10.0, 10.0), rect(20.0, 0.0, 10.0, 10.0)]);
    let r = knife(&s, &line(&[(4.0, -5.0), (4.0, 15.0)])).unwrap().unwrap();
    assert_eq!(r.len(), 2);
    let mut sizes: Vec<(usize, i64)> = r.iter().map(|g| (g.len(), area(g).abs().round() as i64)).collect();
    sizes.sort();
    assert_eq!(sizes, vec![(1, 40), (2, 160)]);
}

#[test]
fn messer_teilt_offene_linie() {
    let r = knife(&shape(vec![line(&[(0.0, 5.0), (10.0, 5.0)])]), &line(&[(4.0, -5.0), (4.0, 15.0)])).unwrap().unwrap();
    assert_eq!(r.len(), 2);
    let mut l: Vec<f64> = r.iter().map(|g| {
        assert!(g.len() == 1 && !g[0].closed);
        length(&g[0])
    }).collect();
    l.sort_by(f64::total_cmp);
    assert!(near(l[0], 4.0, 1e-9) && near(l[1], 6.0, 1e-9), "Längen {l:?}");
}

#[test]
fn messer_teilt_offene_kurve_als_kurve() {
    let mut s = line(&[(0.0, 0.0), (10.0, 0.0)]);
    s.nodes[0].handle_out = Some(Point { x: 3.0, y: 8.0 });
    s.nodes[1].handle_in = Some(Point { x: 7.0, y: 8.0 });
    let r = knife(&shape(vec![s.clone()]), &line(&[(5.0, -5.0), (5.0, 15.0)])).unwrap().unwrap();
    assert_eq!(r.len(), 2);
    for g in &r {
        assert_eq!(g[0].nodes.len(), 2);
        assert!(g[0].nodes[0].handle_out.is_some(), "Stück bleibt Kurve");
    }
    let total: f64 = r.iter().map(|g| length(&g[0])).sum();
    assert!(near(total, length(&s), 1e-3), "Länge {total} vs {}", length(&s));
    let ends: Vec<f64> = r.iter().flat_map(|g| [g[0].nodes[0].x, g[0].nodes[1].x]).collect();
    assert_eq!(ends.iter().filter(|&&x| near(x, 5.0, 1e-9)).count(), 2, "beide Stücke enden am Schnitt: {ends:?}");
}

#[test]
fn radierer_trennt_rechteck_in_teilpfade_eines_objekts() {
    let r = erase(&shape(vec![rect(0.0, 0.0, 10.0, 10.0)]), &line(&[(5.0, -5.0), (5.0, 15.0)]), 2.0, false).unwrap().unwrap();
    assert_eq!(r.len(), 2, "zwei Teilpfade");
    assert!(near(area(&r).abs(), 80.0, 1e-6), "Fläche {}", area(&r));
    assert!(has_corner(&r, 0.0, 0.0) && has_corner(&r, 10.0, 10.0), "Ecken exakt");
    assert!(r.iter().all(|s| s.nodes.len() == 4), "Schnittkanten gerade, keine Zwischenknoten");
}

#[test]
fn radierer_runde_spitze_macht_rundes_loch() {
    let r = erase(&shape(vec![rect(0.0, 0.0, 10.0, 10.0)]), &line(&[(5.0, 5.0)]), 4.0, false).unwrap().unwrap();
    let hole = 100.0 - area(&r).abs();
    assert!(near(hole, std::f64::consts::PI * 4.0, 0.05), "Loch {hole}");
    assert!(r.iter().flat_map(|s| &s.nodes).count() <= 12, "Loch als Kurve, nicht als Vieleck");
}

#[test]
fn radierer_eckige_spitze_macht_eckiges_loch() {
    let r = erase(&shape(vec![rect(0.0, 0.0, 10.0, 10.0)]), &line(&[(5.0, 5.0)]), 4.0, true).unwrap().unwrap();
    assert!(near(100.0 - area(&r).abs(), 16.0, 1e-6));
}

#[test]
fn radierer_daneben_aendert_nichts_ganz_weg_leert() {
    let s = shape(vec![rect(0.0, 0.0, 10.0, 10.0)]);
    assert!(erase(&s, &line(&[(30.0, 0.0), (30.0, 10.0)]), 2.0, false).unwrap().is_none());
    let gone = erase(&s, &line(&[(-5.0, 5.0), (15.0, 5.0)]), 30.0, false).unwrap().unwrap();
    assert!(gone.is_empty());
}

#[test]
fn radierer_auf_offener_linie_laesst_offene_stuecke() {
    let r = erase(&shape(vec![line(&[(0.0, 5.0), (10.0, 5.0)])]), &line(&[(5.0, -5.0), (5.0, 15.0)]), 2.0, false).unwrap().unwrap();
    assert_eq!(r.len(), 2);
    let mut l: Vec<f64> = r.iter().map(|s| {
        assert!(!s.closed);
        length(s)
    }).collect();
    l.sort_by(f64::total_cmp);
    assert!(near(l[0], 4.0, 1e-6) && near(l[1], 4.0, 1e-6), "Längen {l:?}");
}

#[test]
fn gekruemmter_schnitt_bleibt_kurve() {
    let mut blade = line(&[(-20.0, 0.0), (20.0, 0.0)]);
    blade.nodes[0].handle_out = Some(Point { x: -5.0, y: 15.0 });
    blade.nodes[1].handle_in = Some(Point { x: 5.0, y: -15.0 });
    let r = knife(&shape(vec![circle(0.0, 0.0, 10.0)]), &blade).unwrap().unwrap();
    assert_eq!(r.len(), 2);
    let total: f64 = r.iter().map(|g| area(g).abs()).sum();
    assert!(near(total, std::f64::consts::PI * 100.0, 0.05), "Fläche {total}");
    for g in &r {
        assert!(g[0].nodes.len() <= 6, "Schnittkante als Kurve, nicht als Vieleck: {} Knoten", g[0].nodes.len());
    }
}
