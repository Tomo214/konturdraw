import { expect, test } from 'vitest';
import { addLayer, addNodes, createDocument, updateLayer } from '../../src/model/document';
import { buildScene } from '../../src/render/scene';
import type { Doc, Node, PathNode, Shape, ShapeNode } from '../../src/model/types';
import { IDENTITY, scale, translate } from '../../src/model/geometry';
import { shapeSubpaths } from '../../src/model/shapes';
import { createText } from '../../src/model/text';
import { group, pt, square, sub } from '../model/fixtures';

function page(layers: Node[][]): Doc['pages'][number] {
  let doc = createDocument();
  layers.forEach((nodes, i) => {
    if (i > 0) doc = addLayer(doc, 0, `L${i}`);
    doc = addNodes(doc, doc.pages[0].layers[i].id, nodes);
  });
  return doc.pages[0];
}

test('Szene liefert Blätter in Zeichenreihenfolge über alle Ebenen', () => {
  const items = buildScene(page([[square('a'), group('g', [square('b'), square('c')])], [square('d')]]));
  expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
  expect(items.map((i) => i.order)).toEqual([0, 1, 2, 3]);
});

test('topId ist das oberste Objekt unter der Ebene', () => {
  const items = buildScene(page([[group('g', [group('h', [square('a')])])]]));
  expect(items[0].topId).toBe('g');
});

test('chain: vom obersten Objekt bis zum Blatt (Strg-Klick wählt darin tiefer)', () => {
  const items = buildScene(page([[square('a'), group('g', [group('h', [square('b')])])]]));
  expect(items.map((i) => i.chain)).toEqual([['a'], ['g', 'h', 'b']]);
});

test('Transparenz: Produkt entlang der Kette, deckend = 1', () => {
  const inner = { ...group('h', [{ ...square('b'), opacity: 0.5 }]), opacity: 0.5 };
  const items = buildScene(page([[square('a'), { ...group('g', [inner]), opacity: 0.8 }]]));
  expect(items.map((i) => i.opacity)).toEqual([1, 0.2]);
});

test('Gruppen-Transformation landet in Weltmatrix und Box', () => {
  const [item] = buildScene(page([[group('g', [square('a', 5, 0, 10)], 100, 20)]]));
  expect([item.minX, item.minY, item.maxX, item.maxY]).toEqual([105, 20, 115, 30]);
});

test('Kontur verbreitert die Box um die halbe Linienstärke', () => {
  const s: PathNode = { ...square('a', 0, 0, 10), style: { fill: null, stroke: { color: { model: 'rgb', values: [0, 0, 0] }, width: 2, cap: 'butt', join: 'miter' } } };
  const [item] = buildScene(page([[s]]));
  expect([item.minX, item.minY, item.maxX, item.maxY]).toEqual([-1, -1, 11, 11]);
});

test('Kontur verbreitert nur mitskalierend um den Objektmaßstab', () => {
  const stroke = { color: { model: 'rgb', values: [0, 0, 0] }, width: 2, cap: 'butt', join: 'miter' } as const;
  const big = (id: string, scaleWithObject: boolean): PathNode => ({
    ...square(id, 0, 0, 10),
    transform: scale(2, 2),
    style: { fill: null, stroke: { ...stroke, scaleWithObject } },
  });
  const [fixed, scaled] = buildScene(page([[big('a', false), big('b', true)]]));
  expect([fixed.minX, fixed.maxX]).toEqual([-1, 21]);
  expect([scaled.minX, scaled.maxX]).toEqual([-2, 22]);
});

test('Form liefert ihre Bézier-Geometrie und Box', () => {
  const shape: Shape = { kind: 'ellipse', x: 10, y: 20, width: 30, height: 10 };
  const s: ShapeNode = { type: 'shape', id: 's', transform: IDENTITY, style: { fill: null, stroke: null }, shape };
  const [item] = buildScene(page([[s]]));
  expect(item.subpaths).toBe(shapeSubpaths(shape));
  expect([item.minX, item.minY, item.maxX, item.maxY].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([10, 20, 40, 30]);
});

test('Text: leerer Text hat eine Punkt-Box am Ursprung, Fließtext umfasst seinen Rahmen', () => {
  const empty = createText('e', translate(10, 20));
  const framed = { ...createText('f', IDENTITY, { frame: { width: 30, height: 15 } }), outline: [sub(true, pt(2, 3), pt(5, 3), pt(5, 8))] };
  const [a, b] = buildScene(page([[empty, framed]]));
  expect([a.minX, a.minY, a.maxX, a.maxY]).toEqual([10, 20, 10, 20]);
  expect([b.minX, b.minY, b.maxX, b.maxY]).toEqual([0, 0, 30, 15]);
});

test('unsichtbare Ebenen fehlen, gesperrte sind markiert', () => {
  let doc = createDocument();
  doc = addNodes(doc, doc.pages[0].layers[0].id, [square('a')]);
  doc = addLayer(doc, 0, 'versteckt');
  doc = addNodes(doc, doc.pages[0].layers[1].id, [square('b')]);
  doc = addLayer(doc, 0, 'gesperrt');
  doc = addNodes(doc, doc.pages[0].layers[2].id, [square('c')]);
  doc = updateLayer(doc, doc.pages[0].layers[1].id, { visible: false });
  doc = updateLayer(doc, doc.pages[0].layers[2].id, { locked: true });
  const items = buildScene(doc.pages[0]);
  expect(items.map((i) => [i.id, i.locked])).toEqual([
    ['a', false],
    ['c', true],
  ]);
});
