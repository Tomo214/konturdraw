//! Boolesch (3d, architecture.md §10): Korpus 30 Fälle × 4 Operationen gegen ein Raster-Orakel,
//! dazu Kurven-Erhalt und Fehlerfälle. Spike-Ergebnis (linesweeper vs. i_overlay) steht im Bericht 3d.
use kw_core::boolean::{apply, Op, Shape};
use kw_core::scene::{NodeType, PathPoint, Point, Subpath};
use tiny_skia::{FillRule, Paint, PathBuilder, Pixmap, Transform};

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
fn poly(p: &[(f64, f64)]) -> Subpath {
    Subpath {
        closed: true,
        nodes: p.iter().map(|&(x, y)| pt(x, y)).collect(),
    }
}
fn rect(x: f64, y: f64, w: f64, h: f64) -> Subpath {
    poly(&[(x, y), (x + w, y), (x + w, y + h), (x, y + h)])
}
fn circle(cx: f64, cy: f64, r: f64) -> Subpath {
    let nodes = (0..4).map(|i| {
        let a = i as f64 * std::f64::consts::FRAC_PI_2;
        let (x, y, tx, ty) = (
            cx + r * a.cos(),
            cy + r * a.sin(),
            -a.sin() * K * r,
            a.cos() * K * r,
        );
        PathPoint {
            x,
            y,
            kind: NodeType::Smooth,
            handle_in: Some(Point {
                x: x - tx,
                y: y - ty,
            }),
            handle_out: Some(Point {
                x: x + tx,
                y: y + ty,
            }),
        }
    });
    Subpath {
        closed: true,
        nodes: nodes.collect(),
    }
}
fn rev(s: Subpath) -> Subpath {
    let nodes = s.nodes.into_iter().rev().map(|n| PathPoint {
        handle_in: n.handle_out,
        handle_out: n.handle_in,
        ..n
    });
    Subpath {
        closed: s.closed,
        nodes: nodes.collect(),
    }
}
fn star(cx: f64, cy: f64, r: f64) -> Subpath {
    let pts: Vec<_> = (0..5)
        .map(|i| {
            let t = (i * 2 % 5) as f64 * std::f64::consts::TAU / 5.0 - std::f64::consts::FRAC_PI_2;
            (cx + r * t.cos(), cy + r * t.sin())
        })
        .collect();
    poly(&pts)
}
fn shape(subpaths: Vec<Subpath>) -> Shape {
    Shape {
        subpaths,
        even_odd: false,
    }
}
fn even_odd(subpaths: Vec<Subpath>) -> Shape {
    Shape {
        subpaths,
        even_odd: true,
    }
}

/// Sollbild je Pixel aus den Masken von A und B
type Rule = fn(bool, bool) -> bool;

struct Case {
    name: &'static str,
    a: Shape,
    b: Shape,
    /// Konturzahl der Vereinigung, wo eindeutig
    union_contours: Option<usize>,
}

fn case(name: &'static str, a: Shape, b: Shape, union_contours: Option<usize>) -> Case {
    Case {
        name,
        a,
        b,
        union_contours,
    }
}

