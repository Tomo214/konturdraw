import { pointAt, segmentAt, type Cubic } from './bezier';
import { fitOne, type Samples } from './fit';
import type { NodeRef } from './path-edit';
import type { PathPoint, Point, Subpath } from './types';

// Knoten reduzieren: Knoten fallen weg, die übrigen bleiben an Ort und Stelle und behalten ihre Richtung.
// Fest bleiben Ecken, Enden offener Pfade und – bei Knotenauswahl – alle nicht gewählten Knoten.

const SAMPLES = 8; // Stützpunkte je Originalsegment

const dir = (from: Point, h: Point | undefined): Point | undefined =>
  h && Math.hypot(h.x - from.x, h.y - from.y) > 1e-9 ? { x: h.x - from.x, y: h.y - from.y } : undefined;

// Symmetrisch verlangt gleich lange Anfasser; nach neuer Anpassung stimmt das nicht mehr.
const soft = (p: PathPoint): PathPoint => (p.type === 'symmetric' ? { ...p, type: 'smooth' } : p);

function reduceSub(sp: Subpath, fixed: boolean[], tol: number): Subpath {
  const n = sp.nodes.length;
  const anchors = fixed.flatMap((f, i) => (f ? [i] : []));
  if (anchors.length === n) return sp;
  const ends = sp.closed ? [...anchors, anchors[0] + n] : anchors;
  const node = (i: number) => sp.nodes[i % n];

  // Original einmal abtasten: Knoten k liegt bei Index k·SAMPLES (geschlossen bis über den Start hinaus).
  const top = ends[ends.length - 1];
  const p: Samples = { x: new Float64Array(top * SAMPLES + 1), y: new Float64Array(top * SAMPLES + 1) };
  const put = (at: number, q: Point) => ((p.x[at] = q.x), (p.y[at] = q.y));
  for (let k = 0; k <= top; k++) put(k * SAMPLES, node(k));
  for (let k = 0; k < top; k++) {
    const { c } = segmentAt(sp, k % n);
    for (let s = 1; s < SAMPLES; s++) put(k * SAMPLES + s, pointAt(c, s / SAMPLES));
  }

  // Eine Kurve für Originalknoten i → j, null = zu ungenau.
  const fit = (i: number, j: number): Cubic | null =>
    fitOne(p, i * SAMPLES, j * SAMPLES, tol, dir(node(i), node(i).handleOut), dir(node(j), node(j).handleIn));

  // Je Abschnitt zwischen festen Knoten: so weit wie möglich mit einer Kurve (galoppieren, dann halbieren).
  const pieces: { to: number; c: Cubic | null }[] = [];
  for (let k = 0; k + 1 < ends.length; k++) {
    const b = ends[k + 1];
    for (let i = ends[k]; i < b; ) {
      let [good, bad, best] = [i + 1, b + 1, null as Cubic | null];
      for (let step = 2; bad > b && good < b; step *= 2) {
        const j = Math.min(i + step, b);
        const c = fit(i, j);
        if (c) [good, best] = [j, c];
        else bad = j;
      }
      while (bad - good > 1) {
        const mid = (good + bad) >> 1;
        const c = fit(i, mid);
        if (c) [good, best] = [mid, c];
        else bad = mid;
      }
      pieces.push({ to: good, c: best });
      i = good;
    }
  }
  if (pieces.length === ends[ends.length - 1] - ends[0]) return sp;

  const nodes: PathPoint[] = [{ ...node(ends[0]) }];
  for (const { to, c } of pieces) {
    if (c) nodes[nodes.length - 1] = soft({ ...nodes[nodes.length - 1], handleOut: c[1] });
    nodes.push(c ? soft({ ...node(to), handleIn: c[2] }) : { ...node(to) });
  }
  if (sp.closed) {
    const last = nodes.pop()!;
    nodes[0] = last.handleIn === node(ends[0]).handleIn ? nodes[0] : soft({ ...nodes[0], handleIn: last.handleIn });
  }
  return { closed: sp.closed, nodes };
}

/** Knoten reduzieren (Abweichung ≤ tol in Pfad-Einheiten); refs = gewählte Knoten oder null = ganzer Pfad.
 *  Nichts zu holen → dasselbe Array (kein leerer Rückgängig-Schritt). */
export function reduceNodes(sps: readonly Subpath[], refs: readonly NodeRef[] | null, tol: number): readonly Subpath[] {
  if (!(tol > 0)) return sps;
  const picked = refs && new Set(refs.map((r) => `${r.sub}:${r.index}`));
  let changed = false;
  const out = sps.map((sp, s) => {
    const last = sp.nodes.length - 1;
    const fixed = sp.nodes.map((p, i) => p.type === 'corner' || (!sp.closed && (i === 0 || i === last)) || (!!picked && !picked.has(`${s}:${i}`)));
    if (sp.closed && !fixed.includes(true)) fixed[0] = true;
    const next = sp.nodes.length > 2 ? reduceSub(sp, fixed, tol) : sp;
    changed ||= next !== sp;
    return next;
  });
  return changed ? out : sps;
}
