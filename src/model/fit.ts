import type { Cubic } from './bezier';
import type { PathPoint, Point, Subpath } from './types';

// Kurvenanpassung für Freihand und Knoten reduzieren nach Schneider („An Algorithm for Automatically Fitting
// Digitized Curves“, Graphics Gems 1990): Kubik per kleinste Quadrate, Newton-Nachparametrisierung, sonst am
// größten Fehler teilen. Punkte liegen als Zahlenreihen vor, die Schleifen erzeugen keine Objekte: mit
// Punkt-Objekten brauchte Chromium (= WebView2 unter Windows) für 1400 Knoten bis 12 s, ein Drittel davon
// Speicherbereinigung.

/** Punktfolge als Zahlenreihen x[i], y[i]. */
export interface Samples {
  readonly x: Float64Array;
  readonly y: Float64Array;
}

const unit = (x: number, y: number): Point => {
  const l = Math.hypot(x, y);
  return l ? { x: x / l, y: y / l } : { x, y };
};
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
// Eine Koordinate der Kubik a, b, c, d bei t.
const bez = (a: number, b: number, c: number, d: number, t: number) => {
  const s = 1 - t;
  return s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
};

function chordParams(p: Samples, first: number, last: number): Float64Array {
  const u = new Float64Array(last - first + 1);
  for (let i = first + 1; i <= last; i++) {
    const [dx, dy] = [p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]];
    u[i - first] = u[i - first - 1] + Math.sqrt(dx * dx + dy * dy);
  }
  const total = u[last - first];
  if (total) for (let i = 1; i < u.length; i++) u[i] /= total;
  return u;
}

// t1 zeigt vom Start, t2 vom Ende in die Kurve.
function generate(p: Samples, first: number, last: number, u: Float64Array, t1: Point, t2: Point): Cubic {
  const [x0, y0, x3, y3] = [p.x[first], p.y[first], p.x[last], p.y[last]];
  const [t11, t12, t22] = [t1.x * t1.x + t1.y * t1.y, t1.x * t2.x + t1.y * t2.y, t2.x * t2.x + t2.y * t2.y];
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x1 = 0;
  let x2 = 0;
  for (let i = 0; i < u.length; i++) {
    const t = u[i];
    const s = 1 - t;
    const b0 = s * s * s;
    const b1 = 3 * s * s * t;
    const b2 = 3 * s * t * t;
    const b3 = t * t * t;
    c00 += b1 * b1 * t11;
    c01 += b1 * b2 * t12;
    c11 += b2 * b2 * t22;
    const rx = p.x[first + i] - (x0 * (b0 + b1) + x3 * (b2 + b3));
    const ry = p.y[first + i] - (y0 * (b0 + b1) + y3 * (b2 + b3));
    x1 += b1 * (t1.x * rx + t1.y * ry);
    x2 += b2 * (t2.x * rx + t2.y * ry);
  }
  const det = c00 * c11 - c01 * c01;
  let alpha1 = det ? (x1 * c11 - c01 * x2) / det : 0;
  let alpha2 = det ? (c00 * x2 - c01 * x1) / det : 0;
  const [cx, cy] = [x3 - x0, y3 - y0];
  const seg = Math.hypot(cx, cy);
  // Fast singuläres System (wenige, zickzackende Punkte) liefert riesige Alphas; ragen die Griffe zusammen
  // weiter als die Sehne in ihre Richtung, schießt die Kurve übers Ziel → Rückfall auf Sehne/3.
  const over = alpha1 * (t1.x * cx + t1.y * cy) - alpha2 * (t2.x * cx + t2.y * cy);
  if (alpha1 < 1e-6 * seg || alpha2 < 1e-6 * seg || !(over <= seg * seg)) alpha1 = alpha2 = seg / 3;
  return [
    { x: x0, y: y0 },
    { x: x0 + t1.x * alpha1, y: y0 + t1.y * alpha1 },
    { x: x3 + t2.x * alpha2, y: y3 + t2.y * alpha2 },
    { x: x3, y: y3 },
  ];
}

function maxError(p: Samples, first: number, last: number, c: Cubic, u: Float64Array) {
  let err = 0;
  let split = first + 1;
  for (let i = first + 1; i < last; i++) {
    const t = u[i - first];
    const dx = bez(c[0].x, c[1].x, c[2].x, c[3].x, t) - p.x[i];
    const dy = bez(c[0].y, c[1].y, c[2].y, c[3].y, t) - p.y[i];
    const d = dx * dx + dy * dy;
    if (d >= err) {
      err = d;
      split = i;
    }
  }
  return { err, split };
}

