import { transformNodes, translateNodes } from '../../model/document';
import type { Box, Mat } from '../../model/geometry';
import { guideAt, moveGuide, removeGuides } from '../../model/guides';
import type { Doc, Guide } from '../../model/types';
import { screenToPage } from '../../render/viewport';
import { HANDLES, handleAt, handleOnScreen, rotateFromDrag, scaleFromHandle, skewFromHandle, type Handle } from '../handles';
import { drawMarquee, drawSelectionBox } from '../overlay';
import { choose, deeper } from '../selection';
import type { Editor, Pointer, Tool } from './tool';

type Drag =
  | { kind: 'move'; start: Pointer; doc: Doc; moved: boolean; toggle: boolean }
  | { kind: 'handle'; start: Pointer; doc: Doc; moved: boolean; box: Box; handle: Handle }
  | { kind: 'marquee'; start: Pointer; doc: Doc; moved: boolean; cur: Pointer }
  | { kind: 'guide'; start: Pointer; doc: Doc; moved: boolean; guide: Guide };

/** Fangbreite einer Hilfslinie in Bildschirmpixeln. */
const GUIDE_HIT = 4;
const LOCKED = 'Hilfslinie ist gesperrt.';

/** Auswahl: Klick, Shift-Klick, Rahmen; Strg-Klick (Mac ⌘) wählt in Gruppen eine Stufe tiefer.
 *  Griffe skalieren, nach erneutem Klick drehen/neigen.
 *  Hilfslinien (liegen oben): Klick wählt, Ziehen verschiebt, aus der Fläche ziehen oder Entf löscht. */
export function selectTool(ed: Editor): Tool {
  let mode: 'scale' | 'rotate' = 'scale';
  let drag: Drag | null = null;

  const handleUnder = (box: Box, p: Pointer): Handle | undefined =>
    HANDLES.find((h) => {
      const [x, y] = handleOnScreen(ed.vp, box, h);
      return Math.hypot(x - p.sx, y - p.sy) <= 6;
    });

  // Hilfslinien greift man mit dem rohen Zeiger; gefangen wird erst beim Ziehen.
  const raw = (p: Pointer): Pointer => {
    const [x, y] = screenToPage(ed.vp, p.sx, p.sy);
    return { ...p, x, y };
  };

  function matrix(d: Extract<Drag, { kind: 'handle' }>, p: Pointer): Mat {
    // Griffversatz ausgleichen: gezogen wird der Griff, nicht der Zeiger.
    const hp = handleAt(d.box, d.handle);
    const q = { x: hp.x + p.x - d.start.x, y: hp.y + p.y - d.start.y };
    if (mode === 'scale') return scaleFromHandle(d.box, d.handle, q, { free: p.shift, center: p.alt });
    if (d.handle.length === 1) return skewFromHandle(d.box, d.handle, hp, q);
    const c = { x: (d.box.minX + d.box.maxX) / 2, y: (d.box.minY + d.box.maxY) / 2 };
    return rotateFromDrag(c, hp, q, p.shift);
  }

  return {
    down(p) {
      const doc = ed.history.current;
      const box = ed.renderer.bounds(ed.selected);
      const handle = box && handleUnder(box, p);
      if (box && handle) {
        drag = { kind: 'handle', start: p, doc, moved: false, box, handle };
        return;
      }
      const r = raw(p);
      const guide = guideAt(ed.guides(), r.x, r.y, GUIDE_HIT / ed.vp.zoom);
      ed.guide = guide?.id ?? null;
      if (guide) {
        ed.selected = new Set();
        drag = { kind: 'guide', start: r, doc, moved: false, guide };
        return;
      }
      const hit = ed.renderer.hitTest(ed.vp, p.sx, p.sy);
      if (!hit) {
        if (!p.shift) ed.selected = new Set();
        drag = { kind: 'marquee', start: p, doc, moved: false, cur: p };
        return;
      }
      // Ein schon gewähltes Kind bleibt gewählt und lässt sich ohne Strg ziehen.
      const chosen = hit.chain.find((c) => ed.selected.has(c));
      const id = p.mod ? deeper(ed.selected, hit.chain) : (chosen ?? hit.topId);
      const was = ed.selected.has(id);
      if (p.shift) ed.selected = choose(ed.history.current, ed.selected, id, true);
      else if (!was) ed.selected = new Set([id]);
      if (!was) mode = 'scale';
      drag = { kind: 'move', start: p, doc, moved: false, toggle: was && !p.shift };
    },
    move(p) {
      if (!drag) return false;
      drag.moved ||= Math.hypot(p.sx - drag.start.sx, p.sy - drag.start.sy) > 2;
      if (!drag.moved) return false;
      if (drag.kind === 'move') ed.history.preview(translateNodes(drag.doc, ed.selected, p.x - drag.start.x, p.y - drag.start.y));
      else if (drag.kind === 'handle') ed.history.preview(transformNodes(drag.doc, ed.selected, matrix(drag, p)));
      else if (drag.kind === 'guide') {
        const { guide: g, start } = drag;
        const k = g.axis === 'h' ? 'y' : 'x';
        ed.history.preview(moveGuide(drag.doc, g.id, p.snap ? p[k] : g.pos + raw(p)[k] - start[k]) ?? drag.doc);
      } else drag.cur = p;
      return true;
    },
    up(p) {
      const d = drag;
      drag = null;
      if (!d) return;
      if (d.kind === 'guide') {
        if (d.moved && d.guide.locked) ed.notice = LOCKED;
        if (!d.moved || d.guide.locked) return;
        const [w, h] = ed.viewSize;
        if (p.sx < 0 || p.sy < 0 || p.sx > w || p.sy > h) {
          ed.history.preview(removeGuides(d.doc, [d.guide.id]) ?? d.doc);
          ed.guide = null;
        }
        ed.history.commit();
      } else if (d.kind === 'marquee') {
        if (!d.moved) return;
        const r = { minX: Math.min(d.start.x, d.cur.x), minY: Math.min(d.start.y, d.cur.y), maxX: Math.max(d.start.x, d.cur.x), maxY: Math.max(d.start.y, d.cur.y) };
        ed.selected = new Set([...ed.selected, ...ed.renderer.inside(r)]);
        mode = 'scale';
      } else if (d.moved) ed.history.commit();
      else if (d.kind === 'move' && d.toggle) mode = mode === 'scale' ? 'rotate' : 'scale';
    },
    key(cmd) {
      if (cmd.name !== 'delete' || !ed.guide) return false;
      const next = removeGuides(ed.history.current, [ed.guide]);
      if (!next) ed.notice = LOCKED;
      else {
        ed.history.push(next);
        ed.guide = null;
      }
      return true;
    },
    snapSkip() {
      if (drag?.kind === 'guide') return new Set([drag.guide.id]);
      return drag?.kind === 'move' || drag?.kind === 'handle' ? ed.selected : new Set();
    },
    finish() {
      ed.guide = null;
    },
    overlay(ctx, dpr) {
      const box = ed.renderer.bounds(ed.selected);
      if (box && drag?.kind !== 'marquee') drawSelectionBox(ctx, ed.vp, dpr, box, mode, ed.renderer.nested(ed.selected));
      if (drag?.kind === 'marquee' && drag.moved) drawMarquee(ctx, dpr, drag.start.sx, drag.start.sy, drag.cur.sx, drag.cur.sy);
    },
  };
}
