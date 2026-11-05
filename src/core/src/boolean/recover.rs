//! Kurven-Rückgewinnung: jede Ergebnis-Kante wird dem Original-Segment zugeordnet, auf dessen
//! Abtastung beide Endpunkte liegen und dessen Kurvenmitte zur Kantenmitte passt. Zusammenhängende
//! Kanten desselben Segments werden ein exaktes Teilstück (kurbo `subsegment`); der Rest wird Gerade.
use super::{samples, TOL};
use crate::scene::{NodeType, PathPoint, Point as P, Subpath};
use kurbo::{CubicBez, ParamCurve, PathSeg, Point};
use std::collections::HashMap;

/// (Segment, t) — wo ein Ergebnis-Punkt auf einem Original-Segment liegt
type Hit = (usize, f64);
/// (Segment, t am Anfang, t am Ende) einer Ergebnis-Kante
type Label = Option<(usize, f64, f64)>;

pub(super) struct Index<'a> {
    segs: &'a [PathSeg],
    pts: Vec<Vec<(f64, Point)>>,
    /// Gitterzelle → (Segment, Abtast-Kante)
    grid: HashMap<(i64, i64), Vec<(usize, usize)>>,
    cell: f64,
    eps: f64,
}

impl<'a> Index<'a> {
    pub fn new(segs: &'a [PathSeg]) -> Self {
        let pts: Vec<_> = segs.iter().map(samples).collect();
        let all = || pts.iter().flatten().map(|(_, p)| p);
        let (x0, x1) = all().fold((f64::MAX, f64::MIN), |a, p| (a.0.min(p.x), a.1.max(p.x)));
        let (y0, y1) = all().fold((f64::MAX, f64::MIN), |a, p| (a.0.min(p.y), a.1.max(p.y)));
        let dim = (x1 - x0).max(y1 - y0).max(1.0);
        // i_overlay rastert auf ≈ dim·2⁻²⁸; eps lässt dafür reichlich Luft
        let (eps, cell) = (dim * 1e-6, dim / 128.0);
        let mut grid: HashMap<_, Vec<_>> = HashMap::new();
        for (s, sp) in pts.iter().enumerate() {
            for k in 0..sp.len() - 1 {
                let (a, b) = (sp[k].1, sp[k + 1].1);
                let c = |v: f64| (v / cell).floor() as i64;
                for i in c(a.x.min(b.x) - eps)..=c(a.x.max(b.x) + eps) {
                    for j in c(a.y.min(b.y) - eps)..=c(a.y.max(b.y) + eps) {
                        grid.entry((i, j)).or_default().push((s, k));
                    }
                }
            }
        }
        Index {
            segs,
            pts,
            grid,
            cell,
            eps,
        }
    }

    /// Alle Stellen, an denen v auf einer Abtast-Kante liegt; Abtastpunkte (auch Segment-Enden) exakt.
    fn hits(&self, v: Point) -> Vec<Hit> {
        let key = (
            (v.x / self.cell).floor() as i64,
            (v.y / self.cell).floor() as i64,
        );
        let mut out: Vec<Hit> = Vec::new();
        for &(s, k) in self.grid.get(&key).into_iter().flatten() {
            let ((ta, a), (tb, b)) = (self.pts[s][k], self.pts[s][k + 1]);
            let t = if v.distance(a) <= self.eps {
                ta
            } else if v.distance(b) <= self.eps {
                tb
            } else {
                let d = b - a;
                let u = ((v - a).dot(d) / d.hypot2()).clamp(0.0, 1.0);
                if v.distance(a + d * u) > self.eps {
                    continue;
                }
                ta + u * (tb - ta)
            };
            if !out
                .iter()
                .any(|&(s2, t2)| s2 == s && (t2 - t).abs() < 1e-12)
            {
                out.push((s, t));
            }
        }
        out
    }

    /// Kante a→b: Segment, das beide Enden trägt und dessen Kurvenmitte zur Kantenmitte passt;
    /// bei deckungsgleichen Segmenten gewinnt das kleinste, damit Nachbarkanten zusammenpassen.
    fn label(&self, (a, ha): (Point, &[Hit]), (b, hb): (Point, &[Hit])) -> Label {
        let mid = a.midpoint(b);
        let mut best: Label = None;
        for &(s, ta) in ha {
            for &(_, tb) in hb.iter().filter(|h| h.0 == s && h.1 != ta) {
                let fits = self.segs[s].eval((ta + tb) / 2.0).distance(mid) <= 2.0 * TOL + self.eps;
                if fits && best.is_none_or(|(bs, ..)| s < bs) {
                    best = Some((s, ta, tb));
                }
            }
        }
        best
    }

