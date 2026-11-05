import { segmentAt, splitCubic } from './bezier';
import type { NodeType, PathPoint, Point, Subpath } from './types';

// Knoten-Operationen auf den Teilpfaden eines Pfads (Pfad-Koordinaten). Alles rein funktional.

export interface NodeRef {
  sub: number;
  index: number;
}

type Subs = readonly Subpath[];

const key = (s: number, i: number) => `${s}:${i}`;
const same = (p: Point, q: Point) => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;

function replace(sps: Subs, index: number, items: Subpath[]): Subs {
  return [...sps.slice(0, index), ...items, ...sps.slice(index + 1)];
}

function mapNode(sps: Subs, ref: NodeRef, fn: (n: PathPoint, sp: Subpath) => PathPoint): Subs {
  const sp = sps[ref.sub];
  return replace(sps, ref.sub, [{ ...sp, nodes: sp.nodes.map((n, i) => (i === ref.index ? fn(n, sp) : n)) }]);
}

// Endknoten verlieren einen Anfasser; „glatt“ ergibt dann keinen Sinn mehr.
function dropHandle(n: PathPoint, k: 'handleIn' | 'handleOut'): PathPoint {
  const r: PathPoint = { ...n, type: 'corner' };
  delete r[k];
  return r;
}

function reversed(nodes: readonly PathPoint[]): PathPoint[] {
  return [...nodes].reverse().map((n) => {
    const r: PathPoint = { x: n.x, y: n.y, type: n.type };
    if (n.handleOut) r.handleIn = n.handleOut;
    if (n.handleIn) r.handleOut = n.handleIn;
    return r;
  });
}

export function moveNodes(sps: Subs, refs: readonly NodeRef[], dx: number, dy: number): Subs {
  const hit = new Set(refs.map((r) => key(r.sub, r.index)));
  const mv = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  return sps.map((sp, s) =>
    refs.some((r) => r.sub === s)
      ? {
          ...sp,
          nodes: sp.nodes.map((n, i) => {
            if (!hit.has(key(s, i))) return n;
            const out: PathPoint = { ...n, ...mv(n) };
            if (n.handleIn) out.handleIn = mv(n.handleIn);
            if (n.handleOut) out.handleOut = mv(n.handleOut);
            return out;
          }),
        }
      : sp,
  );
}

/** Ecke: Gegenseite bleibt · glatt: Gegenseite kollinear mit eigener Länge · symmetrisch: gespiegelt. */
export function moveHandle(sps: Subs, ref: NodeRef, which: 'in' | 'out', p: Point): Subs {
  const own = which === 'in' ? 'handleIn' : 'handleOut';
  const other = which === 'in' ? 'handleOut' : 'handleIn';
  return mapNode(sps, ref, (n) => {
    const out: PathPoint = { ...n, [own]: p };
    const o = n[other];
    const d = Math.hypot(p.x - n.x, p.y - n.y);
    if (n.type === 'symmetric') out[other] = { x: 2 * n.x - p.x, y: 2 * n.y - p.y };
    else if (n.type === 'smooth' && o && d > 0) {
      const len = Math.hypot(o.x - n.x, o.y - n.y);
      out[other] = { x: n.x - ((p.x - n.x) / d) * len, y: n.y - ((p.y - n.y) / d) * len };
    }
    return out;
  });
}

/** Glatt/symmetrisch richtet die Anfasser aus; fehlende entstehen entlang der Nachbar-Tangente (⅓ Abstand). */
export function setNodeType(sps: Subs, ref: NodeRef, type: NodeType): Subs {
  return mapNode(sps, ref, (n, sp) => {
    if (type === 'corner') return { ...n, type };
    const ns = sp.nodes;
    const i = ref.index;
    const prev = i > 0 || sp.closed ? ns[(i - 1 + ns.length) % ns.length] : undefined;
    const next = i < ns.length - 1 || sp.closed ? ns[(i + 1) % ns.length] : undefined;
    const from = n.handleIn ?? prev ?? n;
    const to = n.handleOut ?? next ?? n;
    const dir = n.handleOut ? { x: to.x - n.x, y: to.y - n.y } : n.handleIn ? { x: n.x - from.x, y: n.y - from.y } : { x: to.x - from.x, y: to.y - from.y };
    const d = Math.hypot(dir.x, dir.y);
    if (d === 0) return { ...n, type };
    const len = (h: Point | undefined, q: Point | undefined) =>
      h ? Math.hypot(h.x - n.x, h.y - n.y) : q ? Math.hypot(q.x - n.x, q.y - n.y) / 3 : 0;
    let li = len(n.handleIn, prev);
    let lo = len(n.handleOut, next);
    if (type === 'symmetric') li = lo = (li + lo) / 2;
    const [ux, uy] = [dir.x / d, dir.y / d];
    return { ...n, type, handleIn: { x: n.x - ux * li, y: n.y - uy * li }, handleOut: { x: n.x + ux * lo, y: n.y + uy * lo } };
  });
}

