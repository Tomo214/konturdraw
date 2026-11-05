import { describe, expect, it } from 'vitest';
import { gridStep, rulerMarks, rulerStep } from '../../src/render/ruler';
import { MM_TO_PX } from '../../src/render/viewport';

describe('Linealteilung', () => {
  it('wählt Beschriftung 1/2/5·10^n mit genug Platz und feine Striche ab 5 px', () => {
    expect(rulerStep(MM_TO_PX)).toEqual({ step: 10, sub: 5 }); // 100 % in mm
    expect(rulerStep(10)).toEqual({ step: 5, sub: 5 });
    expect(rulerStep(100)).toEqual({ step: 0.5, sub: 5 });
    expect(rulerStep(0.05)).toEqual({ step: 1000, sub: 10 });
    expect(rulerStep(30)).toEqual({ step: 2, sub: 4 });
  });

  it('setzt Striche ohne Rundungsfehler, Hauptstriche auf Vielfachen der Beschriftung', () => {
    const marks = rulerMarks(-3, 12, 10, 5);
    expect(marks.map((m) => m.v)).toEqual([-2, 0, 2, 4, 6, 8, 10, 12]);
    expect(marks.filter((m) => m.major).map((m) => m.v)).toEqual([0, 10]);
    expect(rulerMarks(0, 0.3, 0.1, 10).map((m) => m.v)).toContain(0.3);
    expect(rulerMarks(-20, -9, 10, 2).filter((m) => m.major).map((m) => m.v)).toEqual([-20, -10]);
  });
});

describe('Raster-Dichte', () => {
  it('zeigt nur jede k-te Linie, wenn die Linien enger als 8 px liegen', () => {
    expect(gridStep(37.8)).toBe(1);
    expect(gridStep(3)).toBe(5);
    expect(gridStep(0.01)).toBe(1000);
  });
});