fn corpus() -> Vec<Case> {
    let blob: Vec<_> = (0..200)
        .map(|i| {
            let t = i as f64 / 200.0 * std::f64::consts::TAU;
            let r = 18.0 + 3.0 * (7.0 * t).sin();
            (30.0 + r * t.cos(), 30.0 + r * t.sin())
        })
        .collect();
    let s_curve = Subpath {
        closed: true,
        nodes: vec![
            PathPoint {
                handle_in: Some(Point { x: 30.0, y: 50.0 }),
                handle_out: Some(Point { x: 10.0, y: 0.0 }),
                ..pt(10.0, 30.0)
            },
            PathPoint {
                handle_in: Some(Point { x: 50.0, y: 60.0 }),
                handle_out: Some(Point { x: 50.0, y: 10.0 }),
                ..pt(50.0, 30.0)
            },
        ],
    };
    let mut comb = vec![(5.0, 10.0)];
    for i in 0..5 {
        let x = 5.0 + i as f64 * 10.0;
        comb.extend([
            (x, 40.0),
            (x + 5.0, 40.0),
            (x + 5.0, 15.0),
            (x + 10.0, 15.0),
        ]);
    }
    comb.push((55.0, 10.0));
    let o = || {
        shape(vec![
            rect(10.0, 10.0, 40.0, 40.0),
            rev(rect(20.0, 20.0, 20.0, 20.0)),
        ])
    };
    let sq = |x, y, w| shape(vec![rect(x, y, w, w)]);
    let ci = |x, y, r| shape(vec![circle(x, y, r)]);
    vec![
        case(
            "Quadrate überlappend",
            sq(10.0, 10.0, 30.0),
            sq(25.0, 25.0, 30.0),
            Some(1),
        ),
        case(
            "Quadrat + Kreis",
            sq(10.0, 10.0, 30.0),
            ci(40.0, 40.0, 15.0),
            Some(1),
        ),
        case(
            "getrennt",
            sq(5.0, 5.0, 10.0),
            sq(30.0, 30.0, 10.0),
            Some(2),
        ),
        case(
            "verschachtelt",
            sq(5.0, 5.0, 50.0),
            sq(20.0, 20.0, 10.0),
            Some(1),
        ),
        case(
            "gemeinsame Kante",
            sq(10.0, 10.0, 20.0),
            sq(30.0, 10.0, 20.0),
            Some(1),
        ),
        case(
            "Kante versetzt",
            sq(10.0, 10.0, 20.0),
            sq(30.0, 20.0, 20.0),
            Some(1),
        ),
        case("Eckpunkt", sq(10.0, 10.0, 20.0), sq(30.0, 30.0, 20.0), None),
        case(
            "deckungsgleich Quadrat",
            sq(10.0, 10.0, 30.0),
            sq(10.0, 10.0, 30.0),
            Some(1),
        ),
        case(
            "deckungsgleich Kreis",
            ci(30.0, 30.0, 20.0),
            ci(30.0, 30.0, 20.0),
            Some(1),
        ),
        case(
            "Kreis berührt Seite",
            shape(vec![rect(10.0, 10.0, 20.0, 40.0)]),
            ci(45.0, 30.0, 15.0),
            None,
        ),
        case(
            "Ring + Balken",
            shape(vec![
                circle(30.0, 30.0, 20.0),
                rev(circle(30.0, 30.0, 10.0)),
            ]),
            shape(vec![rect(5.0, 27.0, 50.0, 6.0)]),
            Some(3),
        ),
        case(
            "gerade/ungerade",
            even_odd(vec![circle(25.0, 30.0, 15.0), circle(40.0, 30.0, 15.0)]),
            shape(vec![rect(20.0, 20.0, 25.0, 20.0)]),
            None,
        ),
        case(
            "Acht",
            shape(vec![poly(&[
                (10.0, 10.0),
                (50.0, 50.0),
                (50.0, 10.0),
                (10.0, 50.0),
            ])]),
            shape(vec![rect(25.0, 5.0, 10.0, 50.0)]),
            None,
        ),
        case(
            "Stern nonzero",
            shape(vec![star(30.0, 30.0, 25.0)]),
            ci(30.0, 30.0, 8.0),
            Some(1),
        ),
        case(
            "Stern gerade/ungerade",
            even_odd(vec![star(30.0, 30.0, 25.0)]),
            ci(30.0, 30.0, 8.0),
            None,
        ),
        case(
            "innen tangential",
            ci(30.0, 30.0, 20.0),
            ci(40.0, 30.0, 10.0),
            Some(1),
        ),
        case(
            "Kanten teils deckungsgleich",
            shape(vec![rect(10.0, 10.0, 30.0, 20.0)]),
            shape(vec![rect(25.0, 10.0, 30.0, 20.0)]),
            Some(1),
        ),
        case(
            "konzentrisch",
            ci(30.0, 30.0, 20.0),
            ci(30.0, 30.0, 10.0),
            Some(1),
        ),
        case(
            "haarfeine Überlappung",
            sq(10.0, 10.0, 20.0),
            sq(29.99, 10.0, 20.0),
            Some(1),
        ),
        case(
            "große Koordinaten",
            sq(1010.0, 1010.0, 30.0),
            ci(1040.0, 1040.0, 15.0),
            Some(1),
        ),
        case(
            "Freihand-Vieleck",
            shape(vec![poly(&blob)]),
            ci(45.0, 30.0, 12.0),
            Some(1),
        ),
        case(
            "S-Kurve",
            shape(vec![s_curve]),
            shape(vec![rect(25.0, 5.0, 10.0, 50.0)]),
            None,
        ),
        case(
            "Raute auf Kante",
            sq(10.0, 10.0, 30.0),
            shape(vec![poly(&[
                (25.0, 40.0),
                (40.0, 55.0),
                (25.0, 70.0),
                (10.0, 55.0),
            ])]),
            None,
        ),
        case(
            "Kamm",
            shape(vec![poly(&comb)]),
            shape(vec![rect(0.0, 25.0, 60.0, 5.0)]),
            Some(5),
        ),
        case(
            "O + Balken",
            o(),
            shape(vec![rect(5.0, 28.0, 50.0, 4.0)]),
            Some(3),
        ),
        case("Loch exakt gefüllt", o(), sq(20.0, 20.0, 20.0), Some(1)),
        case(
            "gegenläufig",
            sq(10.0, 10.0, 30.0),
            shape(vec![rev(rect(25.0, 25.0, 30.0, 30.0))]),
            Some(1),
        ),
        case(
            "entartet (Fläche 0)",
            shape(vec![
                rect(10.0, 10.0, 30.0, 30.0),
                poly(&[(5.0, 5.0), (55.0, 55.0)]),
            ]),
            sq(25.0, 25.0, 30.0),
            Some(1),
        ),
        case(
            "doppelte Knoten",
            shape(vec![poly(&[
                (10.0, 10.0),
                (10.0, 10.0),
                (40.0, 10.0),
                (40.0, 40.0),
                (40.0, 40.0),
                (10.0, 40.0),
            ])]),
            sq(25.0, 25.0, 30.0),
            Some(1),
        ),
        case(
            "zwei Teile in A",
            shape(vec![
                rect(5.0, 5.0, 15.0, 15.0),
                rect(40.0, 40.0, 15.0, 15.0),
            ]),
            sq(10.0, 10.0, 40.0),
            Some(1),
        ),
    ]
}

