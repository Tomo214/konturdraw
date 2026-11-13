// Kontur-Werkzeug (Ablauf wie Vorbild): Objekt anklicken und nach außen oder zur Mitte ziehen; der Zugweg
// geteilt durch den Abstand der Leiste ergibt die Schritte. „Anwenden“ nimmt die Werte der Leiste unverändert.
import { contourObjects } from '../../io/bridge';
import { MAX_CONTOUR_STEPS, planContour, type ContourJob, type ContourParams } from '../../model/contour';
import type { Box } from '../../model/geometry';
import type { Subpath } from '../../model/types';
import { drawLasso, drawPreview } from '../overlay';
import { run, type Call } from './cut-tools';
import type { Editor, Pointer, Tool } from './tool';
import { tr } from '../../i18n/i18n.svelte';

interface Drag {
  ids: string[];
  box: Box;
  start: Pointer;
  p: Pointer;
}

/** params = Werte der Eigenschaftsleiste; Ziehen schreibt Richtung und Schritte zurück. */
export function contourTool(ed: Editor, params: ContourParams, done: () => void, call: Call<ContourJob, Subpath[][]> = contourObjects): Tool {
  let drag: Drag | null = null;
  let busy = false;

  const moved = (d: Drag) => Math.hypot(d.p.sx - d.start.sx, d.p.sy - d.start.sy) > 3;

  // weiter weg von der Mitte der Auswahl als beim Drücken = außen
  function spec(d: Drag): Pick<ContourParams, 'direction' | 'steps'> {
    const cx = (d.box.minX + d.box.maxX) / 2;
    const cy = (d.box.minY + d.box.maxY) / 2;
    const out = Math.hypot(d.p.x - cx, d.p.y - cy) >= Math.hypot(d.start.x - cx, d.start.y - cy);
    const steps = Math.round(Math.hypot(d.p.x - d.start.x, d.p.y - d.start.y) / params.offset);
    return {
      direction: out ? 'outside' : params.direction === 'center' ? 'center' : 'inside',
      steps: Math.min(MAX_CONTOUR_STEPS, Math.max(1, steps)),
    };
  }

  function apply(ids: string[]): void {
    if (busy) return;
    if (!ids.length) return void (ed.notice = tr('Erst ein Objekt wählen.'));
    const plan = planContour(ed.history.current, ids, { ...params });
    busy = true;
    void run(ed, plan, call, tr('Keine Kontur entstanden – Abstand zu groß für das Objekt.'), () => ((busy = false), done()));
  }

  return {
    down(p) {
      if (busy) return;
      const hit = ed.renderer.hitTest(ed.vp, p.sx, p.sy);
      if (!hit) return void (ed.selected = new Set());
      const ids = hit.chain.some((id) => ed.selected.has(id)) ? [...ed.selected] : [hit.topId];
      ed.selected = new Set(ids);
      const box = ed.renderer.bounds(ed.selected);
      if (box) drag = { ids, box, start: p, p };
    },
    move(p) {
      if (!drag) return false;
      drag.p = p;
      return true;
    },
    up(p) {
      if (!drag) return;
      const d = { ...drag, p };
      drag = null;
      if (!moved(d)) return;
      Object.assign(params, spec(d));
      apply(d.ids);
    },
    overlay(ctx, dpr) {
      if (!drag || !moved(drag)) return;
      const s = spec(drag);
      const grow = s.direction === 'outside' ? s.steps * params.offset : -s.steps * params.offset;
      const b = drag.box;
      if (s.direction !== 'center' && b.maxX - b.minX + 2 * grow > 0 && b.maxY - b.minY + 2 * grow > 0) {
        const [x0, y0, x1, y1] = [b.minX - grow, b.minY - grow, b.maxX + grow, b.maxY + grow];
        drawLasso(ctx, ed.vp, dpr, [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]);
      }
      drawPreview(ctx, ed.vp, dpr, null, [drag.start, drag.p]);
    },
    actions: [{ label: tr('Anwenden'), run: () => apply([...ed.selected]) }],
  };
}
