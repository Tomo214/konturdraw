import { describe, expect, it } from 'vitest';
import { translate } from '../../src/model/geometry';
import { geometry } from '../../src/model/shapes';
import { BLACK, toCurves } from '../../src/model/style';
import { caretAt, createText, indexAt, textSpec, withLayout, type TextLayout } from '../../src/model/text';
import { pt, sub } from './fixtures';

const layout = (outline = [sub(true, pt(0, -5), pt(3, -5), pt(3, 0))]): TextLayout => ({
  glyphs: [],
  lines: [],
  outline,
  ascent: 7,
  descent: 2,
  overflow: false,
});

describe('Text', () => {
  it('neuer Grafiktext: leer, schwarz gefüllt ohne Kontur, Lage = übergebene Matrix', () => {
    const t = createText('t', translate(10, 20));
    expect(t).toMatchObject({ type: 'text', id: 't', transform: translate(10, 20), text: '', outline: [], align: 'left' });
    expect(t.style).toEqual({ fill: BLACK, stroke: null });
    expect(t.frame).toBeUndefined();
  });

  it('textSpec: genau die Felder für kw-core, Rahmen und Pfad nur wenn vorhanden', () => {
    const t = { ...createText('t', translate(0, 0)), text: 'Ink' };
    expect(textSpec(t)).toEqual({ text: 'Ink', font: t.font, tracking: 0, lineSpacing: 100, align: 'left' });
    const path = sub(false, pt(0, 0), pt(50, 0));
    const onPath = { path, offset: 2, distance: 1, side: 'below' as const };
    expect(textSpec(createText('p', translate(0, 0), { onPath }))).toMatchObject({ onPath });
    expect(textSpec(createText('f', translate(0, 0), { frame: { width: 40, height: 20 } }))).toMatchObject({ frame: { width: 40, height: 20 } });
  });

  it('Umriss aus kw-core ist die Geometrie (Zeichnen, Treffer, Export)', () => {
    const l = layout();
    const t = withLayout(createText('t', translate(0, 0)), l);
    expect(geometry(t)).toBe(l.outline);
  });

  it('In Kurven: Umriss wird Pfad; ID, Lage und Stil bleiben, Textfelder fallen weg', () => {
    const t = withLayout({ ...createText('t', translate(5, 6)), text: 'A' }, layout());
    expect(toCurves(t)).toEqual({ type: 'path', id: 't', transform: translate(5, 6), style: t.style, subpaths: t.outline });
  });
});

describe('Schreibmarke', () => {
  const g = (x: number, y: number, index: number, advance = 2, angle = 0) => ({ x, y, angle, advance, index });
  const line = (baseline: number, start: number, end: number) => ({ baseline, x0: 0, x1: 4, start, end });
  // "ab\ncd" in zwei Zeilen
  const two: TextLayout = { ...layout([]), glyphs: [g(0, 0, 0), g(2, 0, 1), g(0, 10, 3), g(2, 10, 4)], lines: [line(0, 0, 2), line(10, 3, 5)] };
  // "ab\n": zweite Zeile leer
  const tail: TextLayout = { ...layout([]), glyphs: [g(0, 0, 0), g(2, 0, 1)], lines: [line(0, 0, 2), line(10, 3, 3)] };

  it('caretAt: vor der Glyphe, hinter der letzten der Zeile, Anfang einer leeren Zeile', () => {
    const at = (l: TextLayout, i: number) => {
      const c = caretAt(l, i);
      return [c.x, c.y];
    };
    expect([0, 1, 2, 3, 5].map((i) => at(two, i))).toEqual([[0, 0], [2, 0], [4, 0], [0, 10], [4, 10]]);
    expect(at(tail, 3)).toEqual([0, 10]);
  });

  it('caretAt folgt dem Winkel der Glyphe (Text auf Pfad)', () => {
    const l: TextLayout = { ...layout([]), glyphs: [g(5, 5, 0, 2, Math.PI / 2)], lines: [line(0, 0, 1)] };
    const c = caretAt(l, 1);
    expect([c.x, c.y].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([5, 7]);
    expect(c.angle).toBe(Math.PI / 2);
  });

  it('indexAt: nächste Glyphengrenze, rechts neben der Zeile = Zeilenende, leere Zeile = ihr Anfang', () => {
    expect(indexAt(two, 0.5, -1)).toBe(0);
    expect(indexAt(two, 1.5, -1)).toBe(1);
    expect(indexAt(two, 9, 0)).toBe(2);
    expect(indexAt(two, 3.5, 9)).toBe(5);
    expect(indexAt(two, 0.5, 20)).toBe(3);
    expect(indexAt(tail, 5, 10)).toBe(3);
  });
});