/** Neuer Knoten bei t auf Segment seg; Kurven werden formtreu geteilt. */
export function insertNode(sps: Subs, s: number, seg: number, t: number): Subs {
  const sp = sps[s];
  const { a, b, line, c } = segmentAt(sp, seg);
  const nodes = [...sp.nodes];
  if (line) {
    const p = { x: c[0].x + (c[3].x - c[0].x) * t, y: c[0].y + (c[3].y - c[0].y) * t };
    nodes.splice(a + 1, 0, { ...p, type: 'corner' });
  } else {
    const [l, r] = splitCubic(c, t);
    nodes[a] = { ...nodes[a], handleOut: l[1] };
    nodes[b] = { ...nodes[b], handleIn: r[2] };
    nodes.splice(a + 1, 0, { x: l[3].x, y: l[3].y, type: 'smooth', handleIn: l[2], handleOut: r[1] });
  }
  return replace(sps, s, [{ ...sp, nodes }]);
}

/** Entfernt Knoten; Anfasser der Nachbarn bleiben. Teilpfade unter zwei Knoten fallen weg. */
export function deleteNodes(sps: Subs, refs: readonly NodeRef[]): Subs {
  const hit = new Set(refs.map((r) => key(r.sub, r.index)));
  return sps.map((sp, s) => ({ ...sp, nodes: sp.nodes.filter((_, i) => !hit.has(key(s, i))) })).filter((sp) => sp.nodes.length >= 2);
}

export function toLine(sps: Subs, s: number, seg: number): Subs {
  const sp = sps[s];
  const { a, b } = segmentAt(sp, seg);
  const nodes = [...sp.nodes];
  nodes[a] = dropHandle(nodes[a], 'handleOut');
  nodes[b] = dropHandle(nodes[b], 'handleIn');
  return replace(sps, s, [{ ...sp, nodes }]);
}

export function toCurve(sps: Subs, s: number, seg: number): Subs {
  const sp = sps[s];
  const { a, b, line } = segmentAt(sp, seg);
  if (!line) return sps;
  const [p, q] = [sp.nodes[a], sp.nodes[b]];
  const nodes = [...sp.nodes];
  nodes[a] = { ...p, handleOut: { x: p.x + (q.x - p.x) / 3, y: p.y + (q.y - p.y) / 3 } };
  nodes[b] = { ...nodes[b], handleIn: { x: p.x + (2 * (q.x - p.x)) / 3, y: p.y + (2 * (q.y - p.y)) / 3 } };
  return replace(sps, s, [{ ...sp, nodes }]);
}

/** Geschlossen → offen ab diesem Knoten; offen → zwei Teilpfade. Endknoten offener Pfade: keine Änderung. */
export function breakAt(sps: Subs, ref: NodeRef): Subs {
  const sp = sps[ref.sub];
  const n = sp.nodes;
  const i = ref.index;
  if (sp.closed) {
    const rot = [...n.slice(i), ...n.slice(0, i)];
    const nodes = [dropHandle(rot[0], 'handleIn'), ...rot.slice(1), dropHandle(n[i], 'handleOut')];
    return replace(sps, ref.sub, [{ closed: false, nodes }]);
  }
  if (i === 0 || i === n.length - 1) return sps;
  return replace(sps, ref.sub, [
    { closed: false, nodes: [...n.slice(0, i), dropHandle(n[i], 'handleOut')] },
    { closed: false, nodes: [dropHandle(n[i], 'handleIn'), ...n.slice(i + 1)] },
  ]);
}

/** Verbindet zwei Endknoten offener Pfade: gleicher Teilpfad → schließen, sonst aneinanderhängen. Deckungsgleich → ein Knoten. */
export function joinEnds(sps: Subs, a: NodeRef, b: NodeRef): Subs {
  const A = sps[a.sub];
  const B = sps[b.sub];
  const isEnd = (sp: Subpath, i: number) => !sp.closed && (i === 0 || i === sp.nodes.length - 1);
  if (!isEnd(A, a.index) || !isEnd(B, b.index) || (a.sub === b.sub && a.index === b.index)) {
    throw new Error('Verbinden geht nur mit zwei Endknoten offener Pfade');
  }
  if (a.sub === b.sub) {
    const nodes = [...A.nodes];
    const last = nodes[nodes.length - 1];
    if (nodes.length > 2 && same(nodes[0], last)) {
      nodes.pop();
      if (last.handleIn) nodes[0] = { ...nodes[0], handleIn: last.handleIn };
    }
    return replace(sps, a.sub, [{ closed: true, nodes }]);
  }
  const head = a.index === 0 ? reversed(A.nodes) : [...A.nodes]; // endet bei a
  const tail = b.index === 0 ? [...B.nodes] : reversed(B.nodes); // beginnt bei b
  const end = head[head.length - 1];
  const start = tail[0];
  let nodes: PathPoint[];
  if (same(end, start)) {
    const merged: PathPoint = { x: end.x, y: end.y, type: 'corner' };
    if (end.handleIn) merged.handleIn = end.handleIn;
    if (start.handleOut) merged.handleOut = start.handleOut;
    nodes = [...head.slice(0, -1), merged, ...tail.slice(1)];
  } else nodes = [...head, ...tail];
  const [lo, hi] = [Math.min(a.sub, b.sub), Math.max(a.sub, b.sub)];
  return sps.flatMap((sp, i) => (i === lo ? [{ closed: false, nodes }] : i === hi ? [] : [sp]));
}

export function setClosed(sps: Subs, s: number, closed: boolean): Subs {
  return replace(sps, s, [{ ...sps[s], closed }]);
}
