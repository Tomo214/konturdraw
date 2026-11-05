import { expect, test } from 'vitest';
import { addTrace, recolor, tracedNode, TRACE_DEFAULTS, type Rgb } from '../../src/io/trace';
import { addNodes, createDocument } from '../../src/model/document';
import { IDENTITY, translate } from '../../src/model/geometry';
import { insertPage } from '../../src/model/pages';
import type { GroupNode, PathNode, Subpath } from '../../src/model/types';

const line: Subpath = { closed: false, nodes: [{ x: 0, y: 0, type: 'corner' }, { x: 5, y: 0, type: 'corner' }] };
const ring: Subpath = { closed: true, nodes: [{ x: 0, y: 0, type: 'corner' }, { x: 5, y: 0, type: 'corner' }, { x: 5, y: 5, type: 'corner' }] };
const at = translate(10, 20);
const bw = (...subpaths: Subpath[]) => [{ rgb: null, subpaths }];

test('Umriss: ein schwarz gefüllter Pfad ohne Kontur – Löcher bleiben Löcher', () => {
  const n = tracedNode(bw(ring, ring), at, { ...TRACE_DEFAULTS, mode: 'outline' }) as PathNode;
  expect(n.type).toBe('path');
  expect(n.transform).toBe(at);
  expect(n.subpaths).toEqual([ring, ring]);
  expect(n.style).toEqual({ fill: { model: 'rgb', values: [0, 0, 0] }, stroke: null });
});

test('Mittellinie: Gruppe einzelner Linien mit Linienstärke, ohne Füllung', () => {
  const g = tracedNode(bw(line, ring), at, { ...TRACE_DEFAULTS, mode: 'centerline', lineWidth: 0.3 }) as GroupNode;
  expect(g.type).toBe('group');
  expect(g.transform).toBe(at);
  expect(g.children.map((c) => (c as PathNode).subpaths)).toEqual([[line], [ring]]);
  const style = (g.children[0] as PathNode).style;
  expect(style.fill).toBeNull();
  expect(style.stroke).toMatchObject({ width: 0.3, color: { values: [0, 0, 0] } });
  expect(new Set([g.id, ...g.children.map((c) => c.id)]).size).toBe(3);
});

test('Umriss farbig: Gruppe gefüllter Flächen in Teilfarbe ohne Kontur, unterste zuerst', () => {
  const g = tracedNode([{ rgb: [1, 1, 1], subpaths: [ring] }, { rgb: [1, 0, 0], subpaths: [ring, line] }], at, { ...TRACE_DEFAULTS, mode: 'color' }) as GroupNode;
  expect(g.type).toBe('group');
  expect(g.transform).toBe(at);
  const kids = g.children as PathNode[];
  expect(kids.map((c) => c.subpaths)).toEqual([[ring], [ring, line]]);
  expect(kids.map((c) => c.style)).toEqual([
    { fill: { model: 'rgb', values: [1, 1, 1] }, stroke: null },
    { fill: { model: 'rgb', values: [1, 0, 0] }, stroke: null },
  ]);
  expect(kids.every((c) => c.transform === IDENTITY)).toBe(true);
});

test('Mittellinie und Umriss s/w nehmen alle Teile zusammen', () => {
  const pieces = [...bw(line), ...bw(ring)];
  expect((tracedNode(pieces, at, { ...TRACE_DEFAULTS, mode: 'outline' }) as PathNode).subpaths).toEqual([line, ring]);
  expect((tracedNode(pieces, at, TRACE_DEFAULTS) as GroupNode).children).toHaveLength(2);
});

test('Ergebnis auf neuer oberster Ebene, Original bleibt', () => {
  let doc = createDocument();
  const original = doc.pages[0].layers[0];
  doc = addNodes(doc, original.id, [{ type: 'image', id: 'bild', transform: at, image: 'h', width: 5, height: 5 }]);
  const node = tracedNode(bw(line), at, TRACE_DEFAULTS);
  const next = addTrace(doc, node);
  const layers = next.pages[0].layers;
  expect(layers).toHaveLength(2);
  expect(layers[0]).toBe(doc.pages[0].layers[0]);
  expect(layers[1]).toMatchObject({ name: 'Nachzeichnung', visible: true, locked: false, children: [node] });
});

test('Nachzeichnung auf Seite 2 landet dort oben', () => {
  const doc = insertPage(createDocument(), 1, 0);
  const node = tracedNode(bw(line), at, TRACE_DEFAULTS);
  const next = addTrace(doc, node, 1);
  expect(next.pages[0]).toBe(doc.pages[0]);
  expect(next.pages[1].layers.map((l) => l.name)).toEqual(['Ebene 1', 'Nachzeichnung']);
});

test('Originalbild löschen (7a): Bild weg, auch aus seiner Gruppe; Ebene bleibt', () => {
  let doc = createDocument();
  const original = doc.pages[0].layers[0];
  const bild = { type: 'image', id: 'bild', transform: at, image: 'h', width: 5, height: 5 } as const;
  doc = addNodes(doc, original.id, [{ type: 'group', id: 'g', transform: IDENTITY, children: [bild] }]);
  const node = tracedNode(bw(line), at, TRACE_DEFAULTS);
  const next = addTrace(doc, node, 0, 'bild');
  const layers = next.pages[0].layers;
  expect(layers.map((l) => l.name)).toEqual(['Ebene 1', 'Nachzeichnung']);
  expect(layers[0].children).toEqual([]);
  expect(layers[1].children).toEqual([node]);
});

test('Palette bearbeiten (7d): gezeigte Farben bekommen eine neue, auch über frühere Änderungen hinweg', () => {
  const [R, G, B, X]: Rgb[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0.5]];
  let e = recolor([], [R], X); // Rot → Grau
  expect(e).toEqual([[R, X]]);
  e = recolor(e, [X, B], G); // Grau (war Rot, ein echtes Grau im Bild ginge mit) und Blau zu Grün zusammengeführt
  expect(e).toEqual([[R, G], [X, G], [B, G]]);
  e = recolor(e, [G], R); // zurück auf Rot: Rot braucht keinen Eintrag mehr
  expect(e).toEqual([[X, R], [B, R], [G, R]]);
});