// Ein Newton-Schritt je Punkt auf (Q(t) − P)·Q'(t) = 0; überschreibt u.
function reparam(p: Samples, first: number, c: Cubic, u: Float64Array): void {
  const [a, b, cc, d] = c;
  for (let i = 0; i < u.length; i++) {
    const t = u[i];
    const s = 1 - t;
    const dx = bez(a.x, b.x, cc.x, d.x, t) - p.x[first + i];
    const dy = bez(a.y, b.y, cc.y, d.y, t) - p.y[first + i];
    const d1x = 3 * (s * s * (b.x - a.x) + 2 * s * t * (cc.x - b.x) + t * t * (d.x - cc.x));
    const d1y = 3 * (s * s * (b.y - a.y) + 2 * s * t * (cc.y - b.y) + t * t * (d.y - cc.y));
    const d2x = 6 * (s * (cc.x - 2 * b.x + a.x) + t * (d.x - 2 * cc.x + b.x));
    const d2y = 6 * (s * (cc.y - 2 * b.y + a.y) + t * (d.y - 2 * cc.y + b.y));
    const den = d1x * d1x + d1y * d1y + dx * d2x + dy * d2y;
    if (den) u[i] = Math.min(1, Math.max(0, t - (dx * d1x + dy * d1y) / den));
  }
}

function fitRange(p: Samples, first: number, last: number, t1: Point, t2: Point, tol2: number, out: Cubic[]): void {
  if (last - first === 1) {
    const [a, b] = [{ x: p.x[first], y: p.y[first] }, { x: p.x[last], y: p.y[last] }];
    const d = dist(a, b) / 3;
    out.push([a, { x: a.x + t1.x * d, y: a.y + t1.y * d }, { x: b.x + t2.x * d, y: b.y + t2.y * d }, b]);
    return;
  }
  const u = chordParams(p, first, last);
  let c = generate(p, first, last, u, t1, t2);
  let { err, split } = maxError(p, first, last, c, u);
  if (err < tol2) return void out.push(c);
  // Nur nachparametrisieren, wenn es aussichtsreich ist; sonst gleich teilen.
  if (err < tol2 * 100) {
    for (let k = 0; k < 20; k++) {
      reparam(p, first, c, u);
      c = generate(p, first, last, u, t1, t2);
      ({ err, split } = maxError(p, first, last, c, u));
      if (err < tol2) return void out.push(c);
    }
  }
  const tc = unit(p.x[split - 1] - p.x[split + 1], p.y[split - 1] - p.y[split + 1]);
  fitRange(p, first, split, t1, tc, tol2, out);
  fitRange(p, split, last, { x: -tc.x, y: -tc.y }, t2, tol2, out);
}

/** Glatte Knotenfolge, die alle Punkte mit Abstand ≤ tol trifft. Innere Knoten glatt, Enden Ecke. */
export function fitCurve(points: readonly Point[], tol: number): PathPoint[] {
  const pts: Point[] = [];
  for (const q of points) if (!pts.length || dist(q, pts[pts.length - 1]) > 1e-9) pts.push(q);
  if (pts.length < 2) return [];
  const out: Cubic[] = [];
  const n = pts.length;
  const p: Samples = { x: Float64Array.from(pts, (q) => q.x), y: Float64Array.from(pts, (q) => q.y) };
  fitRange(p, 0, n - 1, unit(pts[1].x - pts[0].x, pts[1].y - pts[0].y), unit(pts[n - 2].x - pts[n - 1].x, pts[n - 2].y - pts[n - 1].y), tol * tol, out);
  const nodes: PathPoint[] = [{ ...out[0][0], type: 'corner', handleOut: out[0][1] }];
  out.forEach((c, i) => {
    const next = out[i + 1];
    nodes.push(next ? { ...c[3], type: 'smooth', handleIn: c[2], handleOut: next[1] } : { ...c[3], type: 'corner', handleIn: c[2] });
  });
  return nodes;
}

/** Genau eine Kurve durch die Punkte first…last, Enden fest; t1 zeigt vom Start, t2 vom Ende in die Kurve
 *  (fehlt = aus den Nachbarpunkten geschätzt). null = Abweichung bleibt über tol. */
export function fitOne(p: Samples, first: number, last: number, tol: number, t1?: Point, t2?: Point): Cubic | null {
  if (last - first < 1) return null;
  const a = t1 ? unit(t1.x, t1.y) : unit(p.x[first + 1] - p.x[first], p.y[first + 1] - p.y[first]);
  const b = t2 ? unit(t2.x, t2.y) : unit(p.x[last - 1] - p.x[last], p.y[last - 1] - p.y[last]);
  const u = chordParams(p, first, last);
  let c = generate(p, first, last, u, a, b);
  for (let k = 0; ; k++) {
    const { err } = maxError(p, first, last, c, u);
    if (err < tol * tol) return c;
    // Wenige Schritte, früher Abbruch über 10 × Toleranz: Knoten reduzieren rechnet live am Regler.
    if (k === 8 || err > 100 * tol * tol) return null;
    reparam(p, first, c, u);
    c = generate(p, first, last, u, a, b);
  }
}

/** Freihand-Strich → Pfad; liegt das Ende näher als closeTol am Anfang, wird geschlossen. */
export function freehandPath(points: readonly Point[], tol: number, closeTol: number): Subpath | null {
  const end = points[points.length - 1];
  const closed = points.length > 2 && dist(end, points[0]) <= closeTol;
  const nodes = fitCurve(closed ? [...points.slice(0, -1), points[0]] : points, tol);
  if (nodes.length < 2) return null;
  if (closed && nodes.length > 2) {
    const last = nodes.pop()!;
    nodes[0] = { ...nodes[0], handleIn: last.handleIn };
  }
  return { closed, nodes };
}
