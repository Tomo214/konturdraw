//! Text auf Pfad: Glyphenmitte auf der Bogenlänge, gedreht nach der Tangente; Grundlinie auf dem Pfad.
use super::{face::Face, Align, Layout, Line, OnPath, PlacedGlyph, Side, TextSpec};
use crate::scene::{segments, Seg, Subpath};
use kurbo::{CubicBez, Line as KLine, ParamCurve, ParamCurveArclen, PathSeg, Point, Vec2};

const ACCURACY: f64 = 1e-6;

/// Pfad als Kurvenstücke mit aufsummierter Länge.
struct Curve {
    segs: Vec<(PathSeg, f64)>,
    len: f64,
    closed: bool,
}

impl Curve {
    fn new(sp: &Subpath, reverse: bool) -> Self {
        let kp = |p: crate::scene::Point| Point::new(p.x, p.y);
        let mut segs = Vec::new();
        if let Some(first) = sp.nodes.first() {
            let mut prev = Point::new(first.x, first.y);
            for s in segments(sp) {
                let seg = match s {
                    Seg::Line(e) => PathSeg::Line(KLine::new(prev, kp(e))),
                    Seg::Cubic(a, b, e) => PathSeg::Cubic(CubicBez::new(prev, kp(a), kp(b), kp(e))),
                };
                prev = seg.end();
                segs.push(seg);
            }
        }
        if reverse {
            segs = segs.iter().rev().map(|s| s.reverse()).collect();
        }
        let mut len = 0.0;
        let segs = segs
            .into_iter()
            .filter_map(|s| {
                let l = s.arclen(ACCURACY);
                len += l;
                (l > 1e-12).then_some((s, len))
            })
            .collect();
        Curve {
            segs,
            len,
            closed: sp.closed,
        }
    }

    /// Punkt und Einheitstangente bei Bogenlänge s; offen über die Enden hinaus geradeaus weiter.
    fn at(&self, s: f64) -> (Point, Vec2) {
        let (Some(first), Some(last)) = (self.segs.first(), self.segs.last()) else {
            return (Point::ZERO, Vec2::new(1.0, 0.0));
        };
        let s = if self.closed {
            s.rem_euclid(self.len)
        } else {
            s
        };
        if s < 0.0 {
            let t = tangent(&first.0, 0.0);
            return (first.0.start() + t * s, t);
        }
        if s > self.len {
            let t = tangent(&last.0, 1.0);
            return (last.0.end() + t * (s - self.len), t);
        }
        let i = self
            .segs
            .partition_point(|(_, end)| *end < s)
            .min(self.segs.len() - 1);
        let (seg, end) = &self.segs[i];
        let t = seg.inv_arclen(s - (end - seg.arclen(ACCURACY)), ACCURACY);
        (seg.eval(t), tangent(seg, t))
    }
}

/// Mittlere Differenz statt Ableitung: hält auch an Knoten ohne Anfasser die Richtung.
fn tangent(seg: &PathSeg, t: f64) -> Vec2 {
    const H: f64 = 1e-5;
    let d = seg.eval((t + H).min(1.0)) - seg.eval((t - H).max(0.0));
    let n = d.hypot();
    if n > 0.0 {
        d / n
    } else {
        Vec2::new(1.0, 0.0)
    }
}

pub(super) fn place(face: &Face, spec: &TextSpec, p: &OnPath) -> Layout {
    // Eine Zeile; '\n' und ' ' sind beide ein Byte → Cluster passen weiter zum Originaltext
    let text = spec.text.replace('\n', " ");
    let glyphs = face.shape(&text, spec.tracking / 100.0 * face.space);
    let width = glyphs.last().map_or(0.0, |g| g.x + g.advance);
    let curve = Curve::new(&p.path, p.side == Side::Below);
    let start = p.offset
        + match spec.align {
            Align::Left => 0.0,
            Align::Center => (curve.len - width) / 2.0,
            Align::Right => curve.len - width,
        };
    let u16 = super::utf16_table(&spec.text);
    let mut out = Layout {
        glyphs: vec![],
        lines: vec![],
        outline: vec![],
        ascent: face.ascent,
        descent: face.descent,
        overflow: false,
    };
    for g in &glyphs {
        let (pt, t) = curve.at(start + g.x + g.advance / 2.0);
        // Normale zur Schriftseite (y nach unten: links der Laufrichtung = oben)
        let n = Vec2::new(t.y, -t.x);
        let o = pt - t * (g.advance / 2.0) + n * (p.distance - g.y);
        let angle = t.y.atan2(t.x);
        out.glyphs.push(PlacedGlyph {
            x: o.x,
            y: o.y,
            angle,
            advance: g.advance,
            index: u16[g.cluster],
        });
        out.outline.extend(face.outline(g.id, o.x, o.y, angle));
    }
    out.lines.push(Line {
        baseline: 0.0,
        x0: 0.0,
        x1: width,
        start: 0,
        end: u16[spec.text.len()],
    });
    out
}
