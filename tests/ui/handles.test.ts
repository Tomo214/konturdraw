import { expect, test } from 'vitest';
import { apply, type Mat } from '../../src/model/geometry';
import { dragBox, handleAt, handleCursor, handleNear, rotateFromDrag, scaleFromHandle, skewFromHandle } from '../../src/ui/handles';

const box = { minX: 0, minY: 0, maxX: 10, maxY: 20 };
const at = (m: Mat, x: number, y: number) => apply(m, x, y).map((v) => Math.round(v * 1e9) / 1e9 + 0); // + 0: −0 → 0
const plain = { free: false, center: false };

test('handleAt liefert Ecken und Kantenmitten', () => {
  expect(handleAt(box, 'nw')).toEqual({ x: 0, y: 0 });
  expect(handleAt(box, 'e')).toEqual({ x: 10, y: 10 });
  expect(handleAt(box, 's')).toEqual({ x: 5, y: 20 });
});

test('Ecke skaliert proportional vom gegenüberliegenden Griff, Shift frei', () => {
  const m = scaleFromHandle(box, 'se', { x: 20, y: 30 }, plain);
  expect(at(m, 0, 0)).toEqual([0, 0]);
  expect(at(m, 10, 20)).toEqual([20, 40]);
  expect(at(scaleFromHandle(box, 'se', { x: 20, y: 30 }, { free: true, center: false }), 10, 20)).toEqual([20, 30]);
});

test('Kante skaliert nur eine Achse; Alt vom Mittelpunkt; über den Anker hinaus spiegelt', () => {
  expect(at(scaleFromHandle(box, 'e', { x: 15, y: 99 }, plain), 10, 20)).toEqual([15, 20]);
  expect(at(scaleFromHandle(box, 'e', { x: 15, y: 0 }, { free: false, center: true }), 0, 0)).toEqual([-5, 0]);
  expect(at(scaleFromHandle(box, 'e', { x: -10, y: 0 }, plain), 10, 0)).toEqual([-10, 0]);
});

test('Spiegeln einer Achse beim proportionalen Ziehen behält die andere Richtung', () => {
  const m = scaleFromHandle(box, 'se', { x: -10, y: 20 }, plain); // x gespiegelt, |sx| = |sy| = 1
  expect(at(m, 10, 20)).toEqual([-10, 20]);
});

test('Nullbreite bleibt endlich', () => {
  const m = scaleFromHandle({ minX: 5, minY: 0, maxX: 5, maxY: 10 }, 'se', { x: 9, y: 20 }, { free: true, center: false });
  expect(m.every(Number.isFinite)).toBe(true);
});

test('rotateFromDrag dreht um den Mittelpunkt, Shift rastet auf 15°', () => {
  const m = rotateFromDrag({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, false);
  expect(at(m, 10, 0)).toEqual([0, 10]);
  expect(at(rotateFromDrag({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 1 }, true), 10, 1)).toEqual([10, 1]); // 5,7° → 0°
  const snapped = rotateFromDrag({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 1.5 }, true); // 8,5° → 15°
  expect(Math.atan2(snapped[1], snapped[0])).toBeCloseTo(Math.PI / 12, 12);
});

test('skewFromHandle: obere Kante neigt horizontal, untere Kante bleibt', () => {
  const m = skewFromHandle(box, 'n', { x: 5, y: 0 }, { x: 8, y: 0 });
  expect(at(m, 0, 0)).toEqual([3, 0]);
  expect(at(m, 0, 20)).toEqual([0, 20]);
  const v = skewFromHandle(box, 'e', { x: 10, y: 10 }, { x: 10, y: 14 });
  expect(at(v, 10, 0)).toEqual([10, 4]);
  expect(at(v, 0, 0)).toEqual([0, 0]);
});

test('dragBox: normalisiert, Shift = Quadrat, Alt = aus der Mitte', () => {
  const plainBox = { square: false, center: false };
  expect(dragBox({ x: 10, y: 10 }, { x: 4, y: 30 }, plainBox)).toEqual({ minX: 4, minY: 10, maxX: 10, maxY: 30 });
  // Quadrat: längere Seite gilt, Richtung bleibt.
  expect(dragBox({ x: 10, y: 10 }, { x: 4, y: 30 }, { square: true, center: false })).toEqual({ minX: -10, minY: 10, maxX: 10, maxY: 30 });
  expect(dragBox({ x: 10, y: 10 }, { x: 13, y: 6 }, { square: false, center: true })).toEqual({ minX: 7, minY: 6, maxX: 13, maxY: 14 });
  expect(dragBox({ x: 0, y: 0 }, { x: 2, y: -5 }, { square: true, center: true })).toEqual({ minX: -5, minY: -5, maxX: 5, maxY: 5 });
});

test('Mauszeiger am Griff: Ecken schräg, Kanten gerade; im Drehmodus Drehpfeil an Ecken, Neigen an Kanten', () => {
  expect(handleCursor('nw', 'scale')).toBe('nwse-resize');
  expect(handleCursor('se', 'scale')).toBe('nwse-resize');
  expect(handleCursor('ne', 'scale')).toBe('nesw-resize');
  expect(handleCursor('sw', 'scale')).toBe('nesw-resize');
  expect(handleCursor('n', 'scale')).toBe('ns-resize');
  expect(handleCursor('w', 'scale')).toBe('ew-resize');
  expect(handleCursor('n', 'rotate')).toBe('ew-resize'); // obere Kante neigt waagerecht
  expect(handleCursor('e', 'rotate')).toBe('ns-resize');
  expect(handleCursor('ne', 'rotate')).toMatch(/^url\(.+\) \d+ \d+, alias$/);
});

test('Griff unter dem Zeiger: der nächste im Fangradius, auch genau auf der Objektecke', () => {
  const vp = { x: 0, y: 0, zoom: 2 };
  const big = { minX: 0, minY: 0, maxX: 20, maxY: 20 }; // 0…40 px, Griff nw bei (−6, −6)
  expect(handleNear(vp, big, -6, -6)).toBe('nw');
  expect(handleNear(vp, big, 0, 0)).toBe('nw'); // Objektecke, 8,5 px vom Griff
  expect(handleNear(vp, big, 20, 20)).toBeUndefined();
  const small = { minX: 0, minY: 0, maxX: 4, maxY: 4 }; // 8 px: nw (−6, −6), n (4, −6)
  expect(handleNear(vp, small, 0, -6)).toBe('n'); // näher an n, obwohl nw im Radius liegt
});

test('step (Strg): Faktor in ganzen 100-%-Schritten, nie 0; über die Gegenseite = gespiegelt', () => {
  const step = { free: false, center: false, step: true };
  expect(at(scaleFromHandle(box, 'e', { x: 16, y: 0 }, step), 10, 20)).toEqual([20, 20]); // 1,6 → 2
  expect(at(scaleFromHandle(box, 'e', { x: 3, y: 0 }, step), 10, 20)).toEqual([10, 20]); // 0,3 → 1
  expect(at(scaleFromHandle(box, 'e', { x: -8, y: 0 }, step), 10, 20)).toEqual([-10, 20]); // −0,8 → −1
  expect(at(scaleFromHandle(box, 'se', { x: 23, y: 41 }, step), 10, 20)).toEqual([20, 40]); // Ecke bleibt proportional
});
