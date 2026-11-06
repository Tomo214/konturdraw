// Musterfüllung auf dem Bildschirm (8c): Kachel einmal in Gerätegröße rastern, dann als wiederholtes Canvas-Muster.
import { display } from '../io/colors';
import { multiply, scale, type Mat } from '../model/geometry';
import type { Pattern } from '../model/types';

const MAX = 2048; // Kantenlänge der Kachel in Pixeln; darüber wird sie kleiner gerastert

/** Kachelgröße in Gerätepixeln; device = Kachel → Gerätepixel. */
export function tilePixels(p: Pattern, device: Mat): [number, number] {
  const w = p.width * Math.hypot(device[0], device[1]);
  const h = p.height * Math.hypot(device[2], device[3]);
  const k = Math.min(1, MAX / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/** Kachelpixel → Objektsystem (Canvas-Muster gelten im beim Füllen gesetzten Objektsystem). */
export const patternTransform = (p: Pattern, tw: number, th: number): Mat => multiply(p.matrix, scale(p.width / tw, p.height / th));

const cache = new WeakMap<Pattern, { tw: number; th: number; v: number; pattern: CanvasPattern }>();

/**
 * Muster für die aktuelle Objektmatrix object (Objekt → Gerätepixel). draw zeichnet die Kachel mit screen = Kachel → Pixel
 * und meldet, ob alles da war; fehlte etwas (Bild noch nicht dekodiert), wird die Kachel nicht gemerkt.
 */
export function canvasPattern(ctx: CanvasRenderingContext2D, p: Pattern, object: Mat, draw: (c: CanvasRenderingContext2D, screen: Mat) => boolean): CanvasPattern | null {
  const [tw, th] = tilePixels(p, multiply(object, p.matrix));
  const hit = cache.get(p);
  let pattern = hit && hit.tw === tw && hit.th === th && hit.v === display.version ? hit.pattern : null;
  if (!pattern) {
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = [tw, th];
    const c = canvas.getContext('2d');
    if (!c) return null;
    const complete = draw(c, scale(tw / p.width, th / p.height));
    pattern = ctx.createPattern(canvas, 'repeat');
    if (!pattern) return null;
    if (complete) cache.set(p, { tw, th, v: display.version, pattern });
  }
  const [a, b, c, d, e, f] = patternTransform(p, tw, th);
  pattern.setTransform({ a, b, c, d, e, f });
  return pattern;
}
