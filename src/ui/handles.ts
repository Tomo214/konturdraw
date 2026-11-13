import { about, IDENTITY, rotate, scale, skew, type Box, type Mat } from '../model/geometry';
import type { Point } from '../model/types';

// Griffe um die Auswahl-Box (Seitenkoordinaten). Liefert die Matrix für transformNodes.

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const OPPOSITE: Record<Handle, Handle> = { nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e' };

export function handleAt(b: Box, h: Handle): Point {
  const x = h.includes('w') ? b.minX : h.includes('e') ? b.maxX : (b.minX + b.maxX) / 2;
  const y = h.includes('n') ? b.minY : h.includes('s') ? b.maxY : (b.minY + b.maxY) / 2;
  return { x, y };
}

/** Abstand der Griffe zur Box in Bildschirmpixeln (wie Vorbild knapp außerhalb): nahe der Ecke innen greifen verschiebt. */
export const HANDLE_GAP = 6;

/** Griff-Mitte auf dem Schirm; vp wie Viewport (Seite → Pixel), um HANDLE_GAP nach außen gerückt. */
export function handleOnScreen(vp: { x: number; y: number; zoom: number }, b: Box, h: Handle): [number, number] {
  const p = handleAt(b, h);
  const dx = h.includes('w') ? -HANDLE_GAP : h.includes('e') ? HANDLE_GAP : 0;
  const dy = h.includes('n') ? -HANDLE_GAP : h.includes('s') ? HANDLE_GAP : 0;
  return [p.x * vp.zoom + vp.x + dx, p.y * vp.zoom + vp.y + dy];
}

/** Fangradius der Griffe in Bildschirmpixeln: reicht bis auf die Objektecke (HANDLE_GAP · √2 ≈ 8,5). */
export const HANDLE_HIT = 9;

/** Nächster Griff im Fangradius um den Bildschirmpunkt; bei kleinen Objekten überlappen die Radien. */
export function handleNear(vp: { x: number; y: number; zoom: number }, b: Box, sx: number, sy: number): Handle | undefined {
  let best: Handle | undefined;
  let dist = HANDLE_HIT;
  for (const h of HANDLES) {
    const [x, y] = handleOnScreen(vp, b, h);
    const d = Math.hypot(x - sx, y - sy);
    if (d <= dist) [best, dist] = [h, d];
  }
  return best;
}

// Eigener Drehpfeil (Kreisbogen mit Spitze), weiß unterlegt für dunkle Flächen.
const ARC = 'M15 6.5A6 6 0 1 0 16 11 M15.5 2.5v4.5H11';
const ROTATE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
  `<path d="${ARC}" stroke="#fff" stroke-width="4"/><path d="${ARC}" stroke="#000" stroke-width="1.6"/></svg>`;
const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(ROTATE_SVG)}") 10 10, alias`;

/** CSS-Mauszeiger über einem Griff: Größenpfeile; im Drehmodus Drehpfeil an Ecken, Neigen an Kanten. */
export function handleCursor(h: Handle, mode: 'scale' | 'rotate'): string {
  if (mode === 'rotate') return h.length === 2 ? ROTATE_CURSOR : h === 'n' || h === 's' ? 'ew-resize' : 'ns-resize';
  if (h.length === 2) return h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize';
  return h === 'n' || h === 's' ? 'ns-resize' : 'ew-resize';
}

/** Ecken proportional (free: frei), Kanten nur eine Achse; center: vom Mittelpunkt; step: ganze 100-%-Schritte, nie 0.
 *  Über den Anker ziehen spiegelt. Tasten wie Vorbild: Alt = free, Shift = center, Strg (Mac ⌘) = step. */
export function scaleFromHandle(b: Box, h: Handle, p: Point, opts: { free: boolean; center: boolean; step?: boolean }): Mat {
  const anchor = opts.center ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : handleAt(b, OPPOSITE[h]);
  const hp = handleAt(b, h);
  const factor = (pv: number, hv: number, av: number) => (hv === av ? 1 : (pv - av) / (hv - av));
  let sx = h.includes('e') || h.includes('w') ? factor(p.x, hp.x, anchor.x) : 1;
  let sy = h.includes('n') || h.includes('s') ? factor(p.y, hp.y, anchor.y) : 1;
  if (h.length === 2 && !opts.free) {
    const m = Math.max(Math.abs(sx), Math.abs(sy));
    sx = (sx < 0 ? -1 : 1) * m;
    sy = (sy < 0 ? -1 : 1) * m;
  }
  if (opts.step) [sx, sy] = [sx, sy].map((f) => Math.round(f) || (f < 0 ? -1 : 1));
  return about(scale(sx, sy), anchor.x, anchor.y);
}

/** Aufgezogene Box vom Startpunkt s zum Zeiger p; square = Strg/⌘ (längere Seite gilt), center = Shift (s ist Mitte) – wie Vorbild. */
export function dragBox(s: Point, p: Point, opts: { square: boolean; center: boolean }): Box {
  let dx = p.x - s.x;
  let dy = p.y - s.y;
  if (opts.square) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * m;
    dy = (dy < 0 ? -1 : 1) * m;
  }
  const [x0, y0] = opts.center ? [s.x - dx, s.y - dy] : [s.x, s.y];
  const [x1, y1] = [s.x + dx, s.y + dy];
  return { minX: Math.min(x0, x1), minY: Math.min(y0, y1), maxX: Math.max(x0, x1), maxY: Math.max(y0, y1) };
}

/** Drehung um center um den Winkel zwischen start und p; snap = Strg/⌘ (wie Vorbild): 15°-Schritte. */
export function rotateFromDrag(center: Point, start: Point, p: Point, snap: boolean): Mat {
  let a = Math.atan2(p.y - center.y, p.x - center.x) - Math.atan2(start.y - center.y, start.x - center.x);
  if (snap) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
  return about(rotate(a), center.x, center.y);
}

/** Neigen an einer Kante; die gegenüberliegende Kante bleibt stehen. Ecken neigen nicht. */
export function skewFromHandle(b: Box, h: Handle, start: Point, p: Point): Mat {
  if (h.length === 2) return IDENTITY;
  const hp = handleAt(b, h);
  const anchor = handleAt(b, OPPOSITE[h]);
  if (h === 'n' || h === 's') {
    if (hp.y === anchor.y) return IDENTITY;
    return about(skew((p.x - start.x) / (hp.y - anchor.y), 0), anchor.x, anchor.y);
  }
  if (hp.x === anchor.x) return IDENTITY;
  return about(skew(0, (p.y - start.y) / (hp.x - anchor.x)), anchor.x, anchor.y);
}
