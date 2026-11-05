import { apply, IDENTITY, type Box, type Mat } from './geometry';
import type { PathPoint, Point, Subpath } from './types';

export type Cubic = readonly [Point, Point, Point, Point];

export interface Seg {
  /** Index des Start- und Endknotens. */
  a: number;
  b: number;
  line: boolean;
  c: Cubic;
}

export function segmentCount(sp: Subpath): number {
  const n = sp.nodes.length;
  if (n < 2) return 0;
  return sp.closed ? n : n - 1;
}

export function segmentAt(sp: Subpath, i: number): Seg {
  const a = i;
  const b = (i + 1) % sp.nodes.length;
  const p = sp.nodes[a];
  const q = sp.nodes[b];
  const p0 = { x: p.x, y: p.y };
  const p3 = { x: q.x, y: q.y };
  return { a, b, line: !p.handleOut && !q.handleIn, c: [p0, p.handleOut ?? p0, q.handleIn ?? p3, p3] };
}

export function segmentsOf(sp: Subpath): Seg[] {
  return Array.from({ length: segmentCount(sp) }, (_, i) => segmentAt(sp, i));
}

export function pointAt(c: Cubic, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return { x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x, y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y };
}

const lerp = (p: Point, q: Point, t: number): Point => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });

/** De Casteljau. */
export function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const p01 = lerp(c[0], c[1], t);
  const p12 = lerp(c[1], c[2], t);
  const p23 = lerp(c[2], c[3], t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const mid = lerp(p012, p123, t);
  return [
    [c[0], p01, p012, mid],
    [mid, p123, p23, c[3]],
  ];
}

// Nullstellen der Ableitung in (0, 1) für eine Achse.
function extrema(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const roots: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      roots.push((-b + s) / (2 * a), (-b - s) / (2 * a));
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}

export function cubicBounds(c: Cubic): Box {
  const ts = [0, 1, ...extrema(c[0].x, c[1].x, c[2].x, c[3].x), ...extrema(c[0].y, c[1].y, c[2].y, c[3].y)];
  const pts = ts.map((t) => pointAt(c, t));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function mapPoint(m: Mat, p: Point): Point {
  const [x, y] = apply(m, p.x, p.y);
  return { x, y };
}

export function transformSubpath(sp: Subpath, m: Mat): Subpath {
  const nodes = sp.nodes.map((n): PathPoint => {
    const out: PathPoint = { ...n, ...mapPoint(m, n) };
    if (n.handleIn) out.handleIn = mapPoint(m, n.handleIn);
    if (n.handleOut) out.handleOut = mapPoint(m, n.handleOut);
    return out;
  });
  return { ...sp, nodes };
}

/** Enge Box der Kurven (nicht des Kontrollpolygons), optional nach Transformation; null ohne Knoten. */
export function subpathBounds(subpaths: readonly Subpath[], m: Mat = IDENTITY): Box | null {
  let box: Box | null = null;
  const add = (b: Box) => {
    box = box
      ? { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) }
      : b;
  };
  for (const raw of subpaths) {
    const sp = m === IDENTITY ? raw : transformSubpath(raw, m);
    if (sp.nodes.length === 1) add({ minX: sp.nodes[0].x, minY: sp.nodes[0].y, maxX: sp.nodes[0].x, maxY: sp.nodes[0].y });
    for (const s of segmentsOf(sp)) add(cubicBounds(s.c));
  }
  return box;
}

/** Nächster Kurvenpunkt: grob abtasten, dann Newton. */
export function nearest(c: Cubic, p: Point): { t: number; dist: number; point: Point } {
  const d2 = (t: number) => {
    const q = pointAt(c, t);
    return (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
  };
  let t = 0;
  let best = Infinity;
  for (let i = 0; i <= 32; i++) {
    const v = d2(i / 32);
    if (v < best) [best, t] = [v, i / 32];
  }
  for (let i = 0; i < 8; i++) {
    // f(t) = (B(t) − p)·B'(t), Newton mit numerischer Ableitung.
    const h = 1e-6;
    const f = (s: number) => (d2(Math.min(1, s + h)) - d2(Math.max(0, s - h))) / (2 * h);
    const f1 = f(t);
    const f2 = (f(Math.min(1, t + h)) - f(Math.max(0, t - h))) / (2 * h);
    if (Math.abs(f2) < 1e-12) break;
    const next = Math.min(1, Math.max(0, t - f1 / f2));
    if (Math.abs(next - t) < 1e-10) break;
    if (d2(next) <= d2(t)) t = next;
    else break;
  }
  const point = pointAt(c, t);
  return { t, dist: Math.hypot(point.x - p.x, point.y - p.y), point };
}
