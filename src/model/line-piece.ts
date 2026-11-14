// Linienstück löschen: Stück einer Linie zwischen zwei Kreuzungen (mit anderen Linien oder sich selbst) entfernen.
import { nearest, pointAt, segmentAt, segmentCount, segmentsOf, splitCubic, type Cubic, type Seg } from './bezier';
import { deleteNodes, findNode, updateNodes, worldOf } from './document';
import { apply, IDENTITY, multiply, type Box, type Mat } from './geometry';
import { geometry } from './shapes';
import { toCurves } from './style';
import type { Doc, LeafNode, Node, NodeType, PathNode, PathPoint, Point, ShapeNode, Subpath } from './types';

/** Stück eines Teilpfads in Pfadkoordinaten: Segmentnummer + Lage 0–1; geschlossen darf `to` über die Segmentzahl hinausreichen. */
export interface Piece {
  id: string;
  sub: number;
  from: number;
  to: number;
}

const NEAR = 1e-3; // mm: dieselbe Stelle
const TOL = 1e-7; // mm: Teilung fertig
const END = 1e-6; // Lage: am offenen Ende

type Target = PathNode | ShapeNode;
const isTarget = (n: Node | undefined): n is Target => n?.type === 'path' || n?.type === 'shape';

// --- Schnittpunkte zweier Segmente ---

const hull = (c: Cubic) => {
  const xs = c.map((p) => p.x);
  const ys = c.map((p) => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};
type Hull = ReturnType<typeof hull>;
const apart = (a: Hull, b: Hull) => a.x0 > b.x1 || b.x0 > a.x1 || a.y0 > b.y1 || b.y0 > a.y1;
const same = (p: Point, q: Point) => p.x === q.x && p.y === q.y;
const isLine = (c: Cubic) => same(c[0], c[1]) && same(c[2], c[3]);

function lineHits(a: Cubic, b: Cubic): [number, number][] {
  const rx = a[3].x - a[0].x, ry = a[3].y - a[0].y;
  const sx = b[3].x - b[0].x, sy = b[3].y - b[0].y;
  const d = rx * sy - ry * sx;
  if (Math.abs(d) <= 1e-12 * Math.hypot(rx, ry) * Math.hypot(sx, sy)) return []; // parallel
  const qx = b[0].x - a[0].x, qy = b[0].y - a[0].y;
  const t = (qx * sy - qy * sx) / d;
  const u = (qx * ry - qy * rx) / d;
  const e = 1e-9;
  // Gerade = Kubik [P0, P0, P3, P3] → Strecken-Anteil l liegt bei t mit 3t² − 2t³ = l
  const lag = (l: number) => 0.5 - Math.sin(Math.asin(1 - 2 * Math.min(1, Math.max(0, l))) / 3);
  return t >= -e && t <= 1 + e && u >= -e && u <= 1 + e ? [[lag(t), lag(u)]] : [];
}

// Halbieren, bis beide Stücke kleiner als TOL sind; deckungsgleiche Linien sprengen das Budget → keine Kreuzung.
function curveHits(a: Cubic, b: Cubic): [number, number][] {
  const out: [number, number][] = [];
  let calls = 0;
  const go = (a: Cubic, a0: number, a1: number, b: Cubic, b0: number, b1: number): boolean => {
    if (++calls > 20000) return false;
    const A = hull(a), B = hull(b);
    if (apart(A, B)) return true;
    const sa = Math.max(A.x1 - A.x0, A.y1 - A.y0), sb = Math.max(B.x1 - B.x0, B.y1 - B.y0);
    if (sa < TOL && sb < TOL) return out.push([(a0 + a1) / 2, (b0 + b1) / 2]) > 0;
    if (sa >= sb) {
      const [l, r] = splitCubic(a, 0.5), m = (a0 + a1) / 2;
      return go(l, a0, m, b, b0, b1) && go(r, m, a1, b, b0, b1);
    }
    const [l, r] = splitCubic(b, 0.5), m = (b0 + b1) / 2;
    return go(a, a0, a1, l, b0, m) && go(a, a0, a1, r, m, b1);
  };
  return go(a, 0, 1, b, 0, 1) ? out : [];
}

// T-Stoß: Ein Ende, das auf der anderen Linie liegt, zählt als Kreuzung – auch wenn das Abschneiden es um Rundungsfehler verschoben hat.
function touches(a: Cubic, b: Cubic): [number, number][] {
  const out: [number, number][] = [];
  const ha = hull(a), hb = hull(b);
  const within = (h: Hull, q: Point) => q.x >= h.x0 - NEAR && q.x <= h.x1 + NEAR && q.y >= h.y0 - NEAR && q.y <= h.y1 + NEAR;
  for (const u of [0, 1]) {
    const r = within(ha, b[u * 3]) && nearest(a, b[u * 3]);
    if (r && r.dist < NEAR) out.push([r.t, u]);
  }
  for (const t of [0, 1]) {
    const r = within(hb, a[t * 3]) && nearest(b, a[t * 3]);
    if (r && r.dist < NEAR) out.push([t, r.t]);
  }
  return out;
}

/** Segment auf der Seite mit Hülle (um NEAR/2 vergrößert, damit Berührungen nicht durchs Raster fallen): Objekt, Teilpfad, Nummer im Teilpfad. */
type Part = { c: Cubic; h: Hull; id: string; sub: number; k: number };
const hits = (a: Part, b: Part) =>
  apart(a.h, b.h) ? [] : [...(isLine(a.c) && isLine(b.c) ? lineHits(a.c, b.c) : curveHits(a.c, b.c)), ...touches(a.c, b.c)];
const union = (a: Hull, b: Hull): Hull => ({ x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1) });

