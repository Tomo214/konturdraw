import { expect, test } from 'vitest';
import { pointAt, segmentAt } from '../../src/model/bezier';
import {
  breakAt,
  deleteNodes,
  insertNode,
  joinEnds,
  moveHandle,
  moveNodes,
  setClosed,
  setNodeType,
  toCurve,
  toLine,
} from '../../src/model/path-edit';
import { pt, sub } from './fixtures';

const line3 = [sub(false, pt(0, 0), pt(10, 0), pt(20, 0))];
const smoothMid = (type: 'smooth' | 'symmetric' | 'corner') => [
  sub(false, pt(0, 0), pt(10, 0, { type, handleIn: { x: 6, y: 0 }, handleOut: { x: 12, y: 0 } }), pt(20, 0)),
];

test('moveNodes verschiebt Knoten samt Anfassern, andere bleiben geteilt', () => {
  const sps = smoothMid('smooth');
  const r = moveNodes(sps, [{ sub: 0, index: 1 }], 1, 2);
  expect(r[0].nodes[1]).toEqual({ x: 11, y: 2, type: 'smooth', handleIn: { x: 7, y: 2 }, handleOut: { x: 13, y: 2 } });
  expect(r[0].nodes[0]).toBe(sps[0].nodes[0]);
});

test('moveHandle Ecke: Gegenseite bleibt', () => {
  const r = moveHandle(smoothMid('corner'), { sub: 0, index: 1 }, 'out', { x: 10, y: 5 });
  expect(r[0].nodes[1].handleOut).toEqual({ x: 10, y: 5 });
  expect(r[0].nodes[1].handleIn).toEqual({ x: 6, y: 0 });
});

test('moveHandle glatt: Gegenseite kollinear, eigene Länge bleibt', () => {
  const h = moveHandle(smoothMid('smooth'), { sub: 0, index: 1 }, 'out', { x: 10, y: 3 }); // nach unten
  const n = h[0].nodes[1];
  expect(n.handleIn!.x).toBeCloseTo(10, 9);
  expect(n.handleIn!.y).toBeCloseTo(-4, 9); // Länge 4 bleibt, Richtung gegenüber
});

test('moveHandle symmetrisch: Gegenseite gespiegelt', () => {
  const n = moveHandle(smoothMid('symmetric'), { sub: 0, index: 1 }, 'in', { x: 7, y: 4 })[0].nodes[1];
  expect(n.handleOut).toEqual({ x: 13, y: -4 });
});

test('setNodeType glatt ohne Anfasser erzeugt Tangente aus den Nachbarn', () => {
  const sps = [sub(false, pt(0, 0), pt(10, 10), pt(20, 0))];
  const n = setNodeType(sps, { sub: 0, index: 1 }, 'smooth')[0].nodes[1];
  expect(n.type).toBe('smooth');
  expect(n.handleIn!.y).toBeCloseTo(10, 9); // Tangente parallel zu (0,0)→(20,0)
  expect(n.handleOut!.y).toBeCloseTo(10, 9);
  expect(n.handleIn!.x).toBeLessThan(10);
  expect(n.handleOut!.x).toBeGreaterThan(10);
});

test('setNodeType symmetrisch gleicht Längen an', () => {
  const sps = [sub(false, pt(0, 0), pt(10, 0, { handleIn: { x: 8, y: 0 }, handleOut: { x: 16, y: 0 } }), pt(20, 0))];
  const n = setNodeType(sps, { sub: 0, index: 1 }, 'symmetric')[0].nodes[1];
  expect(n.handleIn).toEqual({ x: 6, y: 0 });
  expect(n.handleOut).toEqual({ x: 14, y: 0 });
});

test('insertNode auf Kurve ändert die Form nicht', () => {
  const arch = [sub(false, pt(0, 0, { handleOut: { x: 0, y: 10 } }), pt(10, 0, { handleIn: { x: 10, y: 10 } }))];
  const before = segmentAt(arch[0], 0).c;
  const r = insertNode(arch, 0, 0, 0.3);
  expect(r[0].nodes).toHaveLength(3);
  const a = pointAt(segmentAt(r[0], 0).c, 0.5);
  const b = pointAt(before, 0.15);
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
  expect(r[0].nodes[1].type).toBe('smooth');
});

test('insertNode auf Gerade setzt Eckknoten ohne Anfasser', () => {
  const r = insertNode(line3, 0, 1, 0.5);
  expect(r[0].nodes[2]).toEqual({ x: 15, y: 0, type: 'corner' });
});

test('deleteNodes entfernt; Teilpfade unter zwei Knoten fallen weg', () => {
  const sps = [sub(false, pt(0, 0), pt(10, 0)), ...line3];
  const r = deleteNodes(sps, [{ sub: 0, index: 0 }, { sub: 1, index: 1 }]);
  expect(r).toHaveLength(1);
  expect(r[0].nodes.map((n) => n.x)).toEqual([0, 20]);
});

test('toCurve legt Anfasser auf Drittel, toLine entfernt sie wieder', () => {
  const c = toCurve(line3, 0, 0);
  expect(c[0].nodes[0].handleOut).toEqual({ x: 10 / 3, y: 0 });
  expect(c[0].nodes[1].handleIn).toEqual({ x: 20 / 3, y: 0 });
  const l = toLine(c, 0, 0);
  expect(segmentAt(l[0], 0).line).toBe(true);
});

test('breakAt öffnet geschlossenen Pfad am Knoten', () => {
  const sq = [sub(true, pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10))];
  const r = breakAt(sq, { sub: 0, index: 2 });
  expect(r[0].closed).toBe(false);
  expect(r[0].nodes.map((n) => [n.x, n.y])).toEqual([
    [10, 10],
    [0, 10],
    [0, 0],
    [10, 0],
    [10, 10],
  ]);
});

test('breakAt teilt offenen Pfad in zwei', () => {
  const r = breakAt(line3, { sub: 0, index: 1 });
  expect(r.map((s) => s.nodes.map((n) => n.x))).toEqual([
    [0, 10],
    [10, 20],
  ]);
});

test('joinEnds schließt eigenen Pfad, deckungsgleiche Enden verschmelzen', () => {
  const open = [sub(false, pt(0, 0, { handleOut: { x: 1, y: 1 } }), pt(10, 0), pt(0, 0, { handleIn: { x: -1, y: 1 } }))];
  const r = joinEnds(open, { sub: 0, index: 2 }, { sub: 0, index: 0 });
  expect(r[0].closed).toBe(true);
  expect(r[0].nodes).toHaveLength(2);
  expect(r[0].nodes[0]).toMatchObject({ handleIn: { x: -1, y: 1 }, handleOut: { x: 1, y: 1 } });
});

test('joinEnds verbindet zwei Teilpfade: erster endet bei a, zweiter beginnt bei b', () => {
  const sps = [sub(false, pt(0, 0), pt(10, 0, { handleIn: { x: 8, y: 1 } })), sub(false, pt(0, 5), pt(10, 5))];
  const r = joinEnds(sps, { sub: 0, index: 0 }, { sub: 1, index: 0 });
  expect(r).toHaveLength(1);
  expect(r[0].closed).toBe(false);
  expect(r[0].nodes.map((n) => [n.x, n.y])).toEqual([
    [10, 0],
    [0, 0],
    [0, 5],
    [10, 5],
  ]);
  expect(r[0].nodes[0].handleOut).toEqual({ x: 8, y: 1 }); // beim Umdrehen getauscht
});

test('setClosed', () => {
  expect(setClosed(line3, 0, true)[0].closed).toBe(true);
});
