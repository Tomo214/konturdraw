import { expect, test } from 'vitest';
import { pointAt, segmentsOf, subpathBounds } from '../../src/model/bezier';
import { geometry, shapeSubpaths } from '../../src/model/shapes';
import type { Shape, Subpath } from '../../src/model/types';
import { square } from './fixtures';

const box = (sps: readonly Subpath[]) => {
  const b = subpathBounds(sps)!;
  return [b.minX, b.minY, b.maxX, b.maxY].map((v) => Math.round(v * 1e6) / 1e6);
};
const rect = (radius: number, width = 40, height = 30): Shape => ({ kind: 'rect', x: 10, y: 20, width, height, radius });

test('Rechteck ohne Radius: vier Eckknoten im Uhrzeigersinn ab oben links', () => {
  const [sp] = shapeSubpaths(rect(0));
  expect(sp.closed).toBe(true);
  expect(sp.nodes.map((n) => [n.x, n.y, n.type])).toEqual([
    [10, 20, 'corner'],
    [50, 20, 'corner'],
    [50, 50, 'corner'],
    [10, 50, 'corner'],
  ]);
});

test('Abgerundetes Rechteck: Box bleibt, Bogenmitte liegt auf dem Radius', () => {
  const sps = shapeSubpaths(rect(10));
  expect(box(sps)).toEqual([10, 20, 50, 50]);
  expect(sps[0].nodes).toHaveLength(8);
  // Bogen oben rechts: Mittelpunkt (40, 30), Radius 10.
  const arc = segmentsOf(sps[0]).find((s) => !s.line && s.c[0].x === 40 && s.c[0].y === 20)!;
  const m = pointAt(arc.c, 0.5);
  expect(Math.hypot(m.x - 40, m.y - 30)).toBeCloseTo(10, 2);
});

test('Radius wird auf die halbe kürzere Seite begrenzt, ohne doppelte Knoten', () => {
  const [sp] = shapeSubpaths(rect(100, 20, 10));
  expect(box([sp])).toEqual([10, 20, 30, 30]);
  const n = sp.nodes;
  for (let i = 0; i < n.length; i++) {
    const a = n[i];
    const b = n[(i + 1) % n.length];
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1e-9);
  }
  expect(n).toHaveLength(6);
});

test('Ellipse: vier symmetrische Knoten, Kurve bleibt auf der Ellipse', () => {
  const s: Shape = { kind: 'ellipse', x: 0, y: 0, width: 60, height: 30 };
  const sps = shapeSubpaths(s);
  expect(box(sps)).toEqual([0, 0, 60, 30]);
  expect(sps[0].nodes.map((n) => [n.x, n.y, n.type])).toEqual([
    [30, 0, 'symmetric'],
    [60, 15, 'symmetric'],
    [30, 30, 'symmetric'],
    [0, 15, 'symmetric'],
  ]);
  for (const seg of segmentsOf(sps[0])) {
    const p = pointAt(seg.c, 0.5);
    expect(((p.x - 30) / 30) ** 2 + ((p.y - 15) / 15) ** 2).toBeCloseTo(1, 3);
  }
});

test('Vieleck: Ecken auf der Ellipse, erste oben in der Mitte', () => {
  const [sp] = shapeSubpaths({ kind: 'polygon', x: 0, y: 0, width: 20, height: 20, sides: 6, inner: null });
  expect(sp.nodes).toHaveLength(6);
  expect(sp.nodes[0].x).toBeCloseTo(10);
  expect(sp.nodes[0].y).toBeCloseTo(0);
  for (const n of sp.nodes) expect(Math.hypot(n.x - 10, n.y - 10)).toBeCloseTo(10);
});

test('Stern: doppelt so viele Knoten, jeder zweite auf dem Innenradius', () => {
  const [sp] = shapeSubpaths({ kind: 'polygon', x: 0, y: 0, width: 20, height: 20, sides: 5, inner: 0.4 });
  expect(sp.nodes).toHaveLength(10);
  sp.nodes.forEach((n, i) => expect(Math.hypot(n.x - 10, n.y - 10)).toBeCloseTo(i % 2 ? 4 : 10));
});

test('Gleiche Form → dieselbe Geometrie (Cache); Pfad liefert seine Teilpfade', () => {
  const s = rect(5);
  expect(shapeSubpaths(s)).toBe(shapeSubpaths(s));
  const p = square('p');
  expect(geometry(p)).toBe(p.subpaths);
  expect(geometry({ type: 'shape', id: 's', transform: p.transform, style: p.style, shape: s })).toBe(shapeSubpaths(s));
});
