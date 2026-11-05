//! Messer und Radierer (4f, spec.md §5). Flächen schneidet i_overlay (`slice_by`, Differenz),
//! offene Linien kurbo (`intersect_line`) bzw. i_overlay (`clip_by`); recover.rs holt die Kurven zurück.
use super::recover::Index;
use super::{check, flatten, path_segs, push_samples, rule, Polys, Shape};
use crate::scene::{NodeType, PathPoint, Point as P, Subpath};
use i_overlay::core::fill_rule::FillRule;
use i_overlay::core::overlay_rule::OverlayRule;
use i_overlay::float::clip::FloatClip;
use i_overlay::float::simplify::SimplifyShape;
use i_overlay::float::single::SingleFloatOverlay;
use i_overlay::float::slice::FloatSlice;
use i_overlay::string::clip::ClipRule;
use kurbo::{
    BezPath, Cap, Circle, CubicBez, Join, Line, ParamCurve, ParamCurveArclen, PathEl, PathSeg,
    Point, QuadBez, Rect, Shape as _, Stroke, StrokeOpts,
};

/// Teilt eine Form entlang des Schnitts in höchstens zwei Gruppen (je eine Seite des Schnitts,
/// unberührte Teile zur Seite, auf der sie liegen). None = der Schnitt trennt nichts.
pub fn knife(shape: &Shape, cut: &Subpath) -> Result<Option<Vec<Vec<Subpath>>>, String> {
    check(cut)?;
    let blade = path_segs(&Subpath {
        closed: false,
        nodes: cut.nodes.clone(),
    });
    let mut line = Vec::new();
    for s in &blade {
        push_samples(s, &mut line);
    }
    if let Some(s) = blade.last() {
        line.push([s.end().x, s.end().y]);
    }
    let side = Side::new(&line);
    if side.pts.len() < 2 {
        return Ok(None);
    }
    if shape.subpaths.iter().all(|s| !s.closed) {
        return split_lines(shape, &side);
    }
    let mut segs = Vec::new();
    let own = flatten(shape, &mut segs)?.simplify_shape(rule(shape));
    let pieces = own.slice_by(&line, FillRule::NonZero);
    if pieces.len() <= own.len() {
        return Ok(None);
    }
    segs.extend(blade);
    let index = Index::new(&segs);
    let mut groups = [Vec::new(), Vec::new()];
    for piece in &pieces {
        let k = side.of(piece.iter().flatten().map(|p| Point::new(p[0], p[1])));
        groups[k].extend(piece.iter().map(|c| index.contour(c)));
    }
    Ok(Some(groups.into_iter().filter(|g| !g.is_empty()).collect()))
}

/// Offene Linien an den Schnittpunkten auftrennen; jedes Stück kommt zur Seite seiner Mitte.
fn split_lines(shape: &Shape, side: &Side) -> Result<Option<Vec<Vec<Subpath>>>, String> {
    let blade: Vec<Line> = side.pts.windows(2).map(|w| Line::new(w[0], w[1])).collect();
    let mut groups = [Vec::new(), Vec::new()];
    let mut cuts = 0;
    for sp in &shape.subpaths {
        check(sp)?;
        let mut piece: Vec<PathSeg> = Vec::new();
        let mut pieces = Vec::new();
        for seg in path_segs(sp) {
            let mut ts: Vec<f64> = blade
                .iter()
                .flat_map(|l| seg.intersect_line(*l))
                .filter(|h| (0.0..=1.0).contains(&h.line_t))
                .map(|h| h.segment_t.clamp(0.0, 1.0))
                .collect();
            ts.sort_by(f64::total_cmp);
            ts.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
            cuts += ts.len();
            let mut t0 = 0.0;
            for t in ts {
                if t - t0 > 1e-9 {
                    piece.push(seg.subsegment(t0..t));
                }
                pieces.push(std::mem::take(&mut piece));
                t0 = t;
            }
            if 1.0 - t0 > 1e-9 {
                piece.push(if t0 == 0.0 { seg } else { seg.subsegment(t0..1.0) });
            }
        }
        pieces.push(piece);
        for p in pieces.into_iter().filter(|p| !p.is_empty()) {
            let mid = p[p.len() / 2].eval(0.5);
            groups[side.of([mid])].push(open_subpath(&p));
        }
    }
    if cuts == 0 {
        return Ok(None);
    }
    Ok(Some(groups.into_iter().filter(|g| !g.is_empty()).collect()))
}

