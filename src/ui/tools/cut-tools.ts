// Messer, Radierer, Pipette (Spec §5). Ohne Auswahl wirken Messer und Radierer auf alles, was sie berühren.
import { eraseObjects, knifeObjects } from '../../io/bridge';
import { planErase, planKnife, type CutPlan, type EraseJob, type KnifeJob } from '../../model/cutting';
import { fitCurve } from '../../model/fit';
import type { Box } from '../../model/geometry';
import { copyStyle } from '../../model/style';
import type { Doc, LeafNode, Point, Subpath } from '../../model/types';
import { ACCENT, drawPreview } from '../overlay';
import type { Editor, Pointer, Tool } from './tool';
import { tr } from '../../i18n/i18n.svelte';

/** Werte der Eigenschaftsleiste. */
export interface CutParams {
  /** Messer: gerade Linie zwischen zwei Punkten oder freihand */
  knife: 'line' | 'free';
  /** Radierer-Dicke in mm */
  width: number;
  nib: 'round' | 'square';
  /** Pipette: welche Attribute übertragen werden */
  pick: { fill: boolean; stroke: boolean };
}

type Call<J, R> = (jobs: J[]) => Promise<(R | null)[]>;

const boxOf = (pts: readonly Point[], pad = 0): Box => ({
  minX: Math.min(...pts.map((p) => p.x)) - pad,
  minY: Math.min(...pts.map((p) => p.y)) - pad,
  maxX: Math.max(...pts.map((p) => p.x)) + pad,
  maxY: Math.max(...pts.map((p) => p.y)) + pad,
});

const open = (pts: readonly Point[]): Subpath => ({ closed: false, nodes: pts.map((p) => ({ x: p.x, y: p.y, type: 'corner' })) });

/** Spur als glatter offener Kurvenzug (0,5 px Toleranz); null = kein Weg. */
function smooth(ed: Editor, pts: readonly Point[]): Subpath | null {
  const nodes = fitCurve(pts, 0.5 / ed.vp.zoom);
  return nodes.length ? { closed: false, nodes } : null;
}

/** Rechnet in kw-core und übernimmt; währenddessen Geändertes wird verworfen. */
async function run<J, R>(ed: Editor, plan: CutPlan<J, R>, call: Call<J, R>, none: string, done: () => void) {
  const doc = ed.history.current;
  try {
    const r = plan.jobs.length ? plan.finish(await call(plan.jobs)) : null;
    if (ed.history.current !== doc) ed.notice = tr('Dokument wurde währenddessen geändert – verworfen.');
    else if (!r) ed.notice = none;
    else {
      ed.history.push(r.doc);
      ed.selected = new Set(r.selected);
      ed.notice = '';
    }
  } catch (err) {
    ed.notice = (err as Error).message;
  }
  done();
}

const targets = (ed: Editor, b: Box) => (ed.selected.size ? [...ed.selected] : ed.renderer.touching(b));

/** Messer: Objekte entlang des gezogenen Schnitts in je ein Objekt pro Seite teilen. */
export function knifeTool(ed: Editor, params: () => CutParams, done: () => void, call: Call<KnifeJob, Subpath[][]> = knifeObjects): Tool {
  let trail: Point[] | null = null;
  let start: Pointer | null = null;
  let busy = false;
  const line = () => params().knife === 'line';
  return {
    down(p) {
      if (busy) return;
      start = p;
      trail = [{ x: p.x, y: p.y }];
    },
    move(p) {
      if (!trail) return false;
      if (line()) trail = [trail[0], { x: p.x, y: p.y }];
      else trail.push({ x: p.x, y: p.y });
      return true;
    },
    up(p) {
      if (!trail || !start) return;
      const pts = line() ? [trail[0], { x: p.x, y: p.y }] : [...trail, { x: p.x, y: p.y }];
      const moved = Math.hypot(p.sx - start.sx, p.sy - start.sy) > 2;
      trail = start = null;
      const cut = moved && (line() ? open(pts) : smooth(ed, pts));
      if (!cut) return;
      busy = true;
      const plan = planKnife(ed.history.current, targets(ed, boxOf(pts)), cut);
      void run(ed, plan, call, tr('Schnitt trennt nichts – ganz durch das Objekt ziehen.'), () => ((busy = false), done()));
    },
    overlay(ctx, dpr) {
      if (trail) line() ? drawPreview(ctx, ed.vp, dpr, open(trail)) : drawPreview(ctx, ed.vp, dpr, null, trail);
    },
  };
}

/** Radierer: entlang der Spur mit runder oder eckiger Spitze wegradieren; Flächen bleiben ein Objekt.
 *  Live wie Vorbild: beim Ziehen zeigt eine Vorschau das Ergebnis (immer vom Stand beim Drücken aus), Loslassen = ein Undo-Schritt. */
