import { expect, test } from 'vitest';
import { pointAt, segmentsOf, type Cubic } from '../../src/model/bezier';
import { reduceNodes } from '../../src/model/reduce';
import type { Point, Subpath } from '../../src/model/types';
import { chop } from './fixtures';

const P = (x: number, y: number): Point => ({ x, y });

const dense = (sp: Subpath, n: number) => segmentsOf(sp).flatMap((s) => Array.from({ length: n + 1 }, (_, k) => pointAt(s.c, k / n)));

/** Größter Abstand der Punkte von `b` zur Form `a` (mm), per dichter Abtastung von `a`. */
function deviation(a: Subpath, b: Subpath): number {
  const ref = dense(a, 400);
  return Math.max(...dense(b, 40).map((p) => Math.min(...ref.map((q) => Math.hypot(p.x - q.x, p.y - q.y)))));
}

const arc: Cubic = [P(0, 0), P(10, 20), P(30, 20), P(40, 0)];

test('Offener Pfad: überzählige glatte Knoten fallen weg, Form bleibt innerhalb der Toleranz', () => {
  const sp: Subpath = { closed: false, nodes: chop(arc, 10) };
  const [out] = reduceNodes([sp], null, 0.05);
  expect(out.nodes.length).toBeLessThanOrEqual(3); // von 11
  const [first, last] = [out.nodes[0], out.nodes[out.nodes.length - 1]];
  expect([first.x, first.y, last.x, last.y]).toEqual([0, 0, 40, 0]);
  expect(deviation(sp, out)).toBeLessThan(0.05);
});

test('Ecknoten bleiben an Ort und Stelle', () => {
  const right: Cubic = [P(40, 0), P(50, -20), P(70, -20), P(80, 0)];
  const nodes = chop(arc, 6);
  const tail = chop(right, 6);
  nodes[nodes.length - 1] = { ...nodes[nodes.length - 1], handleOut: tail[0].handleOut };
  const sp: Subpath = { closed: false, nodes: [...nodes, ...tail.slice(1)] };
  const [out] = reduceNodes([sp], null, 0.05);
  expect(out.nodes.length).toBeLessThanOrEqual(5); // von 13
  const corners = out.nodes.filter((n) => n.type === 'corner').map((n) => [n.x, n.y]);
  expect(corners).toEqual([[0, 0], [40, 0], [80, 0]]);
  expect(deviation(sp, out)).toBeLessThan(0.05);
});

test('Mit Knotenauswahl: nur gewählte Knoten dürfen verschwinden', () => {
  const sp: Subpath = { closed: false, nodes: chop(arc, 10) };
  const picked = [1, 2, 3, 4].map((index) => ({ sub: 0, index }));
  const [out] = reduceNodes([sp], picked, 0.05);
  expect(out.nodes.length).toBeLessThan(11);
  const at = out.nodes.map((n) => [n.x, n.y]);
  for (const i of [5, 6, 7, 8, 9]) expect(at).toContainEqual([sp.nodes[i].x, sp.nodes[i].y]);
  expect(out.nodes.slice(-4)).toEqual(sp.nodes.slice(-4)); // hinter der Auswahl unverändert
  expect(deviation(sp, out)).toBeLessThan(0.05);
});

test('Geschlossener Pfad nur aus glatten Knoten bleibt geschlossen und nah an der Form', () => {
  const top = chop([P(0, 0), P(0, -14), P(40, -14), P(40, 0)], 8);
  const bottom = chop([P(40, 0), P(40, 14), P(0, 14), P(0, 0)], 8);
  const nodes = [...top.slice(0, -1), ...bottom.slice(0, -1)].map((n) => ({ ...n, type: 'smooth' as const }));
  nodes[0] = { ...nodes[0], handleIn: bottom[bottom.length - 1].handleIn };
  nodes[8] = { ...nodes[8], handleIn: top[top.length - 1].handleIn };
  const sp: Subpath = { closed: true, nodes };
  const [out] = reduceNodes([sp], null, 0.05);
  expect(out.closed).toBe(true);
  expect(out.nodes.length).toBeLessThanOrEqual(4);
  expect(deviation(sp, out)).toBeLessThan(0.05);
});

test('Nichts zu holen → derselbe Pfad (kein leerer Rückgängig-Schritt)', () => {
  const sps = [{ closed: false, nodes: chop(arc, 1) }];
  expect(reduceNodes(sps, null, 0.05)).toBe(sps);
});
