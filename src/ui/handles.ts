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

/** Ecken proportional (free = Shift: frei), Kanten nur eine Achse; center = Alt: vom Mittelpunkt. Über den Anker ziehen spiegelt. */
export function scaleFromHandle(b: Box, h: Handle, p: Point, opts: { free: boolean; center: boolean }): Mat {
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
  return about(scale(sx, sy), anchor.x, anchor.y);
}

/** Aufgezogene Box vom Startpunkt s zum Zeiger p; square = Shift (längere Seite gilt), center = Alt (s ist Mitte). */
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

/** Drehung um center um den Winkel zwischen start und p; snap = Shift: 15°-Schritte. */
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
