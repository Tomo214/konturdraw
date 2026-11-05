import { expect, test } from 'vitest';
import { addNodes, createDocument } from '../../src/model/document';
import { History } from '../../src/model/history';
import type { Doc } from '../../src/model/types';
import { buildScene } from '../../src/render/scene';
import { screenToPage } from '../../src/render/viewport';
import { Snapper } from '../../src/ui/snapper';
import { selectTool } from '../../src/ui/tools/select-tool';
import type { Editor, Pointer } from '../../src/ui/tools/tool';
import { square } from '../model/fixtures';

// Zoom 2: 1 mm = 2 px, Fangradius 10 px = 5 mm. Quadrat a bei 0..10, b bei 30..40.
const vp = { x: 0, y: 0, zoom: 2 };
const at = (x: number, y: number): Pointer => ({ sx: x * 2, sy: y * 2, x, y, shift: false, alt: false });

function setup() {
  const doc = createDocument();
  const history = new History<Doc>(addNodes(doc, doc.pages[0].layers[0].id, [square('a'), square('b', 30, 0)]));
  const scene = () => buildScene(history.current.pages[0]);
  const ed = {
    history,
    renderer: { bounds: () => null, hitTest: () => scene().find((it) => it.id === 'b'), inside: () => [] },
    vp,
    viewSize: [800, 600] as const,
    selected: new Set<string>(),
    guide: null as string | null,
    notice: '',
    guides: () => [],
  };
  const snapper = new Snapper(() => ({ items: scene(), guides: [], grid: { x: 10, y: 10 }, origin: { x: 0, y: 0 } }), () => ({ objects: true, grid: false, guides: false }));
  const tool = selectTool(ed as unknown as Editor);
  const b = () => history.current.pages[0].layers[0].children.find((n) => n.id === 'b')!.transform;
  return {
    snapper,
    b,
    drag(from: Pointer, to: Pointer) {
      tool.down(snapper.at(from, vp.zoom));
      snapper.freeze(tool.snapSkip?.());
      tool.move(snapper.at(to, vp.zoom));
      tool.up(snapper.at(to, vp.zoom));
      snapper.release();
    },
  };
}

test('Auswahlwerkzeug: gegriffene Ecke landet exakt auf der Ecke des anderen Objekts', () => {
  const s = setup();
  s.drag(at(30.5, 0.5), at(10.5, 0.4));
  expect(s.b()).toEqual([1, 0, 0, 1, 10, 0]);
});

test('bewegtes Objekt fängt nicht an seiner eigenen alten Lage', () => {
  const s = setup();
  s.drag(at(30.5, 0.5), at(31.8, 10.5));
  const m = s.b();
  expect(m[4]).toBeCloseTo(31.8, 9);
  expect(m[5]).toBeCloseTo(10.5, 9);
});

test('Treffer bleibt für die Anzeige stehen; roher Bildschirmpunkt bleibt erhalten', () => {
  const s = setup();
  const p = s.snapper.at(at(10.6, 0.3), vp.zoom);
  expect(s.snapper.hit).toEqual({ x: 10, y: 0, kind: 'node' });
  expect([p.x, p.y, p.snap, p.sx, p.sy]).toEqual([10, 0, 'node', 21.2, 0.6]);
  expect(screenToPage(vp, p.sx, p.sy)).toEqual([10.6, 0.3]);
  expect(s.snapper.at(at(20, 20), vp.zoom).snap).toBeUndefined();
  expect(s.snapper.hit).toBeNull();
});
