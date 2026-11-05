import type { Box, Mat } from '../model/geometry';

/** Ansicht: zoom = CSS-Pixel pro mm, x/y = Bildschirmlage des Seitenursprungs. */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** 100 %: 1 mm in CSS-Pixeln (96 dpi). */
export const MM_TO_PX = 96 / 25.4;
// Spec §12: 1 % … 64 000 %.
export const MIN_ZOOM = MM_TO_PX * 0.01;
export const MAX_ZOOM = MM_TO_PX * 640;

export const toScreen = (vp: Viewport): Mat => [vp.zoom, 0, 0, vp.zoom, vp.x, vp.y];

export const screenToPage = (vp: Viewport, sx: number, sy: number): [number, number] => [
  (sx - vp.x) / vp.zoom,
  (sy - vp.y) / vp.zoom,
];

/** Neuer Zoom, der Seitenpunkt unter (sx, sy) bleibt stehen. */
export function zoomTo(vp: Viewport, zoom: number, sx: number, sy: number): Viewport {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  return { zoom: z, x: sx - ((sx - vp.x) * z) / vp.zoom, y: sy - ((sy - vp.y) * z) / vp.zoom };
}

export const zoomAt = (vp: Viewport, sx: number, sy: number, factor: number): Viewport =>
  zoomTo(vp, vp.zoom * factor, sx, sy);

export const fitPage = (width: number, height: number, viewW: number, viewH: number, margin = 24): Viewport =>
  fitBox({ minX: 0, minY: 0, maxX: width, maxY: height }, viewW, viewH, margin);

/** Seitenbereich mittig mit Rand in die Fläche legen (Zoom auf Auswahl, Zoom-Rahmen). */
export function fitBox(b: Box, viewW: number, viewH: number, margin = 24): Viewport {
  const fit = Math.min((viewW - 2 * margin) / (b.maxX - b.minX), (viewH - 2 * margin) / (b.maxY - b.minY));
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit));
  return { zoom, x: viewW / 2 - ((b.minX + b.maxX) / 2) * zoom, y: viewH / 2 - ((b.minY + b.maxY) / 2) * zoom };
}

/** Bildschirm-Matrix, die ein in Ansicht `from` gezeichnetes Bild in Ansicht `to` deckungsgleich legt. */
export function snapshotTransform(from: Viewport, to: Viewport): Mat {
  const k = to.zoom / from.zoom;
  return [k, 0, 0, k, to.x - from.x * k, to.y - from.y * k];
}

export function visibleBox(vp: Viewport, viewW: number, viewH: number): Box {
  const [minX, minY] = screenToPage(vp, 0, 0);
  const [maxX, maxY] = screenToPage(vp, viewW, viewH);
  return { minX, minY, maxX, maxY };
}