// Grobes Raster: jedes Segment wird nur gegen Segmente in denselben Zellen geprüft statt gegen alle.
function grid(parts: readonly Part[]): (h: Hull) => Iterable<Part> {
  if (parts.length < 64) return (h) => parts.filter((p) => !apart(p.h, h));
  const N = 64;
  const b = parts.reduce((acc, p) => union(acc, p.h), parts[0].h);
  const cw = (b.x1 - b.x0) / N || 1, ch = (b.y1 - b.y0) / N || 1;
  const cell = (v: number) => Math.min(N - 1, Math.max(0, Math.floor(v)));
  const span = (h: Hull) => [cell((h.x0 - b.x0) / cw), cell((h.x1 - b.x0) / cw), cell((h.y0 - b.y0) / ch), cell((h.y1 - b.y0) / ch)];
  const cells = new Map<number, Part[]>();
  for (const p of parts) {
    const [i0, i1, j0, j1] = span(p.h);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const list = cells.get(i * N + j);
      if (list) list.push(p);
      else cells.set(i * N + j, [p]);
    }
  }
  return (h) => {
    const seen = new Set<Part>();
    if (apart(h, b)) return seen;
    const [i0, i1, j0, j1] = span(h);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++)
      for (const p of cells.get(i * N + j) ?? []) if (!apart(p.h, h)) seen.add(p);
    return seen;
  };
}

// --- Kreuzungen je Teilpfad ---

type Leaf = { node: LeafNode; world: Mat };

function leaves(children: readonly Node[], world: Mat, out: Leaf[]): void {
  for (const n of children) {
    const w = multiply(world, n.transform);
    if (n.type === 'group') leaves(n.children, w, out);
    else if (n.type !== 'image') out.push({ node: n, world: w });
  }
}

const has = (children: readonly Node[], id: string): boolean =>
  children.some((n) => n.id === id || (n.type === 'group' && has(n.children, id)));

const mapCubic = (c: Cubic, m: Mat): Cubic => c.map((p) => {
  const [x, y] = apply(m, p.x, p.y);
  return { x, y };
}) as unknown as Cubic;

const partsOf = (id: string, sps: readonly Subpath[], m: Mat): Part[] =>
  sps.flatMap((sp, sub) => segmentsOf(sp).map((g, k) => {
    const c = mapCubic(g.c, m);
    const h = hull(c);
    return { c, h: { x0: h.x0 - NEAR / 2, x1: h.x1 + NEAR / 2, y0: h.y0 - NEAR / 2, y1: h.y1 + NEAR / 2 }, id, sub, k };
  }));

type Lookup = (h: Hull) => Iterable<Part>;
const pageGrids = new WeakMap<Doc, Map<number, Lookup>>();

/** Raster aller Linien auf sichtbaren Ebenen (gesperrte zählen mit) der Seite des Objekts, in Seitenkoordinaten; je Dokumentstand einmal. */
function pageGrid(doc: Doc, id: string): Lookup | null {
  const at = doc.pages.findIndex((p) => p.layers.some((l) => has(l.children, id)));
  if (at < 0) return null;
  let m = pageGrids.get(doc);
  if (!m) pageGrids.set(doc, (m = new Map()));
  let g = m.get(at);
  if (!g) {
    const ls: Leaf[] = [];
    for (const l of doc.pages[at].layers) if (l.visible) leaves(l.children, IDENTITY, ls);
    m.set(at, (g = grid(ls.flatMap((l) => partsOf(l.node.id, geometry(l.node), l.world)))));
  }
  return g;
}