fn open_subpath(segs: &[PathSeg]) -> Subpath {
    let pt = |p: Point| P { x: p.x, y: p.y };
    let mut nodes: Vec<PathPoint> = Vec::new();
    for s in segs {
        let (a, out, inn, b) = match s {
            PathSeg::Cubic(c) => (c.p0, Some(pt(c.p1)), Some(pt(c.p2)), c.p3),
            other => (other.start(), None, None, other.end()),
        };
        if nodes.is_empty() {
            nodes.push(corner(a));
        }
        nodes.last_mut().unwrap().handle_out = out;
        let mut n = corner(b);
        n.handle_in = inn;
        nodes.push(n);
    }
    Subpath {
        closed: false,
        nodes,
    }
}

fn corner(p: Point) -> PathPoint {
    PathPoint {
        x: p.x,
        y: p.y,
        kind: NodeType::Corner,
        handle_in: None,
        handle_out: None,
    }
}

/// Seite bezüglich des Schnitts; erstes und letztes Stück gelten als Strahlen ins Unendliche.
struct Side {
    pts: Vec<Point>,
}

impl Side {
    fn new(line: &[[f64; 2]]) -> Self {
        let mut pts: Vec<Point> = Vec::new();
        for p in line.iter().map(|p| Point::new(p[0], p[1])) {
            if pts.last().is_none_or(|q| q.distance(p) > 1e-9) {
                pts.push(p);
            }
        }
        Side { pts }
    }

    fn signed(&self, p: Point) -> f64 {
        let last = self.pts.len() - 2;
        let mut best = (f64::MAX, 0.0);
        for (k, w) in self.pts.windows(2).enumerate() {
            let d = w[1] - w[0];
            let mut u = (p - w[0]).dot(d) / d.hypot2();
            if k > 0 {
                u = u.max(0.0);
            }
            if k < last {
                u = u.min(1.0);
            }
            let dist = p.distance(w[0] + d * u);
            if dist < best.0 {
                best = (dist, d.cross(p - w[0]).signum() * dist);
            }
        }
        best.1
    }

    /// 0 oder 1: Seite des Punkts mit dem größten Abstand (Schnittkanten-Punkte liegen auf 0).
    fn of(&self, pts: impl IntoIterator<Item = Point>) -> usize {
        let d = pts
            .into_iter()
            .map(|p| self.signed(p))
            .fold(0.0_f64, |a, b| if b.abs() > a.abs() { b } else { a });
        usize::from(d < 0.0)
    }
}

/// Radiert entlang der Spur mit runder oder eckiger Spitze. Flächen bleiben ein Objekt mit
/// Teilpfaden, offene Linien zerfallen in offene Teilpfade. None = nichts getroffen, leer = alles weg.
pub fn erase(
    shape: &Shape,
    trail: &Subpath,
    width: f64,
    square: bool,
) -> Result<Option<Vec<Subpath>>, String> {
    check(trail)?;
    if !(width.is_finite() && width > 0.0) {
        return Err("Die Radierer-Dicke muss größer als 0 sein.".into());
    }
    let mut segs = Vec::new();
    if shape.subpaths.iter().all(|s| !s.closed) {
        let mut lines = Vec::new();
        for sp in &shape.subpaths {
            check(sp)?;
            let mut l = Vec::new();
            for s in path_segs(sp) {
                push_samples(&s, &mut l);
                segs.push(s);
            }
            if let Some(n) = sp.nodes.last().filter(|_| sp.nodes.len() > 1) {
                l.push([n.x, n.y]);
                lines.push(l);
            }
        }
        let mut reg_segs = Vec::new();
        let reg = region(trail, width, square, &mut reg_segs);
        let clip = |invert| {
            lines.clip_by(
                &reg,
                FillRule::NonZero,
                ClipRule {
                    invert,
                    boundary_included: false,
                },
            )
        };
        if clip(false).is_empty() {
            return Ok(None);
        }
        let index = Index::new(&segs);
        return Ok(Some(
            clip(true)
                .iter()
                .filter(|l| l.len() > 1)
                .map(|l| index.open(l))
                .collect(),
        ));
    }
    let own = flatten(shape, &mut segs)?.simplify_shape(rule(shape));
    let reg = region(trail, width, square, &mut segs);
    if own
        .overlay(&reg, OverlayRule::Intersect, FillRule::NonZero)
        .is_empty()
    {
        return Ok(None);
    }
    let index = Index::new(&segs);
    Ok(Some(
        own.overlay(&reg, OverlayRule::Difference, FillRule::NonZero)
            .iter()
            .flatten()
            .map(|c| index.contour(c))
            .collect(),
    ))
}

