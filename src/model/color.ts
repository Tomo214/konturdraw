// Farbmodell ohne Profil (3f): Bauhelfer, einfache Formeln als Rückfall, Vergleich.
// Exakt mit ICC-Profil rechnet kw-core (color.rs); die Anzeige holt das über io/colors.ts.
import type { Color, ColorSettings } from './types';

export const DEFAULT_COLOR_SETTINGS: ColorSettings = { mode: 'rgb', cmykProfile: null, intent: 'relative' };

export const rgb = (r: number, g: number, b: number): Color => ({ model: 'rgb', values: [r, g, b] });
export const cmyk = (c: number, m: number, y: number, k: number): Color => ({ model: 'cmyk', values: [c, m, y, k] });
export const gray = (v: number): Color => ({ model: 'gray', values: [v] });

/** sRGB 0..1 ohne Profil (wie kw-core Cms::default). */
export function naiveSrgb(c: Color): [number, number, number] {
  switch (c.model) {
    case 'rgb':
      return [...c.values];
    case 'gray':
      return [c.values[0], c.values[0], c.values[0]];
    case 'cmyk': {
      const [cy, m, y, k] = c.values;
      return [(1 - cy) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
    }
  }
}

/** CMYK 0..1 ohne Profil; Graustufen werden reines Schwarz. */
export function naiveCmyk(c: Color): [number, number, number, number] {
  if (c.model === 'cmyk') return [...c.values];
  if (c.model === 'gray') return [0, 0, 0, 1 - c.values[0]];
  const [r, g, b] = c.values;
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 1];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
}

/** Modellwechsel ohne Profil, Regeln wie kw-core Cms::convert: neues Modell = Prozessfarbe. */
export function naiveConvert(c: Color, to: Color['model']): Color {
  if (c.model === to) return c;
  if (to === 'rgb') return rgb(...naiveSrgb(c));
  if (to === 'cmyk') return cmyk(...naiveCmyk(c));
  if (c.model === 'cmyk' && c.values[0] === 0 && c.values[1] === 0 && c.values[2] === 0) return gray(1 - c.values[3]);
  const [r, g, b] = naiveSrgb(c);
  return gray(Math.round((0.299 * r + 0.587 * g + 0.114 * b) * 1e6) / 1e6); // Weiß = 1, nicht 0,9999…
}

/** Schlüssel für Anzeige-Caches: Modell + Werte, der Sonderfarbname ändert die Anzeige nicht. */
export const colorKey = (c: Color): string => `${c.model}:${c.values.join(',')}`;

export const sameColor = (a: Color, b: Color): boolean => colorKey(a) === colorKey(b) && a.spot === b.spot;
