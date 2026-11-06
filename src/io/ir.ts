import { subpathBounds } from '../model/bezier';
import { newId } from '../model/document';
import { multiply, scale, translate, type Box, type Mat } from '../model/geometry';
import type { Color, Fill, Node, Page, Stroke, Subpath } from '../model/types';
import { buildScene, worldScale } from '../render/scene';

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
  | { kind: 'group'; matrix: Mat; children: IrItem[] };

export interface IrScene {
  width: number;
  height: number;
  items: IrItem[];
}

/** Sichtbare, druckbare Objekte einer Seite (Spec §11). ids → nur diese Objekte (auch Kinder in Gruppen), Fläche = ihre Box. */
export function toIr(page: Page, ids?: ReadonlySet<string>): IrScene {
  const printable = new Set(page.layers.filter((l) => l.printable).map((l) => l.id));
  const scene = buildScene(page).filter((it) => printable.has(it.layerId) && (!ids || it.chain.some((id) => ids.has(id))));
  const items: IrItem[] = scene.map(({ node, world, subpaths, opacity }) => {
    const alpha = opacity < 1 ? { opacity } : {};
    if (node.type === 'image') return { kind: 'image', matrix: world, width: node.width, height: node.height, image: node.image, ...alpha };
    const s = node.style.stroke;
    const width = s ? (s.scaleWithObject ? s.width * worldScale(world) : s.width) : 0;
    const dash = s?.dash ? { dash: s.dash.map((d) => d * width) } : {};
    const stroke = s && { color: s.color, width, cap: s.cap, join: s.join, ...dash };
    const rule = node.type === 'path' && node.fillRule ? { fillRule: node.fillRule } : {};
    return { kind: 'path', matrix: world, subpaths, fill: node.style.fill, stroke, ...rule, ...alpha };
  });
  if (!ids) return { width: page.width, height: page.height, items };

  let box = null as Box | null;
  for (const [i, it] of scene.entries()) {
    const b = subpathBounds(it.subpaths, it.world);
    const item = items[i];
    if (!b) continue;
    const half = item.kind === 'path' ? (item.stroke?.width ?? 0) / 2 : 0;
    box = {
      minX: Math.min(box?.minX ?? Infinity, b.minX - half),
      minY: Math.min(box?.minY ?? Infinity, b.minY - half),
      maxX: Math.max(box?.maxX ?? -Infinity, b.maxX + half),
      maxY: Math.max(box?.maxY ?? -Infinity, b.maxY + half),
    };
  }
  if (!box) return { width: 0, height: 0, items: [] };
  const shift = translate(-box.minX, -box.minY);
  return { width: box.maxX - box.minX, height: box.maxY - box.minY, items: items.map((it) => ({ ...it, matrix: multiply(shift, it.matrix) })) };
}

/** Import-Ergebnis → Knoten mit neuen IDs. Konturen bleiben in Seiten-mm (scaleWithObject fehlt = fest). */
export function fromIr(items: readonly IrItem[]): Node[] {
  return items.map((it): Node => {
    if (it.kind === 'group') return { id: newId(), transform: it.matrix, type: 'group', children: fromIr(it.children) };
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
