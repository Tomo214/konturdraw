//! Mittellinie (Abnahme 3h): Testbild 2000 × 2000 px mit bekannten Mittellinien → ±2 px, < 3 s (Release).
use kw_core::scene::{segments, Seg, Subpath};
use kw_core::trace::{trace, Mode, Params};
use std::collections::HashMap;
use std::time::Instant;
use tiny_skia::{LineCap, LineJoin, Paint, PathBuilder, Pixmap, Stroke, Transform};

const W: f32 = 12.0; // Strichbreite px
const Y_JOIN: (f64, f64) = (400.0, 1750.0);
const X_JOIN: (f64, f64) = (1400.0, 1200.0);
type P = (f64, f64);

fn line(a: P, b: P) -> Vec<P> {
    let n = ((b.0 - a.0).hypot(b.1 - a.1) / 0.5).ceil() as usize;
    (0..=n)
        .map(|i| i as f64 / n as f64)
        .map(|t| (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t))
        .collect()
}

fn cubic(p: [P; 4]) -> Vec<P> {
    let at = |t: f64, i: usize| {
        let s = 1.0 - t;
        let c = [p[0], p[1], p[2], p[3]].map(|q| if i == 0 { q.0 } else { q.1 });
        s * s * s * c[0] + 3.0 * s * s * t * c[1] + 3.0 * s * t * t * c[2] + t * t * t * c[3]
    };
    (0..=4000)
        .map(|i| i as f64 / 4000.0)
        .map(|t| (at(t, 0), at(t, 1)))
        .collect()
}

/// Wahre Mittellinien + offene Enden; Zeichnung mit runden Enden wie ein Stift.
fn scene() -> (Vec<u8>, Vec<P>, Vec<P>) {
    let s_curve = [
        (100.0, 1100.0),
        (500.0, 700.0),
        (500.0, 1500.0),
        (900.0, 1100.0),
    ];
    let lines: [(P, P); 6] = [
        ((100.0, 100.0), (900.0, 300.0)),
        ((1100.0, 900.0), (1700.0, 1500.0)),
        ((1100.0, 1500.0), (1700.0, 900.0)),
        ((400.0, 1500.0), Y_JOIN),
        (Y_JOIN, (250.0, 1950.0)),
        (Y_JOIN, (550.0, 1950.0)),
    ];
    let mut pb = PathBuilder::new();
    for (a, b) in lines {
        pb.move_to(a.0 as f32, a.1 as f32);
        pb.line_to(b.0 as f32, b.1 as f32);
    }
    let s = s_curve.map(|(x, y)| (x as f32, y as f32));
    pb.move_to(s[0].0, s[0].1);
    pb.cubic_to(s[1].0, s[1].1, s[2].0, s[2].1, s[3].0, s[3].1);
    pb.push_circle(1400.0, 400.0, 300.0);
    let mut pm = Pixmap::new(2000, 2000).unwrap();
    pm.fill(tiny_skia::Color::WHITE);
    let mut paint = Paint::default();
    paint.set_color_rgba8(0, 0, 0, 255);
    let stroke = Stroke {
        width: W,
        line_cap: LineCap::Round,
        line_join: LineJoin::Round,
        ..Stroke::default()
    };
    pm.stroke_path(
        &pb.finish().unwrap(),
        &paint,
        &stroke,
        Transform::identity(),
        None,
    );
    pm.fill_rect(
        tiny_skia::Rect::from_xywh(1800.0, 1800.0, 3.0, 3.0).unwrap(),
        &paint,
        Transform::identity(),
        None,
    ); // Fleck

    let mut truth: Vec<P> = lines.iter().flat_map(|&(a, b)| line(a, b)).collect();
    truth.extend(cubic(s_curve));
    truth.extend(
        (0..4000)
            .map(|i| i as f64 / 4000.0 * std::f64::consts::TAU)
            .map(|a| (1400.0 + 300.0 * a.cos(), 400.0 + 300.0 * a.sin())),
    );
    let ends = vec![
        (100.0, 100.0),
        (900.0, 300.0),
        (1100.0, 900.0),
        (1700.0, 1500.0),
        (1100.0, 1500.0),
        (1700.0, 900.0),
        (400.0, 1500.0),
        (250.0, 1950.0),
        (550.0, 1950.0),
        s_curve[0],
        s_curve[3],
    ];
    (pm.encode_png().unwrap(), truth, ends)
}

