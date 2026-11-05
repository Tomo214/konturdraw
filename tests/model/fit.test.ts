import { expect, test } from 'vitest';
import { nearest, pointAt, segmentsOf } from '../../src/model/bezier';
import { fitCurve, freehandPath } from '../../src/model/fit';
import type { Point, Subpath } from '../../src/model/types';

const distTo = (sp: Subpath, p: Point) => Math.min(...segmentsOf(sp).map((s) => nearest(s.c, p).dist));

function expectWithin(sp: Subpath, pts: Point[], tol: number) {
  for (const p of pts) expect(distTo(sp, p)).toBeLessThanOrEqual(tol + 1e-9);
}

test('Punkte einer Bézierkurve → genau ein Segment', () => {
  const arch = [
    { x: 0, y: 0 },
    { x: 0, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 0 },
  ] as const;
  const pts = Array.from({ length: 50 }, (_, i) => pointAt(arch, i / 49));
  // Endtangente kommt aus der ersten Sehne (robust bei Handeingabe) → ~0,06 Restfehler; 0,1 ist realistisch.
  const nodes = fitCurve(pts, 0.1);
  expect(nodes).toHaveLength(2);
  expectWithin({ closed: false, nodes }, pts, 0.1);
});

test('Gerade → zwei Knoten', () => {
  const pts = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 2 * i }));
  expect(fitCurve(pts, 0.1)).toHaveLength(2);
});

test('Ecke: mehrere Segmente, alle Punkte innerhalb der Toleranz, Übergänge glatt', () => {
  const pts = [
    ...Array.from({ length: 21 }, (_, i) => ({ x: i * 0.5, y: 0 })),
    ...Array.from({ length: 20 }, (_, i) => ({ x: 10, y: (i + 1) * 0.5 })),
  ];
  const nodes = fitCurve(pts, 0.2);
  expect(nodes.length).toBeGreaterThanOrEqual(3);
  expectWithin({ closed: false, nodes }, pts, 0.2);
  expect(nodes.slice(1, -1).every((n) => n.type === 'smooth')).toBe(true);
});

test('freehandPath schließt, wenn das Ende nah am Anfang liegt', () => {
  const pts = Array.from({ length: 60 }, (_, i) => {
    const a = (i / 60) * Math.PI * 2;
    return { x: 10 * Math.cos(a), y: 10 * Math.sin(a) };
  });
  const sp = freehandPath(pts, 0.1, 2)!;
  expect(sp.closed).toBe(true);
  expect(sp.nodes[0].handleIn).toBeDefined();
  expectWithin(sp, pts, 0.1);
});

test('freehandPath offen und ohne genug Punkte', () => {
  expect(freehandPath([{ x: 0, y: 0 }], 0.1, 1)).toBeNull();
  expect(freehandPath([{ x: 0, y: 0 }, { x: 0, y: 0 }], 0.1, 1)).toBeNull();
  expect(freehandPath([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 1 }], 0.1, 1)!.closed).toBe(false);
});

test('Gefangene Zickzack-Spur: Kurve bleibt bei der Spur, kein Ausreißer übers Blatt', () => {
  // Echte Messer-Spur (Fang zieht einen Punkt auf eine Objektkante) – ergab Griffe bei x ≈ 205 659.
  const raw = [
    [78.14733134626778, 60.610517890532435], [79.49174745387941, 66.88833650706503], [80.83616356149105, 73.16616586260321],
    [82.18060114711382, 79.4439844791358], [83.5250172547471, 85.72180314628997], [84.86943336233709, 91.99962171220102],
    [86.21384946994873, 98.27744032873362], [87.55826557756036, 104.55525894526622], [88.90270316318313, 110.83307756179882],
    [86.21384946994873, 115.54144420894967], [83.52501725472546, 120.24981085610051], [80.83616356149105, 124.95816676424577],
    [78.14733134626778, 132.80545350951607], [78.14733134626778, 132.80545350951607], [72.7696454378101, 139.08326670569832],
    [70.08081322258683, 143.79163335284915], [67.39195952935242, 148.5], [69.40859442977545, 155.56254997072628],
    [71.42522933019846, 162.62509994145253], [73.44186423062149, 169.6876499121788], [75.45849913620918, 179.8891038776009],
    [77.47511255345638, 183.8127283756202], [79.49174745387941, 190.87527834634645], [81.50838235430244, 197.93782831707273],
    [83.52501725472546, 205.00037828779898], [83.52501725472546, 205.00037828779898],
  ];
  const pts = raw.map(([x, y]) => ({ x, y }));
  for (const tol of [0.1759478672985782, 0.1, 0.25, 0.5, 1]) {
    const sp: Subpath = { closed: false, nodes: fitCurve(pts, tol) };
    for (const s of segmentsOf(sp))
      for (let i = 0; i <= 20; i++) {
        const q = pointAt(s.c, i / 20);
        expect(q.x).toBeGreaterThan(67.392 - 2);
        expect(q.x).toBeLessThan(88.903 + 2);
        expect(q.y).toBeGreaterThan(60.611 - 2);
        expect(q.y).toBeLessThan(205 + 2);
      }
    expectWithin(sp, pts, tol);
  }
});
