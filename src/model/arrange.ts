// Maße, Ausrichten und Verteilen der Auswahl (Eigenschaftsleiste, Andockfenster, Tasten L/R/T/B/C/E/P).
// Alles in Seitenkoordinaten (mm, y nach unten); ids = gewählte Objekte, auch Kinder in Gruppen. null = nichts zu tun, kein Rückgängig-Schritt.
import { subpathBounds } from './bezier';
import { findNode, transformEach, transformNodes, worldOf } from './document';
import { IDENTITY, about, multiply, rotate, scale, skew, translate, type Box, type Mat } from './geometry';
import { geometry } from './shapes';
import type { Doc, Node } from './types';

export type AlignEdge = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom' | 'page';
/** objects = am zuletzt gewählten Objekt (ein einzelnes Objekt: an der Seite). */
export type AlignTo = 'objects' | 'page' | 'pageCenter';
export type DistributeMode = 'left' | 'centerX' | 'right' | 'spacingX' | 'top' | 'centerY' | 'bottom' | 'spacingY';
export type DistributeTo = 'selection' | 'page';
/** x/y = Mitte, w/h = Größe in mm, sx/sy in %, angle in Grad gegen den Uhrzeigersinn;
 *  skewH/skewV = relativ neigen in Grad, gleiche Drehrichtung (Feld zeigt immer 0). */
export type Field = 'x' | 'y' | 'w' | 'h' | 'sx' | 'sy' | 'angle' | 'skewH' | 'skewV';

export interface Measure {
  box: Box;
  /** Ein Objekt: Skalierung seit dem Zeichnen (%); mehrere: 100. */
  scale: readonly [number, number];
  /** Ein Objekt: Drehung (Grad, gegen den Uhrzeigersinn, 0…360); mehrere: 0. */
  angle: number;
}

const union = (a: Box | null, b: Box | null): Box | null =>
  !a ? b : !b ? a : { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };

/** Enge Box der Kurven (ohne Konturbreite), wie die Griffe. */
export function nodeBounds(node: Node, parent: Mat = IDENTITY): Box | null {
  return boundsAt(node, multiply(parent, node.transform));
}

// world = Lage des Objekts selbst auf der Seite.
function boundsAt(node: Node, world: Mat): Box | null {
  if (node.type === 'group') return node.children.reduce<Box | null>((b, c) => union(b, nodeBounds(c, world)), null);
  return subpathBounds(geometry(node), world);
}

function boxes(doc: Doc, ids: readonly string[]): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const id of ids) {
    const [n, w] = [findNode(doc, id), worldOf(doc, id)];
    const b = n && w && boundsAt(n, w);
    if (b) out.set(id, b);
  }
  return out;
}

const all = (m: Map<string, Box>) => [...m.values()].reduce<Box | null>(union, null);
const cx = (b: Box) => (b.minX + b.maxX) / 2;
const cy = (b: Box) => (b.minY + b.maxY) / 2;
const deg = (rad: number) => (rad * 180) / Math.PI;

export function measure(doc: Doc, ids: readonly string[]): Measure | null {
  const box = all(boxes(doc, ids));
  if (!box) return null;
  const m = ids.length === 1 ? worldOf(doc, ids[0]) : null;
  if (!m) return { box, scale: [100, 100], angle: 0 };
  // y zeigt nach unten: mathematisch positiv = im Uhrzeigersinn, daher Vorzeichen tauschen.
  const angle = (((-deg(Math.atan2(m[1], m[0])) % 360) + 360) % 360) % 360;
  return { box, scale: [Math.hypot(m[0], m[1]) * 100, Math.hypot(m[2], m[3]) * 100], angle: Math.abs(angle) < 1e-9 ? 0 : angle };
}

const nearIdentity = (m: Mat) => m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9);
const apply = (doc: Doc, ids: readonly string[], m: Mat) => (nearIdentity(m) ? null : transformNodes(doc, ids, m));
// Faktor gegen 0 geschützt: eine Linie ohne Höhe lässt sich nicht auf Höhe bringen.
const factor = (to: number, from: number) => (from > 1e-9 ? to / from : NaN);

/** Ein Maßfeld der Eigenschaftsleiste; locked = Seitenverhältnis halten. */
export function setField(doc: Doc, ids: readonly string[], field: Field, value: number, locked: boolean): Doc | null {
  const ms = measure(doc, ids);
  if (!ms) return null;
  const { box } = ms;
  const [w, h] = [box.maxX - box.minX, box.maxY - box.minY];
  let sx = 1;
  let sy = 1;
  switch (field) {
    case 'x': return apply(doc, ids, translate(value - cx(box), 0));
    case 'y': return apply(doc, ids, translate(0, value - cy(box)));
    case 'angle': return apply(doc, ids, about(rotate(((ms.angle - value) * Math.PI) / 180), cx(box), cy(box)));
    case 'skewH':
    case 'skewV': {
      if (!(Math.abs(value) < 90)) return null; // 90° = flach, nicht umkehrbar
      const k = Math.tan((value * Math.PI) / 180);
      // y zeigt nach unten: waagerecht kippt die Oberkante nach links, senkrecht hebt die rechte Kante.
      return apply(doc, ids, about(field === 'skewH' ? skew(k, 0) : skew(0, -k), cx(box), cy(box)));
    }
    case 'w': sx = factor(value, w); sy = locked ? sx : 1; break;
    case 'h': sy = factor(value, h); sx = locked ? sy : 1; break;
    case 'sx': sx = factor(value, ms.scale[0]); sy = locked ? sx : 1; break;
    case 'sy': sy = factor(value, ms.scale[1]); sx = locked ? sy : 1; break;
  }
  if (!(Number.isFinite(sx) && Number.isFinite(sy) && sx > 0 && sy > 0)) return null;
  return apply(doc, ids, about(scale(sx, sy), cx(box), cy(box)));
}

