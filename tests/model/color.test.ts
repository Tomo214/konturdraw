import { describe, expect, it } from 'vitest';
import { cmyk, colorKey, gray, naiveCmyk, naiveConvert, naiveSrgb, rgb, sameColor } from '../../src/model/color';

describe('Farbmodell', () => {
  it('einfache Formel: CMYK → sRGB, Graustufen neutral', () => {
    expect(naiveSrgb(rgb(0.2, 0.4, 0.6))).toEqual([0.2, 0.4, 0.6]);
    expect(naiveSrgb(cmyk(0.5, 0, 1, 0.5))).toEqual([0.25, 0.5, 0]);
    expect(naiveSrgb(gray(0.25))).toEqual([0.25, 0.25, 0.25]);
  });

  it('einfache Formel: → CMYK, Graustufen nur Schwarz', () => {
    const [c, m, y, k] = naiveCmyk(rgb(0.2, 0.4, 0.8));
    expect([c, m, y, k].map((v) => +v.toFixed(12))).toEqual([0.75, 0.5, 0, 0.2]);
    expect(naiveCmyk(rgb(0, 0, 0))).toEqual([0, 0, 0, 1]);
    expect(naiveCmyk(gray(0.25))).toEqual([0, 0, 0, 0.75]);
    expect(naiveCmyk(cmyk(0.1, 0.2, 0.3, 0.4))).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it('Modellwechsel ohne Profil: wie kw-core, Volltonname fällt weg, gleiches Modell bleibt', () => {
    expect(naiveConvert(cmyk(0, 0, 0, 0.75), 'gray')).toEqual(gray(0.25));
    expect(naiveConvert(rgb(1, 1, 1), 'gray')).toEqual(gray(1));
    expect(naiveConvert(rgb(0, 1, 0), 'gray')).toEqual(gray(0.587));
    expect(naiveConvert(gray(0.25), 'cmyk')).toEqual(cmyk(0, 0, 0, 0.75));
    const spot = { ...cmyk(0, 1, 0, 0), spot: 'Stencil-Violett' };
    expect(naiveConvert(spot, 'rgb')).toEqual(rgb(1, 0, 1));
    expect(naiveConvert(spot, 'cmyk')).toBe(spot);
  });

  it('Schlüssel und Gleichheit: Sonderfarbname zählt nur bei sameColor', () => {
    const spot = { ...cmyk(0, 1, 0, 0), spot: 'Stencil-Violett' };
    expect(colorKey(spot)).toBe(colorKey(cmyk(0, 1, 0, 0)));
    expect(colorKey(rgb(0, 0, 0))).not.toBe(colorKey(gray(0)));
    expect(sameColor(spot, cmyk(0, 1, 0, 0))).toBe(false);
    expect(sameColor(spot, { ...cmyk(0, 1, 0, 0), spot: 'Stencil-Violett' })).toBe(true);
  });
});
