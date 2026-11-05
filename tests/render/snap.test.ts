import { expect, test } from 'vitest';
import { addNodes, createDocument } from '../../src/model/document';
import { nearest } from '../../src/model/bezier';
import { translate } from '../../src/model/geometry';
import { createText } from '../../src/model/text';
import type { Guide, Node } from '../../src/model/types';
import { buildScene } from '../../src/render/scene';
import { snapPoint, type SnapTo, type SnapWorld } from '../../src/render/snap';
import { group, pt, square, sub } from '../model/fixtures';

const OBJECTS: SnapTo = { objects: true, grid: false, guides: false };
const ALL: SnapTo = { objects: true, grid: true, guides: true };

function world(nodes: Node[], more: Partial<SnapWorld> = {}): SnapWorld {
  const doc = createDocument();
  const page = addNodes(doc, doc.pages[0].layers[0].id, nodes).pages[0];
  return { items: buildScene(page), guides: [], grid: { x: 10, y: 10 }, origin: { x: 0, y: 0 }, ...more };
}

// Quadrat 0..10: Knoten an den Ecken, Mitten der Seiten, Mittelpunkt (5;5). Fangradius 1 mm.
const box = world([square('a')]);

test('Knoten: Ecke innerhalb des Radius', () => {
  expect(snapPoint(10.6, 0.3, 1, OBJECTS, box)).toEqual({ x: 10, y: 0, kind: 'node' });
});

test('Mitte einer Kante', () => {
  expect(snapPoint(5.4, -0.5, 1, OBJECTS, box)).toEqual({ x: 5, y: 0, kind: 'midpoint' });
});

test('Mittelpunkt des Objekts', () => {
  expect(snapPoint(5.3, 5.2, 1, OBJECTS, box)).toEqual({ x: 5, y: 5, kind: 'center' });
});

test('Kante: nächster Punkt auf dem Umriss, wenn kein Punktziel nah ist', () => {
  const hit = snapPoint(2.5, 0.6, 1, OBJECTS, box)!;
  expect(hit.kind).toBe('edge');
  expect(hit.x).toBeCloseTo(2.5, 6);
  expect(hit.y).toBeCloseTo(0, 6);
});

test('Kante auf einer Kurve', () => {
  const c = [{ x: 0, y: 0 }, { x: 0, y: -10 }, { x: 20, y: -10 }, { x: 20, y: 0 }] as const;
  const arc: Node = { ...square('k'), subpaths: [sub(false, pt(0, 0, { handleOut: c[1] }), pt(20, 0, { handleIn: c[2] }))] };
  // Kurvenpunkt bei t = 0,25 liegt bei (3,125; −5,625); Abfrage knapp darunter.
  const hit = snapPoint(3.125, -5.2, 1, OBJECTS, world([arc]))!;
  expect(hit.kind).toBe('edge');
  expect(nearest(c, hit).dist).toBeLessThan(1e-6);
  expect(Math.hypot(hit.x - 3.125, hit.y + 5.2)).toBeLessThan(0.43);
});

test('außerhalb des Radius: kein Fang', () => {
  expect(snapPoint(2.5, 1.5, 1, OBJECTS, box)).toBeNull();
  expect(snapPoint(11.2, 0, 1, OBJECTS, box)).toBeNull();
});

test('Punktziel schlägt die nähere Kante', () => {
  expect(snapPoint(0.8, 0.5, 1, OBJECTS, box)).toEqual({ x: 0, y: 0, kind: 'node' });
});

test('Weltkoordinaten: Gruppen-Verschiebung zählt', () => {
  const moved = world([group('g', [square('a')], 100, 20)]);
  expect(snapPoint(110.4, 20.2, 1, OBJECTS, moved)).toEqual({ x: 110, y: 20, kind: 'node' });
});

test('Text fängt nur am Mittelpunkt, nicht an Glyphenknoten', () => {
  const t = { ...createText('t', translate(100, 100)), text: 'A', outline: [sub(true, pt(0, 0), pt(10, -20), pt(20, 0))] };
  const w = world([t]);
  expect(snapPoint(100.3, 100.2, 1, OBJECTS, w)).toBeNull();
  expect(snapPoint(110.4, 90.3, 1, OBJECTS, w)).toEqual({ x: 110, y: 90, kind: 'center' });
});

test('ausgenommene Objekte (gerade bewegte) fangen nicht', () => {
  expect(snapPoint(10.6, 0.3, 1, OBJECTS, { ...box, skip: new Set(['a']) })).toBeNull();
});

const guides: Guide[] = [
  { id: 'v', axis: 'v', pos: 50 },
  { id: 'h', axis: 'h', pos: 70 },
];

test('Hilfslinie fängt je Achse, Kreuzung beide', () => {
  const w = world([], { guides });
  expect(snapPoint(50.6, 30, 1, ALL, w)).toEqual({ x: 50, y: 30, kind: 'guide' });
  expect(snapPoint(50.6, 70.4, 1, ALL, w)).toEqual({ x: 50, y: 70, kind: 'guide' });
});

test('Raster zählt ab dem Nullpunkt, je Achse', () => {
  const w = world([], { origin: { x: 3, y: 297 } });
  expect(snapPoint(13.4, 296.6, 1, ALL, w)).toEqual({ x: 13, y: 297, kind: 'grid' });
  expect(snapPoint(13.4, 292, 1, ALL, w)).toEqual({ x: 13, y: 292, kind: 'grid' });
  expect(snapPoint(18, 292, 1, ALL, w)).toBeNull();
});

test('Hilfslinie schlägt Raster auf derselben Achse', () => {
  const w = world([], { guides: [{ id: 'v', axis: 'v', pos: 13.9 }] });
  expect(snapPoint(13.3, 5, 1, ALL, w)).toEqual({ x: 13.9, y: 5, kind: 'guide' });
});

test('Objekt schlägt Hilfslinie', () => {
  const w = world([square('a')], { guides: [{ id: 'v', axis: 'v', pos: 10.5 }] });
  expect(snapPoint(10.3, 0.2, 1, ALL, w)).toEqual({ x: 10, y: 0, kind: 'node' });
});

test('Schalter: nur eingeschaltete Ziele fangen', () => {
  const w = world([square('a')], { guides, origin: { x: 0, y: 0 } });
  expect(snapPoint(10.3, 0.2, 1, { objects: false, grid: false, guides: true }, w)).toBeNull();
  expect(snapPoint(10.3, 0.2, 1, { objects: false, grid: true, guides: false }, w)).toEqual({ x: 10, y: 0, kind: 'grid' });
  expect(snapPoint(50.6, 30, 1, { objects: true, grid: false, guides: false }, w)).toBeNull();
});

test('ausgenommene Hilfslinie (gerade gezogene) fängt nicht', () => {
  const w = world([], { guides, skip: new Set(['v']) });
  expect(snapPoint(50.6, 70.4, 1, { ...ALL, grid: false }, w)).toEqual({ x: 50.6, y: 70, kind: 'guide' });
});
