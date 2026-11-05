import { expect, it } from 'vitest';
import { drawMarquee, drawSelectionBox } from '../../src/ui/overlay';

it('Rahmen hinterlässt keine Strichelung: sonst zeichnet das nächste Bild alle Konturen gestrichelt', () => {
  const dashes: number[][] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => (k === 'setLineDash' ? (d: number[]) => dashes.push(d) : k in t ? t[k] : () => {}),
    set: (t, k, v) => ((t[k] = v), true),
  }) as unknown as CanvasRenderingContext2D;
  drawMarquee(ctx, 1, 0, 0, 10, 10);
  expect(dashes.at(-1)).toEqual([]);
});

it('Objekt in einer Gruppe gewählt: runde statt eckige Griffe (wie Vorbild)', () => {
  const arcs = (child: boolean) => {
    let n = 0;
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (t, k) => (k === 'arc' ? () => n++ : k in t ? t[k] : () => {}),
      set: (t, k, v) => ((t[k] = v), true),
    }) as unknown as CanvasRenderingContext2D;
    drawSelectionBox(ctx, { x: 0, y: 0, zoom: 1 }, 1, { minX: 0, minY: 0, maxX: 10, maxY: 10 }, 'scale', child);
    return n;
  };
  expect(arcs(false)).toBe(0);
  expect(arcs(true)).toBe(8);
});
