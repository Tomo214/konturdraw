// Lineale, Raster und Hilfslinien (Phase 4c), gezeichnet in Bildschirm-Pixeln. Teilung rechnet render/ruler.ts.
import { gridOf, originOf } from '../model/guides';
import type { Doc, Guide, Point } from '../model/types';
import { DEFAULT_UNIT, UNITS, formatNumber } from '../model/units';
import { gridStep, rulerMarks, rulerStep } from '../render/ruler';
import type { Snap, SnapKind } from '../render/snap';
import type { Viewport } from '../render/viewport';
import { ACCENT } from './overlay';
import { N_, tr } from '../i18n/i18n.svelte';

/** Lineal-Breite in CSS-Pixeln. */
export const RULER = 20;

const GUIDE = '#3aa6e8';
const GRID = 'rgb(120 120 135 / 0.32)';

/** Aus theme.css gelesen (Canvas kennt keine CSS-Variablen). */
export interface RulerLook {
  bg: string;
  page: string;
  tick: string;
  text: string;
  font: string;
}

const crisp = (s: number) => Math.round(s) + 0.5;

// Bildschirmlagen der Linien o + i·step (mm) zwischen 0 und len; zu dicht → nur jede k-te.
function gridLines(o: number, step: number, off: number, zoom: number, len: number, at: (s: number) => void) {
  const k = step * gridStep(step * zoom);
  for (let i = Math.ceil((-off / zoom - o) / k); ; i++) {
    const s = off + (o + i * k) * zoom;
    if (s > len) return;
    at(crisp(s));
  }
}

/** Raster ab Nullpunkt über die ganze Fläche, hinter den Objekten. */
export function drawGrid(ctx: CanvasRenderingContext2D, vp: Viewport, dpr: number, w: number, h: number, doc: Doc) {
  const o = originOf(doc);
  const g = gridOf(doc);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineWidth = 1;
  ctx.strokeStyle = GRID;
  ctx.beginPath();
  gridLines(o.x, g.x, vp.x, vp.zoom, w, (s) => (ctx.moveTo(s, 0), ctx.lineTo(s, h)));
  gridLines(o.y, g.y, vp.y, vp.zoom, h, (s) => (ctx.moveTo(0, s), ctx.lineTo(w, s)));
  ctx.stroke();
}

/** Hilfslinien über die ganze Fläche; gewählte in Akzentfarbe, gesperrte gestrichelt. */
export function drawGuides(ctx: CanvasRenderingContext2D, vp: Viewport, dpr: number, w: number, h: number, guides: readonly Guide[], selected: string | null) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineWidth = 1;
  for (const g of guides) {
    const s = crisp(g.axis === 'h' ? vp.y + g.pos * vp.zoom : vp.x + g.pos * vp.zoom);
    ctx.strokeStyle = g.id === selected ? ACCENT : GUIDE;
    ctx.setLineDash(g.locked ? [5, 3] : []);
    ctx.beginPath();
    if (g.axis === 'h') ctx.moveTo(0, s), ctx.lineTo(w, s);
    else ctx.moveTo(s, 0), ctx.lineTo(s, h);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

const SNAP_NAME: Record<SnapKind, string> = {
  node: N_('Knoten'), midpoint: N_('Streckenmitte'), center: N_('Mittelpunkt'), edge: N_('Kante'), guide: N_('Hilfslinie'), grid: N_('Raster'),
};

/** Fangpunkt-Anzeige: Marke je Zielart in Akzentfarbe, weiß umrandet (auf hell und dunkel lesbar), Name daneben. */
export function drawSnap(ctx: CanvasRenderingContext2D, vp: Viewport, dpr: number, hit: Snap, font: string) {
  const x = crisp(vp.x + hit.x * vp.zoom);
  const y = crisp(vp.y + hit.y * vp.zoom);
  const r = 5;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.beginPath();
  if (hit.kind === 'node') ctx.rect(x - r, y - r, 2 * r, 2 * r);
  else if (hit.kind === 'midpoint') ctx.moveTo(x, y - r - 1), ctx.lineTo(x + r + 1, y + r), ctx.lineTo(x - r - 1, y + r), ctx.closePath();
  else if (hit.kind === 'edge') ctx.moveTo(x, y - r - 1), ctx.lineTo(x + r + 1, y), ctx.lineTo(x, y + r + 1), ctx.lineTo(x - r - 1, y), ctx.closePath();
  else if (hit.kind === 'center') ctx.arc(x, y, r, 0, 2 * Math.PI), ctx.moveTo(x - 2, y), ctx.lineTo(x + 2, y), ctx.moveTo(x, y - 2), ctx.lineTo(x, y + 2);
  else ctx.moveTo(x - r - 2, y), ctx.lineTo(x + r + 2, y), ctx.moveTo(x, y - r - 2), ctx.lineTo(x, y + r + 2);
  [ctx.lineWidth, ctx.strokeStyle] = [4, '#fff'];
  ctx.stroke();
  [ctx.lineWidth, ctx.strokeStyle] = [2, ACCENT];
  ctx.stroke();

  const name = tr(SNAP_NAME[hit.kind]);
  ctx.font = `11px ${font}`;
  ctx.textBaseline = 'middle';
  const [bx, by, bw, bh] = [x + 10, y + 10, ctx.measureText(name).width + 12, 18];
  ctx.fillStyle = 'rgb(26 26 29 / 0.92)';
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 4);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(name, bx + 6, by + bh / 2 + 0.5);
}

