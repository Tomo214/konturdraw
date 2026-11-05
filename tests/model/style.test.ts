import { expect, test } from 'vitest';
import { addNodes, createDocument, findNode } from '../../src/model/document';
import { IDENTITY } from '../../src/model/geometry';
import { shapeSubpaths } from '../../src/model/shapes';
import {
  DEFAULT_STROKE,
  fillSpec,
  fromHex,
  mmField,
  setFill,
  toHex,
  setGradientLine,
  setPolygon,
  setRadius,
  setStroke,
  toCurves,
  updateLeaves,
  copyStyle,
  setImageOpacity,
  type FillSpec,
} from '../../src/model/style';
import type { Color, Gradient, ImageNode, LeafNode, ShapeNode } from '../../src/model/types';
import { group, square } from './fixtures';

const red: Color = { model: 'rgb', values: [1, 0, 0] };
const blue: Color = { model: 'rgb', values: [0, 0, 1] };
const spec = (kind: FillSpec['kind']): FillSpec => ({ kind, a: red, b: blue });

const rect: ShapeNode = {
  type: 'shape',
  id: 'r',
  transform: IDENTITY,
  style: { fill: null, stroke: null },
  shape: { kind: 'rect', x: 10, y: 20, width: 40, height: 20, radius: 0 },
};

test('Füllung: keine / Vollton', () => {
  expect(setFill(rect, spec('solid')).style.fill).toBe(red);
  expect(setFill(setFill(rect, spec('solid')), spec('none')).style.fill).toBeNull();
});

test('Neuer linearer Verlauf läuft quer über die Objekt-Box', () => {
  expect(setFill(rect, spec('linear')).style.fill).toEqual({
    kind: 'linear',
    from: { x: 10, y: 30 },
    to: { x: 50, y: 30 },
    stops: [{ offset: 0, color: red }, { offset: 1, color: blue }],
  });
});

test('Neuer radialer Verlauf: Mitte bis halbe längere Seite', () => {
  const g = setFill(rect, spec('radial')).style.fill as Gradient;
  expect([g.from, g.to]).toEqual([{ x: 30, y: 30 }, { x: 50, y: 30 }]);
});

test('Vorhandener Verlauf behält seine Lage, nur Art und Farben ändern sich', () => {
  const custom = setGradientLine(rect, { x: 0, y: 0 }, { x: 5, y: 5 }, spec('linear'));
  const g = setFill(custom, { kind: 'radial', a: blue, b: red }).style.fill as Gradient;
  expect(g.kind).toBe('radial');
  expect([g.from, g.to]).toEqual([{ x: 0, y: 0 }, { x: 5, y: 5 }]);
  expect(g.stops.map((s) => s.color)).toEqual([blue, red]);
});

test('Bedienfeld ändert nur Anfangs- und Endfarbe; Zwischenknoten und Lagen bleiben', () => {
  const green: Color = { model: 'rgb', values: [0, 1, 0] };
  const base = setGradientLine(rect, { x: 0, y: 0 }, { x: 5, y: 5 }, spec('linear'));
  const g0 = base.style.fill as Gradient;
  const three = { ...base, style: { ...base.style, fill: { ...g0, stops: [{ offset: 0.1, color: red }, { offset: 0.4, color: green }, { offset: 1, color: blue }] } } };
  const g = setFill(three, { kind: 'radial', a: blue, b: red }).style.fill as Gradient;
  expect(g.kind).toBe('radial');
  expect(g.stops).toEqual([{ offset: 0.1, color: blue }, { offset: 0.4, color: green }, { offset: 1, color: red }]);
});

test('Verlaufslinie: neuer Verlauf aus Vorgabe, vorhandener behält Art und Stopps', () => {
  const fresh = setGradientLine(rect, { x: 1, y: 2 }, { x: 3, y: 4 }, spec('solid')).style.fill as Gradient;
  expect(fresh).toEqual({ kind: 'linear', from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, stops: [{ offset: 0, color: red }, { offset: 1, color: blue }] });
  const radial = setFill(rect, spec('radial'));
  const moved = setGradientLine(radial, { x: 0, y: 0 }, { x: 9, y: 0 }, spec('linear')).style.fill as Gradient;
  expect(moved.kind).toBe('radial');
  expect(moved.stops).toBe((radial.style.fill as Gradient).stops);
});

test('fillSpec liest Füllung zurück, behält sonst die vorigen Farben', () => {
  const prev = spec('solid');
  expect(fillSpec(null, prev)).toEqual({ kind: 'none', a: red, b: blue });
  expect(fillSpec(blue, prev)).toEqual({ kind: 'solid', a: blue, b: blue });
  expect(fillSpec(setFill(rect, { kind: 'linear', a: blue, b: red }).style.fill, prev)).toEqual({ kind: 'linear', a: blue, b: red });
});

test('Kontur: entfernen, neu mit Vorgabe, einzelne Eigenschaft ändern', () => {
  const withStroke = setStroke(rect, { width: 2 });
  expect(withStroke.style.stroke).toEqual({ ...DEFAULT_STROKE, width: 2 });
  const thicker = setStroke(setStroke(withStroke, { color: red }), { cap: 'butt' });
  expect(thicker.style.stroke).toEqual({ ...DEFAULT_STROKE, width: 2, color: red, cap: 'butt' });
  expect(setStroke(thicker, null).style.stroke).toBeNull();
});

test('In Kurven: Form wird Pfad mit gleicher ID, Lage und Stil; Pfad bleibt unverändert', () => {
  const styled = setFill(rect, spec('solid'));
  const p = toCurves(styled);
  expect(p).toEqual({ type: 'path', id: 'r', transform: IDENTITY, style: styled.style, subpaths: shapeSubpaths(rect.shape) });
  const sq = square('s');
  expect(toCurves(sq)).toBe(sq);
});

