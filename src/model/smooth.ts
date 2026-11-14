// Glätten-Werkzeug (Spec §18 #4): ein Pinseltupfer glättet die Kurvenstücke im Kreis und senkt die Knotenzahl.
// Knoten außerhalb des Pinsels (und Enden offener Pfade) bleiben fest. Jeder Abschnitt dazwischen wird gleichmäßig
// abgetastet, unter dem Pinsel mit Taubin-Schritten geglättet (λ glättet, μ hebt das Schrumpfen wieder auf) und
// eng neu angepasst. Vorher wird die Kurve am Pinselrand geteilt: nur das Stück im Kreis wird neu angepasst, der
// Rest bleibt exakt. Am Strich-Ende fasst settleAt die Knoten im Strichbereich zusammen.
// Ablauf und Aufteilung = eigene Festlegung.
import { pointAt, segmentAt, segmentCount, transformSubpath, type Cubic } from './bezier';
import { findNode, updateNodes, worldOf } from './document';
import { fitSpan } from './fit';
import { insertNode } from './path-edit';
import { reduceNodes } from './reduce';
import { IDENTITY, invert } from './geometry';
import { toCurves } from './style';
import type { Doc, Node, PathNode, PathPoint, Point, Subpath } from './types';

const PER_R = 8; // Abtastpunkte je Pinselradius
const MAX_SAMPLES = 4000;
const LAMBDA = 0.5;
const MU = -0.53;
const STEPS = 2; // Taubin-Paare je Tupfer
// Je mm Radius. Jeder Tupfer passt eng an: mit gröberer Toleranz summierten sich die Fit-Fehler von Tupfer zu
// Tupfer zu einer Wölbung neben gerundeten Ecken (gemessen bis 0,6 mm bei r = 10). Knoten spart das Strich-Ende.
const TOL = 1 / 2000;
const STILL = 1 / 800; // darunter gilt eine Probe als unbewegt
// Abweichung beim Zusammenfassen am Strich-Ende. Gemessen (r = 10, sechs Striche über eine Ecke; Zickzack r = 5):
// r/400 wölbt ≤ 0,09 mm, lässt aber mehr Knoten als vorher; r/100 spart viel, wölbt bis 0,37 mm. r/250: ≤ 0,12 mm.
const SETTLE = 1 / 250;

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const dir = (from: Point, h: Point | undefined): Point | undefined =>
  h && dist(from, h) > 1e-9 ? { x: h.x - from.x, y: h.y - from.y } : undefined;
// Symmetrisch verlangt gleich lange Anfasser; nach neuer Anpassung stimmt das nicht mehr.
const soft = (p: PathPoint): PathPoint => (p.type === 'symmetric' ? { ...p, type: 'smooth' } : p);
// Pinsel-Abfall: 1 in der Mitte, weich auf 0 am Rand.
const falloff = (d: number, r: number) => (d < r ? (1 - (d / r) ** 2) ** 2 : 0);

function near(c: Cubic, at: Point, r: number): boolean {
  const xs = c.map((p) => p.x), ys = c.map((p) => p.y);
  return at.x > Math.min(...xs) - r && at.x < Math.max(...xs) + r && at.y > Math.min(...ys) - r && at.y < Math.max(...ys) + r;
}

/** Stellen 0 < t < 1, an denen die Kurve den Kreis um at mit Radius r kreuzt, aufsteigend. Nur Stellen, deren
 *  Stück außerhalb bis zum Segmentende länger als r/2 ist: kurze Stücke weichen kaum ab (≤ 0,04 mm gemessen), und
 *  Randknoten dort blieben hinter dem Pinsel liegen und kosteten Knoten. */
function crossings(c: Cubic, at: Point, r: number): number[] {
  const f = (t: number) => dist(pointAt(c, t), at) - r;
  const poly = dist(c[0], c[1]) + dist(c[1], c[2]) + dist(c[2], c[3]);
  const steps = Math.min(512, Math.max(8, Math.ceil(poly / (r / 4))));
  const out: number[] = [];
  for (let s = 0, prev = f(0); s < steps; s++) {
    let [lo, hi] = [s / steps, (s + 1) / steps];
    const next = f(hi);
    if (prev < 0 !== next < 0) {
      for (let k = 0; k < 50; k++) {
        const mid = (lo + hi) / 2;
        if (f(mid) < 0 === prev < 0) lo = mid;
        else hi = mid;
      }
      const t = (lo + hi) / 2;
      const end = prev < 0 ? c[3] : c[0];
      if (t > 1e-6 && t < 1 - 1e-6 && dist(pointAt(c, t), end) > r / 2) out.push(t);
    }
    prev = next;
  }
  return out;
}

