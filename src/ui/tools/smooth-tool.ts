// Glätten-Werkzeug (Spec §18 #4, Ablauf wie Vorbild): über die Kanten gewählter Objekte streichen glättet sie und
// spart Knoten. Shift + Ziehen zieht den Pinsel bis zur Maus auf, Alt + Ziehen stellt das Tempo ein (Mitte 0 %,
// Rand 100 %); mit Stiftdruck steuert der Druck das Tempo. Ein Strich = ein Rückgängig-Schritt; am Strich-Ende
// fasst er die Knoten im Strichbereich zusammen.
import { settleAt, smoothAt } from '../../model/smooth';
import type { Doc, Point } from '../../model/types';
import { ACCENT } from '../overlay';
import type { Editor, Pointer, Tool } from './tool';
import { tr } from '../../i18n/i18n.svelte';

/** Werte der Eigenschaftsleiste. */
export interface SmoothParams {
  /** Pinselradius in mm */
  radius: number;
  /** Tempo in Prozent (1–100) */
  rate: number;
  /** Stiftdruck steuert das Tempo */
  pressure: boolean;
}

export const RADIUS_RANGE = [0.05, 100] as const;

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function smoothTool(ed: Editor, params: SmoothParams): Tool {
  let mode: 'smooth' | 'radius' | 'rate' | null = null;
  let start: Pointer | null = null;
  let cursor: Point | null = null;
  let last: Point | null = null;
  let ids: string[] = [];
  let dabs: Point[] = [];
  let doc: Doc | null = null;
  let changed = false;

  function dab(at: Point, pressure: number | undefined) {
    dabs.push(at);
    const rate = (params.rate / 100) * (params.pressure && pressure !== undefined ? pressure : 1);
    const next = smoothAt(doc!, ids, at, params.radius, rate);
    if (next === doc) return;
    ed.history.preview((doc = next));
    changed = true;
  }

  // Tupfer im Abstand eines Viertel-Radius, damit schnelle Züge keine Lücken lassen.
  function stroke(to: Pointer) {
    const from = last!;
    const n = Math.max(1, Math.ceil(dist(from, to) / (params.radius / 4)));
    for (let i = 1; i <= n; i++) dab({ x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n }, to.pressure);
    last = { x: to.x, y: to.y };
  }

  // Shift/Alt: erst ab 3 px Zugweg, ein Klick allein ändert nichts.
  function adjust(p: Pointer) {
    if (!start || Math.hypot(p.sx - start.sx, p.sy - start.sy) <= 3) return;
    const d = dist(start, p);
    if (mode === 'radius') params.radius = clamp(d, ...RADIUS_RANGE);
    else params.rate = clamp(Math.round((d / params.radius) * 100), 1, 100);
  }

  return {
    noSnap: true,
    down(p) {
      cursor = { x: p.x, y: p.y };
      if (p.shift || p.alt) {
        mode = p.shift ? 'radius' : 'rate';
        start = p;
        return;
      }
      if (!ed.selected.size) return void (ed.notice = tr('Erst ein Objekt wählen.'));
      mode = 'smooth';
      ids = [...ed.selected];
      dabs = [];
      doc = ed.history.current;
      changed = false;
      last = cursor;
      ed.notice = '';
      dab(cursor, p.pressure);
    },
    move(p) {
      cursor = { x: p.x, y: p.y };
      if (mode === 'smooth') stroke(p);
      else if (mode) adjust(p);
      return true;
    },
    up(p) {
      if (mode === 'smooth') {
        stroke(p);
        if (changed) {
          ed.history.preview(settleAt(doc!, ids, dabs, params.radius));
          ed.history.commit();
        }
      } else if (mode) adjust(p);
      mode = null;
      start = last = doc = null;
    },
    overlay(ctx, dpr) {
      const c = mode === 'radius' || mode === 'rate' ? start : cursor;
      if (!c) return;
      const z = ed.vp.zoom;
      const [x, y] = [c.x * z + ed.vp.x, c.y * z + ed.vp.y];
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(params.radius * z, 1), 0, Math.PI * 2);
      ctx.stroke();
      // Tempo als innerer Kreis, solange es eingestellt wird.
      if (mode !== 'rate') return;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(x, y, Math.max((params.radius * z * params.rate) / 100, 1), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    },
  };
}
