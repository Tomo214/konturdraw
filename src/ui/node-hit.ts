import { nearest, segmentsOf, transformSubpath } from '../model/bezier';
import { apply, multiply, type Mat } from '../model/geometry';
import type { NodeRef } from '../model/path-edit';
import type { Point, Subpath } from '../model/types';
import { toScreen, type Viewport } from '../render/viewport';

export type PathHit =
  | { kind: 'node' | 'in' | 'out'; ref: NodeRef }
  | { kind: 'seg'; sub: number; seg: number; t: number };

export const nodeKey = (r: NodeRef) => `${r.sub}:${r.index}`;

/** Treffer in Bildschirm-Pixeln. Vorrang: Anfasser gewählter Knoten, dann Knoten, dann nächstes Segment. */
export function hitPath(
  subpaths: readonly Subpath[],
  world: Mat,
  vp: Viewport,
  sx: number,
  sy: number,
  selected: ReadonlySet<string>,
  tolPx = 6,
): PathHit | null {
  const m = multiply(toScreen(vp), world);
  const near = (p: Point) => {
    const [x, y] = apply(m, p.x, p.y);
    return Math.hypot(x - sx, y - sy) <= tolPx;
  };
  for (const [s, sp] of subpaths.entries()) {
    for (const [index, n] of sp.nodes.entries()) {
      if (!selected.has(nodeKey({ sub: s, index }))) continue;
      if (n.handleIn && near(n.handleIn)) return { kind: 'in', ref: { sub: s, index } };
      if (n.handleOut && near(n.handleOut)) return { kind: 'out', ref: { sub: s, index } };
    }
  }
  for (const [s, sp] of subpaths.entries()) {
    const index = sp.nodes.findIndex(near);
    if (index >= 0) return { kind: 'node', ref: { sub: s, index } };
  }
  let best: PathHit | null = null;
  let bestDist = tolPx;
  for (const [s, sp] of subpaths.entries()) {
    for (const [seg, { c }] of segmentsOf(transformSubpath(sp, m)).entries()) {
      const r = nearest(c, { x: sx, y: sy });
      if (r.dist <= bestDist) [best, bestDist] = [{ kind: 'seg', sub: s, seg, t: r.t }, r.dist];
    }
  }
  return best;
}