// Benachbarte Segmente treffen sich immer im gemeinsamen Knoten – das ist keine Kreuzung.
function atShared(a: Part, o: Part, n: number, closed: boolean, p: Point): boolean {
  const near = (q: Point) => Math.hypot(q.x - p.x, q.y - p.y) < NEAR;
  return (o.k === a.k + 1 && near(a.c[3])) || (closed && a.k === 0 && o.k === n - 1 && near(a.c[0]));
}

function clean(found: { s: number; p: Point }[], n: number, closed: boolean): number[] {
  const xs = found
    .map((f) => ({ ...f, s: closed && f.s >= n - END ? 0 : f.s }))
    .filter((f) => closed || (f.s > END && f.s < n - END))
    .sort((a, b) => a.s - b.s);
  const out: typeof xs = [];
  for (const f of xs) {
    const last = out[out.length - 1];
    if (!last || f.s - last.s > 1e-4 || Math.hypot(f.p.x - last.p.x, f.p.y - last.p.y) >= NEAR) out.push(f);
  }
  return out.map((f) => f.s);
}

// Gerechnet wird in Seitenkoordinaten: Lagen auf Kurven bleiben unter affinen Abbildungen gleich.
function compute(doc: Doc, id: string): number[][] {
  const node = findNode(doc, id);
  const world = worldOf(doc, id);
  const page = pageGrid(doc, id);
  if (!isTarget(node) || !world || !page) return [];
  const sps = geometry(node);
  const own = partsOf(id, sps, world);
  const near = grid(own);
  return sps.map((sp, i) => {
    const n = segmentCount(sp);
    const found: { s: number; p: Point }[] = [];
    const add = (o: Part, t: number) => found.push({ s: o.k + t, p: pointAt(o.c, t) });
    for (const a of own) {
      if (a.sub !== i) continue;
      for (const o of page(a.h)) if (o.id !== id) for (const [t] of hits(a, o)) add(a, t);
      for (const o of near(a.h)) {
        if (o.sub !== i) for (const [t] of hits(a, o)) add(a, t);
        else if (o.k > a.k)
          for (const [t, u] of hits(a, o))
            if (!atShared(a, o, n, sp.closed, pointAt(a.c, t))) {
              add(a, t);
              add(o, u);
            }
      }
    }
    return clean(found, n, sp.closed);
  });
}

const cache = new WeakMap<Doc, Map<string, number[][]>>();

/** Kreuzungen je Teilpfad als sortierte Lagen (Segment + t); im Dokument zwischengespeichert. */
export function crossings(doc: Doc, id: string): number[][] {
  let m = cache.get(doc);
  if (!m) cache.set(doc, (m = new Map()));
  let r = m.get(id);
  if (!r) m.set(id, (r = compute(doc, id)));
  return r;
}

// --- Stücke ---

function piecesOf(id: string, sub: number, sp: Subpath, xs: readonly number[]): Piece[] {
  const n = segmentCount(sp);
  if (!xs.length) return [{ id, sub, from: 0, to: n }];
  const cuts = sp.closed ? [...xs, xs[0] + n] : [0, ...xs, n];
  return cuts.slice(1).map((to, i) => ({ id, sub, from: cuts[i], to }));
}

/** Stück unter der Lage s (Segment + t) des Teilpfads; null = kein Linienobjekt. */
export function pieceAt(doc: Doc, id: string, sub: number, s: number): Piece | null {
  const node = findNode(doc, id);
  const sp = isTarget(node) ? geometry(node)[sub] : undefined;
  if (!sp) return null;
  const all = piecesOf(id, sub, sp, crossings(doc, id)[sub] ?? []);
  const n = segmentCount(sp);
  return all.find((p) => (p.from <= s && s < p.to) || (p.from <= s + n && s + n < p.to)) ?? all[all.length - 1];
}

function part(c: Cubic, t0: number, t1: number): Cubic {
  let q = c;
  if (t0 > 0) q = splitCubic(q, t0)[1];
  if (t1 < 1) q = splitCubic(q, (t1 - t0) / (1 - t0))[0];
  return q;
}

function pieceCubics(sp: Subpath, a: number, b: number): { g: Seg; q: Cubic; partial: boolean }[] {
  const n = segmentCount(sp);
  if (a >= n) [a, b] = [a - n, b - n];
  const out = [];
  for (let i = Math.floor(a), last = Math.ceil(b) - 1; i <= last; i++) {
    const g = segmentAt(sp, i % n);
    const t0 = Math.max(0, a - i), t1 = Math.min(1, b - i);
    out.push({ g, q: part(g.c, t0, t1), partial: t0 > 0 || t1 < 1 });
  }
  return out;
}

