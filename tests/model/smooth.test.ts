import { describe, expect, it } from 'vitest';
import { pointAt, segmentAt, segmentCount } from '../../src/model/bezier';
import { addNodes, createDocument, findNode } from '../../src/model/document';
import { translate } from '../../src/model/geometry';
import { settleAt, settleSubpath, smoothAt, smoothSubpath } from '../../src/model/smooth';
import type { Doc, Node, PathNode, PathPoint, Point, ShapeNode, Subpath } from '../../src/model/types';
import { group, pt, sub } from './fixtures';

const curve = (sp: Subpath, per = 16): Point[] => {
  const out: Point[] = [];
  for (let k = 0; k < segmentCount(sp); k++) {
    const { c } = segmentAt(sp, k);
    for (let s = 0; s <= per; s++) out.push(pointAt(c, s / per));
  }
  return out;
};
const dab = (sp: Subpath, at: Point, r: number, rate: number, times: number) => {
  for (let i = 0; i < times; i++) sp = smoothSubpath(sp, at, r, rate);
  return sp;
};
const has = (sp: Subpath, x: number, y: number) => sp.nodes.some((n) => n.x === x && n.y === y);

// Nachgezeichnete Linie: 41 Ecken, abwechselnd 0,3 mm über und unter der Achse.
const jaggy = sub(false, ...Array.from({ length: 41 }, (_, i) => pt(i, i % 2 ? 0.3 : -0.3)));

describe('Glätten', () => {
  it('Pinsel trifft nichts: derselbe Pfad', () => {
    expect(smoothSubpath(jaggy, { x: 20, y: 30 }, 5, 1)).toBe(jaggy);
  });

  it('gerade Strecke unter dem Pinsel bleibt unverändert (keine Knoten-Unruhe)', () => {
    const line = sub(false, pt(0, 0), pt(40, 0));
    expect(smoothSubpath(line, { x: 20, y: 0 }, 5, 1)).toBe(line);
  });

  it('Strich entlang der zackigen Linie: glatt, Knoten unter dem Pinsel mindestens halbiert, außerhalb unverändert', () => {
    // Pinsel r = 6 dreimal von x = 10 bis 30 über die Linie, Tupfer je mm.
    let out = jaggy;
    for (let pass = 0; pass < 3; pass++) for (let x = 10; x <= 30; x++) out = smoothSubpath(out, { x, y: 0 }, 6, 1);
    // 19 Knoten liegen dabei unter dem Pinsel (|x − 20| < 10): davon bleibt höchstens die Hälfte.
    expect(out.nodes.length).toBeLessThanOrEqual(41 - 10);
    const mid = curve(out).filter((p) => Math.abs(p.x - 20) < 8);
    expect(Math.max(...mid.map((p) => Math.abs(p.y)))).toBeLessThan(0.15);
    expect(out.nodes.slice(0, 4)).toEqual(jaggy.nodes.slice(0, 4));
    expect(out.nodes.slice(-4)).toEqual(jaggy.nodes.slice(-4));
  });

  it('Tupfer an einer Stelle: Knoten außerhalb des Pinsels bleiben, wo sie sind', () => {
    const out = dab(jaggy, { x: 20, y: 0 }, 6, 1, 10);
    const outside = (n: PathPoint) => Math.abs(n.x - 20) >= 6;
    expect(out.nodes.filter(outside).map((n) => [n.x, n.y])).toEqual(jaggy.nodes.filter(outside).map((n) => [n.x, n.y]));
    expect(out.nodes.slice(0, 14)).toEqual(jaggy.nodes.slice(0, 14));
  });

  it('Ecke eines Quadrats wird rund, die anderen Ecken bleiben', () => {
    const square = sub(true, pt(0, 0), pt(20, 0), pt(20, 20), pt(0, 20));
    const out = dab(square, { x: 0, y: 0 }, 5, 1, 10);
    expect(out.closed).toBe(true);
    expect([has(out, 20, 0), has(out, 20, 20), has(out, 0, 20), has(out, 0, 0)]).toEqual([true, true, true, false]);
    expect(Math.min(...curve(out).map((p) => Math.hypot(p.x, p.y)))).toBeGreaterThan(0.3);
  });

  it('Striche über eine Ecke: außerhalb des Pinsels bleibt alles exakt, Knoten bleiben wenige', () => {
    // Quadrat 40 mm, Pinsel r = 10 dreimal diagonal über die Ecke (0, 0), 41 Tupfer je Durchgang.
    let out = sub(true, pt(0, 0), pt(40, 0), pt(40, 40), pt(0, 40));
    const dabs: Point[] = [];
    for (let pass = 0; pass < 3; pass++) {
      const stroke = Array.from({ length: 41 }, (_, s) => ({ x: -6 + (s / 40) * 18, y: 12 - (s / 40) * 18 }));
      for (const at of stroke) out = smoothSubpath(out, at, 10, 1);
      out = settleSubpath(out, stroke, 10);
      dabs.push(...stroke);
    }
    const pts = curve(out, 64);
    expect(Math.min(...pts.map((p) => Math.hypot(p.x, p.y)))).toBeGreaterThan(0.3);
    // Abstand zum Rand des Quadrats, nur für Punkte, die kein Tupfer erreicht hat
    const off = (p: Point) => Math.min(Math.abs(p.x), Math.abs(p.y), Math.abs(40 - p.x), Math.abs(40 - p.y));
    const outside = pts.filter((p) => dabs.every((d) => Math.hypot(p.x - d.x, p.y - d.y) > 10.5));
    expect(Math.max(...outside.map(off))).toBeLessThan(1e-6);
    expect(out.nodes.length).toBeLessThanOrEqual(10);
  });

  // Quadrat 40 mm, Pinsel r = 10 schräg über die Ecke (0, 0) wie im Klicktest, Tupfer im Abstand h; settle =
  // Strich-Ende wie im Werkzeug. Die Maus tupft dichter als r/4.
  const corner = (h: number, strokes: number, settle: boolean) => {
    let out = sub(true, pt(0, 0), pt(40, 0), pt(40, 40), pt(0, 40));
    const [from, to] = [{ x: -5.6, y: 11 }, { x: 16.7, y: -11 }];
    const n = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / h);
    for (let k = 0; k < strokes; k++) {
      const stroke = Array.from({ length: n + 1 }, (_, s) => ({ x: from.x + ((to.x - from.x) * s) / n, y: from.y + ((to.y - from.y) * s) / n }));
      for (const at of stroke) out = smoothSubpath(out, at, 10, 1);
      if (settle) out = settleSubpath(out, stroke, 10);
    }
    return out;
  };
  const bulge = (sp: Subpath) => Math.max(...curve(sp, 64).map((p) => Math.max(-p.x, -p.y)));

  it('Ecke runden, auch mit dichten Tupfern: die Nachbarkanten wölben sich nicht nach außen', () => {
    // Vorher bis 0,6 mm über die Kante (Taubin schwingt über, Fit-Fehler summieren sich von Tupfer zu Tupfer).
    for (const h of [2.5, 0.7, 0.35]) {
      const out = corner(h, 3, false);
      expect(Math.min(...curve(out, 64).map((p) => Math.hypot(p.x, p.y))), `h = ${h}`).toBeGreaterThan(0.5);
      expect(bulge(out), `h = ${h}`).toBeLessThan(0.08);
    }
  });

  it('Strich-Ende fasst die Knoten zusammen; auch sechs Striche über die Ecke wölben kaum', () => {
    for (const h of [2.5, 0.7, 0.35]) {
      const out = corner(h, 6, true);
      expect(out.nodes.length, `h = ${h}`).toBeLessThanOrEqual(10);
      expect(bulge(out), `h = ${h}`).toBeLessThan(0.15);
    }
  });

  it('Kreisbogen schrumpft beim Glätten nicht', () => {
    const K = 0.5523 * 10;
    const smooth = (x: number, y: number, hi: Point, ho: Point): PathPoint => ({ x, y, type: 'smooth', handleIn: hi, handleOut: ho });
    const circle = sub(
      true,
      smooth(10, 0, { x: 10, y: -K }, { x: 10, y: K }),
      smooth(0, 10, { x: K, y: 10 }, { x: -K, y: 10 }),
      smooth(-10, 0, { x: -10, y: K }, { x: -10, y: -K }),
      smooth(0, -10, { x: -K, y: -10 }, { x: K, y: -10 }),
    );
    const radii = curve(dab(circle, { x: 10, y: 0 }, 4, 1, 30)).map((p) => Math.hypot(p.x, p.y));
    expect(Math.min(...radii)).toBeGreaterThan(9.85);
  });

  it('Tempo: kleiner Wert glättet weniger', () => {
    const rough = (sp: Subpath) => Math.max(...curve(sp).filter((p) => Math.abs(p.x - 20) < 3).map((p) => Math.abs(p.y)));
    expect(rough(dab(jaggy, { x: 20, y: 0 }, 6, 0.1, 3))).toBeGreaterThan(rough(dab(jaggy, { x: 20, y: 0 }, 6, 1, 3)));
  });
});

