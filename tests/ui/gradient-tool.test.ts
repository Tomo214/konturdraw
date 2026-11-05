import { describe, expect, it } from 'vitest';
import { addNodes, createDocument, findNode } from '../../src/model/document';
import { History } from '../../src/model/history';
import type { FillSpec } from '../../src/model/style';
import type { Color, Doc, Gradient, LeafNode } from '../../src/model/types';
import { screenToPage, type Viewport } from '../../src/render/viewport';
import { gradientTool } from '../../src/ui/tools/gradient-tool';
import type { Editor, Pointer, Tool } from '../../src/ui/tools/tool';
import { square } from '../model/fixtures';

const vp: Viewport = { x: 0, y: 0, zoom: 2 };
const at = (sx: number, sy: number): Pointer => {
  const [x, y] = screenToPage(vp, sx, sy);
  return { sx, sy, x, y, shift: false, alt: false };
};
const rgb = (r: number, g: number, b: number): Color => ({ model: 'rgb', values: [r, g, b] });
const [RED, GREEN, BLUE, YELLOW] = [rgb(1, 0, 0), rgb(0, 1, 0), rgb(0, 0, 1), rgb(1, 1, 0)];
const spec: FillSpec = { kind: 'linear', a: RED, b: BLUE };

// Quadrat 10×10 bei (10,20); Verlauf in Objektkoordinaten (0,5)→(10,5).
// Bildschirm (Zoom 2): Anfang (20,50), Grün-Knoten bei 0,25 → (25,50), Ende (40,50).
function editor() {
  const node: LeafNode = {
    ...square('a', 10, 20),
    style: { fill: { kind: 'linear', from: { x: 0, y: 5 }, to: { x: 10, y: 5 }, stops: [{ offset: 0, color: RED }, { offset: 0.25, color: GREEN }, { offset: 1, color: BLUE }] }, stroke: null },
  };
  const doc = createDocument(200, 200);
  const ed = {
    history: new History<Doc>(addNodes(doc, doc.pages[0].layers[0].id, [node])),
    renderer: {
      leavesOf: (ids: ReadonlySet<string>) =>
        [...ids].map((id) => {
          const n = findNode(ed.history.current, id) as LeafNode;
          return { id, node: n, world: n.transform };
        }),
    },
    vp,
    selected: new Set(['a']),
    notice: '',
    fill: spec,
    stroke: null,
  };
  return { ed, tool: gradientTool(ed as unknown as Editor) };
}
const grad = (ed: { history: History<Doc> }) => (findNode(ed.history.current, 'a') as LeafNode).style.fill as Gradient;
const click = (tool: Tool, p: Pointer) => (tool.down(p), tool.up(p));
const dbl = (tool: Tool, p: Pointer) => (click(tool, p), click(tool, p), tool.dblclick!(p));

describe('Verlaufswerkzeug: Knoten auf der Linie', () => {
  it('Doppelklick auf die Linie: Knoten mit der dort sichtbaren Farbe, gewählt; Palette färbt ihn; ein Rückgängig-Schritt', () => {
    const { ed, tool } = editor();
    dbl(tool, at(32, 50)); // Objekt-x 6 → t 0,6
    const g = grad(ed);
    expect(g.stops.map((s) => s.offset)).toEqual([0, 0.25, 0.6, 1]);
    const c = g.stops[2].color.values;
    [0, 1 - 0.35 / 0.75, 0.35 / 0.75].forEach((v, i) => expect(c[i]).toBeCloseTo(v));
    expect(g.from).toEqual({ x: 0, y: 5 });
    expect(tool.paint!(YELLOW)).toBe(true);
    expect(grad(ed).stops[2].color).toEqual(YELLOW);
    ed.history.undo();
    ed.history.undo();
    expect(grad(ed).stops).toHaveLength(3);
  });

  it('Knoten ziehen verschiebt nur ihn, begrenzt zwischen die Nachbarn; Linie bleibt', () => {
    const { ed, tool } = editor();
    tool.down(at(25, 50));
    tool.move(at(35, 50));
    tool.up(at(35, 50));
    expect(grad(ed).stops[1].offset).toBeCloseTo(0.75);
    expect([grad(ed).from, grad(ed).to]).toEqual([{ x: 0, y: 5 }, { x: 10, y: 5 }]);
    tool.down(at(35, 50));
    tool.move(at(80, 50));
    tool.up(at(80, 50));
    expect(grad(ed).stops[1].offset).toBeLessThan(1);
    expect(grad(ed).stops[1].offset).toBeGreaterThan(0.99);
    ed.history.undo();
    expect(grad(ed).stops[1].offset).toBeCloseTo(0.75);
  });

  it('Doppelklick auf Zwischenknoten oder Entf löscht ihn; Enden bleiben, Entf ohne Knoten löscht das Objekt', () => {
    const { ed, tool } = editor();
    dbl(tool, at(25, 50));
    expect(grad(ed).stops.map((s) => s.color)).toEqual([RED, BLUE]);
    ed.history.undo();
    click(tool, at(25, 50));
    expect(tool.key!({ name: 'delete' })).toBe(true);
    expect(grad(ed).stops).toHaveLength(2);
    click(tool, at(40, 50)); // Ende gewählt: Entf verbraucht, nichts gelöscht
    expect(tool.key!({ name: 'delete' })).toBe(true);
    expect(grad(ed).stops).toHaveLength(2);
    click(tool, at(32, 50)); // auf der Linie, kein Knoten → Auswahl weg
    expect(tool.key!({ name: 'delete' })).toBe(false);
  });

  it('Klick auf ein Ende wählt es für die Palette; ohne gewählten Knoten bleibt die Palette beim Objekt', () => {
    const { ed, tool } = editor();
    expect(tool.paint!(YELLOW)).toBe(false);
    click(tool, at(40, 50));
    expect(grad(ed).to).toEqual({ x: 10, y: 5 });
    expect(tool.paint!(YELLOW)).toBe(true);
    expect(grad(ed).stops.map((s) => s.color)).toEqual([RED, GREEN, YELLOW]);
    click(tool, at(18, 50)); // 2 px vom Anfang, 7 px vom Grün-Knoten
    expect(tool.paint!(GREEN)).toBe(true);
    expect(grad(ed).stops[0].color).toEqual(GREEN);
    click(tool, at(32, 50));
    expect(tool.paint!(RED)).toBe(false);
  });
});