/** Umriss eines Stücks auf der Seite (zum Hervorheben). */
export function pieceShape(doc: Doc, p: Piece): Cubic[] {
  const node = findNode(doc, p.id);
  const world = worldOf(doc, p.id);
  const sp = isTarget(node) ? geometry(node)[p.sub] : undefined;
  return sp && world ? pieceCubics(sp, p.from, p.to).map(({ q }) => mapCubic(q, world)) : [];
}

const point = (p: Point, type: NodeType, handleIn?: Point, handleOut?: Point): PathPoint => ({
  x: p.x,
  y: p.y,
  type,
  ...(handleIn && { handleIn }),
  ...(handleOut && { handleOut }),
});

// Offener Pfad von a bis b; Zwischenknoten behalten Art und Anfasser, neue Enden sind Ecken.
function slice(sp: Subpath, a: number, b: number): Subpath {
  const nodes: PathPoint[] = [];
  let pos: Point | null = null;
  let hIn: Point | undefined;
  let bent = false;
  for (const { g, q, partial } of pieceCubics(sp, a, b)) {
    const type = pos ? sp.nodes[g.a].type : 'corner';
    nodes.push(point(pos ?? q[0], (bent || partial) && type === 'symmetric' ? 'smooth' : type, hIn, g.line ? undefined : q[1]));
    pos = q[3];
    hIn = g.line ? undefined : q[2];
    bent = partial;
  }
  if (pos) nodes.push(point(pos, 'corner', hIn));
  return { closed: false, nodes };
}

function keep(sp: Subpath, drop: readonly Piece[]): Subpath[] {
  const n = segmentCount(sp);
  const ds = [...new Map(drop.map((p) => [`${p.from}:${p.to}`, p])).values()].sort((a, b) => a.from - b.from);
  const runs: [number, number][] = [];
  if (!sp.closed) {
    let at = 0;
    for (const p of ds) {
      if (p.from > at + END) runs.push([at, p.from]);
      at = Math.max(at, p.to);
    }
    if (at < n - END) runs.push([at, n]);
  } else {
    ds.forEach((p, i) => {
      const end = i + 1 < ds.length ? ds[i + 1].from : ds[0].from + n;
      if (end - p.to > END) runs.push([p.to, end]);
    });
  }
  return runs.map(([a, b]) => slice(sp, a, b));
}

/** Stücke entfernen: Formen werden zu Kurven, Rest bleibt im selben Objekt (Stil, Lage); nichts übrig → Objekt weg. */
export function deletePieces(doc: Doc, pieces: readonly Piece[]): Doc {
  let out = doc;
  const gone: string[] = [];
  for (const id of new Set(pieces.map((p) => p.id))) {
    const node = findNode(doc, id);
    if (!isTarget(node)) continue;
    const path = toCurves(node) as PathNode;
    const mine = pieces.filter((p) => p.id === id);
    const subpaths = path.subpaths.flatMap((sp, i) => {
      const drop = mine.filter((p) => p.sub === i);
      return drop.length ? keep(sp, drop) : [sp];
    });
    if (subpaths.length) out = updateNodes(out, [id], () => ({ ...path, subpaths }));
    else gone.push(id);
  }
  return gone.length ? deleteNodes(out, gone) : out;
}

// Liang-Barsky: Strecke p–q berührt den Rahmen?
function crossesBox(p: Point, q: Point, b: Box): boolean {
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  for (const [pk, qk] of [[-dx, p.x - b.minX], [dx, b.maxX - p.x], [-dy, p.y - b.minY], [dy, b.maxY - p.y]]) {
    if (pk === 0) {
      if (qk < 0) return false;
      continue;
    }
    const r = qk / pk;
    if (pk < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return true;
}

/** Alle Stücke der Objekte, die den Rahmen (Seitenkoordinaten) berühren oder darin liegen. */
export function piecesIn(doc: Doc, ids: readonly string[], box: Box): Piece[] {
  return ids.flatMap((id) => {
    const node = findNode(doc, id);
    if (!isTarget(node)) return [];
    const xs = crossings(doc, id);
    return geometry(node).flatMap((sp, sub) =>
      piecesOf(id, sub, sp, xs[sub] ?? []).filter((p) => {
        const pts = pieceShape(doc, p).flatMap((c) => Array.from({ length: 17 }, (_, k) => pointAt(c, k / 16)));
        return pts.some((q, k) => k > 0 && crossesBox(pts[k - 1], q, box));
      }),
    );
  });
}