describe('Glätten im Dokument', () => {
  const docWith = (...nodes: Node[]): Doc => {
    const doc = createDocument(300, 300);
    return addNodes(doc, doc.pages[0].layers[0].id, nodes);
  };
  const rect: ShapeNode = {
    type: 'shape',
    id: 'r',
    transform: translate(100, 50),
    style: { fill: null, stroke: null },
    shape: { kind: 'rect', x: 0, y: 0, width: 20, height: 20, radius: 0 },
  };

  it('Form in gewählter Gruppe wird zur Kurve; Pinsel in Seitenkoordinaten', () => {
    const d = docWith(group('g', [rect]));
    const n = findNode(smoothAt(d, ['g'], { x: 100, y: 50 }, 5, 1), 'r') as PathNode;
    expect(n.type).toBe('path');
    expect([has(n.subpaths[0], 0, 0), has(n.subpaths[0], 20, 20)]).toEqual([false, true]);
  });

  it('nichts getroffen: dasselbe Dokument', () => {
    const d = docWith(rect);
    expect(smoothAt(d, ['r'], { x: 0, y: 0 }, 5, 1)).toBe(d);
  });

  it('Strich-Ende: Knoten im Strichbereich fallen weg, in Seitenkoordinaten; sonst dasselbe Dokument', () => {
    // Gerade Linie mit Zwischenknoten, verschoben um (100, 50): nur die Knoten nahe am Strich fallen weg.
    const line: PathNode = {
      type: 'path',
      id: 'l',
      transform: translate(100, 50),
      style: { fill: null, stroke: null },
      subpaths: [sub(false, ...Array.from({ length: 21 }, (_, i) => ({ ...pt(i * 2, 0), type: 'smooth' as const })))],
    };
    const d = docWith(line);
    const out = findNode(settleAt(d, ['l'], [{ x: 110, y: 50 }, { x: 114, y: 50 }], 5), 'l') as PathNode;
    const xs = out.subpaths[0].nodes.map((p) => p.x);
    expect(xs.filter((x) => x > 5 && x < 19)).toEqual([]);
    expect(xs.filter((x) => x <= 4 || x >= 20)).toEqual(line.subpaths[0].nodes.map((p) => p.x).filter((x) => x <= 4 || x >= 20));
    expect(settleAt(d, ['l'], [{ x: 0, y: 0 }], 5)).toBe(d);
  });
});
