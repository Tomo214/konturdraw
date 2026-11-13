import { expect, test } from 'vitest';
import type { ContourJob, ContourParams } from '../../src/model/contour';
import { addNodes, createDocument } from '../../src/model/document';
import { History } from '../../src/model/history';
import type { Doc, Node, Subpath } from '../../src/model/types';
import { screenToPage, type Viewport } from '../../src/render/viewport';
import { contourTool } from '../../src/ui/tools/contour-tool';
import type { Editor, Pointer, Tool } from '../../src/ui/tools/tool';
import { pt, square, sub } from '../model/fixtures';

const vp: Viewport = { x: 0, y: 0, zoom: 2 };
const at = (x: number, y: number): Pointer => {
  const [sx, sy] = [x * vp.zoom, y * vp.zoom];
  const [px, py] = screenToPage(vp, sx, sy);
  return { sx, sy, x: px, y: py, shift: false, alt: false };
};
const settle = () => new Promise((r) => setTimeout(r, 0));
const box = (x0: number, y0: number, x1: number, y1: number): Subpath => sub(true, pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1));
const kids = (d: Doc) => d.pages[0].layers[0].children;

/** Objekt 'a' = Quadrat 0–10 mm; Treffer nur darauf (Bildschirm-x < 22). */
function editor(nodes: Node[]) {
  const doc = createDocument(200, 200);
  return {
    history: new History<Doc>(addNodes(doc, doc.pages[0].layers[0].id, nodes)),
    renderer: {
      hitTest: (_: Viewport, sx: number) => (sx < 22 ? { topId: 'a', chain: ['a'] } : null),
      bounds: () => ({ minX: 0, minY: 0, maxX: 10, maxY: 10 }),
    },
    vp,
    viewSize: [800, 600] as const,
    selected: new Set<string>(),
    guide: null,
    notice: '',
  };
}

function setup(p: Partial<ContourParams> = {}) {
  const ed = editor([square('a', 0, 0)]);
  const params: ContourParams = { direction: 'outside', steps: 1, offset: 2, join: 'round', ...p };
  const calls: ContourJob[][] = [];
  let done = 0;
  const tool = contourTool(ed as unknown as Editor, params, () => done++, async (jobs) => {
    calls.push(jobs);
    return jobs.map((j) => Array.from({ length: j.steps }, (_, k) => [box(-2 * (k + 1), -2 * (k + 1), 10 + 2 * (k + 1), 10 + 2 * (k + 1))]));
  });
  return { ed, params, calls, tool, done: () => done };
}

function drag(tool: Tool, ...ps: Pointer[]) {
  tool.down(ps[0]);
  for (const p of ps.slice(1)) tool.move(p);
  tool.up(ps[ps.length - 1]);
}

test('vom Objekt weg ziehen = außen; Schritte = Zugweg ÷ Abstand; Ergebnis gewählt, Leiste zeigt die Werte', async () => {
  const s = setup();
  drag(s.tool, at(10, 5), at(12, 5), at(14, 5));
  expect(s.calls).toHaveLength(1);
  expect(s.calls[0][0]).toMatchObject({ direction: 'outside', steps: 2, offset: 2, join: 'round' });
  await settle();
  expect(kids(s.ed.history.current)).toHaveLength(2);
  expect(s.ed.selected.has('a')).toBe(false);
  expect(s.ed.selected.size).toBe(1);
  expect(s.params).toMatchObject({ direction: 'outside', steps: 2 });
  expect(s.done()).toBe(1);
});

test('zur Mitte ziehen = innen; „zur Mitte“ in der Leiste bleibt erhalten', async () => {
  const s = setup();
  drag(s.tool, at(10, 5), at(6, 5));
  expect(s.calls[0][0]).toMatchObject({ direction: 'inside', steps: 2 });
  const c = setup({ direction: 'center' });
  drag(c.tool, at(10, 5), at(7, 5));
  expect(c.calls[0][0].direction).toBe('center');
  expect(c.params.direction).toBe('center');
});

test('Klick ohne Ziehen wählt nur; Klick daneben hebt die Auswahl auf', () => {
  const s = setup();
  drag(s.tool, at(5, 5));
  expect([...s.ed.selected]).toEqual(['a']);
  drag(s.tool, at(50, 50), at(60, 60));
  expect(s.ed.selected.size).toBe(0);
  expect(s.calls).toHaveLength(0);
});

test('Anwenden: Werte der Leiste auf die Auswahl; ohne Auswahl ein Hinweis', async () => {
  const s = setup({ steps: 3 });
  s.tool.actions![0].run();
  expect(s.calls).toHaveLength(0);
  expect(s.ed.notice).not.toBe('');
  s.ed.selected = new Set(['a']);
  s.tool.actions![0].run();
  expect(s.calls[0][0]).toMatchObject({ direction: 'outside', steps: 3 });
  await settle();
  expect(kids(s.ed.history.current)).toHaveLength(2);
});
