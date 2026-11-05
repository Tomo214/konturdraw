// Fangen wie Vorbild: Knoten, Kantenmitten, Mittelpunkt und Kante von Objekten; dazu Hilfslinien und Raster je Achse.
// Reihenfolge: Punktziel vor Kante vor Hilfslinie vor Raster; innerhalb einer Stufe gewinnt das nächste Ziel.
import { cubicBounds, nearest, pointAt, segmentsOf, subpathBounds, transformSubpath, type Cubic } from '../model/bezier';
import type { Guide, Point } from '../model/types';
import type { SceneItem } from './scene';

export type SnapKind = 'node' | 'midpoint' | 'center' | 'edge' | 'guide' | 'grid';
export interface Snap {
  x: number;
  y: number;
  kind: SnapKind;
}
export interface SnapTo {
  objects: boolean;
  grid: boolean;
  guides: boolean;
}
export interface SnapWorld {
  items: readonly SceneItem[];
  /** Oberste Objekte und Hilfslinien, an denen nicht gefangen wird (die gerade bewegten). */
  skip?: ReadonlySet<string>;
  /** Sichtbare Hilfslinien. */
  guides: readonly Guide[];
  grid: { x: number; y: number };
  /** Nullpunkt in Seiten-mm; durch ihn laufen die Rasterlinien. */
  origin: Point;
}

/** Fangradius in Bildschirmpixeln. */
export const SNAP_PX = 10;

interface Targets {
  points: readonly Snap[];
  curves: readonly Cubic[];
}
const cache = new WeakMap<SceneItem, Targets>();

// Text fängt nur am Mittelpunkt: Glyphenknoten wären Rauschen.
function targetsOf(it: SceneItem): Targets {
  const hit = cache.get(it);
  if (hit) return hit;
  const world = it.subpaths.map((sp) => transformSubpath(sp, it.world));
  const points: Snap[] = [];
  const curves: Cubic[] = [];
  if (it.node.type !== 'text') {
    for (const sp of world) {
      for (const n of sp.nodes) points.push({ x: n.x, y: n.y, kind: 'node' });
      for (const { c } of segmentsOf(sp)) {
        const m = pointAt(c, 0.5);
        points.push({ x: m.x, y: m.y, kind: 'midpoint' });
        curves.push(c);
      }
    }
  }
  const b = subpathBounds(world);
  if (b) points.push({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, kind: 'center' });
  const t = { points, curves };
  cache.set(it, t);
  return t;
}

const near = (b: { minX: number; minY: number; maxX: number; maxY: number }, x: number, y: number, tol: number) =>
  x >= b.minX - tol && x <= b.maxX + tol && y >= b.minY - tol && y <= b.maxY + tol;

function objectSnap(x: number, y: number, tol: number, w: SnapWorld): Snap | null {
  let point: Snap | null = null;
  let pd = tol;
  let edge: Point | null = null;
  let ed = tol;
  for (const it of w.items) {
    if (!near(it, x, y, tol) || (w.skip && it.chain.some((id) => w.skip!.has(id)))) continue;
    const t = targetsOf(it);
    for (const p of t.points) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= pd) [point, pd] = [p, d];
    }
    // Kanten zählen nur, solange kein Punktziel gefunden ist.
    if (point) continue;
    for (const c of t.curves) {
      if (!near(cubicBounds(c), x, y, tol)) continue;
      const n = nearest(c, { x, y });
      if (n.dist <= ed) [edge, ed] = [n.point, n.dist];
    }
  }
  if (point) return { x: point.x, y: point.y, kind: point.kind };
  return edge && { x: edge.x, y: edge.y, kind: 'edge' };
}

function axisSnap(v: number, tol: number, lines: readonly number[], origin: number, step: number | null) {
  let best: number | null = null;
  let d = tol;
  for (const g of lines) if (Math.abs(g - v) <= d) [best, d] = [g, Math.abs(g - v)];
  if (best !== null) return { v: best, kind: 'guide' as const };
  if (!step) return null;
  const g = origin + Math.round((v - origin) / step) * step;
  return Math.abs(g - v) <= tol ? { v: g, kind: 'grid' as const } : null;
}

/** Gefangener Seitenpunkt zu (x, y) in mm, tol in mm; null = nichts in Reichweite. */
export function snapPoint(x: number, y: number, tol: number, to: SnapTo, w: SnapWorld): Snap | null {
  const hit = to.objects ? objectSnap(x, y, tol, w) : null;
  if (hit) return hit;
  const lines = (axis: Guide['axis']) => (to.guides ? w.guides.filter((g) => g.axis === axis && !w.skip?.has(g.id)).map((g) => g.pos) : []);
  const sx = axisSnap(x, tol, lines('v'), w.origin.x, to.grid ? w.grid.x : null);
  const sy = axisSnap(y, tol, lines('h'), w.origin.y, to.grid ? w.grid.y : null);
  if (!sx && !sy) return null;
  return { x: sx?.v ?? x, y: sy?.v ?? y, kind: sx?.kind === 'guide' || sy?.kind === 'guide' ? 'guide' : 'grid' };
}