/// Rastert Pfade nicht geglättet; Fenster = Hülle der Eingänge + 2 mm, längste Seite 1400 px.
struct Raster {
    w: u32,
    h: u32,
    t: Transform,
}

impl Raster {
    fn new(shapes: &[&Shape]) -> Self {
        let pts = || {
            shapes
                .iter()
                .flat_map(|s| &s.subpaths)
                .flat_map(|s| &s.nodes)
        };
        let (x0, y0) = pts().fold((f64::MAX, f64::MAX), |a, p| (a.0.min(p.x), a.1.min(p.y)));
        let (x1, y1) = pts().fold((f64::MIN, f64::MIN), |a, p| (a.0.max(p.x), a.1.max(p.y)));
        let (x0, y0, w, h) = (x0 - 2.0, y0 - 2.0, x1 - x0 + 4.0, y1 - y0 + 4.0);
        let s = 1400.0 / w.max(h);
        let t = Transform::from_row(
            s as f32,
            0.0,
            0.0,
            s as f32,
            (-x0 * s) as f32,
            (-y0 * s) as f32,
        );
        Raster {
            w: (w * s).ceil() as u32,
            h: (h * s).ceil() as u32,
            t,
        }
    }
    fn mask(&self, subpaths: &[Subpath], even_odd: bool) -> Vec<bool> {
        let mut pm = Pixmap::new(self.w, self.h).unwrap();
        let mut pb = PathBuilder::new();
        for sp in subpaths.iter().filter(|s| !s.nodes.is_empty()) {
            let n = &sp.nodes;
            pb.move_to(n[0].x as f32, n[0].y as f32);
            for i in 0..n.len() {
                let (a, b) = (&n[i], &n[(i + 1) % n.len()]);
                if a.handle_out.is_none() && b.handle_in.is_none() {
                    pb.line_to(b.x as f32, b.y as f32);
                } else {
                    let (c1, c2) = (
                        a.handle_out.unwrap_or(Point { x: a.x, y: a.y }),
                        b.handle_in.unwrap_or(Point { x: b.x, y: b.y }),
                    );
                    pb.cubic_to(
                        c1.x as f32,
                        c1.y as f32,
                        c2.x as f32,
                        c2.y as f32,
                        b.x as f32,
                        b.y as f32,
                    );
                }
            }
            pb.close();
        }
        if let Some(path) = pb.finish() {
            let paint = Paint {
                anti_alias: false,
                ..Default::default()
            };
            pm.fill_path(
                &path,
                &paint,
                if even_odd {
                    FillRule::EvenOdd
                } else {
                    FillRule::Winding
                },
                self.t,
                None,
            );
        }
        pm.pixels().iter().map(|p| p.alpha() > 0).collect()
    }
    /// Abweichungen weiter als 2 px von einer Kante des Sollbilds. 2 px, weil flache Schnittwinkel
    /// (Kreis an Sehne, 15°) die Rasterung der Kreiskurve an der Spitze um mehr als 1 px verschieben.
    fn errors(&self, want: &[bool], got: &[bool]) -> usize {
        let (w, h) = (self.w as i64, self.h as i64);
        let near_edge = |x: i64, y: i64| {
            let v = want[(y * w + x) as usize];
            (-2..=2).any(|dy| {
                (-2..=2).any(|dx| {
                    let (u, t) = (x + dx, y + dy);
                    u >= 0 && t >= 0 && u < w && t < h && want[(t * w + u) as usize] != v
                })
            })
        };
        (0..h)
            .flat_map(|y| (0..w).map(move |x| (x, y)))
            .filter(|&(x, y)| {
                want[(y * w + x) as usize] != got[(y * w + x) as usize] && !near_edge(x, y)
            })
            .count()
    }
}

