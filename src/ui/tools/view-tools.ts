// Ansicht-Werkzeuge (Spec §5): Hand verschiebt, Zoom: Klick rein, Alt-Klick raus, Rahmen = Bereich.
import { fitBox, zoomAt, type Viewport } from '../../render/viewport';
import { ACCENT } from '../overlay';
import type { Editor, Pointer, Tool } from './tool';

/** Ab so viel Weg wird aus dem Klick ein Zoom-Rahmen. */
const DRAG_PX = 4;

export function handTool(ed: Editor): Tool {
  let start: { p: Pointer; vp: Viewport } | null = null;
  return {
    down(p) {
      start = { p, vp: ed.vp };
    },
    move(p) {
      if (start) ed.view({ ...start.vp, x: start.vp.x + p.sx - start.p.sx, y: start.vp.y + p.sy - start.p.sy });
      return false;
    },
    up() {
      start = null;
    },
    overlay() {},
  };
}

export function zoomTool(ed: Editor): Tool {
  let start: Pointer | null = null;
  let end: Pointer | null = null;
  const dragged = () => !!start && !!end && Math.hypot(end.sx - start.sx, end.sy - start.sy) > DRAG_PX;
  return {
    down(p) {
      start = p;
      end = null;
    },
    move(p) {
      if (!start) return false;
      end = p;
      return true;
    },
    up(p) {
      if (!start) return;
      end = p;
      if (dragged()) {
        const box = { minX: Math.min(start.x, p.x), minY: Math.min(start.y, p.y), maxX: Math.max(start.x, p.x), maxY: Math.max(start.y, p.y) };
        ed.view(fitBox(box, ed.viewSize[0], ed.viewSize[1], 0));
      } else ed.view(zoomAt(ed.vp, p.sx, p.sy, p.alt ? 0.5 : 2));
      start = end = null;
    },
    overlay(ctx, dpr) {
      if (!start || !end || !dragged()) return;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = ACCENT;
      ctx.strokeRect(start.sx + 0.5, start.sy + 0.5, end.sx - start.sx, end.sy - start.sy);
      ctx.restore();
    },
  };
}
