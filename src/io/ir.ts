import { subpathBounds, transformSubpath } from '../model/bezier';
import { newId } from '../model/document';
import { IDENTITY, invert, multiply, scale, translate, type Box, type Mat } from '../model/geometry';
import type { Color, Fill, Node, Page, Stroke, Subpath } from '../model/types';
import { buildScene, paintOf, worldScale, type Clip, type SceneItem, type StyledItem } from '../render/scene';

/** Kontur im Austausch: Breite in Seiten-mm, unverzerrt (wie auf dem Bildschirm, renderer.ts). */
export interface IrStroke {
  color: Color;
  width: number;
  cap: Stroke['cap'];
  join: Stroke['join'];
  /** Strich, Lücke, … in Seiten-mm; fehlt = durchgehend */
  dash?: number[];
}

/** Austausch mit kw-core (architecture.md §3): Export-Eingabe und Import-Ergebnis. mm, y nach unten. */
export type IrItem =
  | { kind: 'path'; matrix: Mat; subpaths: readonly Subpath[]; fill: Fill | null; stroke: IrStroke | null; fillRule?: 'evenodd'; opacity?: number }
  | { kind: 'image'; matrix: Mat; width: number; height: number; image: string; opacity?: number }
  | { kind: 'group'; matrix: Mat; children: IrItem[] }
  /** Beschneidung (Rahmen-Inhalt): matrix gilt nur für den Umriss, Kinder liegen im Koordinatensystem darüber. */
  | { kind: 'clip'; matrix: Mat; subpaths: readonly Subpath[]; fillRule?: 'evenodd'; children: IrItem[] };

export interface IrScene {
  width: number;
  height: number;
  items: IrItem[];
}

function leaf(it: SceneItem): IrItem {
  const { node, world, subpaths, opacity } = it;
  const alpha = opacity < 1 ? { opacity } : {};
  if (node.type === 'image') return { kind: 'image', matrix: world, width: node.width, height: node.height, image: node.image, ...alpha };
  const { fill, stroke: s } = paintOf(it as StyledItem);
  const width = s ? (s.scaleWithObject ? s.width * worldScale(world) : s.width) : 0;
  const dash = s?.dash ? { dash: s.dash.map((d) => d * width) } : {};
  const stroke = s && { color: s.color, width, cap: s.cap, join: s.join, ...dash };
  const rule = node.type === 'path' && node.fillRule ? { fillRule: node.fillRule } : {};
  return { kind: 'path', matrix: world, subpaths, fill, stroke, ...rule, ...alpha };
}

// Rahmen mit Inhalt: leere Füllung bzw. Kontur entfällt (sonst schneidet der Plotter den Umriss doppelt).
const empty = (it: SceneItem) => !!it.part && it.node.type !== 'image' && !(it.part === 'fill' ? it.node.style.fill : it.node.style.stroke);

// Box mit halber Konturbreite; Inhalt nur, soweit er in seinen Rahmen liegt.
function boxOf(it: SceneItem, ir: IrItem): Box | null {
  const b = subpathBounds(it.subpaths, it.world);
  if (!b) return null;
  const half = ir.kind === 'path' ? (ir.stroke?.width ?? 0) / 2 : 0;
  let box = { minX: b.minX - half, minY: b.minY - half, maxX: b.maxX + half, maxY: b.maxY + half };
  for (const c of it.clips ?? []) {
    const k = subpathBounds(c.subpaths, c.world);
    if (!k) return null;
    box = { minX: Math.max(box.minX, k.minX), minY: Math.max(box.minY, k.minY), maxX: Math.min(box.maxX, k.maxX), maxY: Math.min(box.maxY, k.maxY) };
  }
  return box.minX <= box.maxX && box.minY <= box.maxY ? box : null;
}

const shift = (items: IrItem[], m: Mat): IrItem[] =>
  items.map((it) => (it.kind === 'clip' || it.kind === 'group' ? { ...it, matrix: multiply(m, it.matrix), children: it.kind === 'clip' ? shift(it.children, m) : it.children } : { ...it, matrix: multiply(m, it.matrix) }));