describe('Verlaufswerkzeug: Knotenfelder in der Eigenschaftsleiste (7b)', () => {
  it('ohne gewählten Knoten nichts; Klick auf Knoten zeigt Lage, Farbe, Stelle', () => {
    const { tool } = editor();
    expect(tool.knot!.get()).toBeNull();
    click(tool, at(25, 50));
    expect(tool.knot!.get()).toEqual({ index: 1, count: 3, offset: 0.25, color: GREEN });
  });

  it('Lage und Farbe setzen: je ein Rückgängig-Schritt, Lage begrenzt zwischen die Nachbarn', () => {
    const { ed, tool } = editor();
    click(tool, at(25, 50));
    tool.knot!.set({ offset: 0.5 });
    expect(grad(ed).stops.map((s) => s.offset)).toEqual([0, 0.5, 1]);
    tool.knot!.set({ color: YELLOW });
    expect(grad(ed).stops[1].color).toEqual(YELLOW);
    tool.knot!.set({ offset: 2 });
    expect(grad(ed).stops[1].offset).toBeCloseTo(0.999);
    ed.history.undo();
    ed.history.undo();
    expect(grad(ed).stops[1]).toEqual({ offset: 0.5, color: GREEN });
  });

  it('Ende: Lage bleibt fest und kostet keinen Schritt, Farbe geht', () => {
    const { ed, tool } = editor();
    click(tool, at(40, 50));
    tool.knot!.set({ offset: 0.5 });
    expect(grad(ed).stops[2].offset).toBe(1);
    expect(ed.history.canUndo).toBe(false);
    tool.knot!.set({ color: YELLOW });
    expect(grad(ed).stops[2].color).toEqual(YELLOW);
  });
});

describe('Verlaufswerkzeug: Palettenfarbe auf die Linie ziehen (7c)', () => {
  it('auf die Linie: neuer Knoten in dieser Farbe, gewählt; ein Rückgängig-Schritt', () => {
    const { ed, tool } = editor();
    expect(tool.drop!(at(32, 50), YELLOW)).toBe(true);
    const g = grad(ed);
    expect(g.stops.map((s) => s.offset)).toEqual([0, 0.25, 0.6, 1]);
    expect(g.stops[2].color).toEqual(YELLOW);
    expect(tool.knot!.get()).toMatchObject({ index: 2, color: YELLOW });
    ed.history.undo();
    expect(grad(ed).stops).toHaveLength(3);
  });

  it('auf einen Knoten oder ein Ende: färbt ihn um', () => {
    const { ed, tool } = editor();
    expect(tool.drop!(at(25, 50), YELLOW)).toBe(true);
    expect(tool.drop!(at(18, 50), BLUE)).toBe(true); // 2 px vom Anfang, 7 px vom Knoten
    expect(grad(ed).stops.map((s) => s.color)).toEqual([BLUE, YELLOW, BLUE]);
  });

  it('daneben oder ohne Verlauf: nicht verbraucht, nichts geändert', () => {
    const { ed, tool } = editor();
    expect(tool.drop!(at(32, 70), YELLOW)).toBe(false);
    ed.selected = new Set();
    expect(tool.drop!(at(32, 50), YELLOW)).toBe(false);
    expect(ed.history.canUndo).toBe(false);
  });
});
