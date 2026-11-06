import { naiveSrgb } from './color';
import { subpathBounds } from './bezier';
import { findNode, updateNodes } from './document';
import { geometry, shapeSubpaths } from './shapes';
import type { Color, Doc, Fill, Gradient, LeafNode, Node, Point, Stroke } from './types';

export const BLACK: Color = { model: 'rgb', values: [0, 0, 0] };
export const DEFAULT_STROKE: Stroke = { color: BLACK, width: 0.5, cap: 'round', join: 'round' };

/** Füllung, wie Bedienfeld und Werkzeuge sie setzen: Art + Anfangs-/Endfarbe. */
export interface FillSpec {
  kind: 'none' | 'solid' | 'linear' | 'radial';
  a: Color;
  b: Color;
}

export const isGradient = (f: Fill): f is Gradient => 'kind' in f;

/** Farbfeld-Wert (#rrggbb) ↔ RGB 0..1; CMYK/Grau ohne Profil über die einfache Formel. */
export const toHex = (c: Color): string =>
  '#' + naiveSrgb(c).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

export const fromHex = (s: string): Color => ({
  model: 'rgb',
  values: [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255) as [number, number, number],
});

/** mm-Feldwert: höchstens 4 Nachkommastellen (0,1 µm) wie der SVG-Export; schluckt Rechenrauschen. */
export const mmField = (v: number): number => +v.toFixed(4);

/** Liest eine Füllung zurück; was sie nicht festlegt, kommt aus prev. */
export function fillSpec(f: Fill | null, prev: FillSpec): FillSpec {
  if (!f) return { ...prev, kind: 'none' };
  if (!isGradient(f)) return { ...prev, kind: 'solid', a: f };
  return { kind: f.kind, a: f.stops[0].color, b: f.stops[f.stops.length - 1].color };
}

const stops = (s: FillSpec) => [{ offset: 0, color: s.a }, { offset: 1, color: s.b }];

const withFill = (n: LeafNode, fill: Fill | null): LeafNode => ({ ...n, style: { ...n.style, fill } });

/** Vorhandener Verlauf behält seine Lage; neuer liegt quer über der Objekt-Box (radial: Mitte bis halbe längere Seite). */
export function setFill(n: LeafNode, s: FillSpec): LeafNode {
  if (s.kind === 'none') return withFill(n, null);
  if (s.kind === 'solid') return withFill(n, s.a);
  const old = n.style.fill;
  if (old && isGradient(old)) {
    // nur Anfangs- und Endfarbe kommen aus dem Bedienfeld; Zwischenknoten und Lagen bleiben
    const last = old.stops.length - 1;
    const kept = old.stops.map((st, i) => (i === 0 ? { ...st, color: s.a } : i === last ? { ...st, color: s.b } : st));
    return withFill(n, { ...old, kind: s.kind, stops: last >= 1 ? kept : stops(s) });
  }
  const b = subpathBounds(geometry(n)) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const [cx, cy] = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  const r = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 2;
  return withFill(n, {
    kind: s.kind,
    from: s.kind === 'linear' ? { x: b.minX, y: cy } : { x: cx, y: cy },
    to: s.kind === 'linear' ? { x: b.maxX, y: cy } : { x: cx + r, y: cy },
    stops: stops(s),
  });
}

/** Verlaufswerkzeug: Lage setzen; ohne Verlauf entsteht einer aus der Vorgabe (Vollton/keine → linear). */
export function setGradientLine(n: LeafNode, from: Point, to: Point, s: FillSpec): LeafNode {
  const old = n.style.fill;
  if (old && isGradient(old)) return withFill(n, { ...old, from, to });
  return withFill(n, { kind: s.kind === 'radial' ? 'radial' : 'linear', from, to, stops: stops(s) });
}

/** Linienarten der Kontur: Strichmuster (Strich, Lücke, …) als Vielfache der Breite, wächst mit ihr. */
export const DASHES: readonly { name: string; dash?: readonly number[] }[] = [
  { name: 'durchgehend' },
  { name: 'Striche', dash: [4, 2] },
  { name: 'kurze Striche', dash: [2, 2] },
  { name: 'Punkte', dash: [1, 2] },
  { name: 'Strich-Punkt', dash: [4, 2, 1, 2] },
];

