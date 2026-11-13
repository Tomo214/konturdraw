import { duplicateNodes, transformNodes, translateNodes } from '../../model/document';
import type { Box, Mat } from '../../model/geometry';
import { guideAt, moveGuide, removeGuides } from '../../model/guides';
import type { Doc, Guide } from '../../model/types';
import { screenToPage } from '../../render/viewport';
import { handleAt, handleCursor, handleNear, rotateFromDrag, scaleFromHandle, skewFromHandle, type Handle } from '../handles';
import { drawLasso, drawMarquee, drawSelectionBox } from '../overlay';
import { choose, deeper } from '../selection';
import type { Editor, Pointer, Tool } from './tool';
import { N_, tr } from '../../i18n/i18n.svelte';

type Drag =
  | { kind: 'move'; start: Pointer; doc: Doc; moved: boolean; toggle: boolean; copied?: boolean }
  | { kind: 'handle'; start: Pointer; doc: Doc; moved: boolean; box: Box; handle: Handle; copied?: boolean }
  | { kind: 'marquee'; start: Pointer; doc: Doc; moved: boolean; cur: Pointer }
  | { kind: 'lasso'; start: Pointer; doc: Doc; moved: boolean; pts: Pointer[] }
  | { kind: 'guide'; start: Pointer; doc: Doc; moved: boolean; guide: Guide };

/** Fangbreite einer Hilfslinie in Bildschirmpixeln. */
const GUIDE_HIT = 4;
const LOCKED = N_('Hilfslinie ist gesperrt.');

/** Auswahl: Klick, Shift-Klick, Rahmen (mit Alt: berührte Objekte); Strg-Klick (Mac ⌘) wählt in Gruppen eine Stufe tiefer.
 *  freehand = Freihand-Auswahl: auf leerer Fläche zieht man eine Spur statt eines Rahmens, sonst gleich.
 *  Griffe skalieren, nach erneutem Klick drehen/neigen. Tasten wie Vorbild: Strg (Mac ⌘) = waagerecht/senkrecht bewegen,
 *  100-%-Schritte, 15°; Shift = vom Mittelpunkt; Alt = Ecke frei. Rechtsklick/Leertaste beim Ziehen = Kopie ablegen.
 *  Hilfslinien (liegen oben): Klick wählt, Ziehen verschiebt, aus der Fläche ziehen oder Entf löscht. */
