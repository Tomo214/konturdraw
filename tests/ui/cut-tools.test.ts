import { expect, test } from 'vitest';
import type { EraseJob, KnifeJob } from '../../src/model/cutting';
import { addNodes, createDocument, findNode } from '../../src/model/document';
import type { Box } from '../../src/model/geometry';
import { History } from '../../src/model/history';
import { DEFAULT_STROKE } from '../../src/model/style';
import type { Doc, LeafNode, Node, Subpath } from '../../src/model/types';
import { screenToPage, type Viewport } from '../../src/render/viewport';
import { eraserTool, eyedropperTool, knifeTool, type CutParams } from '../../src/ui/tools/cut-tools';
import type { Editor, Pointer, Tool } from '../../src/ui/tools/tool';
import { pt, square, sub } from '../model/fixtures';

const vp: Viewport = { x: 0, y: 0, zoom: 2 };
const at = (sx: number, sy: number, shift = false): Pointer => {
  const [x, y] = screenToPage(vp, sx, sy);
  return { sx, sy, x, y, shift, alt: false };
};
const params: CutParams = { knife: 'line', width: 2, nib: 'round', pick: { fill: true, stroke: true } };
const settle = () => new Promise((r) => setTimeout(r, 0));
const box = (x0: number, y0: number, x1: number, y1: number): Subpath => sub(true, pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1));
const kids = (d: Doc) => d.pages[0].layers[0].children;

/** Treffer: Bildschirm-x < 50 → a, < 100 → b, sonst nichts. touching meldet alle Objekte. */
function editor(nodes: Node[]) {
  const doc = createDocument(200, 200);
  const touched: Box[] = [];
  const ed = {
    history: new History<Doc>(addNodes(doc, doc.pages[0].layers[0].id, nodes)),
    renderer: {
      touching: (r: Box) => (touched.push(r), nodes.map((n) => n.id)),
      hitTest: (_: Viewport, sx: number) => {
        const id = sx < 50 ? 'a' : sx < 100 ? 'b' : null;
        return id && { topId: id, chain: [id], node: findNode(ed.history.current, id) };
      },
    },
    vp,
    viewSize: [800, 600] as const,
    selected: new Set<string>(),
    guide: null,
    notice: '',
    touched,
  };
  return ed;
}

function drag(tool: Tool, ...ps: Pointer[]) {
  tool.down(ps[0]);
  for (const p of ps.slice(1)) tool.move(p);
  tool.up(ps[ps.length - 1]);
}

test('Messer (Gerade): Schnitt vom Drücken bis Loslassen; ohne Auswahl die berührten Objekte; Teile gewählt', async () => {
  const ed = editor([square('a', 0, 0)]);
  const calls: KnifeJob[][] = [];
  let done = 0;
  const tool = knifeTool(ed as unknown as Editor, () => params, () => done++, async (jobs) => {
    calls.push(jobs);
    return [[[box(0, 0, 4, 10)], [box(4, 0, 10, 10)]]];
  });
  drag(tool, at(8, -10), at(8, 10), at(8, 40));
  await settle();
  expect(calls[0][0].cut).toEqual(sub(false, pt(4, -5), pt(4, 20)));
  expect(ed.touched[0]).toEqual({ minX: 4, minY: -5, maxX: 4, maxY: 20 });
  expect(kids(ed.history.current)).toHaveLength(2);
  expect(ed.selected.size).toBe(2);
  expect(done).toBe(1);
});

test('Messer: Auswahl geht vor; nichts geteilt → Hinweis, Dokument bleibt; Klick ohne Weg schneidet nicht', async () => {
  const ed = editor([square('a', 0, 0), square('b', 30, 0)]);
  ed.selected = new Set(['b']);
  const calls: KnifeJob[][] = [];
  const tool = knifeTool(ed as unknown as Editor, () => params, () => {}, async (jobs) => (calls.push(jobs), [null]));
  const before = ed.history.current;
  drag(tool, at(8, -10), at(8, 40));
  await settle();
  expect(calls[0]).toHaveLength(1);
  expect(calls[0][0].shape.subpaths).toEqual([box(30, 0, 40, 10)]);
  expect(ed.touched).toEqual([]);
  expect(ed.history.current).toBe(before);
  expect(ed.notice).toMatch(/trennt nichts/);
  drag(tool, at(8, 8), at(9, 8));
  await settle();
  expect(calls).toHaveLength(1);
});

test('Messer (Freihand): offener Kurvenzug von Anfang bis Ende', async () => {
  const ed = editor([square('a', 0, 0)]);
  const calls: KnifeJob[][] = [];
  const tool = knifeTool(ed as unknown as Editor, () => ({ ...params, knife: 'free' }), () => {}, async (jobs) => (calls.push(jobs), [null]));
  drag(tool, at(0, -10), at(6, 6), at(10, 20), at(14, 40));
  await settle();
  const cut = calls[0][0].cut;
  expect(cut.closed).toBe(false);
  expect([cut.nodes[0].x, cut.nodes[0].y]).toEqual([0, -5]);
  expect([cut.nodes.at(-1)!.x, cut.nodes.at(-1)!.y]).toEqual([7, 20]);
});

