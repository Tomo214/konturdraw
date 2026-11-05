import type { PathPoint, Point, Subpath } from '../model/types';

// Stift: Klick = Eckpunkt, Ziehen = symmetrischer Kurvenpunkt, Klick auf den Start = schließen.

export interface Pen {
  nodes: readonly PathPoint[];
}

export const emptyPen: Pen = { nodes: [] };

/** tol = Fangradius für den Startpunkt (Seitenkoordinaten). done ≠ null: Pfad fertig, Stift leer. */
export function penDown(pen: Pen, p: Point, tol: number): { pen: Pen; done: Subpath | null } {
  const first = pen.nodes[0];
  if (pen.nodes.length >= 2 && Math.hypot(p.x - first.x, p.y - first.y) <= tol) {
    return { pen: emptyPen, done: { closed: true, nodes: pen.nodes } };
  }
  return { pen: { nodes: [...pen.nodes, { x: p.x, y: p.y, type: 'corner' }] }, done: null };
}

export function penDrag(pen: Pen, p: Point): Pen {
  const last = pen.nodes[pen.nodes.length - 1];
  if (!last) return pen;
  const node: PathPoint = { ...last, type: 'symmetric', handleOut: p, handleIn: { x: 2 * last.x - p.x, y: 2 * last.y - p.y } };
  return { nodes: [...pen.nodes.slice(0, -1), node] };
}

export function penFinish(pen: Pen): Subpath | null {
  return pen.nodes.length >= 2 ? { closed: false, nodes: pen.nodes } : null;
}
