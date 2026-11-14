// Linienstück löschen: Klick entfernt das Stück bis zu den nächsten Kreuzungen, ein Rahmen alle berührten Stücke.
import { nearest, segmentsOf, type Cubic } from '../../model/bezier';
import { findNode } from '../../model/document';
import { apply, type Box } from '../../model/geometry';
import { deletePieces, pieceAt, pieceShape, piecesIn, type Piece } from '../../model/line-piece';
import type { Point } from '../../model/types';
import type { SceneItem } from '../../render/scene';
import { ACCENT, drawMarquee } from '../overlay';
import type { Editor, Pointer, Tool } from './tool';
import { tr } from '../../i18n/i18n.svelte';

/** Fangweite in Bildschirmpunkten. */
const REACH = 6;
/** Ab so viel Bildschirmweg wird aus dem Klick ein Rahmen. */
const DRAG = 3;

const lines = (ed: Editor, b: Box): SceneItem[] =>
  ed.renderer.scene.filter(
    (it) => !it.locked && !it.clips && (it.node.type === 'path' || it.node.type === 'shape') &&
      it.minX <= b.maxX && it.maxX >= b.minX && it.minY <= b.maxY && it.maxY >= b.minY,
  );

/** Nächstes Linienstück unter dem Zeiger (entsperrte Pfade und Formen), sonst null. */
function pieceNear(ed: Editor, p: Point): Piece | null {
  const tol = REACH / ed.vp.zoom;
  let best: { id: string; sub: number; s: number; dist: number } | null = null;
  for (const it of lines(ed, { minX: p.x - tol, minY: p.y - tol, maxX: p.x + tol, maxY: p.y + tol }))
    for (const [sub, sp] of it.subpaths.entries())
      for (const [k, g] of segmentsOf(sp).entries()) {
        const c = g.c.map((q) => {
          const [x, y] = apply(it.world, q.x, q.y);
          return { x, y };
        }) as unknown as Cubic;
        const xs = c.map((q) => q.x), ys = c.map((q) => q.y);
        if (Math.max(...xs) < p.x - tol || Math.min(...xs) > p.x + tol || Math.max(...ys) < p.y - tol || Math.min(...ys) > p.y + tol) continue;
        const r = nearest(c, p);
        if (r.dist <= tol && (!best || r.dist < best.dist)) best = { id: it.id, sub, s: k + r.t, dist: r.dist };
      }
  return best && pieceAt(ed.history.current, best.id, best.sub, best.s);
}

const same = (a: Piece | null, b: Piece | null) => a?.id === b?.id && a?.sub === b?.sub && a?.from === b?.from && a?.to === b?.to;

export function pieceTool(ed: Editor): Tool {
  let hover: Piece | null = null;
  let start: Pointer | null = null;
  let end: Pointer | null = null;
  let framing = false;

  return {
    noSnap: true,
    down(p) {
      start = end = p;
      framing = false;
    },
    move(p) {
      if (start) {
        end = p;
        framing ||= Math.hypot(p.sx - start.sx, p.sy - start.sy) > DRAG;
        hover = null;
        return framing;
      }
      const h = pieceNear(ed, p);
      const changed = !same(h, hover);
      hover = h;
      return changed;
    },
    up(p) {
      if (!start) return;
      const doc = ed.history.current;
      const b: Box = { minX: Math.min(start.x, p.x), minY: Math.min(start.y, p.y), maxX: Math.max(start.x, p.x), maxY: Math.max(start.y, p.y) };
      const pieces = framing ? piecesIn(doc, [...new Set(lines(ed, b).map((it) => it.id))], b) : [pieceNear(ed, p)].filter((x): x is Piece => !!x);
      start = end = hover = null;
      framing = false;
      if (!pieces.length) {
        ed.notice = tr('Keine Linie getroffen.');
        return;
      }
      const next = deletePieces(doc, pieces);
      ed.history.push(next);
      ed.selected = new Set([...ed.selected].filter((id) => findNode(next, id)));
      ed.notice = '';
    },
    finish() {
      start = end = hover = null;
      framing = false;
    },
    overlay(ctx, dpr) {
      if (start && end && framing) drawMarquee(ctx, dpr, start.sx, start.sy, end.sx, end.sy);
      if (!hover) return;
      const z = ed.vp.zoom;
      const s = (q: Point): [number, number] => [q.x * z + ed.vp.x, q.y * z + ed.vp.y];
      const cs = pieceShape(ed.history.current, hover);
      if (!cs.length) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.setLineDash([]);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(...s(cs[0][0]));
      for (const c of cs) ctx.bezierCurveTo(...s(c[1]), ...s(c[2]), ...s(c[3]));
      ctx.stroke();
    },
  };
}