#[test]
fn korpus_30_faelle_fehlerfrei() {
    let mut bad = Vec::new();
    let t = std::time::Instant::now();
    for c in corpus() {
        let r = Raster::new(&[&c.a, &c.b]);
        let (ma, mb) = (
            r.mask(&c.a.subpaths, c.a.even_odd),
            r.mask(&c.b.subpaths, c.b.even_odd),
        );
        let ops: [(&str, Op, [&Shape; 2], Rule); 4] = [
            ("A∪B", Op::Union, [&c.a, &c.b], |a, b| a || b),
            ("A∩B", Op::Intersect, [&c.a, &c.b], |a, b| a && b),
            ("A−B", Op::Difference, [&c.a, &c.b], |a, b| a && !b),
            ("B−A", Op::Difference, [&c.b, &c.a], |a, b| b && !a),
        ];
        for (label, op, input, f) in ops {
            let want: Vec<bool> = ma.iter().zip(&mb).map(|(&a, &b)| f(a, b)).collect();
            let got = apply(op, &[input[0].clone(), input[1].clone()]).unwrap();
            let (e_nz, e_eo) = (
                r.errors(&want, &r.mask(&got, false)),
                r.errors(&want, &r.mask(&got, true)),
            );
            let count_ok = op != Op::Union || c.union_contours.is_none_or(|n| n == got.len());
            let finite = got
                .iter()
                .flat_map(|s| &s.nodes)
                .all(|p| p.x.is_finite() && p.y.is_finite());
            if e_nz + e_eo > 0
                || !count_ok
                || !finite
                || got.iter().any(|s| !s.closed || s.nodes.len() < 2)
            {
                bad.push(format!(
                    "{} {label}: Pixel {e_nz}/{e_eo}, Konturen {} (soll {:?})",
                    c.name,
                    got.len(),
                    c.union_contours
                ));
            }
        }
    }
    println!(
        "Korpus: 120 Operationen in {:.0} ms",
        t.elapsed().as_secs_f64() * 1e3
    );
    assert!(bad.is_empty(), "{bad:#?}");
}

fn segments(s: &Subpath) -> impl Iterator<Item = (&PathPoint, &PathPoint)> {
    (0..s.nodes.len()).map(move |i| (&s.nodes[i], &s.nodes[(i + 1) % s.nodes.len()]))
}

