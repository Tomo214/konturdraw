import type { Mat } from './geometry';
import { BLACK } from './style';
import type { Subpath, TextFont, TextNode } from './types';

/** Antwort von kw-core (text/mod.rs Layout), mm im Objektsystem; index in UTF-16 wie das Textfeld. */
export interface TextLayout {
  glyphs: { x: number; y: number; angle: number; advance: number; index: number }[];
  lines: { baseline: number; x0: number; x1: number; start: number; end: number }[];
  outline: Subpath[];
  ascent: number;
  descent: number;
  overflow: boolean;
}

export const DEFAULT_FONT: TextFont = { family: 'Arial', weight: 400, italic: false, size: 24 };

/** Leerer Text; place wählt Fließtext-Rahmen oder Pfad. */
export function createText(id: string, transform: Mat, place: Pick<TextNode, 'frame' | 'onPath'> = {}): TextNode {
  return {
    type: 'text',
    id,
    transform,
    style: { fill: BLACK, stroke: null },
    text: '',
    font: DEFAULT_FONT,
    tracking: 0,
    lineSpacing: 100,
    align: 'left',
    ...place,
    outline: [],
  };
}

/** Eingabe für kw-core: Satz-Felder ohne Umriss, Stil und Lage. */
export function textSpec(n: TextNode) {
  const { text, font, tracking, lineSpacing, align, frame, onPath } = n;
  return { text, font, tracking, lineSpacing, align, ...(frame && { frame }), ...(onPath && { onPath }) };
}

export const withLayout = (n: TextNode, l: TextLayout): TextNode => ({ ...n, outline: l.outline });

/** Schreibmarke vor Stelle index: Punkt auf der Grundlinie und Laufrichtung (Bogenmaß). */
export function caretAt(l: TextLayout, index: number): { x: number; y: number; angle: number } {
  const hit = l.glyphs.find((g) => g.index === index);
  if (hit) return { x: hit.x, y: hit.y, angle: hit.angle };
  const line = l.lines.filter((r) => r.start <= index).at(-1) ?? l.lines[0];
  const prev = l.glyphs.filter((g) => g.index < index && g.index >= line.start).at(-1);
  if (!prev) return { x: line.x0, y: line.baseline, angle: 0 };
  const { x, y, angle, advance } = prev;
  return { x: x + advance * Math.cos(angle), y: y + advance * Math.sin(angle), angle };
}

const outside = (v: number, lo: number, hi: number) => (v < lo ? lo - v : v > hi ? v - hi : 0);

/** Stelle im Text (UTF-16) zum Punkt: nächste Glyphe, dann die nähere ihrer beiden Kanten. */
export function indexAt(l: TextLayout, x: number, y: number): number {
  let best = { d: Infinity, i: 0 };
  const take = (d: number, i: number) => d < best.d && (best = { d, i });
  for (const line of l.lines) {
    const gs = l.glyphs.filter((g) => g.index >= line.start && g.index < line.end);
    if (!gs.length) take(Math.hypot(x - line.x0, outside(y - line.baseline, -l.ascent, l.descent)), line.start);
    gs.forEach((g, k) => {
      const c = Math.cos(g.angle);
      const s = Math.sin(g.angle);
      const u = (x - g.x) * c + (y - g.y) * s;
      const v = (y - g.y) * c - (x - g.x) * s;
      take(Math.hypot(outside(u, 0, g.advance), outside(v, -l.ascent, l.descent)), u < g.advance / 2 ? g.index : (gs[k + 1]?.index ?? line.end));
    });
  }
  return best.i;
}
