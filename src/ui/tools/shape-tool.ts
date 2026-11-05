import { newId } from '../../model/document';
import { IDENTITY, type Box } from '../../model/geometry';
import { shapeSubpaths } from '../../model/shapes';
import type { Shape } from '../../model/types';
import { dragBox } from '../handles';
import { drawPreview, drawSelectionBox } from '../overlay';
import { addLeaf, type Editor, type Pointer, type Tool } from './tool';

/** Werte aus dem Bedienfeld; inner = null → Vieleck statt Stern. */
export interface ShapeParams {
  radius: number;
  sides: number;
  inner: number | null;
}

function shapeIn(kind: Shape['kind'], b: Box, s: ShapeParams): Shape {
  const box = { x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY };
  if (kind === 'rect') return { kind, ...box, radius: s.radius };
  if (kind === 'ellipse') return { kind, ...box };
  return { kind, ...box, sides: s.sides, inner: s.inner };
}

/** Rechteck / Ellipse / Vieleck aufziehen: Shift = Quadrat/Kreis, Alt = aus der Mitte (Spec §5). */
export function shapeTool(ed: Editor, kind: Shape['kind'], params: () => ShapeParams): Tool {
  let start: Pointer | null = null;
  let box: Box | null = null;
  // Erst ab 2 px Weg: ein Klick legt nichts an.
  const track = (s: Pointer, p: Pointer) =>
    (box = Math.hypot(p.sx - s.sx, p.sy - s.sy) > 2 ? dragBox(s, p, { square: p.shift, center: p.alt }) : null);
  return {
    down(p) {
      start = p;
      box = null;
    },
    move(p) {
      if (!start) return false;
      track(start, p);
      return true;
    },
    up(p) {
      if (start) track(start, p);
      if (box) addLeaf(ed, { type: 'shape', id: newId(), transform: IDENTITY, style: { fill: null, stroke: null }, shape: shapeIn(kind, box, params()) });
      start = box = null;
    },
    // Wie Vorbild: das gewählte (z. B. gerade gezeichnete) Objekt zeigt Rahmen und Griffe, solange nichts Neues aufgezogen wird.
    overlay(ctx, dpr) {
      if (box) drawPreview(ctx, ed.vp, dpr, shapeSubpaths(shapeIn(kind, box, params()))[0]);
      else {
        const b = ed.renderer.bounds(ed.selected);
        if (b) drawSelectionBox(ctx, ed.vp, dpr, b, 'scale', ed.renderer.nested(ed.selected));
      }
    },
  };
}
