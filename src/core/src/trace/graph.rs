//! Skelett → Polylinien: Enden und Abzweige werden Knoten, kurze Sporne fallen weg,
//! durchlaufende Knoten verschmelzen; Äste an einem Abzweig enden im selben Punkt (lückenlos).
use super::thin::Grid;
use std::collections::HashMap;

pub(super) struct Line {
    pub pts: Vec<(f64, f64)>,
    pub closed: bool,
}

struct Edge {
    a: usize,
    b: usize,
    px: Vec<usize>,
}

impl Edge {
    fn reversed(mut self) -> Edge {
        self.px.reverse();
        Edge {
            a: self.b,
            b: self.a,
            px: self.px,
        }
    }
}

pub(super) fn lines(g: &Grid, spur: f64) -> Vec<Line> {
    let offs = g.offsets();
    let deg = |i: usize| g.nbrs(i).iter().filter(|&&b| b).count();

    // Knoten: jedes Ende einzeln, zusammenhängende Abzweigpixel als einer; Lage = Schwerpunkt.
    let mut node_of: HashMap<usize, usize> = HashMap::new();
    let mut centers: Vec<(f64, f64)> = vec![];
    for i in (0..g.px.len()).filter(|&i| g.px[i] && deg(i) != 2 && deg(i) > 0) {
        if node_of.contains_key(&i) {
            continue;
        }
        let (n, mut stack, mut sum, mut count) = (centers.len(), vec![i], (0.0, 0.0), 0.0);
        node_of.insert(i, n);
        while let Some(j) = stack.pop() {
            let p = g.pos(j);
            (sum, count) = ((sum.0 + p.0, sum.1 + p.1), count + 1.0);
            if deg(j) < 3 {
                continue;
            }
            for o in offs {
                let k = g.at(j, o);
                if g.px[k] && deg(k) >= 3 && !node_of.contains_key(&k) {
                    node_of.insert(k, n);
                    stack.push(k);
                }
            }
        }
        centers.push((sum.0 / count, sum.1 / count));
    }

    // Kanten: von jedem Knotenpixel die Kette aus Pixeln mit 2 Nachbarn entlang.
    let mut seen = vec![false; g.px.len()];
    let mut edges: Vec<Option<Edge>> = vec![];
    let mut starts: Vec<usize> = node_of.keys().copied().collect();
    starts.sort_unstable();
    let next = |cur: usize, prev: usize| {
        offs.map(|o| g.at(cur, o))
            .into_iter()
            .find(|&k| g.px[k] && k != prev)
    };
    for &u in &starts {
        for v in offs.map(|o| g.at(u, o)).into_iter().filter(|&v| g.px[v]) {
            if let Some(&nv) = node_of.get(&v) {
                if nv != node_of[&u] && u < v {
                    edges.push(Some(Edge {
                        a: node_of[&u],
                        b: nv,
                        px: vec![u, v],
                    }));
                }
                continue;
            }
            if seen[v] {
                continue;
            }
            seen[v] = true;
            let (mut px, mut prev, mut cur) = (vec![u, v], u, v);
            while let Some(k) = next(cur, prev) {
                px.push(k);
                if let Some(&nk) = node_of.get(&k) {
                    edges.push(Some(Edge {
                        a: node_of[&u],
                        b: nk,
                        px,
                    }));
                    break;
                }
                if seen[k] {
                    break;
                }
                seen[k] = true;
                (prev, cur) = (cur, k);
            }
        }
    }

    // Ringe ohne Knoten (Kreis, O).
    let mut out = vec![];
    for s in 0..g.px.len() {
        if !g.px[s] || seen[s] || deg(s) != 2 {
            continue;
        }
        seen[s] = true;
        let (mut px, mut prev, mut cur) = (vec![s], usize::MAX, s);
        while let Some(k) = next(cur, prev).filter(|&k| !seen[k]) {
            seen[k] = true;
            px.push(k);
            (prev, cur) = (cur, k);
        }
        out.push(Line {
            pts: px.iter().map(|&i| g.pos(i)).collect(),
            closed: true,
        });
    }

    prune(&mut edges, centers.len(), spur);
    let inc = merge(&mut edges, centers.len());
    for e in edges.into_iter().flatten() {
        let closed = e.a == e.b && inc[e.a].len() == 2;
        let mut pts: Vec<(f64, f64)> = e.px.iter().map(|&i| g.pos(i)).collect();
        if !closed {
            // Abzweig: alle Äste enden im Schwerpunkt
            if inc[e.a].len() >= 3 {
                pts.insert(0, centers[e.a]);
            }
            if inc[e.b].len() >= 3 {
                pts.push(centers[e.b]);
            }
        }
        out.push(Line { pts, closed });
    }
    out
}

fn incidence(edges: &[Option<Edge>], nodes: usize) -> Vec<Vec<usize>> {
    let mut inc = vec![vec![]; nodes];
    for (k, e) in edges.iter().enumerate() {
        if let Some(e) = e {
            inc[e.a].push(k);
            inc[e.b].push(k);
        }
    }
    inc
}

/// Sporn = Ast von einem Ende zu einem Abzweig, kürzer als die Strichbreite. Sind alle Äste eines
/// Abzweigs Sporne (kleiner Klecks), bleibt der längste.
fn prune(edges: &mut [Option<Edge>], nodes: usize, spur: f64) {
    let inc = incidence(edges, nodes);
    let is_spur = |e: &Edge| {
        let (da, db) = (inc[e.a].len(), inc[e.b].len());
        (e.px.len() as f64) < spur && ((da == 1 && db >= 3) || (db == 1 && da >= 3))
    };
    let mut drop = vec![];
    for at in inc.iter().filter(|l| l.len() >= 3) {
        let mut spurs: Vec<usize> = at
            .iter()
            .copied()
            .filter(|&k| edges[k].as_ref().is_some_and(is_spur))
            .collect();
        if spurs.len() == at.len() {
            spurs.sort_by_key(|&k| edges[k].as_ref().map_or(0, |e| e.px.len()));
            spurs.pop();
        }
        drop.extend(spurs);
    }
    for k in drop {
        edges[k] = None;
    }
}

/// Knoten mit genau zwei Ästen verschwinden: die Äste werden eine Linie. Liefert die Inzidenz danach.
fn merge(edges: &mut [Option<Edge>], nodes: usize) -> Vec<Vec<usize>> {
    let mut inc = incidence(edges, nodes);
    for n in 0..nodes {
        if inc[n].len() != 2 || inc[n][0] == inc[n][1] {
            continue;
        }
        let (k1, k2) = (inc[n][0], inc[n][1]);
        let (mut e1, mut e2) = (edges[k1].take().unwrap(), edges[k2].take().unwrap());
        if e1.b != n {
            e1 = e1.reversed();
        }
        if e2.a != n {
            e2 = e2.reversed();
        }
        if let Some(x) = inc[e2.b].iter_mut().find(|x| **x == k2) {
            *x = k1;
        }
        e1.px.extend(e2.px);
        edges[k1] = Some(Edge {
            a: e1.a,
            b: e2.b,
            px: e1.px,
        });
        inc[n].clear();
    }
    inc
}
