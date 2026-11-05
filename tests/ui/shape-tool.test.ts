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
