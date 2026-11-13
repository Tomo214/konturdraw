import { expect, test } from 'vitest';
import type { Box } from '../../src/model/geometry';
import { shapeTool } from '../../src/ui/tools/shape-tool';
import type { Editor } from '../../src/ui/tools/tool';

/** Zählt Rechteck-Striche: Auswahlrahmen + eckige Griffe. */
function frames(sel: string[], bounds: Box | null): number {
  let n = 0;
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => (k === 'strokeRect' ? () => n++ : k in t ? t[k] : () => {}),
    set: (t, k, v) => ((t[k] = v), true),
  }) as unknown as CanvasRenderingContext2D;
  const ed = { vp: { x: 0, y: 0, zoom: 1 }, selected: new Set(sel), renderer: { bounds: () => bounds, nested: () => false } };
  shapeTool(ed as unknown as Editor, 'rect', () => ({ radius: 0, sides: 5, inner: null })).overlay(ctx, 1);
  return n;
}

test('Form-Werkzeug zeigt Rahmen und Griffe des gewählten Objekts (wie Vorbild nach dem Zeichnen)', () => {
  expect(frames(['a'], { minX: 0, minY: 0, maxX: 10, maxY: 10 })).toBeGreaterThan(0);
  expect(frames([], null)).toBe(0);
});

test('Aufziehen wie Vorbild: Strg (Mac ⌘) = Quadrat/Kreis, Shift = aus der Mitte', async () => {
  const { createDocument, findNode } = await import('../../src/model/document');
  const { History } = await import('../../src/model/history');
  const ed = {
    history: new History(createDocument()),
    vp: { x: 0, y: 0, zoom: 1 },
    selected: new Set<string>(),
    fill: { kind: 'none' },
    stroke: null,
    page() { return this.history.current.pages[0]; },
  };
  const tool = shapeTool(ed as unknown as Editor, 'rect', () => ({ radius: 0, sides: 5, inner: null }));
  const p = (x: number, y: number, mods = {}) => ({ sx: x, sy: y, x, y, shift: false, alt: false, ...mods });
  const draw = (mods: object) => {
    tool.down(p(10, 10, mods));
    tool.move(p(20, 14, mods));
    tool.up(p(20, 14, mods));
    const n = findNode(ed.history.current, [...ed.selected][0]) as { shape: { x: number; y: number; width: number; height: number } };
    return [n.shape.x, n.shape.y, n.shape.width, n.shape.height];
  };
  expect(draw({ mod: true })).toEqual([10, 10, 10, 10]);
  expect(draw({ shift: true })).toEqual([0, 6, 20, 8]);
  expect(draw({ alt: true })).toEqual([10, 10, 10, 4]); // Alt hat beim Aufziehen keine Bedeutung
});
