import { expect, test } from 'vitest';
import { fitBox, screenToPage, type Viewport } from '../../src/render/viewport';
import type { Editor, Pointer } from '../../src/ui/tools/tool';
import { handTool, zoomTool } from '../../src/ui/tools/view-tools';

function editor(vp: Viewport) {
  const ed = {
    vp,
    viewSize: [800, 600] as [number, number],
    view(next: Viewport) {
      ed.vp = next;
    },
  };
  return ed;
}

const at = (vp: Viewport, sx: number, sy: number, alt = false): Pointer => {
  const [x, y] = screenToPage(vp, sx, sy);
  return { sx, sy, x, y, shift: false, alt };
};

test('Zoom-Werkzeug: Klick vergrößert ×2 um den Zeiger, Alt-Klick verkleinert', () => {
  const ed = editor({ x: 0, y: 0, zoom: 1 });
  const zoom = zoomTool(ed as unknown as Editor);
  const p = at(ed.vp, 100, 50);
  zoom.down(p);
  zoom.up(p);
  expect(ed.vp.zoom).toBe(2);
  expect(screenToPage(ed.vp, 100, 50)).toEqual([p.x, p.y]);
  const q = at(ed.vp, 100, 50, true);
  zoom.down(q);
  zoom.up(q);
  expect(ed.vp.zoom).toBe(1);
});

test('Zoom-Werkzeug: Rahmen ziehen zeigt genau diesen Bereich', () => {
  const ed = editor({ x: 0, y: 0, zoom: 1 });
  const zoom = zoomTool(ed as unknown as Editor);
  zoom.down(at(ed.vp, 300, 200));
  expect(zoom.move(at(ed.vp, 100, 100))).toBe(true);
  zoom.up(at(ed.vp, 100, 100));
  expect(ed.vp).toEqual(fitBox({ minX: 100, minY: 100, maxX: 300, maxY: 200 }, 800, 600, 0));
});

test('Hand-Werkzeug verschiebt die Ansicht mit dem Zeiger', () => {
  const ed = editor({ x: 10, y: 20, zoom: 3 });
  const hand = handTool(ed as unknown as Editor);
  hand.down(at(ed.vp, 50, 50));
  hand.move(at(ed.vp, 80, 40));
  expect(ed.vp).toEqual({ x: 40, y: 10, zoom: 3 });
  hand.up(at(ed.vp, 80, 40));
  hand.move(at(ed.vp, 200, 200));
  expect(ed.vp).toEqual({ x: 40, y: 10, zoom: 3 });
});
