import { expect, test } from 'vitest';
import { translate } from '../../src/model/geometry';
import { hitPath } from '../../src/ui/node-hit';
import { pt, sub } from '../model/fixtures';

// Quadrat 10 × 10 bei (10, 10), Zoom 2 → Bildschirm (20..40, 20..40). Knoten 0 hat einen Ausgangsanfasser nach oben.
const sps = [sub(true, pt(0, 0, { handleOut: { x: 5, y: -15 } }), pt(10, 0), pt(10, 10), pt(0, 10))];
const world = translate(10, 10);
const vp = { x: 0, y: 0, zoom: 2 };
const none = new Set<string>();

test('Knoten innerhalb der Toleranz', () => {
  expect(hitPath(sps, world, vp, 22, 21, none)).toEqual({ kind: 'node', ref: { sub: 0, index: 0 } });
});

test('Segment mit Parameter t', () => {
  const h = hitPath(sps, world, vp, 39, 30, none);
  expect(h).toMatchObject({ kind: 'seg', sub: 0, seg: 1 });
  expect(h!.kind === 'seg' && h!.t).toBeCloseTo(0.5, 2);
});

test('Anfasser nur bei gewähltem Knoten', () => {
  // Anfasser (5, −15) → Welt (15, −5) → Bildschirm (30, −10); Kurve selbst liegt ≥ 15 px entfernt
  expect(hitPath(sps, world, vp, 30, -9, none)).toBeNull();
  expect(hitPath(sps, world, vp, 30, -9, new Set(['0:0']))).toEqual({ kind: 'out', ref: { sub: 0, index: 0 } });
});

test('daneben → null', () => {
  expect(hitPath(sps, world, vp, 100, 100, none)).toBeNull();
});
