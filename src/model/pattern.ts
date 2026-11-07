// Musterfüllung (Phase 8c): eigene Zweifarb-Vorlagen und „Muster aus Auswahl“. Kachel in eigenen Koordinaten,
// matrix bildet sie ins Objektsystem ab; Größe = Kachelbreite im Objektsystem, Winkel in Grad.
import { nodeBounds } from './arrange';
import { cloneWithNewIds, findNode, newId, places, updateNodes, worldOf } from './document';
import { IDENTITY, invert, multiply, rotate, scale, translate, type Box, type Mat } from './geometry';
import { shapeSubpaths } from './shapes';
import type { Color, Doc, Fill, Node, Page, PathNode, Pattern, Point, Subpath } from './types';
import { N_, tr } from '../i18n/i18n.svelte';

export const isPattern = (f: Fill | null | undefined): f is Pattern => !!f && 'kind' in f && f.kind === 'pattern';

const poly = (...p: [number, number][]): Subpath => ({ closed: true, nodes: p.map(([x, y]) => ({ x, y, type: 'corner' })) });
const box = (x0: number, y0: number, x1: number, y1: number) => poly([x0, y0], [x1, y0], [x1, y1], [x0, y1]);

/** Einfache geometrische Vorlagen in der Einheitszelle; was über den Rand liefe, ist auf die Zelle verteilt. */
export const PATTERNS: readonly { name: string; cell: readonly Subpath[] }[] = [
  { name: N_('Punkte'), cell: shapeSubpaths({ kind: 'ellipse', x: 0.25, y: 0.25, width: 0.5, height: 0.5 }) },
  { name: N_('Streifen'), cell: [box(0, 0, 1, 0.5)] },
  {
    name: N_('Schräg'),
    cell: [poly([0, 0], [0.25, 0], [1, 0.75], [1, 1], [0.75, 1], [0, 0.25]), poly([0.75, 0], [1, 0], [1, 0.25]), poly([0, 0.75], [0, 1], [0.25, 1])],
  },
  { name: N_('Karo'), cell: [box(0, 0, 0.5, 0.5), box(0.5, 0.5, 1, 1)] },
  { name: N_('Gitter'), cell: [box(0, 0, 1, 0.2), box(0, 0.2, 0.2, 1)] },
  { name: N_('Rauten'), cell: [poly([0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5])] },
  { name: N_('Ziegel'), cell: [box(0.025, 0.05, 0.975, 0.45), box(0, 0.55, 0.475, 0.95), box(0.525, 0.55, 1, 0.95)] },
];

const leaf = (fill: Color, subpaths: readonly Subpath[]): PathNode => ({ type: 'path', id: newId(), transform: IDENTITY, style: { fill, stroke: null }, subpaths });

/** Kachel einer Vorlage: Hintergrund-Quadrat, darüber die Vordergrundformen; null = unbekannte Vorlage. */
function presetTile(name: string, fg: Color, bg: Color): Node[] | null {
  const p = PATTERNS.find((q) => q.name === name);
  return p ? [leaf(bg, [box(0, 0, 1, 1)]), leaf(fg, p.cell)] : null;
}

// Winkel gegen den Uhrzeigersinn wie die Objektdrehung (arrange.ts); y zeigt nach unten → negativ drehen.
const cellMatrix = (origin: Point, size: number, angle: number, width: number): Mat =>
  multiply(multiply(translate(origin.x, origin.y), rotate((-angle * Math.PI) / 180)), scale(size / width, size / width));

export function makePattern(name: string, fg: Color, bg: Color, size: number, angle: number, origin: Point): Pattern {
  const base: Pattern = { kind: 'pattern', width: 1, height: 1, matrix: cellMatrix(origin, size, angle, 1), tile: [] };
  const p = recolorPattern(base, name, fg, bg);
  return p.twoColor ? p : recolorPattern(base, PATTERNS[0].name, fg, bg);
}

/** Kachel als Pseudo-Seite (eine druckbare Ebene) – für Szene, Austausch und Bildschirm. */
export const tilePage = (p: Pattern): Page => ({
  id: '',
  width: p.width,
  height: p.height,
  layers: [{ id: '', name: '', visible: true, locked: false, printable: true, children: p.tile }],
});

