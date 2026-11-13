import { pointAt, segmentsOf } from './bezier';
import { apply, type Box, type Mat } from './geometry';
import type { Point, Subpath } from './types';

// Freihand-Auswahl: liegt ein Umriss ganz in einer frei gezogenen, geschlossenen Spur?

/** Gerade-ungerade-Regel; die Spur gilt als geschlossen. */
export function pointInPolygon(x: number, y: number, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polygonBox(poly: readonly Point[]): Box | null {
  if (poly.length < 3) return null;
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** Prüft Knoten und 7 Zwischenpunkte je Segment in Weltkoordinaten – genau genug für eine Hand-Spur. */
export function outlineInPolygon(subpaths: readonly Subpath[], m: Mat, poly: readonly Point[]): boolean {
  if (poly.length < 3) return false;
  const ok = (p: Point) => pointInPolygon(...apply(m, p.x, p.y), poly);
  for (const sp of subpaths) {
    if (sp.nodes.length === 1 && !ok(sp.nodes[0])) return false;
    for (const { c } of segmentsOf(sp)) for (let k = 0; k <= 8; k++) if (!ok(pointAt(c, k / 8))) return false;
  }
  return true;
}