    /// Eine Ergebnis-Kontur → geschlossener Teilpfad mit exakten Kurvenstücken.
    pub fn contour(&self, c: &[[f64; 2]]) -> Subpath {
        self.build(c, true)
    }

    /// Ein Ergebnis-Linienzug (Radierer auf offenen Pfaden) → offener Teilpfad.
    pub fn open(&self, c: &[[f64; 2]]) -> Subpath {
        self.build(c, false)
    }

    fn build(&self, c: &[[f64; 2]], closed: bool) -> Subpath {
        let v: Vec<Point> = c.iter().map(|p| Point::new(p[0], p[1])).collect();
        let n = v.len();
        // Kantenzahl: offen fehlt die Schlusskante
        let e = if closed { n } else { n - 1 };
        let hits: Vec<_> = v.iter().map(|&p| self.hits(p)).collect();
        // Original-Knoten exakt übernehmen, Schnittpunkte wie berechnet
        let pos: Vec<Point> = (0..n)
            .map(
                |i| match hits[i].iter().find(|h| h.1 == 0.0 || h.1 == 1.0) {
                    Some(&(s, 0.0)) => self.segs[s].start(),
                    Some(&(s, _)) => self.segs[s].end(),
                    None => v[i],
                },
            )
            .collect();
        let labels: Vec<Label> = (0..e)
            .map(|i| self.label((v[i], &hits[i]), (v[(i + 1) % n], &hits[(i + 1) % n])))
            .collect();
        let joins = |x: Label, y: Label| matches!((x, y), (Some((s, a, b)), Some((s2, a2, b2))) if s == s2 && b == a2 && (b > a) == (b2 > a2));
        let first = if closed {
            (0..n)
                .find(|&i| !joins(labels[(i + n - 1) % n], labels[i]))
                .unwrap_or(0)
        } else {
            0
        };

        // Läufe: (Startpunkt, Endpunkt, Kurvenstück falls Kurve)
        let mut runs: Vec<(usize, usize, Option<CubicBez>)> = Vec::new();
        let mut i = first;
        for _ in 0..e {
            let j = (i + 1) % n;
            match runs.last_mut() {
                Some(r) if joins(labels[(i + e - 1) % e], labels[i]) => r.1 = j,
                _ => runs.push((i, j, None)),
            }
            i = j;
        }
        for r in &mut runs {
            let (Some((s, ta, _)), Some((_, _, tb))) = (labels[r.0], labels[(r.1 + n - 1) % n])
            else {
                continue;
            };
            if let PathSeg::Cubic(cb) = self.segs[s] {
                let piece = if ta.min(tb) == 0.0 && ta.max(tb) == 1.0 {
                    cb
                } else {
                    cb.subsegment(ta.min(tb)..ta.max(tb))
                };
                let piece = if ta > tb {
                    CubicBez::new(piece.p3, piece.p2, piece.p1, piece.p0)
                } else {
                    piece
                };
                let (d0, d1) = (pos[r.0] - piece.p0, pos[r.1] - piece.p3);
                r.2 = Some(CubicBez::new(
                    pos[r.0],
                    piece.p1 + d0,
                    piece.p2 + d1,
                    pos[r.1],
                ));
            }
        }

        let mut nodes: Vec<PathPoint> = runs
            .iter()
            .map(|r| PathPoint {
                x: pos[r.0].x,
                y: pos[r.0].y,
                kind: NodeType::Corner,
                handle_in: None,
                handle_out: r.2.map(|c| pt(c.p1)),
            })
            .collect();
        if !closed {
            nodes.push(PathPoint {
                x: pos[n - 1].x,
                y: pos[n - 1].y,
                kind: NodeType::Corner,
                handle_in: None,
                handle_out: None,
            });
        }
        let m = nodes.len();
        for (k, r) in runs.iter().enumerate() {
            nodes[(k + 1) % m].handle_in = r.2.map(|c| pt(c.p2));
        }
        for nd in &mut nodes {
            nd.kind = kind(nd);
        }
        Subpath { closed, nodes }
    }
}

fn pt(p: Point) -> P {
    P { x: p.x, y: p.y }
}

/// Glatt, wenn beide Anfasser entgegengesetzt auf einer Linie liegen.
fn kind(n: &PathPoint) -> NodeType {
    let (Some(a), Some(b)) = (n.handle_in, n.handle_out) else {
        return NodeType::Corner;
    };
    let (ax, ay, bx, by) = (a.x - n.x, a.y - n.y, b.x - n.x, b.y - n.y);
    let (la, lb) = (ax.hypot(ay), bx.hypot(by));
    let smooth = la > 1e-12
        && lb > 1e-12
        && ax * bx + ay * by < 0.0
        && (ax * by - ay * bx).abs() <= 1e-6 * la * lb;
    if smooth {
        NodeType::Smooth
    } else {
        NodeType::Corner
    }
}
