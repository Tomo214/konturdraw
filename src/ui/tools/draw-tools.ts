import { freehandPath } from '../../model/fit';
import type { Point } from '../../model/types';
import { drawPreview } from '../overlay';
import { emptyPen, penDown, penDrag, penFinish } from '../pen';
import { addPath, type Editor, type Pointer, type Tool } from './tool';

const SNAP_PX = 6;

export function penTool(ed: Editor): Tool {
  let pen = emptyPen;
  let cursor: Point | null = null;
  let pressed: Pointer | null = null;
  const finish = () => {
    const sp = penFinish(pen);
    pen = emptyPen;
    if (sp) addPath(ed, sp);
  };
  return {
    down(p) {
      const r = penDown(pen, p, SNAP_PX / ed.vp.zoom);
      pen = r.pen;
      if (r.done) addPath(ed, r.done);
      pressed = p;
    },
    move(p) {
      cursor = { x: p.x, y: p.y };
      // Erst ab 2 px Weg wird aus dem Klick ein Kurvenpunkt.
      if (pressed && pen.nodes.length && Math.hypot(p.sx - pressed.sx, p.sy - pressed.sy) > 2) pen = penDrag(pen, p);
      return pen.nodes.length > 0;
    },
    up() {
      pressed = null;
    },
    key(cmd) {
      if ((cmd.name === 'confirm' || cmd.name === 'deselect') && pen.nodes.length) {
        finish();
        return true;
      }
      return false;
    },
    finish,
    overlay(ctx, dpr) {
      if (!pen.nodes.length) return;
      const rubber = cursor && !pressed ? [{ x: cursor.x, y: cursor.y, type: 'corner' as const }] : [];
      drawPreview(ctx, ed.vp, dpr, { closed: false, nodes: [...pen.nodes, ...rubber] });
    },
  };
}

/** smoothingPx: Toleranz der Kurvenanpassung in Bildschirm-Pixeln (Regler). */
export function freehandTool(ed: Editor, smoothingPx: () => number): Tool {
  let trail: Point[] | null = null;
  return {
    down(p) {
      trail = [{ x: p.x, y: p.y }];
    },
    move(p) {
      if (!trail) return false;
      trail.push({ x: p.x, y: p.y });
      return true;
    },
    up() {
      if (!trail) return;
      const sp = freehandPath(trail, smoothingPx() / ed.vp.zoom, (2 * SNAP_PX) / ed.vp.zoom);
      trail = null;
      if (sp) addPath(ed, sp);
    },
    overlay(ctx, dpr) {
      if (trail) drawPreview(ctx, ed.vp, dpr, null, trail);
    },
  };
}