/** Sichtbare, druckbare Objekte einer Seite (Spec §11). ids → nur diese Objekte (auch Kinder in Gruppen), Fläche = ihre Box. */
export function toIr(page: Page, ids?: ReadonlySet<string>): IrScene {
  const printable = new Set(page.layers.filter((l) => l.printable).map((l) => l.id));
  const scene = buildScene(page).filter((it) => printable.has(it.layerId) && (!ids || it.chain.some((id) => ids.has(id))) && !empty(it));
  const leaves = scene.map(leaf);
  // Flache Szene → verschachtelte Beschneidungen: gleiche Umriss-Kette = gleicher clip-Eintrag.
  const items: IrItem[] = [];
  const open: { clip: Clip; children: IrItem[] }[] = [];
  scene.forEach((it, i) => {
    const cs = it.clips ?? [];
    let k = 0;
    while (k < open.length && k < cs.length && open[k].clip === cs[k]) k++;
    open.length = k;
    for (const c of cs.slice(k)) {
      const clip: IrItem = { kind: 'clip', matrix: c.world, subpaths: c.subpaths, ...(c.fillRule === 'evenodd' ? { fillRule: 'evenodd' as const } : {}), children: [] };
      (open.at(-1)?.children ?? items).push(clip);
      open.push({ clip: c, children: clip.children });
    }
    (open.at(-1)?.children ?? items).push(leaves[i]);
  });
  if (!ids) return { width: page.width, height: page.height, items };

  let box = null as Box | null;
  scene.forEach((it, i) => {
    const b = boxOf(it, leaves[i]);
    if (b) box = box ? { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) } : b;
  });
  if (!box) return { width: 0, height: 0, items: [] };
  const { minX, minY, maxX, maxY } = box as Box;
  return { width: maxX - minX, height: maxY - minY, items: shift(items, translate(-minX, -minY)) };
}

/** Import-Ergebnis → Knoten mit neuen IDs. Konturen bleiben in Seiten-mm (scaleWithObject fehlt = fest). */
export function fromIr(items: readonly IrItem[]): Node[] {
  return items.map((it): Node => {
    if (it.kind === 'group') return { id: newId(), transform: it.matrix, type: 'group', children: fromIr(it.children) };
    // Unsichtbarer Rahmen; Inhalt liegt im Modell in Rahmen-Koordinaten. Nicht umkehrbar → Umriss einrechnen.
    if (it.kind === 'clip') {
      const kids = fromIr(it.children);
      const rule = it.fillRule ? { fillRule: it.fillRule } : {};
      const frame = { id: newId(), type: 'path' as const, style: { fill: null, stroke: null }, ...rule };
      if (it.matrix[0] * it.matrix[3] - it.matrix[1] * it.matrix[2] === 0)
        return { ...frame, transform: IDENTITY, subpaths: it.subpaths.map((sp) => transformSubpath(sp, it.matrix)), contents: kids };
      const inv = invert(it.matrix);
      return { ...frame, transform: it.matrix, subpaths: it.subpaths, contents: kids.map((k) => ({ ...k, transform: multiply(inv, k.transform) })) };
    }
    const base = { id: newId(), transform: it.matrix, ...(it.opacity !== undefined && it.opacity < 1 ? { opacity: it.opacity } : {}) };
    if (it.kind === 'image') return { ...base, type: 'image', image: it.image, width: it.width, height: it.height };
    const s = it.stroke;
    // Strichmuster im Modell als Vielfache der Breite (wächst mit ihr)
    const dash = s?.dash && s.width > 0 ? { dash: s.dash.map((d) => d / s.width) } : {};
    const stroke = s && { color: s.color, width: s.width, cap: s.cap, join: s.join, ...dash };
    return { ...base, type: 'path', style: { fill: it.fill, stroke }, subpaths: it.subpaths, ...(it.fillRule ? { fillRule: it.fillRule } : {}) };
  });
}

/** Lage eines Imports: mittig auf der Seite; Pixelbilder (fit) zusätzlich auf die Seite verkleinert. */
export function placeImport(page: { width: number; height: number }, ir: IrScene, fit: boolean): Mat {
  const k = fit ? Math.min(1, page.width / ir.width, page.height / ir.height) : 1;
  const move = translate((page.width - ir.width * k) / 2, (page.height - ir.height * k) / 2);
  return k === 1 ? move : multiply(move, scale(k, k));
}