test('Radierer: Klick = Punkt mit Dicke und Spitze; ganz weg entfernt das Objekt', async () => {
  const ed = editor([square('a', 0, 0)]);
  const calls: EraseJob[][] = [];
  const tool = eraserTool(ed as unknown as Editor, () => ({ ...params, nib: 'square' }), () => {}, async (jobs) => (calls.push(jobs), [[]]));
  drag(tool, at(10, 10));
  await settle();
  expect(calls[0][0]).toMatchObject({ trail: sub(false, pt(5, 5)), width: 2, square: true });
  expect(kids(ed.history.current)).toEqual([]);
  expect(ed.selected.size).toBe(0);
});

test('Radierer: Zug von Anfang bis Ende, Ergebnis ersetzt die Form', async () => {
  const ed = editor([square('a', 0, 0)]);
  ed.selected = new Set(['a']);
  const calls: EraseJob[][] = [];
  const tool = eraserTool(ed as unknown as Editor, () => params, () => {}, async (jobs) => (calls.push(jobs), [[box(0, 0, 4, 10), box(6, 0, 10, 10)]]));
  drag(tool, at(10, -10), at(10, 10), at(10, 40));
  await settle();
  const trail = calls.at(-1)![0].trail;
  expect([trail.nodes[0].y, trail.nodes.at(-1)!.y]).toEqual([-5, 20]);
  expect((kids(ed.history.current)[0] as LeafNode & { subpaths: Subpath[] }).subpaths).toHaveLength(2);
  expect([...ed.selected]).toEqual(['a']);
});

test('Radierer live wie Vorbild: schon beim Ziehen radiert; Loslassen = ein Rückgängig-Schritt', async () => {
  const ed = editor([square('a', 0, 0)]);
  const before = ed.history.current;
  const tool = eraserTool(ed as unknown as Editor, () => params, () => {}, async () => [[box(0, 0, 4, 10), box(6, 0, 10, 10)]]);
  tool.down(at(10, -10));
  tool.move(at(10, 10));
  await settle();
  expect((kids(ed.history.current)[0] as LeafNode & { subpaths: Subpath[] }).subpaths).toHaveLength(2);
  tool.move(at(10, 40));
  tool.up(at(10, 40));
  await settle();
  ed.history.undo();
  expect(ed.history.current).toBe(before);
  expect(ed.history.canUndo).toBe(false);
});

test('Radierer live: ganz Weggeradiertes bleibt weg, auch wenn es nicht mehr berührt wird', async () => {
  const ed = editor([square('a', 0, 0)]);
  const calls: EraseJob[][] = [];
  const tool = eraserTool(ed as unknown as Editor, () => params, () => {}, async (jobs) => (calls.push(jobs), jobs.map(() => [])));
  ed.renderer.touching = () => (calls.length ? [] : ['a']);
  tool.down(at(10, 10));
  tool.move(at(12, 12));
  await settle();
  tool.up(at(14, 14));
  await settle();
  expect(calls.at(-1)).toHaveLength(1);
  expect(kids(ed.history.current)).toEqual([]);
});

test('Radierer fängt nicht (freie Spur ohne Sprung an Fangpunkte); Messer fängt weiter', () => {
  const ed = editor([square('a', 0, 0)]) as unknown as Editor;
  expect(eraserTool(ed, () => params, () => {}).noSnap).toBe(true);
  expect(knifeTool(ed, () => params, () => {}).noSnap).toBeFalsy();
});

test('Pipette: erster Klick nimmt auf, weitere übertragen; Shift nimmt neu auf; Esc setzt zurück', () => {
  const red = { model: 'rgb' as const, values: [1, 0, 0] as [number, number, number] };
  const a = { ...square('a', 0, 0), style: { fill: red, stroke: { ...DEFAULT_STROKE, width: 3 } } };
  const ed = editor([a, square('b', 30, 0)]);
  let pick = { fill: true, stroke: false };
  const tool = eyedropperTool(ed as unknown as Editor, () => ({ ...params, pick }));
  const style = (id: string) => (findNode(ed.history.current, id) as LeafNode).style;
  const click = (p: Pointer) => drag(tool, p);
  const b0 = style('b');

  click(at(10, 10));
  expect(ed.history.canUndo).toBe(false);
  click(at(60, 10));
  expect(style('b')).toEqual({ fill: red, stroke: b0.stroke });
  pick = { fill: true, stroke: true };
  click(at(60, 10));
  expect(style('b')).toEqual(a.style);

  ed.history.undo();
  ed.history.undo();
  click(at(60, 10, true)); // Shift: b neu aufnehmen
  click(at(10, 10));
  expect(style('a')).toEqual(b0);

  expect(tool.key!({ name: 'deselect' })).toBe(true);
  click(at(60, 10)); // nach Esc: wieder aufnehmen, nichts übertragen
  expect(style('b')).toEqual(b0);
});
