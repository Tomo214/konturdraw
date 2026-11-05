import { expect, test } from 'vitest';
import { cubicBounds, nearest, pointAt, segmentsOf, splitCubic, subpathBounds, transformSubpath } from '../../src/model/bezier';
import { multiply, scale, translate } from '../../src/model/geometry';
import type { Point } from '../../src/model/types';
import { pt, sub } from './fixtures';

// Bogen (0,0) → (10,0) mit Kontrollpunkten (0,10), (10,10): y(t) = 30·t·(1−t), Scheitel 7,5 bei t = 0,5.
const arch = [
  { x: 0, y: 0 },
  { x: 0, y: 10 },
  { x: 10, y: 10 },
  { x: 10, y: 0 },
] as const;

const close = (a: Point, b: Point) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

test('offener Pfad: n−1 Segmente, Gerade ohne Anfasser', () => {
  const segs = segmentsOf(sub(false, pt(0, 0), pt(10, 0), pt(10, 10)));
  expect(segs.map((s) => [s.a, s.b, s.line])).toEqual([
    [0, 1, true],
    [1, 2, true],
  ]);
});

test('geschlossener Pfad: Schlusssegment vom letzten zum ersten Knoten', () => {
  const segs = segmentsOf(sub(true, pt(0, 0), pt(10, 0), pt(10, 10)));
  expect(segs.map((s) => [s.a, s.b])).toEqual([
    [0, 1],
    [1, 2],
    [2, 0],
  ]);
});

test('ein Anfasser genügt für eine Kurve; der fehlende liegt auf dem Knoten', () => {
  const [s] = segmentsOf(sub(false, pt(0, 0, { handleOut: { x: 0, y: 10 } }), pt(10, 0)));
  expect(s.line).toBe(false);
  expect(s.c).toEqual([
    { x: 0, y: 0 },
    { x: 0, y: 10 },
    { x: 10, y: 0 },
    { x: 10, y: 0 },
  ]);
});

test('pointAt: Endpunkte und Scheitel', () => {
  close(pointAt(arch, 0), { x: 0, y: 0 });
  close(pointAt(arch, 1), { x: 10, y: 0 });
  close(pointAt(arch, 0.5), { x: 5, y: 7.5 });
});

test('splitCubic teilt formtreu', () => {
  const [l, r] = splitCubic(arch, 0.3);
  close(l[0], arch[0]);
  close(l[3], pointAt(arch, 0.3));
  close(r[0], pointAt(arch, 0.3));
  close(r[3], arch[3]);
  close(pointAt(l, 0.5), pointAt(arch, 0.15));
  close(pointAt(r, 0.5), pointAt(arch, 0.65));
});

test('cubicBounds ist eng (Kurve, nicht Kontrollpolygon)', () => {
  const b = cubicBounds(arch);
  expect(b.minX).toBeCloseTo(0, 9);
  expect(b.maxX).toBeCloseTo(10, 9);
  expect(b.minY).toBeCloseTo(0, 9);
  expect(b.maxY).toBeCloseTo(7.5, 9);
});

test('subpathBounds nach Transformation', () => {
  const s = sub(false, pt(0, 0, { handleOut: { x: 0, y: 10 } }), pt(10, 0, { handleIn: { x: 10, y: 10 } }));
  const b = subpathBounds([s], multiply(translate(100, 0), scale(2, 2)));
  expect(b).not.toBeNull();
  expect(b!.minX).toBeCloseTo(100, 9);
  expect(b!.maxX).toBeCloseTo(120, 9);
  expect(b!.maxY).toBeCloseTo(15, 9);
});

test('nearest findet t und Abstand', () => {
  const r = nearest(arch, { x: 5, y: 9 });
  expect(r.t).toBeCloseTo(0.5, 4);
  expect(r.dist).toBeCloseTo(1.5, 4);
});

test('transformSubpath bildet Knoten und Anfasser ab', () => {
  const s = sub(true, pt(1, 2, { handleOut: { x: 3, y: 4 } }), pt(5, 6));
  const t = transformSubpath(s, translate(10, 20));
  expect(t.closed).toBe(true);
  expect(t.nodes[0]).toEqual({ x: 11, y: 22, type: 'corner', handleOut: { x: 13, y: 24 } });
  expect(t.nodes[1]).toEqual({ x: 15, y: 26, type: 'corner' });
});
