import { expect, test } from 'vitest';
import { addNodes, createDocument, findNode } from '../../src/model/document';
import { IDENTITY, multiply, scale, translate } from '../../src/model/geometry';
import { pointAt, segmentAt } from '../../src/model/bezier';
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

// Gerade aus 4 Knoten bei y = 0, Zoom 4 (Trefferzone 6 px = 1,5 mm).
function line4(extra: PathNode['subpaths'] = []) {
  const corner = (x: number, y = 0) => ({ x, y, type: 'corner' as const });
  const path: PathNode = { type: 'path', id: 'p', transform: IDENTITY, style: { fill: null, stroke: null }, subpaths: [{ closed: false, nodes: [0, 10, 20, 30].map((x) => corner(x)) }, ...extra] };
  const doc = createDocument(200, 200);
  const ed = { history: new History<Doc>(addNodes(doc, doc.pages[0].layers[0].id, [path])), selected: new Set(['p']), notice: '', vp: { x: 0, y: 0, zoom: 4 }, renderer: { hitTest: () => null } };
  return { ed, tool: nodeTool(ed as unknown as Editor) };
}
const at = (x: number, y: number, o: { shift?: boolean; alt?: boolean } = {}) => ({ sx: x * 4, sy: y * 4, x, y, shift: !!o.shift, alt: !!o.alt });
const xs = (d: Doc, s = 0) => (findNode(d, 'p') as PathNode).subpaths[s].nodes.map((n) => n.x);
function drag(tool: ReturnType<typeof nodeTool>, from: [number, number], to: [number, number], o: { shift?: boolean; alt?: boolean } = {}) {
  tool.down(at(...from, o));
  tool.move(at(...to, o));
  tool.up(at(...to, o));
}

test('Rahmen auf leerer Fläche wählt Knoten darin; Umschalt fügt hinzu; Klick ohne Ziehen hebt die Auswahl auf', () => {
  const { ed, tool } = line4();
  drag(tool, [5, -5], [25, 5]);
  tool.key!({ name: 'delete' });
  expect(xs(ed.history.current)).toEqual([0, 30]);
  ed.history.undo();
  drag(tool, [-5, -5], [5, 5]);
  drag(tool, [25, -5], [35, 5], { shift: true });
  tool.key!({ name: 'delete' });
  expect(xs(ed.history.current)).toEqual([10, 20]);
  tool.down(at(100, 100));
  tool.up(at(100, 100));
  expect(ed.selected.size).toBe(0);
});

test('Alt beim Rahmen = Freihand-Spur', () => {
  const { ed, tool } = line4();
  tool.down(at(5, -5, { alt: true }));
  for (const [x, y] of [[15, -5], [15, 5], [5, 5]] as const) tool.move(at(x, y, { alt: true }));
  tool.up(at(5, 5, { alt: true }));
  tool.key!({ name: 'delete' });
  expect(xs(ed.history.current)).toEqual([0, 20, 30]);
});

test('Segment ziehen biegt es (Gerade wird Kurve), ein Rückgängig-Schritt', () => {
  const { ed, tool } = line4();
  const before = ed.history.current;
  drag(tool, [15, 0], [15, 4]);
  const sp = (findNode(ed.history.current, 'p') as PathNode).subpaths[0];
  expect(xs(ed.history.current)).toEqual([0, 10, 20, 30]);
  const q = pointAt(segmentAt(sp, 1).c, 0.5);
  expect([q.x, q.y].map((v) => +v.toFixed(6))).toEqual([15, 4]);
  ed.history.undo();
  expect(ed.history.current).toBe(before);
});

test('Doppelklick auf einen Knoten löscht ihn; Mod+A wählt alle Knoten', () => {
  const { ed, tool } = line4();
  tool.down(at(10, 0));
  tool.up(at(10, 0));
  tool.dblclick!(at(10, 0));
  expect(xs(ed.history.current)).toEqual([0, 20, 30]);
  expect(tool.key!({ name: 'selectAll' })).toBe(true);
  tool.key!({ name: 'nudge', dx: 1, dy: 0 });
  expect(xs(ed.history.current)).toEqual([0.1, 20.1, 30.1].map((v) => expect.closeTo(v, 9)));
});

test('Richtung umkehren und Teilpfad herauslösen am angeklickten Teilpfad', () => {
  const { ed, tool } = line4([{ closed: false, nodes: [{ x: 0, y: 50, type: 'corner' }, { x: 10, y: 50, type: 'corner' }] }]);
  const act = (label: string) => tool.actions!.find((a) => a.label === label)!.run();
  tool.down(at(5, 0));
  tool.up(at(5, 0));
  act('Richtung umkehren');
  expect(xs(ed.history.current)).toEqual([30, 20, 10, 0]);
  tool.down(at(5, 50));
  tool.up(at(5, 50));
  act('Teilpfad herauslösen');
  const kids = ed.history.current.pages[0].layers[0].children as PathNode[];
  expect(kids.map((k) => k.subpaths.length)).toEqual([1, 1]);
  expect([...ed.selected]).toEqual([kids[1].id]);
  expect(kids[1].subpaths[0].nodes[0].y).toBe(50);
});
