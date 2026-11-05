//! Polylinie → kubische Béziers nach Schneider („An Algorithm for Automatically Fitting Digitized Curves“,
//! Graphics Gems 1990): kleinste Quadrate mit festen Endtangenten, Newton-Nachparametrierung, Teilen am größten Fehler.
use crate::scene::{NodeType, PathPoint, Point, Subpath};

type V = (f64, f64);
type Cubic = [V; 4];

fn add(a: V, b: V) -> V {
    (a.0 + b.0, a.1 + b.1)
}
fn sub(a: V, b: V) -> V {
    (a.0 - b.0, a.1 - b.1)
}
fn mul(a: V, s: f64) -> V {
    (a.0 * s, a.1 * s)
}
fn dot(a: V, b: V) -> f64 {
    a.0 * b.0 + a.1 * b.1
}
fn len(a: V) -> f64 {
    a.0.hypot(a.1)
}
fn unit(a: V) -> V {
    let l = len(a);
    if l > 0.0 {
        mul(a, 1.0 / l)
    } else {
        a
    }
}

fn at(c: &Cubic, t: f64) -> V {
    let s = 1.0 - t;
    let w = [s * s * s, 3.0 * s * s * t, 3.0 * s * t * t, t * t * t];
    (0..4).fold((0.0, 0.0), |acc, i| add(acc, mul(c[i], w[i])))
}

/// Pixeltreppen glätten: gleitender Mittelwert über 5 Punkte; offene Enden bleiben fest.
fn smooth(pts: &[V], closed: bool) -> Vec<V> {
    let n = pts.len();
    (0..n)
        .map(|i| {
            let r = if closed {
                2.min(n / 2)
            } else {
                2.min(i).min(n - 1 - i)
            };
            let sum = (i + n - r..=i + n + r).fold((0.0, 0.0), |acc, j| add(acc, pts[j % n]));
            mul(sum, 1.0 / (2 * r + 1) as f64)
        })
        .collect()
}

/// Knicke: Richtungswechsel über ±k Punkte größer als `angle` (rad); je Umgebung nur der stärkste.
fn corners(d: &[V], closed: bool, k: usize, angle: f64) -> Vec<usize> {
    let n = d.len();
    if n < 2 * k + 1 {
        return vec![];
    }
    let turn = |i: usize| {
        let (u, v) = (sub(d[i], d[(i + n - k) % n]), sub(d[(i + k) % n], d[i]));
        (u.0 * v.1 - u.1 * v.0).atan2(dot(u, v)).abs()
    };
    let t: Vec<f64> = (0..n)
        .map(|i| if closed || (k..n - k).contains(&i) { turn(i) } else { 0.0 })
        .collect();
    let at = |j: isize| t[j.rem_euclid(n as isize) as usize];
    (0..n)
        .filter(|&i| {
            let i = i as isize;
            t[i as usize] > angle
                && (1..=k as isize).all(|j| at(i - j) < t[i as usize] && at(i + j) <= t[i as usize])
        })
        .collect()
}

/// Geglättete, angepasste Kurven einer Polylinie (d ohne doppelte Punkte). Offene Enden: Tangente über
/// `ends` Punkte – an Linienenden 3, an Ecken eine Strichbreite, sonst kippt die abgerundete Pixelspitze sie.
fn curves(d: &[V], closed: bool, tol: f64, ends: (usize, usize)) -> Option<Vec<Cubic>> {
    let mut d = smooth(d, closed);
    if d.len() < 2 || (closed && d.len() < 4) {
        return None;
    }
    let (t1, t2) = if closed {
        let t = unit(sub(d[1], d[d.len() - 1]));
        d.push(d[0]);
        (t, mul(t, -1.0))
    } else {
        let (a, b) = (ends.0.min(d.len() - 1), ends.1.min(d.len() - 1));
        (
            unit(sub(d[a], d[0])),
            unit(sub(d[d.len() - 1 - b], d[d.len() - 1])),
        )
    };
    let mut out = vec![];
    fit(&d, t1, t2, tol * tol, &mut out);
    Some(out)
}

/// tol in px. Geschlossen: Start = Ende mit gemeinsamer Tangente. Knicke über `angle` (gemessen über ±k px)
/// werden Eckknoten; dazwischen wird je Stück getrennt geglättet und angepasst.
pub(super) fn subpath(pts: &[V], closed: bool, tol: f64, angle: f64, k: usize) -> Option<Subpath> {
    let mut d: Vec<V> = vec![];
    for &p in pts {
        if d.last().is_none_or(|&q| len(sub(p, q)) > 1e-9) {
            d.push(p);
        }
    }
    let mut cs = corners(&d, closed, k, angle);
    // je Kurve: beginnt sie an einem Eckknoten?
    let (all, breaks) = if cs.is_empty() {
        let c = curves(&d, closed, tol, (3, 3))?;
        let b = vec![false; c.len()];
        (c, b)
    } else {
        if closed {
            // ab der ersten Ecke als offener Zug, der dort wieder endet
            d.rotate_left(cs[0]);
            cs = cs.iter().map(|&c| c - cs[0]).collect();
            d.push(d[0]);
            cs.push(d.len() - 1);
        } else {
            cs.insert(0, 0);
            cs.push(d.len() - 1);
        }
        let (mut all, mut breaks) = (vec![], vec![]);
        let last = d.len() - 1;
        for w in cs.windows(2) {
            let ends = (
                if closed || w[0] > 0 { k } else { 3 },
                if closed || w[1] < last { k } else { 3 },
            );
            let piece = curves(&d[w[0]..=w[1]], false, tol, ends)?;
            breaks.extend((0..piece.len()).map(|i| i == 0 && (closed || w[0] > 0)));
            all.extend(piece);
        }
        (all, breaks)
    };

    let node = |p: V, kind, hin: Option<V>, hout: Option<V>| {
        let pt = |v: V| Point { x: v.0, y: v.1 };
        PathPoint {
            x: p.0,
            y: p.1,
            kind,
            handle_in: hin.map(pt),
            handle_out: hout.map(pt),
        }
    };
    let n = all.len();
    let mut nodes: Vec<PathPoint> = (0..n)
        .map(|k| {
            let prev = if k > 0 {
                Some(all[k - 1][2])
            } else if closed {
                Some(all[n - 1][2])
            } else {
                None
            };
            let kind = if prev.is_some() && !breaks[k] {
                NodeType::Smooth
            } else {
                NodeType::Corner
            };
            node(all[k][0], kind, prev, Some(all[k][1]))
        })
        .collect();
    if !closed {
        nodes.push(node(
            all[n - 1][3],
            NodeType::Corner,
            Some(all[n - 1][2]),
            None,
        ));
    }
    Some(Subpath { closed, nodes })
}

