import { expect, test } from 'vitest';
import { addNodes, createDocument, findNode } from '../../src/model/document';
import { IDENTITY, multiply, scale, translate } from '../../src/model/geometry';
import { History } from '../../src/model/history';
import type { Doc, PathNode } from '../../src/model/types';
import { nodeTool } from '../../src/ui/tools/node-tool';
import type { Editor } from '../../src/ui/tools/tool';
import { chop, group, square } from '../model/fixtures';

const P = (x: number, y: number) => ({ x, y });

function setup() {
  const path: PathNode = { type: 'path', id: 'p', transform: IDENTITY, style: { fill: null, stroke: null }, subpaths: [{ closed: false, nodes: chop([P(0, 0), P(10, 20), P(30, 20), P(40, 0)], 10) }] };
  const doc = createDocument(200, 200);
  const ed = { history: new History<Doc>(addNodes(doc, doc.pages[0].layers[0].id, [path])), selected: new Set(['p']), notice: '' };
  return { ed, tool: nodeTool(ed as unknown as Editor) };
}
const nodes = (d: Doc) => (findNode(d, 'p') as PathNode).subpaths[0].nodes.length;

test('Glätte-Regler: live beim Ziehen, beim Loslassen genau ein Rückgängig-Schritt', () => {
  const { ed, tool } = setup();
  const before = ed.history.current;
  tool.slider!.set(10, false);
  tool.slider!.set(40, false);
  expect(nodes(ed.history.current)).toBeLessThan(11);
  tool.slider!.set(40, true);
  expect(ed.notice).toMatch(/Knoten: 11 → \d/);
  expect(ed.history.undo()).toBe(true);
  expect(ed.history.current).toBe(before);
  expect(ed.history.canUndo).toBe(false);
});

test('Knopf „Knoten reduzieren“ nutzt die eingestellte Glätte; nichts zu holen → kein Schritt', () => {
  const { ed, tool } = setup();
  const run = () => tool.actions!.find((a) => a.label === 'Knoten reduzieren')!.run();
  tool.slider!.set(0, true);
  expect(ed.history.canUndo).toBe(false);
  tool.slider!.set(40, false);
  tool.slider!.set(40, true);
  ed.history.undo();
  run();
  expect(nodes(ed.history.current)).toBeLessThan(11);
});

test('Kurve in verschobener, vergrößerter Gruppe: Knoten sitzen dort, wo man sie sieht; Klick auf ein Kind wählt das Kind', () => {
  const path: PathNode = { type: 'path', id: 'p', transform: IDENTITY, style: { fill: null, stroke: null }, subpaths: [{ closed: false, nodes: [P(0, 0), P(10, 0)].map((q) => ({ ...q, type: 'corner' as const })) }] };
  const g = { ...group('g', [path, square('q', 30, 0)]), transform: multiply(translate(100, 50), scale(2, 2)) };
  const doc = createDocument(200, 200);
  const ed = {
    history: new History<Doc>(addNodes(doc, doc.pages[0].layers[0].id, [g])),
    selected: new Set(['p']),
    notice: '',
    vp: { x: 0, y: 0, zoom: 1 },
    renderer: { hitTest: () => ({ id: 'q', topId: 'g', chain: ['g', 'q'] }) },
  };
  const tool = nodeTool(ed as unknown as Editor);
  const at = (x: number, y: number) => ({ sx: x, sy: y, x, y, shift: false, alt: false });
  // Knoten (0|0) liegt auf der Seite bei 100|50; 10 mm nach rechts = 5 Einheiten in der doppelt großen Gruppe.
  tool.down(at(100, 50));
  tool.move(at(110, 50));
  tool.up(at(110, 50));
  expect((findNode(ed.history.current, 'p') as PathNode).subpaths[0].nodes[0].x).toBeCloseTo(5, 9);
  expect([...ed.selected]).toEqual(['p']);
  tool.down(at(170, 60));
  expect([...ed.selected]).toEqual(['q']);
});
