import { expect, test } from 'vitest';
import { apply } from '../../src/model/geometry';
import { MAX_ZOOM, MM_TO_PX, fitBox, fitPage, screenToPage, snapshotTransform, toScreen, visibleBox, zoomAt, zoomTo } from '../../src/render/viewport';

const vp = { x: 40, y: 20, zoom: 2 };

test('screenToPage kehrt toScreen um', () => {
  const [sx, sy] = apply(toScreen(vp), 10, 30);
  expect([sx, sy]).toEqual([60, 80]);
  expect(screenToPage(vp, sx, sy)).toEqual([10, 30]);
});

test('zoomAt hält den Seitenpunkt unter dem Zeiger fest', () => {
  const before = screenToPage(vp, 300, 200);
  const next = zoomAt(vp, 300, 200, 1.5);
  expect(next.zoom).toBe(3);
  const after = screenToPage(next, 300, 200);
  expect(after[0]).toBeCloseTo(before[0], 9);
  expect(after[1]).toBeCloseTo(before[1], 9);
});

test('zoomAt begrenzt den Zoom', () => {
  expect(zoomAt(vp, 0, 0, 1e9).zoom).toBe(MAX_ZOOM);
});

test('fitPage zentriert die Seite mit Rand', () => {
  const fit = fitPage(210, 297, 800, 600, 24);
  expect(fit.zoom).toBeCloseTo((600 - 48) / 297, 9);
  expect(fit.x).toBeCloseTo((800 - 210 * fit.zoom) / 2, 9);
  expect(fit.y).toBeCloseTo(24, 9);
});

test('zoomTo 100 % = echte Millimeter auf 96-dpi-Basis, um die Mitte', () => {
  const next = zoomTo(vp, MM_TO_PX, 400, 300);
  expect(next.zoom).toBeCloseTo(96 / 25.4, 9);
  expect(screenToPage(next, 400, 300)[0]).toBeCloseTo(screenToPage(vp, 400, 300)[0], 9);
});

test('snapshotTransform legt ein altes Bild deckungsgleich in die neue Ansicht', () => {
  const next = zoomAt({ ...vp, x: vp.x + 30 }, 120, 90, 2.5);
  const m = snapshotTransform(vp, next);
  // Ein Seitenpunkt im alten Bild muss nach der Transformation dort liegen, wo die neue Ansicht ihn zeigt.
  const [ox, oy] = apply(toScreen(vp), 17, 23);
  const [nx, ny] = apply(toScreen(next), 17, 23);
  const [tx, ty] = apply(m, ox, oy);
  expect(tx).toBeCloseTo(nx, 9);
  expect(ty).toBeCloseTo(ny, 9);
});

test('visibleBox liefert den sichtbaren Seitenausschnitt', () => {
  expect(visibleBox(vp, 400, 300)).toEqual({ minX: -20, minY: -10, maxX: 180, maxY: 140 });
});

test('fitBox legt einen Seitenbereich mittig in die Fläche', () => {
  const v = fitBox({ minX: 10, minY: 20, maxX: 110, maxY: 70 }, 800, 600, 0);
  expect(v.zoom).toBeCloseTo(8, 9);
  const [cx, cy] = screenToPage(v, 400, 300);
  expect(cx).toBeCloseTo(60, 9);
  expect(cy).toBeCloseTo(45, 9);
});

test('fitBox begrenzt den Zoom, auch bei einem Punkt', () => {
  const v = fitBox({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 800, 600);
  expect(v.zoom).toBe(MAX_ZOOM);
  expect(screenToPage(v, 400, 300)).toEqual([5, 5]);
});
