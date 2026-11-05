import { IDENTITY, multiply, transformBox, type Box, type Mat } from '../model/geometry';
import { geometry } from '../model/shapes';
import type { ImageNode, Layer, LeafNode, Node, Page, Subpath } from '../model/types';

/** Ein zeichenbares Blatt mit Weltmatrix und Welt-Box (rbush-kompatibel). */
export interface SceneItem extends Box {
  id: string;
  /** Oberstes Objekt unter der Ebene – das wird beim Klick ausgewählt. */
  topId: string;
  /** Vom obersten Objekt über die Gruppen bis zu diesem Blatt (Strg-Klick wählt darin tiefer). */
  chain: readonly string[];
  layerId: string;
  locked: boolean;
  order: number;
  node: LeafNode | ImageNode;
  /** Zeichenbare Geometrie (Formen als Bézier-Teilpfade). */
  subpaths: readonly Subpath[];
  world: Mat;
}

/** Blatt mit Stil (kein Bild) – nur diese haben Füllung und Kontur. */
export type StyledItem = SceneItem & { node: LeafNode };
export const styled = (it: SceneItem): it is StyledItem => it.node.type !== 'image';

// Schlüssel = Geometrie, nicht Knoten: Verschieben ändert nur transform, die Box bleibt gültig.
const localBoxes = new WeakMap<readonly Subpath[], Box>();

// Box über alle Stütz- und Kontrollpunkte: etwas großzügig, aber billig und sicher für Culling.
function pathBox(subpaths: readonly Subpath[]): Box {
  let box = localBoxes.get(subpaths);
  if (box) return box;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const sp of subpaths) {
    for (const n of sp.nodes) {
      xs.push(n.x);
      ys.push(n.y);
      if (n.handleIn) xs.push(n.handleIn.x), ys.push(n.handleIn.y);
      if (n.handleOut) xs.push(n.handleOut.x), ys.push(n.handleOut.y);
    }
  }
  box = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  localBoxes.set(subpaths, box);
  return box;
}

// Text: leer = Punkt am Ursprung (Schreibmarke), Fließtext = mindestens sein Rahmen.
function localBox(node: LeafNode | ImageNode, subpaths: readonly Subpath[]): Box {
  if (node.type !== 'text') return pathBox(subpaths);
  const b = subpaths.length ? pathBox(subpaths) : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const f = node.frame;
  return f ? { minX: Math.min(b.minX, 0), minY: Math.min(b.minY, 0), maxX: Math.max(b.maxX, f.width), maxY: Math.max(b.maxY, f.height) } : b;
}

/** Mittlerer Maßstab einer Matrix (Wurzel der Flächenänderung). */
export const worldScale = (m: Mat) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

function visit(node: Node, parent: Mat, up: readonly string[], layer: Layer, items: SceneItem[]): void {
  const world = multiply(parent, node.transform);
  const chain = [...up, node.id];
  if (node.type === 'group') {
    for (const c of node.children) visit(c, world, chain, layer, items);
    return;
  }
  const subpaths = geometry(node);
  const b = transformBox(world, localBox(node, subpaths));
  const stroke = node.type === 'image' ? null : node.style.stroke;
  const half = stroke ? (stroke.width / 2) * (stroke.scaleWithObject ? worldScale(world) : 1) : 0;
  items.push({
    id: node.id,
    topId: chain[0],
    chain,
    layerId: layer.id,
    locked: layer.locked,
    order: items.length,
    node,
    subpaths,
    world,
    minX: b.minX - half,
    minY: b.minY - half,
    maxX: b.maxX + half,
    maxY: b.maxY + half,
  });
}

/** Flache Liste aller sichtbaren Blätter in Zeichenreihenfolge. */
export function buildScene(page: Page): SceneItem[] {
  const items: SceneItem[] = [];
  for (const layer of page.layers) {
    if (!layer.visible) continue;
    for (const top of layer.children) visit(top, IDENTITY, [], layer, items);
  }
  return items;
}
