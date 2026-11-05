import { describe, expect, it } from 'vitest';
import { addNodes, createDocument } from '../../src/model/document';
import { translate } from '../../src/model/geometry';
import { planErase, planKnife } from '../../src/model/cutting';
import type { Doc, Node, PathNode, Subpath } from '../../src/model/types';
import { group, pt, square, sub } from './fixtures';

const red = { fill: { model: 'rgb' as const, values: [1, 0, 0] as [number, number, number] }, stroke: null };
const box = (x0: number, y0: number, x1: number, y1: number): Subpath => sub(true, pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1));
const docWith = (...nodes: Node[]): Doc => {
  const doc = createDocument(200, 200);
  return addNodes(doc, doc.pages[0].layers[0].id, nodes);
};
const kids = (d: Doc) => d.pages[0].layers[0].children;
const ids = (d: Doc) => kids(d).map((n) => n.id);
const cut = sub(false, pt(9, 0), pt(9, 20));
const image: Node = { type: 'image', id: 'img', transform: translate(0, 0), width: 5, height: 5, imageId: 'x' } as unknown as Node;

describe('planKnife', () => {
  it('Aufträge in Seitenkoordinaten mit Füllregel; Gruppen und Bilder bleiben außen vor', () => {
    const doc = docWith(square('a', 5, 5), { ...square('b', 0, 0), fillRule: 'evenodd' }, group('g', [square('k')]), image);
    const plan = planKnife(doc, ['a', 'b', 'g', 'img'], cut);
    expect(plan.jobs).toEqual([
      { shape: { subpaths: [box(5, 5, 15, 15)], evenOdd: false }, cut },
      { shape: { subpaths: [box(0, 0, 10, 10)], evenOdd: true }, cut },
    ]);
  });

  it('Teilen: zwei Objekte am alten Platz, erstes behält die Kennung, Stil und Transformation bleiben', () => {
    const doc = docWith(square('x', 50, 50), { ...square('a', 5, 5), style: red }, square('c', 80, 80));
    const plan = planKnife(doc, ['a'], cut);
    const r = plan.finish([[[box(5, 5, 9, 15)], [box(9, 5, 15, 15)]]])!;
    expect(ids(r.doc)[0]).toBe('x');
    expect(ids(r.doc)[1]).toBe('a');
    expect(ids(r.doc)[3]).toBe('c');
    const [left, right] = kids(r.doc).slice(1, 3) as PathNode[];
    expect(right.id).not.toBe('a');
    expect(left.style).toBe(red);
    expect(right.style).toBe(red);
    expect(right.transform).toEqual(translate(5, 5));
    expect(right.subpaths).toEqual([box(4, 0, 10, 10)]);
    expect(r.selected).toEqual([left.id, right.id]);
  });

  it('Nichts geteilt → null; nur geteilte Objekte ändern sich', () => {
    const doc = docWith(square('a', 0, 0), square('b', 30, 0));
    const plan = planKnife(doc, ['a', 'b'], cut);
    expect(plan.finish([null, null])).toBeNull();
    const r = plan.finish([null, [[box(30, 0, 35, 10)], [box(35, 0, 40, 10)]]])!;
    expect(kids(r.doc)[0]).toBe(kids(doc)[0]);
    expect(kids(r.doc)).toHaveLength(3);
    expect(r.selected).toHaveLength(2);
    expect(r.selected).not.toContain('a');
  });
});

describe('planErase', () => {
  it('Aufträge mit Spur, Dicke und Spitze', () => {
    const doc = docWith(square('a', 5, 5));
    const plan = planErase(doc, ['a'], cut, 2, true);
    expect(plan.jobs).toEqual([{ shape: { subpaths: [box(5, 5, 15, 15)], evenOdd: false }, trail: cut, width: 2, square: true }]);
  });

  it('Radieren ersetzt die Form (gleiche Kennung), ganz weg entfernt das Objekt, unberührt bleibt', () => {
    const doc = docWith({ ...square('a', 5, 5), style: red }, square('b', 30, 0), square('c', 60, 0));
    const plan = planErase(doc, ['a', 'b', 'c'], cut, 2, false);
    const r = plan.finish([[box(5, 5, 8, 15), box(10, 5, 15, 15)], [], null])!;
    expect(ids(r.doc)).toEqual(['a', 'c']);
    const a = kids(r.doc)[0] as PathNode;
    expect(a.style).toBe(red);
    expect(a.transform).toEqual(translate(5, 5));
    expect(a.subpaths).toEqual([box(0, 0, 3, 10), box(5, 0, 10, 10)]);
    expect(kids(r.doc)[1]).toBe(kids(doc)[2]);
    expect(r.selected).toEqual(['a']);
    expect(plan.finish([null, null, null])).toBeNull();
  });
});