/** Vorgabe mit genau diesem Muster; -1 = eigenes (z. B. aus einer Importdatei). */
export function dashIndex(dash: readonly number[] | undefined): number {
  return DASHES.findIndex((d) => (d.dash ?? []).join() === (dash ?? []).join());
}

/** null entfernt die Kontur; sonst nur die genannten Eigenschaften ändern (fehlende Kontur → Vorgabe). */
export function setStroke(n: LeafNode, patch: Partial<Stroke> | null): LeafNode {
  return { ...n, style: { ...n.style, stroke: patch && { ...(n.style.stroke ?? DEFAULT_STROKE), ...patch } } };
}

/** Form oder Text → bearbeitbarer Pfad; ID, Lage und Stil bleiben. */
export function toCurves(n: LeafNode): LeafNode {
  if (n.type === 'path') return n;
  if (n.type === 'text') {
    const { text, font, tracking, lineSpacing, align, frame, onPath, outline, ...rest } = n;
    return { ...rest, type: 'path', subpaths: outline };
  }
  const { shape, ...rest } = n;
  return { ...rest, type: 'path', subpaths: shapeSubpaths(shape) };
}

export const setRadius = (radius: number) => (n: LeafNode): LeafNode =>
  n.type === 'shape' && n.shape.kind === 'rect' ? { ...n, shape: { ...n.shape, radius } } : n;

export const setPolygon = (sides: number, inner: number | null) => (n: LeafNode): LeafNode =>
  n.type === 'shape' && n.shape.kind === 'polygon' ? { ...n, shape: { ...n.shape, sides, inner } } : n;

/** Bilder haben keinen Stil und bleiben unberührt. */
export function mapLeaves(n: Node, fn: (l: LeafNode) => LeafNode): Node {
  if (n.type === 'group') return { ...n, children: n.children.map((c) => mapLeaves(c, fn)) };
  return n.type === 'image' ? n : fn(n);
}

/** Wendet fn auf alle Blätter der gewählten Objekte an (auch in Gruppen). */
export function updateLeaves(doc: Doc, ids: Iterable<string>, fn: (l: LeafNode) => LeafNode): Doc {
  return updateNodes(doc, ids, (n) => mapLeaves(n, fn));
}

/** Transparenz der gewählten Objekte (Gruppe als Ganzes, wirkt auf jedes Kind); 1 = deckend, Feld entfällt. */
export function setOpacity(doc: Doc, ids: Iterable<string>, opacity: number): Doc {
  const o = Math.min(1, Math.max(0, opacity));
  return updateNodes(doc, ids, (n) => {
    const { opacity: _, ...rest } = n;
    return (o < 1 ? { ...rest, opacity: o } : rest) as Node;
  });
}

/** Deckkraft des ersten gewählten Objekts; null = nichts gewählt. */
export function selectionOpacity(doc: Doc, ids: Iterable<string>): number | null {
  for (const id of ids) {
    const n = findNode(doc, id);
    if (n) return n.opacity ?? 1;
  }
  return null;
}

const rel = (v: number, a: number, b: number) => (b - a > 1e-12 ? (v - a) / (b - a) : 0.5);

/** Pipette: Füllung und/oder Kontur der Quelle übernehmen; ein Verlauf liegt im Ziel an derselben Stelle seiner Box. */
export function copyStyle(doc: Doc, ids: Iterable<string>, source: LeafNode, what: { fill: boolean; stroke: boolean }): Doc {
  const src = source.style.fill;
  const sb = src && isGradient(src) ? subpathBounds(geometry(source)) : null;
  return updateLeaves(doc, ids, (n) => {
    let fill = what.fill ? src : n.style.fill;
    const tb = sb && what.fill ? subpathBounds(geometry(n)) : null;
    if (src && isGradient(src) && sb && tb) {
      const map = (p: Point): Point => ({
        x: tb.minX + rel(p.x, sb.minX, sb.maxX) * (tb.maxX - tb.minX),
        y: tb.minY + rel(p.y, sb.minY, sb.maxY) * (tb.maxY - tb.minY),
      });
      fill = { ...src, from: map(src.from), to: map(src.to) };
    }
    return { ...n, style: { fill, stroke: what.stroke ? source.style.stroke : n.style.stroke } };
  });
}