/// Punkte auf der Ausgabe, höchstens 0,5 px auseinander.
fn samples(sp: &Subpath) -> Vec<P> {
    let mut out = vec![];
    for (i, seg) in segments(sp).iter().enumerate() {
        let a = &sp.nodes[i];
        let (p0, c) = (
            (a.x, a.y),
            match seg {
                Seg::Line(e) => [(a.x, a.y), (e.x, e.y), (e.x, e.y)],
                Seg::Cubic(c1, c2, e) => [(c1.x, c1.y), (c2.x, c2.y), (e.x, e.y)],
            },
        );
        let poly = (p0.0 - c[0].0).hypot(p0.1 - c[0].1)
            + (c[0].0 - c[1].0).hypot(c[0].1 - c[1].1)
            + (c[1].0 - c[2].0).hypot(c[1].1 - c[2].1);
        let n = (poly / 0.5).ceil().max(1.0) as usize;
        out.extend(
            cubic([p0, c[0], c[1], c[2]])
                .into_iter()
                .step_by((4000 / n).max(1)),
        );
    }
    out
}

/// Abstand zum nächsten Punkt, nur bis 4 px genau (darüber ∞).
struct Near(HashMap<(i64, i64), Vec<P>>);

impl Near {
    fn new(pts: &[P]) -> Self {
        let mut m: HashMap<(i64, i64), Vec<P>> = HashMap::new();
        for &p in pts {
            m.entry(((p.0 / 4.0).floor() as i64, (p.1 / 4.0).floor() as i64))
                .or_default()
                .push(p);
        }
        Near(m)
    }

    fn dist(&self, p: P) -> f64 {
        let (cx, cy) = ((p.0 / 4.0).floor() as i64, (p.1 / 4.0).floor() as i64);
        let mut d = f64::INFINITY;
        for (dx, dy) in (-1..=1).flat_map(|x| (-1..=1).map(move |y| (x, y))) {
            for q in self.0.get(&(cx + dx, cy + dy)).into_iter().flatten() {
                d = d.min((p.0 - q.0).hypot(p.1 - q.1));
            }
        }
        if d <= 4.0 {
            d
        } else {
            f64::INFINITY
        }
    }
}

/// Kreuzungen und Strichenden sind bei jeder Mittellinie mehrdeutig → ausgenommen.
fn counts(p: P, ends: &[P]) -> bool {
    let away = |q: P, r: f64| (p.0 - q.0).hypot(p.1 - q.1) > r;
    away(Y_JOIN, 2.0 * W as f64)
        && away(X_JOIN, 2.0 * W as f64)
        && ends.iter().all(|&e| away(e, W as f64))
}

#[test]
fn mittellinie_testbild_2px_unter_3s() {
    let (png, truth, ends) = scene();
    let p = Params {
        mode: Mode::Centerline,
        threshold: 128,
        speckle: 16,
        smooth: 0.5,
        ..Params::default()
    };
    let t = Instant::now();
    let sps = trace(&png, &p, 2000.0, 2000.0).unwrap();
    let secs = t.elapsed().as_secs_f64();
    println!("Mittellinie: {} Pfade in {secs:.2} s", sps.len());

    let out: Vec<P> = sps.iter().flat_map(samples).collect();
    let (to_truth, to_out) = (Near::new(&truth), Near::new(&out));
    let worst = |pts: &[P], near: &Near| {
        pts.iter()
            .copied()
            .filter(|&q| counts(q, &ends))
            .map(|q| (near.dist(q), q))
            .fold((0.0, (0.0, 0.0)), |a, b| if b.0 > a.0 { b } else { a })
    };
    let (d_out, at_out) = worst(&out, &to_truth);
    let (d_truth, at_truth) = worst(&truth, &to_out);
    println!("größte Abweichung: Ausgabe → Mitte {d_out:.2} px bei {at_out:?}, Mitte → Ausgabe {d_truth:.2} px bei {at_truth:?}");
    assert!(
        d_out <= 2.0,
        "Ausgabe {d_out:.2} px neben der Mitte bei {at_out:?}"
    );
    assert!(
        d_truth <= 2.0,
        "Mittellinie {d_truth:.2} px nicht getroffen bei {at_truth:?}"
    );

    // Kreis bleibt geschlossen; keine Sporne, kein Fleck: 1 + 1 + 1 + Kreuz (2–5) + Y 3
    assert_eq!(sps.iter().filter(|s| s.closed).count(), 1);
    assert!(sps.len() <= 11, "{} Pfade", sps.len());
    // Y-Abzweig lückenlos: drei Enden in einem Punkt
    let at_y: Vec<P> = sps
        .iter()
        .filter(|s| !s.closed)
        .flat_map(|s| [&s.nodes[0], s.nodes.last().unwrap()])
        .map(|n| (n.x, n.y))
        .filter(|&q| (q.0 - Y_JOIN.0).hypot(q.1 - Y_JOIN.1) < 2.0 * W as f64)
        .collect();
    assert!(
        at_y.len() >= 3
            && at_y
                .iter()
                .all(|q| (q.0 - at_y[0].0).hypot(q.1 - at_y[0].1) <= 1.0),
        "{at_y:?}"
    );
    if !cfg!(debug_assertions) {
        assert!(secs < 3.0, "{secs:.2} s");
    }
}