export function selectTool(ed: Editor, opts: { freehand?: boolean } = {}): Tool {
  let mode: 'scale' | 'rotate' = 'scale';
  let drag: Drag | null = null;
  let last: Pointer | null = null;

  const handleUnder = (box: Box, p: Pointer): Handle | undefined => handleNear(ed.vp, box, p.sx, p.sy);

  // Hilfslinien greift man mit dem rohen Zeiger; gefangen wird erst beim Ziehen.
  const raw = (p: Pointer): Pointer => {
    const [x, y] = screenToPage(ed.vp, p.sx, p.sy);
    return { ...p, x, y };
  };

  /** Rahmen vom Start zum Zeiger; Alt = alle berührten Objekte (wie Vorbild), sonst nur ganz umschlossene. */
  function framed(d: Extract<Drag, { kind: 'marquee' }>, p: Pointer): string[] {
    const r = { minX: Math.min(d.start.x, d.cur.x), minY: Math.min(d.start.y, d.cur.y), maxX: Math.max(d.start.x, d.cur.x), maxY: Math.max(d.start.y, d.cur.y) };
    return d.start.alt || p.alt ? ed.renderer.touching(r) : ed.renderer.inside(r);
  }

  function matrix(d: Extract<Drag, { kind: 'handle' }>, p: Pointer): Mat {
    // Griffversatz ausgleichen: gezogen wird der Griff, nicht der Zeiger.
    const hp = handleAt(d.box, d.handle);
    const q = { x: hp.x + p.x - d.start.x, y: hp.y + p.y - d.start.y };
    if (mode === 'scale') return scaleFromHandle(d.box, d.handle, q, { free: p.alt, center: p.shift, step: !!p.mod });
    if (d.handle.length === 1) return skewFromHandle(d.box, d.handle, hp, q);
    const c = { x: (d.box.minX + d.box.maxX) / 2, y: (d.box.minY + d.box.maxY) / 2 };
    return rotateFromDrag(c, hp, q, !!p.mod);
  }

  function show(d: Extract<Drag, { kind: 'move' | 'handle' }>, p: Pointer) {
    if (d.kind === 'handle') return ed.history.preview(transformNodes(d.doc, ed.selected, matrix(d, p)));
    let [dx, dy] = [p.x - d.start.x, p.y - d.start.y];
    if (p.mod) [dx, dy] = Math.abs(dx) >= Math.abs(dy) ? [dx, 0] : [0, dy];
    ed.history.preview(translateNodes(d.doc, ed.selected, dx, dy));
  }

  /** Ab jetzt wird eine Kopie gezogen; das Original bleibt am Platz (ein Rückgängig-Schritt mit dem Ziehen). */
  function stamp(): boolean {
    const d = drag;
    if ((d?.kind !== 'move' && d?.kind !== 'handle') || !d.moved || !last) return false;
    if (!d.copied) {
      const dup = duplicateNodes(d.doc, ed.selected, 0, 0);
      [d.doc, d.copied] = [dup.doc, true];
      ed.selected = new Set(dup.ids);
      show(d, last);
    }
    return true;
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
        // Spur roh: am Fangpunkt springende Punkte würden sie verzerren.
        drag = opts.freehand ? { kind: 'lasso', start: p, doc, moved: false, pts: [raw(p)] } : { kind: 'marquee', start: p, doc, moved: false, cur: p };
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
      last = p;
      if (drag.kind === 'move' || drag.kind === 'handle') show(drag, p);
      else if (drag.kind === 'guide') {
        const { guide: g, start } = drag;
        const k = g.axis === 'h' ? 'y' : 'x';
        ed.history.preview(moveGuide(drag.doc, g.id, p.snap ? p[k] : g.pos + raw(p)[k] - start[k]) ?? drag.doc);
      } else if (drag.kind === 'lasso') {
        const last = drag.pts[drag.pts.length - 1];
        if (Math.hypot(p.sx - last.sx, p.sy - last.sy) >= 2) drag.pts.push(raw(p));
      } else drag.cur = p;
      return true;
    },
    up(p) {
      const d = drag;
      drag = null;
      if (!d) return;
      if (d.kind === 'guide') {
        if (d.moved && d.guide.locked) ed.notice = tr(LOCKED);
        if (!d.moved || d.guide.locked) return;
        const [w, h] = ed.viewSize;
        if (p.sx < 0 || p.sy < 0 || p.sx > w || p.sy > h) {
          ed.history.preview(removeGuides(d.doc, [d.guide.id]) ?? d.doc);
          ed.guide = null;
        }
        ed.history.commit();
      } else if (d.kind === 'marquee' || d.kind === 'lasso') {
        if (!d.moved) return;
        ed.selected = new Set([...ed.selected, ...(d.kind === 'marquee' ? framed(d, p) : d.pts.length < 3 ? [] : ed.renderer.inPolygon(d.pts))]);
        mode = 'scale';
      } else if (d.moved) ed.history.commit();
      else if (d.kind === 'move' && d.toggle) mode = mode === 'scale' ? 'rotate' : 'scale';
    },
    stamp,
    key(cmd) {
      if (cmd.name === 'pickToggle') return stamp();
      if (cmd.name !== 'delete' || !ed.guide) return false;
      const next = removeGuides(ed.history.current, [ed.guide]);
      if (!next) ed.notice = tr(LOCKED);
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
    cursor(p) {
      if (drag?.kind === 'handle') return handleCursor(drag.handle, mode);
      if (drag) return drag.kind === 'move' && drag.moved ? 'move' : '';
      const box = ed.renderer.bounds(ed.selected);
      const h = box && handleUnder(box, p);
      if (!box || h) return h ? handleCursor(h, mode) : '';
      const r = raw(p);
      return r.x >= box.minX && r.x <= box.maxX && r.y >= box.minY && r.y <= box.maxY ? 'move' : '';
    },
    overlay(ctx, dpr) {
      const box = ed.renderer.bounds(ed.selected);
      if (box && drag?.kind !== 'marquee' && drag?.kind !== 'lasso') drawSelectionBox(ctx, ed.vp, dpr, box, mode, ed.renderer.nested(ed.selected));
      if (drag?.kind === 'marquee' && drag.moved) drawMarquee(ctx, dpr, drag.start.sx, drag.start.sy, drag.cur.sx, drag.cur.sy);
      if (drag?.kind === 'lasso' && drag.moved) drawLasso(ctx, ed.vp, dpr, drag.pts);
    },
  };
}