export function eraserTool(ed: Editor, params: () => CutParams, done: () => void, call: Call<EraseJob, Subpath[]> = eraseObjects): Tool {
  let trail: Point[] | null = null;
  let cursor: Point | null = null;
  let busy = false;
  let base: Doc | null = null;
  let shown: Doc | null = null;
  /** Alles bisher Berührte: ganz Weggeradiertes ist nicht mehr berührbar und bliebe sonst nicht weg. */
  let hit = new Set<string>();
  let seq = 0;
  let flying = false;
  let again = false;
  /** Spurpunkte, deren Ergebnis schon zu sehen ist – nur der Rest wird noch als Streifen gezeigt. */
  let upto = 0;

  // Rechnet die ganze bisherige Spur; nur das Ergebnis der jüngsten Rechnung zählt.
  async function erase(pts: Point[], last: boolean): Promise<void> {
    const { width, nib } = params();
    for (const id of targets(ed, boxOf(pts, width / 2))) hit.add(id);
    const plan = planErase(base!, [...hit], smooth(ed, pts) ?? open([pts[0]]), width, nib === 'square');
    const mine = ++seq;
    flying = !last;
    let r: { doc: Doc; selected: string[] } | null = null;
    let error = '';
    try {
      r = plan.jobs.length ? plan.finish(await call(plan.jobs)) : null;
    } catch (err) {
      error = (err as Error).message;
    }
    if (mine !== seq) return;
    flying = false;
    if (ed.history.current !== shown) return ((ed.notice = tr('Dokument wurde währenddessen geändert – verworfen.')), finish(last));
    if (r) ed.history.preview((shown = r.doc));
    if (!last) {
      if (!error) upto = pts.length;
      if (again && trail) ((again = false), void erase([...trail], false));
      return done();
    }
    if (r) {
      ed.history.commit();
      ed.selected = new Set(r.selected);
      ed.notice = '';
    } else {
      ed.history.cancel();
      ed.notice = error || tr('Nichts getroffen.');
    }
    finish(true);
  }
  function finish(last: boolean) {
    if (last) busy = false;
    done();
  }

  return {
    noSnap: true,
    down(p) {
      if (busy) return;
      trail = [{ x: p.x, y: p.y }];
      base = shown = ed.history.current;
      hit = new Set();
      upto = 0;
    },
    move(p) {
      cursor = { x: p.x, y: p.y };
      if (!trail) return true;
      trail.push(cursor);
      if (flying) again = true;
      else void erase([...trail], false);
      return true;
    },
    up(p) {
      if (!trail) return;
      const pts = [...trail, { x: p.x, y: p.y }];
      trail = null;
      busy = true;
      void erase(pts, true);
    },
    overlay(ctx, dpr) {
      const { width, nib } = params();
      const w = width * ed.vp.zoom;
      const s = (q: Point): [number, number] => [q.x * ed.vp.zoom + ed.vp.x, q.y * ed.vp.zoom + ed.vp.y];
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.setLineDash([]);
      const rest = trail?.slice(Math.max(0, upto - 1)) ?? [];
      if (rest.length) {
        ctx.strokeStyle = 'rgba(255, 106, 61, 0.35)';
        ctx.lineWidth = Math.max(w, 1);
        ctx.lineCap = nib === 'square' ? 'square' : 'round';
        ctx.lineJoin = nib === 'square' ? 'miter' : 'round';
        ctx.beginPath();
        rest.forEach((q, i) => (i ? ctx.lineTo(...s(q)) : ctx.moveTo(...s(q))));
        if (rest.length === 1) ctx.lineTo(...s(rest[0]));
        ctx.stroke();
      }
      if (!cursor) return;
      const [x, y] = s(cursor);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (nib === 'square') ctx.rect(x - w / 2, y - w / 2, w, w);
      else ctx.arc(x, y, Math.max(w / 2, 1), 0, Math.PI * 2);
      ctx.stroke();
    },
  };
}

/** Pipette: erster Klick nimmt Füllung/Kontur auf, jeder weitere überträgt sie; Shift nimmt neu auf, Esc setzt zurück. */
export function eyedropperTool(ed: Editor, params: () => CutParams): Tool {
  let sample: LeafNode | null = null;
  return {
    down(p) {
      const hit = ed.renderer.hitTest(ed.vp, p.sx, p.sy);
      if (!hit) return;
      if (hit.node.type === 'image') {
        ed.notice = tr('Bilder haben keine Füllung oder Kontur.');
        return;
      }
      if (!sample || p.shift) {
        sample = hit.node;
        ed.notice = tr('Attribute aufgenommen – Zielobjekte anklicken (Shift: neu aufnehmen, Esc: zurücksetzen).');
        return;
      }
      const ids = hit.chain.some((id) => ed.selected.has(id)) ? [...ed.selected] : [hit.topId];
      ed.history.push(copyStyle(ed.history.current, ids, sample, params().pick));
    },
    move: () => false,
    up() {},
    key(cmd) {
      if (cmd.name !== 'deselect' || !sample) return false;
      sample = null;
      ed.notice = '';
      return true;
    },
    overlay() {},
  };
}
