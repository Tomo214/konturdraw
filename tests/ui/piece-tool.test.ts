import { expect, test } from 'vitest';
import { subpathBounds } from '../../src/model/bezier';
import { addNodes, createDocument, findNode } from '../../src/model/document';
import { IDENTITY } from '../../src/model/geometry';
import { History } from '../../src/model/history';
import type { Doc, PathNode } from '../../src/model/types';
import { screenToPage, type Viewport } from '../../src/render/viewport';
import { setLang } from '../../src/i18n/i18n.svelte';
import { TOOLBOX, toolName } from '../../src/ui/toolbox';
import { pieceTool } from '../../src/ui/tools/piece-tool';
import type { Editor, Pointer } from '../../src/ui/tools/tool';
import { pt, sub } from '../model/fixtures';

const vp: Viewport = { x: 0, y: 0, zoom: 2 };
const at = (x: number, y: number): Pointer => {
  const [px, py] = screenToPage(vp, x * 2, y * 2);
  return { sx: x * 2, sy: y * 2, x: px, y: py, shift: false, alt: false };
};
const line = (id: string, x0: number, y0: number, x1: number, y1: number): PathNode => ({
  type: 'path',
  id,
  transform: IDENTITY,
  style: { fill: null, stroke: null },
  subpaths: [sub(false, pt(x0, y0), pt(x1, y1))],
});

/** Szene wie der Renderer: je Blatt Geometrie, Lage und Box auf der Seite. */
function editor(nodes: PathNode[], locked: string[] = []) {
  const doc = createDocument(200, 200);
  const ed = {
    history: new History<Doc>(addNodes(doc, doc.pages[0].layers[0].id, nodes)),
    renderer: {
      get scene() {
        return ed.history.current.pages[0].layers[0].children.map((n) => {
          const p = n as PathNode;
          return { id: p.id, topId: p.id, locked: locked.includes(p.id), node: p, subpaths: p.subpaths, world: p.transform, ...subpathBounds(p.subpaths, p.transform)! };
        });
      },
    },
    vp,
    viewSize: [800, 600] as const,
    selected: new Set<string>(),
    guide: null,
    notice: '',
  };
  return ed;
}
const subs = (ed: { history: History<Doc> }, id: string) => (findNode(ed.history.current, id) as PathNode | undefined)?.subpaths;

test('Klick nahe der Linie löscht das Stück bis zur nächsten Kreuzung, Überfahren hebt es hervor', () => {
  const ed = editor([line('h', 0, 50, 100, 50), line('v', 50, 0, 50, 100)]);
  const tool = pieceTool(ed as unknown as Editor);
  expect(tool.move(at(80, 51))).toBe(true);
  expect(tool.move(at(81, 51))).toBe(false);
  tool.down(at(80, 51));
  tool.up(at(80, 51));
  expect(subs(ed, 'h')![0].nodes.map((n) => [n.x, n.y])).toEqual([[0, 50], [50, 50]]);
  expect(subs(ed, 'v')).toHaveLength(1);
  expect(ed.history.canUndo).toBe(true);
});

test('Rahmen löscht alle berührten Stücke; gesperrte Objekte bleiben', () => {
  const ed = editor([line('h', 0, 50, 100, 50), line('a', 30, 0, 30, 100), line('b', 70, 0, 70, 100)], ['b']);
  const tool = pieceTool(ed as unknown as Editor);
  tool.down(at(20, 80));
  tool.move(at(50, 90));
  tool.move(at(80, 100));
  tool.up(at(80, 100));
  expect(subs(ed, 'a')![0].nodes.map((n) => [n.x, n.y])).toEqual([[30, 0], [30, 50]]);
  expect(subs(ed, 'b')![0].nodes.map((n) => [n.x, n.y])).toEqual([[70, 0], [70, 100]]);
});

test('Klick ins Leere: Hinweis, Dokument bleibt', () => {
  const ed = editor([line('h', 0, 50, 100, 50)]);
  const before = ed.history.current;
  const tool = pieceTool(ed as unknown as Editor);
  tool.down(at(50, 150));
  tool.up(at(50, 150));
  expect(ed.history.current).toBe(before);
  expect(ed.notice).toBe('Keine Linie getroffen.');
});

test('Gelöschtes Objekt fällt aus der Auswahl', () => {
  const ed = editor([line('h', 0, 50, 100, 50), line('far', 0, 150, 100, 150)]);
  ed.selected = new Set(['h', 'far']);
  const tool = pieceTool(ed as unknown as Editor);
  tool.down(at(30, 50));
  tool.up(at(30, 50));
  expect(subs(ed, 'h')).toBeUndefined();
  expect([...ed.selected]).toEqual(['far']);
});

test('Werkzeugkasten: zwischen Messer und Radierer, eigener Name in beiden Sprachen', () => {
  expect(TOOLBOX.find((g) => g[0].tool === 'knife')!.map((t) => t.tool)).toEqual(['knife', 'piece', 'eraser']);
  expect(toolName('piece')).toBe('Linienstück löschen');
  setLang('en');
  expect(toolName('piece')).toBe('Delete line piece');
  setLang('de');
});
