import { describe, expect, it } from 'vitest';
import { addStop, along, colorAt, moveStop, removeStop, setStopColor } from '../../src/model/gradient';
import type { Color, Gradient } from '../../src/model/types';

const rgb = (r: number, g: number, b: number): Color => ({ model: 'rgb', values: [r, g, b] });
const [RED, GREEN, BLUE] = [rgb(1, 0, 0), rgb(0, 1, 0), rgb(0, 0, 1)];
const g3: Gradient = {
  kind: 'linear',
  from: { x: 0, y: 0 },
  to: { x: 100, y: 0 },
  stops: [{ offset: 0, color: RED }, { offset: 0.25, color: GREEN }, { offset: 1, color: BLUE }],
};

describe('Verlaufsknoten', () => {
  it('Lage auf der Linie: Lotfußpunkt, auch schräg und außerhalb', () => {
    expect(along(g3, { x: 25, y: 40 })).toBeCloseTo(0.25);
    expect(along({ ...g3, to: { x: 10, y: 10 } }, { x: 10, y: 0 })).toBeCloseTo(0.5);
    expect(along(g3, { x: -20, y: 0 })).toBeCloseTo(-0.2);
  });

  it('Farbe an t wie der Renderer: zwischen Nachbarn linear, außerhalb Endfarbe', () => {
    expect(colorAt(g3, 0.125)).toEqual(rgb(0.5, 0.5, 0));
    expect(colorAt(g3, 0.625)).toEqual(rgb(0, 0.5, 0.5));
    expect(colorAt(g3, -1)).toEqual(RED);
    expect(colorAt(g3, 2)).toEqual(BLUE);
    // gemischte Modelle über sRGB; CMYK unter sich bleibt CMYK
    const k: Gradient = { ...g3, stops: [{ offset: 0, color: { model: 'cmyk', values: [0, 0, 0, 1] } }, { offset: 1, color: { model: 'cmyk', values: [1, 0, 0, 0] } }] };
    expect(colorAt(k, 0.5)).toEqual({ model: 'cmyk', values: [0.5, 0, 0, 0.5] });
    const mixed: Gradient = { ...g3, stops: [{ offset: 0, color: { model: 'gray', values: [0] } }, { offset: 1, color: rgb(1, 1, 1) }] };
    expect(colorAt(mixed, 0.5)).toEqual(rgb(0.5, 0.5, 0.5));
  });

  it('Doppelklick auf die Linie: neuer Knoten mit der Farbe, die dort zu sehen ist; an Enden/Knoten keiner', () => {
    const r = addStop(g3, 0.625)!;
    expect(r.index).toBe(2);
    expect(r.gradient.stops.map((s) => s.offset)).toEqual([0, 0.25, 0.625, 1]);
    expect(r.gradient.stops[2].color).toEqual(rgb(0, 0.5, 0.5));
    expect(addStop(g3, 0.251)).toBeNull();
    expect(addStop(g3, 1)).toBeNull();
    expect(addStop(g3, -0.3)).toBeNull();
  });

  it('Knoten ziehen: nur Zwischenknoten, bleibt zwischen den Nachbarn', () => {
    expect(moveStop(g3, 1, 0.6).stops[1].offset).toBe(0.6);
    const far = moveStop(g3, 1, 1.4).stops[1].offset;
    expect(far).toBeLessThan(1);
    expect(far).toBeGreaterThan(0.99);
    expect(moveStop(g3, 1, -1).stops[1].offset).toBeGreaterThan(0);
    expect(moveStop(g3, 0, 0.5)).toBe(g3);
  });

  it('Knoten löschen nur innen; Farbe für jeden Knoten setzbar', () => {
    expect(removeStop(g3, 1)!.stops.map((s) => s.color)).toEqual([RED, BLUE]);
    expect(removeStop(g3, 0)).toBeNull();
    expect(removeStop(g3, 2)).toBeNull();
    expect(setStopColor(g3, 2, GREEN).stops.map((s) => s.color)).toEqual([RED, GREEN, GREEN]);
  });
});
