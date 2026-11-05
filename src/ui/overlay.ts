import { segmentsOf, transformSubpath } from '../model/bezier';
import { apply, multiply, type Box, type Mat } from '../model/geometry';
import type { Point, Subpath } from '../model/types';
import { toScreen, type Viewport } from '../render/viewport';
import { HANDLES, handleOnScreen } from './handles';
import { nodeKey } from './node-hit';

// Werkzeug-Overlays in Bildschirm-Pixeln, über dem fertig gezeichneten Dokument.

export const ACCENT = '#ff6a3d';

function screen(ctx: CanvasRenderingContext2D, dpr: number) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeStyle = ACCENT;
}

const toS = (vp: Viewport, p: Point): [number, number] => [p.x * vp.zoom + vp.x, p.y * vp.zoom + vp.y];

function pathIn(sps: readonly Subpath[], m: Mat): Path2D {
  const p = new Path2D();
  for (const raw of sps) {
    const sp = transformSubpath(raw, m);
    if (!sp.nodes.length) continue;
    p.moveTo(sp.nodes[0].x, sp.nodes[0].y);
    for (const { line, c } of segmentsOf(sp)) {
      if (line) p.lineTo(c[3].x, c[3].y);
      else p.bezierCurveTo(c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y);
    }
    if (sp.closed) p.closePath();
  }
  return p;
}

function square(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.rect(Math.round(x - size / 2) + 0.5, Math.round(y - size / 2) + 0.5, size, size);
  ctx.fill();
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** Auswahlrahmen; scale = Quadrate (Kind einer Gruppe: kleine Kreise), rotate = Kreise (drehen) an Ecken, Balken (neigen) an Kanten. */
export function drawSelectionBox(ctx: CanvasRenderingContext2D, vp: Viewport, dpr: number, b: Box, mode: 'scale' | 'rotate', child = false) {
  screen(ctx, dpr);
  const [x0, y0] = toS(vp, { x: b.minX, y: b.minY });
  const [x1, y1] = toS(vp, { x: b.maxX, y: b.maxY });
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(x1 - x0), Math.round(y1 - y0));
  ctx.setLineDash([]);
  for (const h of HANDLES) {
    const [x, y] = handleOnScreen(vp, b, h);
    if (mode === 'scale') child ? dot(ctx, x, y, 3.5) : square(ctx, x, y, 7, '#fff');
    else if (h.length === 2) dot(ctx, x, y, 4.5);
    else {
      const [bw, bh] = h === 'n' || h === 's' ? [14, 5] : [5, 14];
      ctx.fillStyle = '#fff';
      ctx.fillRect(Math.round(x - bw / 2), Math.round(y - bh / 2), bw, bh);
      ctx.strokeRect(Math.round(x - bw / 2) + 0.5, Math.round(y - bh / 2) + 0.5, bw - 1, bh - 1);
    }
  }
  if (mode === 'rotate') {
    const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.moveTo(cx - 7, cy);
    ctx.lineTo(cx + 7, cy);
    ctx.moveTo(cx, cy - 7);
    ctx.lineTo(cx, cy + 7);
    ctx.stroke();
  }
}

export function drawMarquee(ctx: CanvasRenderingContext2D, dpr: number, x0: number, y0: number, x1: number, y1: number) {
  screen(ctx, dpr);
  ctx.fillStyle = 'rgb(255 106 61 / 0.08)';
  ctx.setLineDash([4, 3]);
  ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
  ctx.setLineDash([]);
}

/** Pfad im Knoten-Werkzeug: Umriss, gewähltes Segment, Anfasser gewählter Knoten, alle Knoten. */
export function drawNodes(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  dpr: number,
  world: Mat,
  sps: readonly Subpath[],
  sel: ReadonlySet<string>,
  seg: { sub: number; seg: number } | null,
) {
  screen(ctx, dpr);
  const m = multiply(toScreen(vp), world);
  ctx.stroke(pathIn(sps, m));
  if (seg && sps[seg.sub]) {
    const s = segmentsOf(transformSubpath(sps[seg.sub], m))[seg.seg];
    if (s) {
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(s.c[0].x, s.c[0].y);
      ctx.bezierCurveTo(s.c[1].x, s.c[1].y, s.c[2].x, s.c[2].y, s.c[3].x, s.c[3].y);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }
  const at = (p: Point) => apply(m, p.x, p.y);
  for (const [s, sp] of sps.entries()) {
    for (const [index, n] of sp.nodes.entries()) {
      if (!sel.has(nodeKey({ sub: s, index }))) continue;
      const [nx, ny] = at(n);
      for (const h of [n.handleIn, n.handleOut]) {
        if (!h) continue;
        const [hx, hy] = at(h);
        ctx.beginPath();
        ctx.moveTo(nx, ny);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.fillStyle = ACCENT;
        ctx.beginPath();
        ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  for (const [s, sp] of sps.entries()) {
    for (const [index, n] of sp.nodes.entries()) {
      const [x, y] = at(n);
      square(ctx, x, y, 7, sel.has(nodeKey({ sub: s, index })) ? ACCENT : '#fff');
    }
  }
}

export interface GradientKnot {
  at: Point;
  color: string;
}

/** Verlaufslinie in Seitenkoordinaten: Anfang = Quadrat, Ende = Kreis, dazwischen die Farbknoten – alle in ihrer Farbe, der gewählte größer. */
export function drawGradientLine(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  dpr: number,
  from: Point,
  to: Point,
  knots: readonly GradientKnot[] = [],
  selected = -1,
) {
  screen(ctx, dpr);
  const [x0, y0] = toS(vp, from);
  const [x1, y1] = toS(vp, to);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  // Knoten in ihrer Farbe mit weißem Rand und dunkler Außenlinie – bleibt auf jeder Verlaufsfarbe sichtbar; gewählt = größer mit Akzent-Ring.
  const mark = (x: number, y: number, size: number, i: number, round = false) => {
    const on = selected >= 0 && i === selected;
    const s = size + (on ? 4 : 0);
    ctx.beginPath();
    if (round) ctx.arc(x, y, s / 2, 0, Math.PI * 2);
    else ctx.rect(Math.round(x - s / 2) + 0.5, Math.round(y - s / 2) + 0.5, s, s);
    ctx.fillStyle = knots[i]?.color ?? '#fff';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = on ? ACCENT : 'rgba(0, 0, 0, 0.6)';
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  };
  const last = Math.max(knots.length - 1, 0);
  mark(x0, y0, 9, 0);
  mark(x1, y1, 10, last, true);
  // Zwischenknoten zuletzt: sie liegen oben und werden beim Klicken zuerst getroffen.
  for (let i = 1; i < last; i++) mark(...toS(vp, knots[i].at), 8, i);
  ctx.strokeStyle = ACCENT;
}

/** Vorschau beim Zeichnen: Pfad (Seitenkoordinaten) und/oder Punktspur. */
export function drawPreview(ctx: CanvasRenderingContext2D, vp: Viewport, dpr: number, sp: Subpath | null, trail: readonly Point[] = []) {
  screen(ctx, dpr);
  const m = toScreen(vp);
  if (sp) {
    ctx.stroke(pathIn([sp], m));
    for (const n of sp.nodes) square(ctx, ...toS(vp, n), 6, '#fff');
  }
  if (trail.length > 1) {
    ctx.beginPath();
    trail.forEach((p, i) => (i ? ctx.lineTo(...toS(vp, p)) : ctx.moveTo(...toS(vp, p))));
    ctx.stroke();
  }
}
