import { expect, test } from 'vitest';
import { addNodes, createDocument, findNode } from '../../src/model/document';
import { IDENTITY, multiply, scale, translate } from '../../src/model/geometry';
import { handleOnScreen, type Handle } from '../../src/ui/handles';
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

function zigzag(transform = IDENTITY) {
  const corner = (x: number, y: number) => ({ x, y, type: 'corner' as const });
  const path: PathNode = {
    type: 'path',
    id: 'p',
    transform,
    style: { fill: null, stroke: null },
    subpaths: [{ closed: false, nodes: [corner(0, 0), corner(10, 5), corner(20, -5), corner(30, 0)] }, { closed: false, nodes: [corner(0, 50), corner(10, 50)] }],
  };
  const doc = createDocument(200, 100);
  const ed = { history: new History<Doc>(addNodes(doc, doc.pages[0].layers[0].id, [path])), selected: new Set(['p']), notice: '', vp: { x: 0, y: 0, zoom: 4 }, renderer: { hitTest: () => null }, page: () => doc.pages[0] };
  return { ed, tool: nodeTool(ed as unknown as Editor) };
}
const ys = (d: Doc) => (findNode(d, 'p') as PathNode).subpaths[0].nodes.map((n) => n.y);

test('Ausrichten-Befehle wirken auf die gewählten Knoten (Rahmen der Knoten oder Seite); ohne Knoten wie bisher aufs Objekt', () => {
  const { ed, tool } = zigzag();
  expect(tool.key!({ name: 'align', edge: 'top' })).toBe(false);
  drag(tool, [5, -10], [25, 10]); // Knoten 1 und 2
  expect(tool.key!({ name: 'align', edge: 'top' })).toBe(true);
  expect(ys(ed.history.current)).toEqual([0, -5, -5, 0]);
  expect(tool.key!({ name: 'align', edge: 'bottom', to: 'page' })).toBe(true);
  expect(ys(ed.history.current)).toEqual([0, 100, 100, 0]);
  ed.history.undo();
  ed.history.undo();
  drag(tool, [5, 0], [15, 10]); // nur Knoten 1
  const before = ed.history.current;
  expect(tool.key!({ name: 'align', edge: 'left' })).toBe(true);
  expect(ed.notice).toBe('Mindestens zwei Knoten wählen');
  expect(ed.history.current).toBe(before);
});

test('Rechtsklick auf Knoten oder Segment: Knotenbefehle, unpassende grau; daneben kein eigenes Menü', () => {
  const { ed, tool } = zigzag();
  expect(tool.menu!(at(15, 30))).toBeNull();
  const m = tool.menu!(at(10, 5))!;
  const item = (menu: typeof m, label: string) => menu.find((i) => i?.label === label)!;
  expect(m).toContain(null);
  expect(item(m, 'Löschen').disabled).toBe(false);
  expect(item(m, 'Verbinden').disabled).toBe(true);
  expect(item(m, 'Gerade').disabled).toBe(true);
  expect(item(m, 'Waagerecht ausrichten').disabled).toBe(true);
  expect(item(m, 'Teilpfad herauslösen').disabled).toBe(false);
  item(m, 'Löschen').run();
  expect(xs(ed.history.current)).toEqual([0, 20, 30]);
  const s = tool.menu!(at(10, -2.5))!; // Segment (0|0)–(20|-5)
  expect(item(s, 'Gerade').disabled).toBe(false);
  expect(item(s, 'Löschen').disabled).toBe(true);
  item(s, 'Knoten +').run();
  expect(xs(ed.history.current)).toHaveLength(4);
});

test('Rechtsklick auf einen gewählten Knoten lässt die Mehrfachauswahl stehen; „Waagerecht ausrichten“ legt sie auf eine Linie', () => {
  const { ed, tool } = zigzag();
  drag(tool, [5, -10], [25, 10]);
  const m = tool.menu!(at(20, -5))!;
  m.find((i) => i?.label === 'Waagerecht ausrichten')!.run();
  expect(ys(ed.history.current)).toEqual([0, 0, 0, 0]);
});

// Griff auf dem Schirm (Zoom 4) als Zeiger in Seitenkoordinaten
const grip = (b: { minX: number; minY: number; maxX: number; maxY: number }, h: Handle, dx = 0, dy = 0) => {
  const [sx, sy] = handleOnScreen({ x: 0, y: 0, zoom: 4 }, b, h);
  return at(sx / 4 + dx, sy / 4 + dy);
};
const mode = (tool: ReturnType<typeof nodeTool>, p: ReturnType<typeof at>, label: string) => tool.menu!(p)!.find((i) => i?.label === label)!;

test('Knoten strecken: Rechtsklick schaltet den Modus (Haken), Seitengriff streckt nur die gewählten Knoten – auch in verschobenen Pfaden', () => {
  const { ed, tool } = zigzag(translate(40, 0)); // Knoten auf der Seite: (40|0) (50|5) (60|-5) (70|0)
  drag(tool, [45, -10], [65, 10]);
  const before = ed.history.current;
  expect(mode(tool, at(50, 5), 'Knoten strecken/skalieren').checked).toBe(false);
  mode(tool, at(50, 5), 'Knoten strecken/skalieren').run();
  expect(mode(tool, at(50, 5), 'Knoten strecken/skalieren').checked).toBe(true);
  const box = { minX: 50, minY: -5, maxX: 60, maxY: 5 };
  expect(tool.cursor!(grip(box, 'e'))).toBe('ew-resize');
  tool.down(grip(box, 'e'));
  tool.move(grip(box, 'e', 5));
  tool.move(grip(box, 'e', 10));
  tool.up(grip(box, 'e', 10));
  expect(xs(ed.history.current)).toEqual([0, 10, 30, 30]);
  expect(ys(ed.history.current)).toEqual([0, 5, -5, 0]);
  expect(ed.history.undo()).toBe(true);
  expect(ed.history.current).toBe(before);
});

test('Knoten drehen: Eckgriff dreht die gewählten Knoten um die Rahmenmitte; Modus erneut wählen schaltet ab', () => {
  const { ed, tool } = zigzag();
  drag(tool, [5, -10], [25, 10]); // (10|5) und (20|-5), Mitte (15|0)
  mode(tool, at(10, 5), 'Knoten drehen/neigen').run();
  const box = { minX: 10, minY: -5, maxX: 20, maxY: 5 };
  tool.down(grip(box, 'ne'));
  tool.move(grip(box, 'ne', -10, 10)); // Griff (20|-5) → (10|5): halbe Drehung
  tool.up(grip(box, 'ne', -10, 10));
  const r = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
  expect(xs(ed.history.current).map(r)).toEqual([0, 20, 10, 30]);
  expect(ys(ed.history.current).map(r)).toEqual([0, -5, 5, 0]);
  mode(tool, at(20, -5), 'Knoten drehen/neigen').run();
  expect(mode(tool, at(20, -5), 'Knoten drehen/neigen').checked).toBe(false);
  expect(tool.cursor!(grip(box, 'ne'))).not.toMatch(/resize|url/);
});

test('Knoten am Rahmenrand bleibt greifbar: Klick genau auf den Knoten verschiebt ihn, statt zu strecken', () => {
  const { ed, tool } = zigzag();
  drag(tool, [5, -10], [25, 10]);
  mode(tool, at(10, 5), 'Knoten strecken/skalieren').run();
  drag(tool, [20, -5], [22, -5]); // (20|-5) = Ecke oben rechts, Griff liegt 8,5 px daneben
  expect(xs(ed.history.current)).toEqual([0, 12, 22, 30]);
});