#[test]
fn kurven_bleiben_kurven() {
    // zwei Kreise je 4 Bögen: Vereinigung = 3 ganze + 2 Teilbögen je Kreis… höchstens 8 Segmente, alle Kurven
    let got = apply(
        Op::Union,
        &[
            shape(vec![circle(0.0, 0.0, 10.0)]),
            shape(vec![circle(10.0, 0.0, 10.0)]),
        ],
    )
    .unwrap();
    assert_eq!(got.len(), 1);
    let segs: Vec<_> = segments(&got[0]).collect();
    assert!(segs.len() <= 8, "{} Segmente", segs.len());
    assert!(
        segs.iter()
            .all(|(a, b)| a.handle_out.is_some() && b.handle_in.is_some()),
        "gerade Stücke im Kreis"
    );
    for n in &got[0].nodes {
        let d = (n.x.hypot(n.y) - 10.0)
            .abs()
            .min(((n.x - 10.0).hypot(n.y) - 10.0).abs());
        assert!(
            d < 0.005,
            "Knoten ({}, {}) {d} mm neben den Kreisen",
            n.x,
            n.y
        );
    }
    // Original-Knoten (Kreis links bei 180°) bleibt exakt samt Anfassern und glatt
    let o = &circle(0.0, 0.0, 10.0).nodes[2];
    let same = |a: Option<Point>, b: Option<Point>| a.map(|p| (p.x, p.y)) == b.map(|p| (p.x, p.y));
    assert!(got[0].nodes.iter().any(|n| n.x == o.x
        && n.y == o.y
        && same(n.handle_in, o.handle_in)
        && same(n.handle_out, o.handle_out)
        && n.kind == NodeType::Smooth));
}

#[test]
fn rechtecke_ergeben_exakte_ecken() {
    let got = apply(
        Op::Difference,
        &[
            shape(vec![rect(0.0, 0.0, 20.0, 20.0)]),
            shape(vec![rect(10.0, 10.0, 20.0, 20.0)]),
        ],
    )
    .unwrap();
    assert_eq!(got.len(), 1);
    let mut pts: Vec<_> = got[0]
        .nodes
        .iter()
        .map(|n| ((n.x * 1e6).round() / 1e6, (n.y * 1e6).round() / 1e6))
        .collect();
    pts.sort_by(|a, b| a.partial_cmp(b).unwrap());
    assert_eq!(
        pts,
        [
            (0.0, 0.0),
            (0.0, 20.0),
            (10.0, 10.0),
            (10.0, 20.0),
            (20.0, 0.0),
            (20.0, 10.0)
        ]
    );
    assert!(got[0]
        .nodes
        .iter()
        .all(|n| n.handle_in.is_none() && n.handle_out.is_none() && n.kind == NodeType::Corner));
}

#[test]
fn mehrere_formen() {
    let sq = |x: f64| shape(vec![rect(x, 0.0, 10.0, 10.0)]);
    assert_eq!(
        apply(Op::Union, &[sq(0.0), sq(10.0), sq(20.0)])
            .unwrap()
            .len(),
        1
    );
    let cut = apply(Op::Intersect, &[sq(0.0), sq(5.0), sq(8.0)]).unwrap();
    let xs: Vec<f64> = cut[0].nodes.iter().map(|n| n.x).collect();
    assert!(
        xs.iter()
            .all(|&x| (x - 8.0).abs() < 1e-6 || (x - 10.0).abs() < 1e-6),
        "{xs:?}"
    );
    let holes = apply(
        Op::Difference,
        &[
            shape(vec![rect(0.0, 0.0, 30.0, 10.0)]),
            sq(2.0),
            shape(vec![rect(20.0, 2.0, 5.0, 5.0)]),
        ],
    )
    .unwrap();
    assert_eq!(holes.len(), 3, "linker Streifen, rechter Teil, Loch");
    assert!(apply(Op::Intersect, &[sq(0.0), sq(50.0)])
        .unwrap()
        .is_empty());
}

#[test]
fn offene_pfade_gelten_als_geschlossen() {
    let open = Subpath {
        closed: false,
        nodes: vec![pt(0.0, 0.0), pt(10.0, 0.0), pt(10.0, 10.0)],
    };
    let got = apply(Op::Union, &[shape(vec![open])]).unwrap();
    assert_eq!((got.len(), got[0].nodes.len()), (1, 3));
}

#[test]
fn ungueltige_zahlen_sind_ein_fehler() {
    let err = apply(Op::Union, &[shape(vec![rect(f64::NAN, 0.0, 1.0, 1.0)])]).unwrap_err();
    assert!(err.contains("Koordinate"), "{err}");
}