/** h = links ↔ rechts, v = oben ↔ unten; um die Mitte der Auswahl. */
export function mirror(doc: Doc, ids: readonly string[], axis: 'h' | 'v'): Doc | null {
  const box = all(boxes(doc, ids));
  return box && transformNodes(doc, ids, about(axis === 'h' ? scale(-1, 1) : scale(1, -1), cx(box), cy(box)));
}

// Jedes Objekt um seinen eigenen Versatz; unbewegte bleiben unberührt.
function moveEach(doc: Doc, moves: Map<string, [number, number]>): Doc | null {
  for (const [id, [dx, dy]] of moves) if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) moves.delete(id);
  if (!moves.size) return null;
  return transformEach(doc, new Map([...moves].map(([id, [dx, dy]]) => [id, translate(dx, dy)])));
}

const pageBox = (doc: Doc): Box => ({ minX: 0, minY: 0, maxX: doc.pages[0].width, maxY: doc.pages[0].height });

export function align(doc: Doc, ids: readonly string[], edge: AlignEdge, to: AlignTo = 'objects'): Doc | null {
  const bs = boxes(doc, ids);
  if (!bs.size) return null;
  const page = pageBox(doc);
  const last = ids[ids.length - 1];
  const ref =
    edge === 'page' || to === 'page' || (to === 'objects' && bs.size === 1)
      ? page
      : to === 'pageCenter'
        ? { minX: cx(page), minY: cy(page), maxX: cx(page), maxY: cy(page) }
        : bs.get(last);
  if (!ref) return null;
  const moves = new Map<string, [number, number]>();
  for (const [id, b] of bs) {
    if (to === 'objects' && bs.size > 1 && id === last && edge !== 'page') continue;
    const d: Record<AlignEdge, [number, number]> = {
      left: [ref.minX - b.minX, 0],
      right: [ref.maxX - b.maxX, 0],
      centerX: [cx(ref) - cx(b), 0],
      top: [0, ref.minY - b.minY],
      bottom: [0, ref.maxY - b.maxY],
      centerY: [0, cy(ref) - cy(b)],
      page: [cx(page) - cx(b), cy(page) - cy(b)],
    };
    moves.set(id, d[edge]);
  }
  return moveEach(doc, moves);
}

type Axis = 'x' | 'y';
const lo = (b: Box, a: Axis) => (a === 'x' ? b.minX : b.minY);
const hi = (b: Box, a: Axis) => (a === 'x' ? b.maxX : b.maxY);

/**
 * Bezugspunkte gleichmäßig verteilen. Auswahl: äußerste Bezugspunkte bleiben stehen.
 * Seite: das erste Objekt rückt an den Seitenanfang, das letzte an das Seitenende.
 */
export function distribute(doc: Doc, ids: readonly string[], mode: DistributeMode, to: DistributeTo = 'selection'): Doc | null {
  const bs = boxes(doc, ids);
  if (bs.size < 2) return null;
  const axis: Axis = /X$|left|right/.test(mode) ? 'x' : 'y';
  const anchor = (b: Box) =>
    mode === 'left' || mode === 'top' ? lo(b, axis) : mode === 'right' || mode === 'bottom' ? hi(b, axis) : (lo(b, axis) + hi(b, axis)) / 2;
  const extent = to === 'page' ? pageBox(doc) : all(bs)!;
  const items = [...bs].sort((a, b) => (mode.startsWith('spacing') ? lo(a[1], axis) - lo(b[1], axis) : anchor(a[1]) - anchor(b[1])));
  const n = items.length;
  const targets: number[] = [];
  if (mode.startsWith('spacing')) {
    // Gleiche Lücken: Objekte der Reihe nach von links bzw. oben anlegen.
    const total = items.reduce((s, [, b]) => s + hi(b, axis) - lo(b, axis), 0);
    const gap = (hi(extent, axis) - lo(extent, axis) - total) / (n - 1);
    let pos = lo(extent, axis);
    for (const [, b] of items) {
      targets.push(pos - lo(b, axis));
      pos += hi(b, axis) - lo(b, axis) + gap;
    }
  } else {
    const [first, lastBox] = [items[0][1], items[n - 1][1]];
    const start = to === 'page' ? anchor(first) + lo(extent, axis) - lo(first, axis) : anchor(first);
    const end = to === 'page' ? anchor(lastBox) + hi(extent, axis) - hi(lastBox, axis) : anchor(lastBox);
    items.forEach(([, b], i) => targets.push(start + ((end - start) * i) / (n - 1) - anchor(b)));
  }
  const moves = new Map<string, [number, number]>();
  items.forEach(([id], i) => moves.set(id, axis === 'x' ? [targets[i], 0] : [0, targets[i]]));
  return moveEach(doc, moves);
}