/** Fadenkreuz beim Ziehen des Nullpunkts aus der Lineal-Ecke. */
export function drawCrosshair(ctx: CanvasRenderingContext2D, dpr: number, w: number, h: number, sx: number, sy: number) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineWidth = 1;
  ctx.strokeStyle = ACCENT;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(crisp(sx), 0), ctx.lineTo(crisp(sx), h);
  ctx.moveTo(0, crisp(sy)), ctx.lineTo(w, crisp(sy));
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * Lineal oben (x) oder links (y), len = Länge in CSS-Pixeln. Werte in Dokumenteinheit ab Nullpunkt, y nach oben.
 * Gezeichnet in Lineal-Koordinaten (u entlang, v quer, v = RULER an der Fläche); das linke Lineal ist gedreht,
 * damit seine Zahlen von unten nach oben laufen. cursor = Zeigerlage auf der Fläche (Bildschirm-px).
 */
export function drawRuler(ctx: CanvasRenderingContext2D, dpr: number, axis: 'x' | 'y', len: number, vp: Viewport, doc: Doc, cursor: Point | null, look: RulerLook) {
  const unit = UNITS[doc.units ?? DEFAULT_UNIT].mm;
  const o = originOf(doc);
  const page = doc.pages[0];
  const vertical = axis === 'y';
  if (vertical) ctx.setTransform(0, -dpr, dpr, 0, 0, len * dpr);
  else ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Bildschirmlage s (entlang der Fläche) → u im Lineal.
  const u = (s: number) => (vertical ? len - s : s);
  const off = vertical ? vp.y + o.y * vp.zoom : vp.x + o.x * vp.zoom;
  const px = vp.zoom * unit * (vertical ? -1 : 1); // Bildschirm-px je Einheit, mit Richtung
  const screenOf = (v: number) => off + v * px;

  ctx.fillStyle = look.bg;
  ctx.fillRect(0, 0, len, RULER);
  const [p0, p1] = vertical ? [vp.y, vp.y + page.height * vp.zoom] : [vp.x, vp.x + page.width * vp.zoom];
  ctx.fillStyle = look.page;
  ctx.fillRect(Math.min(u(p0), u(p1)), 0, Math.abs(p1 - p0), RULER);

  const { step, sub } = rulerStep(Math.abs(px));
  const [a, b] = [-off / px, (len - off) / px];
  ctx.strokeStyle = look.tick;
  ctx.fillStyle = look.text;
  ctx.font = `10px ${look.font}`;
  ctx.textBaseline = 'top';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const m of rulerMarks(Math.min(a, b), Math.max(a, b), step, sub)) {
    const at = crisp(u(screenOf(m.v)));
    const half = !m.major && sub % 2 === 0 && Number.isInteger(Number(((m.v * 2) / step).toPrecision(12)));
    ctx.moveTo(at, RULER);
    ctx.lineTo(at, RULER - (m.major ? RULER : half ? 7 : 4));
    if (m.major) ctx.fillText(formatNumber(m.v), at + 3, 2);
  }
  ctx.moveTo(0, RULER - 0.5);
  ctx.lineTo(len, RULER - 0.5);
  ctx.stroke();

  if (cursor) {
    const at = crisp(u(vertical ? cursor.y : cursor.x));
    ctx.strokeStyle = ACCENT;
    ctx.beginPath();
    ctx.moveTo(at, 0);
    ctx.lineTo(at, RULER);
    ctx.stroke();
  }
}