/** Neue Knoten, wo die Kurve den Pinselrand kreuzt (Linien bleiben Linien). */
function splitAtRim(sp: Subpath, at: Point, r: number): Subpath {
  let subs: readonly Subpath[] = [sp];
  for (let k = segmentCount(sp) - 1; k >= 0; k--) {
    const { c } = segmentAt(sp, k);
    if (!near(c, at, r)) continue;
    // Von hinten: das linke Teilstück behält Parameter 0…t, weitere Stellen werden darauf umgerechnet.
    const ts = crossings(c, at, r);
    for (let i = ts.length - 1; i >= 0; i--) subs = insertNode(subs, 0, k, i < ts.length - 1 ? ts[i] / ts[i + 1] : ts[i]);
  }
  return subs[0];
}

/** Abschnitt Knoten a → b (b darf bei geschlossenen Pfaden über n hinaus zählen); null = nichts zu glätten. */
function section(sp: Subpath, a: number, b: number, at: Point, r: number, rate: number): Cubic[] | null {
  const n = sp.nodes.length;
  const node = (i: number) => sp.nodes[i % n];
  const h = r / PER_R;
  // Dichter Linienzug (Abstand ≤ h/2), dann gleichmäßig nach Bogenlänge.
  const xs: number[] = [], ys: number[] = [], len: number[] = [];
  let total = 0;
  for (let k = a; k < b; k++) {
    const { c } = segmentAt(sp, k % n);
    const poly = dist(c[0], c[1]) + dist(c[1], c[2]) + dist(c[2], c[3]);
    const steps = Math.min(4096, Math.max(4, Math.ceil(poly / (h / 2))));
    for (let s = k === a ? 0 : 1; s <= steps; s++) {
      const q = pointAt(c, s / steps);
      if (xs.length) total += Math.hypot(q.x - xs[xs.length - 1], q.y - ys[ys.length - 1]);
      xs.push(q.x), ys.push(q.y), len.push(total);
    }
  }
  if (total < 1e-9) return null;
  const m = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil(total / h)));
  const x = new Float64Array(m + 1), y = new Float64Array(m + 1);
  for (let j = 0, i = 0; j <= m; j++) {
    const s = (total * j) / m;
    while (i < len.length - 2 && len[i + 1] < s) i++;
    const f = len[i + 1] > len[i] ? Math.min(1, (s - len[i]) / (len[i + 1] - len[i])) : 0;
    x[j] = xs[i] + (xs[i + 1] - xs[i]) * f;
    y[j] = ys[i] + (ys[i + 1] - ys[i]) * f;
  }
  const w = new Float64Array(m + 1);
  for (let j = 1; j < m; j++) w[j] = rate * falloff(Math.hypot(x[j] - at.x, y[j] - at.y), r);
  if (!w.some((v) => v > 0)) return null;

  // Taubin-Paare; sx/sy merken sich, wohin λ jede Probe gezogen hat.
  const x0 = x.slice(), y0 = y.slice();
  const dx = new Float64Array(m + 1), dy = new Float64Array(m + 1);
  const sx = new Float64Array(m + 1), sy = new Float64Array(m + 1);
  for (let step = 0; step < STEPS; step++)
    for (const f of [LAMBDA, MU]) {
      for (let j = 1; j < m; j++) {
        dx[j] = ((x[j - 1] + x[j + 1]) / 2 - x[j]) * f * w[j];
        dy[j] = ((y[j - 1] + y[j + 1]) / 2 - y[j]) * f * w[j];
      }
      for (let j = 1; j < m; j++) {
        (x[j] += dx[j]), (y[j] += dy[j]);
        if (f === LAMBDA) (sx[j] += dx[j]), (sy[j] += dy[j]);
      }
    }
  // μ darf das Schrumpfen aufheben, aber keine Probe über ihren Platz hinaus gegen die Glättrichtung schieben:
  // sonst schwingt die Kurve neben einer gerundeten Ecke über die gerade Kante (gemessen bis 0,5 mm).
  let moved = false;
  for (let j = 1; j < m; j++) {
    const ss = sx[j] * sx[j] + sy[j] * sy[j];
    const back = ss > 0 ? Math.min(0, (x[j] - x0[j]) * sx[j] + (y[j] - y0[j]) * sy[j]) / ss : 0;
    (x[j] -= back * sx[j]), (y[j] -= back * sy[j]);
    moved ||= Math.hypot(x[j] - x0[j], y[j] - y0[j]) >= r * STILL;
  }
  return moved ? fitSpan({ x, y }, 0, m, r * TOL, dir(node(a), node(a).handleOut), dir(node(b), node(b).handleIn)) : null;
}

