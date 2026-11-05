// Verlaufsknoten (5c) wie im Vorbild: auf der Verlaufslinie Knoten setzen, schieben, löschen, umfärben.
// Alles in Objektkoordinaten des Verlaufs; t = Lage auf from→to (0 = Anfang, 1 = Ende). Rein, ohne UI.
import { naiveSrgb } from './color';
import type { Color, Gradient, Point } from './types';

/** Mindestabstand zwischen Knoten: neue Knoten nicht darauf, gezogene nicht darüber hinweg. */
const NEAR = 0.005;
const GAP = 0.001;

/** Lage des Lotfußpunkts von p auf der Verlaufslinie (kann außerhalb 0..1 liegen). */
export function along(g: Gradient, p: Point): number {
  const dx = g.to.x - g.from.x;
  const dy = g.to.y - g.from.y;
  const len2 = dx * dx + dy * dy;
  return len2 > 0 ? ((p.x - g.from.x) * dx + (p.y - g.from.y) * dy) / len2 : 0;
}

/** Gleiches Farbmodell → im Modell mischen (CMYK bleibt CMYK); sonst über sRGB. Volltonname fällt weg. */
function mix(a: Color, b: Color, f: number): Color {
  const lerp = (x: readonly number[], y: readonly number[]) => x.map((v, i) => v + (y[i] - v) * f);
  // gleiches Modell → gleich viele Werte wie a
  if (a.model === b.model) return { model: a.model, values: lerp(a.values, b.values) } as unknown as Color;
  const [r, g, bl] = lerp(naiveSrgb(a), naiveSrgb(b));
  return { model: 'rgb', values: [r, g, bl] };
}

/** Farbe an der Lage t: zwischen den Nachbarknoten linear, vor dem ersten/hinter dem letzten deren Farbe. */
export function colorAt(g: Gradient, t: number): Color {
  const s = g.stops;
  if (t <= s[0].offset) return s[0].color;
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i].offset) {
      const span = s[i].offset - s[i - 1].offset;
      return mix(s[i - 1].color, s[i].color, span > 0 ? (t - s[i - 1].offset) / span : 1);
    }
  }
  return s[s.length - 1].color;
}

/** Neuer Knoten bei t mit der dort sichtbaren Farbe; nur zwischen den Enden und nicht auf einem vorhandenen. */
export function addStop(g: Gradient, t: number): { gradient: Gradient; index: number } | null {
  const s = g.stops;
  if (!(t > s[0].offset && t < s[s.length - 1].offset)) return null;
  if (s.some((st) => Math.abs(st.offset - t) < NEAR)) return null;
  const index = s.findIndex((st) => st.offset > t);
  const stop = { offset: t, color: colorAt(g, t) };
  return { gradient: { ...g, stops: [...s.slice(0, index), stop, ...s.slice(index)] }, index };
}

const inner = (g: Gradient, i: number) => i > 0 && i < g.stops.length - 1;

/** Zwischenknoten auf t schieben, begrenzt zwischen seine Nachbarn; Enden bleiben fest. */
export function moveStop(g: Gradient, i: number, t: number): Gradient {
  if (!inner(g, i)) return g;
  const lo = g.stops[i - 1].offset + GAP;
  const hi = g.stops[i + 1].offset - GAP;
  const offset = Math.min(hi, Math.max(lo, t));
  return { ...g, stops: g.stops.map((st, k) => (k === i ? { ...st, offset } : st)) };
}

/** Zwischenknoten entfernen; die Enden lassen sich nicht löschen. */
export function removeStop(g: Gradient, i: number): Gradient | null {
  return inner(g, i) ? { ...g, stops: g.stops.filter((_, k) => k !== i) } : null;
}

export function setStopColor(g: Gradient, i: number, color: Color): Gradient {
  return { ...g, stops: g.stops.map((st, k) => (k === i ? { ...st, color } : st)) };
}