/// Fläche, die die Spitze entlang der Spur überstreicht (kurbo-Kontur), als Polygone; Segmente für recover.
fn region(trail: &Subpath, width: f64, square: bool, segs: &mut Vec<PathSeg>) -> Polys {
    let tsegs = path_segs(&Subpath {
        closed: false,
        nodes: trail.nodes.clone(),
    });
    let len: f64 = tsegs.iter().map(|s| s.arclen(1e-3)).sum();
    let path = match trail.nodes.first() {
        Some(n) if len < 1e-9 => {
            let c = Point::new(n.x, n.y);
            if square {
                Rect::from_center_size(c, (width, width)).to_path(1e-3)
            } else {
                Circle::new(c, width / 2.0).to_path(1e-3)
            }
        }
        None => BezPath::new(),
        Some(_) => {
            let mut bez = BezPath::new();
            bez.move_to(tsegs[0].start());
            for s in &tsegs {
                bez.push(s.as_path_el());
            }
            let (cap, join) = if square {
                (Cap::Square, Join::Miter)
            } else {
                (Cap::Round, Join::Round)
            };
            kurbo::stroke(
                bez,
                &Stroke::new(width).with_caps(cap).with_join(join),
                &StrokeOpts::default(),
                1e-3,
            )
        }
    };
    polys_of(&path, segs)
}

/// kurbo-Pfad → geschlossene Polygone; die Segmente landen für recover in segs.
pub(super) fn polys_of(path: &BezPath, segs: &mut Vec<PathSeg>) -> Polys {
    let mut b = Bez::default();
    for el in path.elements() {
        match *el {
            PathEl::MoveTo(p) => {
                b.close(segs);
                (b.start, b.last) = (p, p);
            }
            PathEl::ClosePath => b.close(segs),
            PathEl::LineTo(p) => b.add(PathSeg::Line(Line::new(b.last, p)), segs),
            PathEl::QuadTo(a, p) => b.add(PathSeg::Cubic(QuadBez::new(b.last, a, p).raise()), segs),
            PathEl::CurveTo(a, c, p) => b.add(PathSeg::Cubic(CubicBez::new(b.last, a, c, p)), segs),
        }
    }
    b.close(segs);
    b.out
}

/// Sammelt kurbo-Elemente zu geschlossenen Polygonen.
#[derive(Default)]
struct Bez {
    out: Polys,
    poly: Vec<[f64; 2]>,
    start: Point,
    last: Point,
}

impl Bez {
    fn add(&mut self, seg: PathSeg, segs: &mut Vec<PathSeg>) {
        if seg.start().distance(seg.end()) <= 1e-12 && matches!(seg, PathSeg::Line(_)) {
            return;
        }
        push_samples(&seg, &mut self.poly);
        self.last = seg.end();
        segs.push(seg);
    }

    fn close(&mut self, segs: &mut Vec<PathSeg>) {
        self.add(PathSeg::Line(Line::new(self.last, self.start)), segs);
        if self.poly.len() > 2 {
            self.out.push(std::mem::take(&mut self.poly));
        }
        self.poly.clear();
        self.last = self.start;
    }
}