/** Ein Tupfer bei at mit Radius r, Tempo rate (0–1]; nichts geändert → derselbe Pfad. */
export function smoothSubpath(source: Subpath, at: Point, r: number, rate: number): Subpath {
  if (source.nodes.length < 2 || !(r > 0) || !(rate > 0)) return source;
  const sp = splitAtRim(source, at, r);
  const n = sp.nodes.length;
  // Randknoten liegen bis auf Rechengenauigkeit auf dem Kreis.
  const fixed = sp.nodes.map((p, i) => dist(p, at) >= r * (1 - 1e-9) || (!sp.closed && (i === 0 || i === n - 1)));
  let anchors = fixed.flatMap((f, i) => (f ? [i] : []));
  // Geschlossener Pfad ganz im Pinsel: der entfernteste Knoten hält ihn fest.
  if (!anchors.length) anchors = [sp.nodes.reduce((best, p, i) => (dist(p, at) > dist(sp.nodes[best], at) ? i : best), 0)];
  const ends = sp.closed ? [...anchors, anchors[0] + n] : anchors;
  const node = (i: number) => sp.nodes[i % n];

  const out: PathPoint[] = [{ ...node(ends[0]) }];
  let changed = false;
  for (let k = 0; k + 1 < ends.length; k++) {
    const [a, b] = [ends[k], ends[k + 1]];
    let touched = false;
    for (let i = a; i < b && !touched; i++) touched = near(segmentAt(sp, i % n).c, at, r);
    const fit = touched ? section(sp, a, b, at, r, rate) : null;
    if (!fit) {
      for (let i = a + 1; i <= b; i++) out.push({ ...node(i) });
      continue;
    }
    changed = true;
    out[out.length - 1] = soft({ ...out[out.length - 1], handleOut: fit[0][1] });
    fit.forEach((c, i) => {
      const next = fit[i + 1];
      out.push(next ? { ...c[3], type: 'smooth', handleIn: c[2], handleOut: next[1] } : soft({ ...node(b), handleIn: c[2] }));
    });
  }
  if (!changed) return source;
  if (sp.closed) {
    const last = out.pop()!;
    out[0] = { ...out[0], handleIn: last.handleIn, type: last.type === out[0].type ? out[0].type : 'smooth' };
  }
  return { closed: sp.closed, nodes: out };
}

/** Strich-Ende: Knoten näher als r an einem Tupfer zusammenfassen (Abweichung ≤ r/250); nichts → derselbe Pfad. */
export function settleSubpath(sp: Subpath, dabs: readonly Point[], r: number): Subpath {
  const refs = sp.nodes.flatMap((p, index) => (dabs.some((d) => dist(p, d) < r) ? [{ sub: 0, index }] : []));
  return refs.length ? reduceNodes([sp], refs, r * SETTLE)[0] : sp;
}

// fn auf jeden Teilpfad der Objekte ids (Gruppen: alle Pfade und Formen darin), in Seitenkoordinaten. Formen werden
// zu Kurven, sobald sie sich ändern. Nichts geändert → dasselbe Dokument.
function onPage(doc: Doc, ids: readonly string[], fn: (sp: Subpath) => Subpath): Doc {
  const leaves = new Set<string>();
  const collect = (n: Node | undefined): void => {
    if (n?.type === 'group') n.children.forEach(collect);
    else if (n?.type === 'path' || n?.type === 'shape') leaves.add(n.id);
  };
  ids.forEach((id) => collect(findNode(doc, id)));
  let out = doc;
  for (const id of leaves) {
    const world = worldOf(doc, id);
    const n = findNode(doc, id);
    if (!world || (n?.type !== 'path' && n?.type !== 'shape')) continue;
    const path = toCurves(n) as PathNode;
    const plain = world.every((v, i) => v === IDENTITY[i]);
    let changed = false;
    const subpaths = path.subpaths.map((sp) => {
      const page = plain ? sp : transformSubpath(sp, world);
      const next = fn(page);
      if (next === page) return sp;
      changed = true;
      return plain ? next : transformSubpath(next, invert(world));
    });
    if (changed) out = updateNodes(out, [id], () => ({ ...path, subpaths }));
  }
  return out;
}

/** Tupfer auf die Objekte ids, at in Seitenkoordinaten. */
export function smoothAt(doc: Doc, ids: readonly string[], at: Point, r: number, rate: number): Doc {
  return onPage(doc, ids, (sp) => smoothSubpath(sp, at, r, rate));
}

/** Strich-Ende für die Objekte ids, Tupfer in Seitenkoordinaten. */
export function settleAt(doc: Doc, ids: readonly string[], dabs: readonly Point[], r: number): Doc {
  return onPage(doc, ids, (sp) => settleSubpath(sp, dabs, r));
}
