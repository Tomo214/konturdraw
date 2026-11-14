import { expect, test } from 'vitest';
import { addNodes, createDocument, findNode } from '../../src/model/document';
import { IDENTITY } from '../../src/model/geometry';
import { History } from '../../src/model/history';
import type { Doc, PathNode } from '../../src/model/types';
import { screenToPage, type Viewport } from '../../src/render/viewport';
import { smoothTool, type SmoothParams } from '../../src/ui/tools/smooth-tool';
import type { Editor, Pointer, Tool } from '../../src/ui/tools/tool';
import { pt, sub } from '../model/fixtures';

const vp: Viewport = { x: 0, y: 0, zoom: 2 };
const at = (x: number, y: number, o: Partial<Pointer> = {}): Pointer => {
  const [sx, sy] = [x * vp.zoom, y * vp.zoom];
  const [px, py] = screenToPage(vp, sx, sy);
  return { sx, sy, x: px, y: py, shift: false, alt: false, ...o };
};

// Nachgezeichnete Linie 'z': 41 Ecken, abwechselnd 0,3 mm über und unter y = 10.
const zigzag: PathNode = {
  type: 'path',
  id: 'z',
  transform: IDENTITY,
  style: { fill: null, stroke: null },
  subpaths: [sub(false, ...Array.from({ length: 41 }, (_, i) => pt(i, i % 2 ? 10.3 : 9.7)))],
};

function setup(p: Partial<SmoothParams> = {}, selected = ['z']) {
  const doc = createDocument(200, 200);
  const ed = { history: new History<Doc>(addNodes(doc, doc.pages[0].layers[0].id, [zigzag])), vp, selected: new Set(selected), notice: '' };
  const params: SmoothParams = { radius: 5, rate: 100, pressure: false, ...p };
  return { ed, params, tool: smoothTool(ed as unknown as Editor, params) };
}
const count = (d: Doc) => (findNode(d, 'z') as PathNode).subpaths[0].nodes.length;

function drag(tool: Tool, ...ps: Pointer[]) {
  tool.down(ps[0]);
  for (const p of ps.slice(1)) tool.move(p);
  tool.up(ps[ps.length - 1]);
}

test('Strich über die gewählte Linie glättet sie, ein Rückgängig-Schritt', () => {
  const s = setup();
  const before = s.ed.history.current;
  drag(s.tool, at(12, 10), at(20, 10), at(28, 10));
  expect(count(s.ed.history.current)).toBeLessThan(41);
  s.ed.history.undo();
  expect(s.ed.history.current).toBe(before);
  expect(s.ed.history.canUndo).toBe(false);
});

test('Strich-Ende fasst die Knoten zusammen: danach weniger als während des Strichs', () => {
  // Endet weit weg von der Linie: der letzte Tupfer trifft nichts mehr.
  const s = setup();
  s.tool.down(at(12, 10));
  for (const p of [at(20, 10), at(28, 10), at(28, 40)]) s.tool.move(p);
  const during = count(s.ed.history.current);
  s.tool.up(at(28, 40));
  expect(count(s.ed.history.current)).toBeLessThan(during);
  s.ed.history.undo();
  expect(s.ed.history.canUndo).toBe(false);
});

test('ohne Auswahl: Hinweis, nichts geändert', () => {
  const s = setup({}, []);
  drag(s.tool, at(12, 10), at(28, 10));
  expect(s.ed.history.canUndo).toBe(false);
  expect(s.ed.notice).toBe('Erst ein Objekt wählen.');
});

test('Pinsel trifft nichts: kein Rückgängig-Schritt', () => {
  const s = setup();
  drag(s.tool, at(12, 50), at(28, 50));
  expect(s.ed.history.canUndo).toBe(false);
});

test('Shift + Ziehen zieht den Pinsel bis zur Maus auf, ohne zu glätten', () => {
  const s = setup({ radius: 2 });
  drag(s.tool, at(20, 10, { shift: true }), at(23, 14, { shift: true }));
  expect(s.params.radius).toBeCloseTo(5);
  expect(s.ed.history.canUndo).toBe(false);
});

test('Alt + Ziehen stellt das Tempo ein: Mitte 0 %, Pinselrand 100 %', () => {
  const s = setup({ radius: 4, rate: 100 });
  drag(s.tool, at(20, 10, { alt: true }), at(22, 10, { alt: true }));
  expect(s.params.rate).toBe(50);
  expect(s.ed.history.canUndo).toBe(false);
});

test('Stiftdruck an: leichter Druck glättet weniger als fester', () => {
  const after = (pressure: number) => {
    const s = setup({ pressure: true });
    drag(s.tool, at(14, 10, { pressure }), at(26, 10, { pressure }));
    return count(s.ed.history.current);
  };
  expect(after(0.05)).toBeGreaterThan(after(1));
});