export const patternSize = (p: Pattern): number => p.width * Math.hypot(p.matrix[0], p.matrix[1]);
export const patternAngle = (p: Pattern): number => (-Math.atan2(p.matrix[1], p.matrix[0]) * 180) / Math.PI;

/** Größe und Winkel neu, Ursprung und Kachel bleiben. */
export const resizePattern = (p: Pattern, size: number, angle: number): Pattern => ({
  ...p,
  matrix: cellMatrix({ x: p.matrix[4], y: p.matrix[5] }, size, angle, p.width),
});

/** Andere Vorlage oder Farben: Kachel neu erzeugen (unbekannte Vorlage → Muster bleibt). */
export function recolorPattern(p: Pattern, name: string, fg: Color, bg: Color): Pattern {
  const tile = presetTile(name, fg, bg);
  return tile ? { ...p, width: 1, height: 1, tile, twoColor: { name, fg, bg } } : p;
}

const hasPattern = (n: Node): boolean =>
  n.type === 'group' ? n.children.some(hasPattern) : n.type !== 'image' && (isPattern(n.style.fill) || (n.type !== 'text' && !!n.contents?.some(hasPattern)));

// Halbe Konturbreite, damit Konturen an der Kachelkante nicht abgeschnitten werden.
const pad = (n: Node): number => (n.type === 'group' ? Math.max(0, ...n.children.map(pad)) : n.type === 'image' ? 0 : (n.style.stroke?.width ?? 0) / 2);

/** Ziel = zuletzt gewähltes Objekt mit Füllung; die übrige Auswahl wird als Kopie zur Kachel, Originale bleiben. */
export function patternFromSelection(doc: Doc, ids: readonly string[]): { doc: Doc; selected: string[] } {
  const targetId = ids.at(-1) ?? '';
  const target = findNode(doc, targetId);
  if (!target || target.type === 'group' || target.type === 'image') throw new Error(tr('Ziel (zuletzt gewählt) muss eine Form, ein Pfad oder ein Text sein.'));
  const chosen = new Set(ids.filter((id) => id !== targetId));
  if (!chosen.size) throw new Error(tr('Für das Muster mindestens ein weiteres Objekt wählen.'));
  const at = places(doc);
  if (at.get(targetId)?.path.some((g) => chosen.has(g))) throw new Error(tr('Ziel liegt in der Auswahl für die Kachel.'));
  const order = [...at.keys()].filter((id) => chosen.has(id) && !at.get(id)!.path.some((g) => chosen.has(g)));
  const nodes = order.map((id) => findNode(doc, id)!);
  if (nodes.some(hasPattern)) throw new Error(tr('Ein Muster darf keine Muster enthalten.'));
  const boxes = nodes.flatMap((n): Box[] => {
    const nb = nodeBounds(n, at.get(n.id)!.world);
    const p = pad(n);
    return nb ? [{ minX: nb.minX - p, minY: nb.minY - p, maxX: nb.maxX + p, maxY: nb.maxY + p }] : [];
  });
  const [minX, minY] = [Math.min(...boxes.map((b) => b.minX)), Math.min(...boxes.map((b) => b.minY))];
  const [maxX, maxY] = [Math.max(...boxes.map((b) => b.maxX)), Math.max(...boxes.map((b) => b.maxY))];
  if (!(maxX - minX >= 1e-9 && maxY - minY >= 1e-9)) throw new Error(tr('Kachel hat keine Fläche.'));
  const tw = worldOf(doc, targetId)!;
  if (Math.abs(tw[0] * tw[3] - tw[1] * tw[2]) < 1e-12) throw new Error(tr('Ziel hat keine Fläche.'));
  const tile = nodes.map((n) => ({ ...cloneWithNewIds(n), transform: multiply(translate(-minX, -minY), worldOf(doc, n.id)!) }));
  const pattern: Pattern = { kind: 'pattern', width: maxX - minX, height: maxY - minY, matrix: multiply(invert(tw), translate(minX, minY)), tile };
  const next = updateNodes(doc, [targetId], (n) => (n.type === 'group' || n.type === 'image' ? n : { ...n, style: { ...n.style, fill: pattern } }));
  return { doc: next, selected: [targetId] };
}