fn fit(d: &[V], t1: V, t2: V, tol2: f64, out: &mut Vec<Cubic>) {
    let (first, last) = (d[0], d[d.len() - 1]);
    if d.len() == 2 {
        let l = len(sub(last, first)) / 3.0;
        out.push([first, add(first, mul(t1, l)), add(last, mul(t2, l)), last]);
        return;
    }
    let mut u = chord(d);
    let mut c = generate(d, &u, t1, t2);
    let (mut err, mut split) = max_error(d, &c, &u);
    if err >= tol2 && err < 4.0 * tol2 {
        for _ in 0..4 {
            u = u
                .iter()
                .enumerate()
                .map(|(i, &t)| newton(&c, d[i], t))
                .collect();
            c = generate(d, &u, t1, t2);
            (err, split) = max_error(d, &c, &u);
            if err < tol2 {
                break;
            }
        }
    }
    if err < tol2 {
        out.push(c);
        return;
    }
    let back = sub(d[split - 1], d[split + 1]);
    let tc = unit(if len(back) > 0.0 {
        back
    } else {
        sub(d[split - 1], d[split])
    });
    fit(&d[..=split], t1, tc, tol2, out);
    fit(&d[split..], mul(tc, -1.0), t2, tol2, out);
}

fn chord(d: &[V]) -> Vec<f64> {
    let mut u = vec![0.0];
    for i in 1..d.len() {
        u.push(u[i - 1] + len(sub(d[i], d[i - 1])));
    }
    let total = u[d.len() - 1];
    u.iter().map(|x| x / total).collect()
}

/// Anfasserlängen α₁, α₂ entlang t1/t2 nach kleinsten Quadraten; entartet → Drittel der Sehne.
fn generate(d: &[V], u: &[f64], t1: V, t2: V) -> Cubic {
    let (first, last) = (d[0], d[d.len() - 1]);
    let (mut c, mut x) = ([[0.0; 2]; 2], [0.0; 2]);
    for (i, &t) in u.iter().enumerate() {
        let s = 1.0 - t;
        let (a0, a1) = (mul(t1, 3.0 * s * s * t), mul(t2, 3.0 * s * t * t));
        c[0][0] += dot(a0, a0);
        c[0][1] += dot(a0, a1);
        c[1][1] += dot(a1, a1);
        let base = at(&[first, first, last, last], t);
        let r = sub(d[i], base);
        x[0] += dot(a0, r);
        x[1] += dot(a1, r);
    }
    let det = c[0][0] * c[1][1] - c[0][1] * c[0][1];
    let (al, ar) = if det.abs() > 1e-12 {
        (
            (x[0] * c[1][1] - x[1] * c[0][1]) / det,
            (c[0][0] * x[1] - c[0][1] * x[0]) / det,
        )
    } else {
        (0.0, 0.0)
    };
    let seg = len(sub(last, first));
    let (al, ar) = if al < 1e-6 * seg || ar < 1e-6 * seg {
        (seg / 3.0, seg / 3.0)
    } else {
        (al, ar)
    };
    [first, add(first, mul(t1, al)), add(last, mul(t2, ar)), last]
}

/// Größter quadrierter Abstand Punkt ↔ Kurve am Parameter und wo (nie an den Enden).
fn max_error(d: &[V], c: &Cubic, u: &[f64]) -> (f64, usize) {
    (1..d.len() - 1)
        .map(|i| (dot(sub(at(c, u[i]), d[i]), sub(at(c, u[i]), d[i])), i))
        .fold((0.0, d.len() / 2), |a, b| if b.0 > a.0 { b } else { a })
}

fn newton(c: &Cubic, p: V, t: f64) -> f64 {
    let d1: [V; 3] = [0, 1, 2].map(|i| mul(sub(c[i + 1], c[i]), 3.0));
    let d2: [V; 2] = [0, 1].map(|i| mul(sub(d1[i + 1], d1[i]), 2.0));
    let s = 1.0 - t;
    let q1 = add(
        add(mul(d1[0], s * s), mul(d1[1], 2.0 * s * t)),
        mul(d1[2], t * t),
    );
    let q2 = add(mul(d2[0], s), mul(d2[1], t));
    let diff = sub(at(c, t), p);
    let den = dot(q1, q1) + dot(diff, q2);
    if den.abs() < 1e-12 {
        t
    } else {
        (t - dot(diff, q1) / den).clamp(0.0, 1.0)
    }
}
