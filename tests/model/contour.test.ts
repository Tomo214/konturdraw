import { describe, expect, it } from 'vitest';
import { addNodes, createDocument } from '../../src/model/document';
import { IDENTITY, translate } from '../../src/model/geometry';
import { planContour, type ContourParams } from '../../src/model/contour';
import type { Color, Doc, GroupNode, ImageNode, Node, PathNode, Subpath } from '../../src/model/types';
import { group, pt, square, sub } from './fixtures';

const blue: Color = { model: 'rgb', values: [0, 0, 1] };
const box = (x0: number, y0: number, x1: number, y1: number): Subpath => sub(true, pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1));
const docWith = (...nodes: Node[]): Doc => {
  const doc = createDocument(200, 200);
  return addNodes(doc, doc.pages[0].layers[0].id, nodes);
};
const kids = (d: Doc) => d.pages[0].layers[0].children;
const lines = (id: string, x: number, y: number): PathNode => ({
  ...square(id, x, y),
  style: { fill: null, stroke: { color: blue, width: 0.5, cap: 'round', join: 'round' } },
});
const first = (n: Node) => [(n as PathNode).subpaths[0].nodes[0].x, (n as PathNode).subpaths[0].nodes[0].y];
const out2: ContourParams = { direction: 'outside', steps: 2, offset: 1, join: 'miter' };

describe('planContour', () => {
  it('außen: Schritte als Gruppe unter dem Original, größter ganz hinten, Stil vom Original', () => {
    const doc = docWith(lines('a', 5, 5));
    const plan = planContour(doc, ['a'], out2);
    expect(plan.jobs).toEqual([
      { shapes: [{ subpaths: [box(5, 5, 15, 15)], evenOdd: false }], offset: 1, steps: 2, direction: 'outside', join: 'miter' },
    ]);
    const r = plan.finish([[[box(4, 4, 16, 16)], [box(3, 3, 17, 17)]]])!;
    const [g, a] = kids(r.doc);
    expect(a.id).toBe('a');
    expect(g).toMatchObject({ type: 'group', transform: translate(5, 5) });
    const [far, near] = (g as GroupNode).children;
    expect(first(far)).toEqual([-2, -2]);
    expect(first(near)).toEqual([-1, -1]);
    expect(far).toMatchObject({ type: 'path', transform: IDENTITY, style: lines('a', 0, 0).style });
    expect(r.selected).toEqual([g.id]);
  });

  it('innen: über dem Original, kleinster ganz vorn; ein Schritt = einzelner Pfad statt Gruppe', () => {
    const doc = docWith(lines('a', 0, 0));
    const inside = planContour(doc, ['a'], { ...out2, direction: 'inside' }).finish([[[box(1, 1, 9, 9)], [box(2, 2, 8, 8)]]])!;
    const [a, g] = kids(inside.doc);
    expect(a.id).toBe('a');
    expect((g as GroupNode).children.map(first)).toEqual([[1, 1], [2, 2]]);
    const one = planContour(doc, ['a'], { ...out2, steps: 1 }).finish([[[box(-1, -1, 11, 11)]]])!;
    const [made] = kids(one.doc);
    expect(made).toMatchObject({ type: 'path', transform: IDENTITY });
    expect(one.selected).toEqual([made.id]);
  });

  it('Gruppe = ein gemeinsamer Umriss aller Blätter; Ergebnis neben der Gruppe in deren Lage', () => {
    const even: PathNode = { ...square('b', 5, 0), fillRule: 'evenodd' };
    const doc = docWith(group('g', [lines('a', 0, 0), even], 10, 10));
    const plan = planContour(doc, ['g'], { ...out2, steps: 1 });
    expect(plan.jobs[0].shapes).toEqual([
      { subpaths: [box(10, 10, 20, 20)], evenOdd: false },
      { subpaths: [box(15, 10, 25, 20)], evenOdd: true },
    ]);
    const r = plan.finish([[[box(9, 9, 26, 21)]]])!;
    const [made, g] = kids(r.doc);
    expect(g.id).toBe('g');
    expect(made).toMatchObject({ transform: translate(10, 10), style: lines('a', 0, 0).style });
    expect(first(made)).toEqual([-1, -1]);
  });

  it('nichts herausgekommen → null; Bilder und leere Auswahl → Fehler', () => {
    const doc = docWith(lines('a', 0, 0));
    expect(planContour(doc, ['a'], out2).finish([[]])).toBeNull();
    const img: ImageNode = { type: 'image', id: 'i', transform: IDENTITY, image: 'x', width: 10, height: 10 };
    expect(() => planContour(docWith(img), ['i'], out2)).toThrow();
    expect(() => planContour(doc, [], out2)).toThrow();
  });
});