test('Radius nur für Rechtecke, Ecken/Stern nur für Vielecke', () => {
  const poly: ShapeNode = { ...rect, shape: { kind: 'polygon', x: 0, y: 0, width: 10, height: 10, sides: 5, inner: null } };
  expect((setRadius(4)(rect) as ShapeNode).shape).toMatchObject({ radius: 4 });
  expect(setRadius(4)(poly)).toBe(poly);
  expect((setPolygon(6, 0.5)(poly) as ShapeNode).shape).toMatchObject({ sides: 6, inner: 0.5 });
  expect(setPolygon(6, 0.5)(rect)).toBe(rect);
});

test('updateLeaves wirkt auf Blätter in gewählten Gruppen, Rest bleibt geteilt', () => {
  let doc = createDocument();
  const layer = doc.pages[0].layers[0].id;
  doc = addNodes(doc, layer, [group('g', [square('a'), rect]), square('b')]);
  const next = updateLeaves(doc, ['g'], (n: LeafNode) => setStroke(n, { width: 3 }));
  expect((findNode(next, 'a') as LeafNode).style.stroke?.width).toBe(3);
  expect((findNode(next, 'r') as LeafNode).style.stroke?.width).toBe(3);
  expect(findNode(next, 'b')).toBe(findNode(doc, 'b'));
});

test('Hex für Farbfelder: hin und zurück', () => {
  expect(toHex({ model: 'rgb', values: [1, 0.5, 0] })).toBe('#ff8000');
  expect(fromHex('#ff8000')).toEqual({ model: 'rgb', values: [1, 128 / 255, 0] });
  expect(toHex(fromHex('#1a2b3c'))).toBe('#1a2b3c');
  expect(toHex({ model: 'cmyk', values: [0, 1, 0, 0] })).toBe('#ff00ff'); // ohne Profil: einfache Formel
  expect(toHex({ model: 'gray', values: [0.5] })).toBe('#808080');
});

test('mm-Feld: Rundungsrauschen weg, höchstens 4 Nachkommastellen wie im Export', () => {
  expect(mmField(0.9999999647339185)).toBe(1); // SVG-Import über usvg-f32
  expect(mmField(1 / 3)).toBe(0.3333);
  expect(mmField(0.05)).toBe(0.05);
  expect(mmField(1.005)).toBe(1.005);
});

const docWith = (...nodes: Parameters<typeof addNodes>[2]) => {
  const d = createDocument();
  return addNodes(d, d.pages[0].layers[0].id, nodes);
};

test('Pipette: Füllung und/oder Kontur übertragen, auch in Gruppen', () => {
  const src: LeafNode = { ...rect, style: { fill: red, stroke: { ...DEFAULT_STROKE, width: 2 } } };
  const doc = docWith(square('a'), group('g', [square('k')]));
  const both = copyStyle(doc, ['a', 'g'], src, { fill: true, stroke: true });
  expect((findNode(both, 'a') as LeafNode).style).toEqual(src.style);
  expect((findNode(both, 'k') as LeafNode).style).toEqual(src.style);
  const onlyStroke = copyStyle(doc, ['a'], src, { fill: false, stroke: true });
  expect((findNode(onlyStroke, 'a') as LeafNode).style).toEqual({ fill: square('a').style.fill, stroke: src.style.stroke });
  const onlyFill = copyStyle(doc, ['a'], src, { fill: true, stroke: false });
  expect((findNode(onlyFill, 'a') as LeafNode).style).toEqual({ fill: red, stroke: null });
});

test('Pipette: Verlauf liegt im Ziel an derselben Stelle seiner Box', () => {
  // Quelle 10..50 × 20..40, Verlauf vom linken Rand bis Mitte; Ziel 0..10 × 0..10 (square)
  const g: Gradient = { kind: 'linear', from: { x: 10, y: 30 }, to: { x: 30, y: 30 }, stops: [{ offset: 0, color: red }, { offset: 0.5, color: blue }, { offset: 1, color: red }] };
  const src: LeafNode = { ...rect, style: { fill: g, stroke: null } };
  const doc = docWith(square('a'));
  const fill = (findNode(copyStyle(doc, ['a'], src, { fill: true, stroke: false }), 'a') as LeafNode).style.fill as Gradient;
  expect(fill).toEqual({ ...g, from: { x: 0, y: 5 }, to: { x: 5, y: 5 } });
});

test('Bild-Transparenz: wirkt auf Bilder in Auswahl und Gruppen, 1 = Feld weg, Formen unberührt', () => {
  const pic = (id: string): ImageNode => ({ type: 'image', id, transform: IDENTITY, image: 'h', width: 4, height: 3 });
  const doc = docWith(pic('a'), group('g', [pic('k'), square('s')]), pic('z'));
  const half = setImageOpacity(doc, ['a', 'g'], 0.5);
  expect((findNode(half, 'a') as ImageNode).opacity).toBe(0.5);
  expect((findNode(half, 'k') as ImageNode).opacity).toBe(0.5);
  expect(findNode(half, 's')).toEqual(findNode(doc, 's'));
  expect(findNode(half, 'z')).toBe(findNode(doc, 'z'));
  const back = setImageOpacity(half, ['a'], 1);
  expect('opacity' in (findNode(back, 'a') as ImageNode)).toBe(false);
  expect((findNode(setImageOpacity(doc, ['a'], -2), 'a') as ImageNode).opacity).toBe(0);
});
