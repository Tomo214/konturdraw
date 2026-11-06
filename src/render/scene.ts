import { IDENTITY, multiply, transformBox, type Box, type Mat } from '../model/geometry';
import { geometry } from '../model/shapes';
import type { ImageNode, Layer, LeafNode, Node, Page, Style, Subpath } from '../model/types';

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
  /** Deckkraft: Produkt über die Kette (Gruppen wirken auf jedes Kind); 1 = deckend. */
  opacity: number;
  /** Rahmen mit Inhalt: Füllung (unter dem Inhalt) und Kontur (darüber) sind getrennte Einträge. */
  part?: 'fill' | 'stroke';
  /** Inhalt eines Rahmens: beschnitten von allen Umrissen (verschachtelt = Schnittmenge). */
  clips?: readonly Clip[];
  /** Äußerster Rahmen des Inhalts (sein Füll-Eintrag) – Klick und Auswahl gelten ihm. */
  frame?: SceneItem;
}

/** Umriss eines Rahmens in Weltkoordinaten. */
export interface Clip {
  subpaths: readonly Subpath[];
  world: Mat;
  fillRule: CanvasFillRule;
}

/** Blatt mit Stil (kein Bild) – nur diese haben Füllung und Kontur. */
export type StyledItem = SceneItem & { node: LeafNode };
export const styled = (it: SceneItem): it is StyledItem => it.node.type !== 'image';

/** Was dieser Eintrag zeichnet: beim Rahmen mit Inhalt nur Füllung bzw. nur Kontur. */
export const paintOf = (it: StyledItem): Style => {
  const { fill, stroke } = it.node.style;
  return { fill: it.part === 'stroke' ? null : fill, stroke: it.part === 'fill' ? null : stroke };
};

interface Inner {
  chain: readonly string[];
  clips: readonly Clip[];
  frame: SceneItem;
}

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

// inner: im Inhalt eines Rahmens – Kette bleibt die des Rahmens, Umrisse beschneiden.
function visit(node: Node, parent: Mat, up: readonly string[], layer: Layer, items: SceneItem[], alpha: number, inner?: Inner): void {
  const world = multiply(parent, node.transform);
  const chain = inner?.chain ?? [...up, node.id];
  const opacity = alpha * (node.opacity ?? 1);
  if (node.type === 'group') {
    for (const c of node.children) visit(c, world, chain, layer, items, opacity, inner);
    return;
  }
  const subpaths = geometry(node);
  const b = transformBox(world, localBox(node, subpaths));
  const stroke = node.type === 'image' ? null : node.style.stroke;
  const half = stroke ? (stroke.width / 2) * (stroke.scaleWithObject ? worldScale(world) : 1) : 0;
  const push = (part?: SceneItem['part']): SceneItem => {
    const it: SceneItem = {
      id: node.id,
      topId: chain[0],
      chain,
      layerId: layer.id,
      locked: layer.locked,
      order: items.length,
      node,
      subpaths,
      world,
      opacity,
      ...(part && { part }),
      ...(inner && { clips: inner.clips, frame: inner.frame }),
      minX: b.minX - half,
      minY: b.minY - half,
      maxX: b.maxX + half,
      maxY: b.maxY + half,
    };
    items.push(it);
    return it;
  };
  const contents = node.type === 'path' || node.type === 'shape' ? node.contents : undefined;
  if (!contents?.length) return void push();
  const fill = push('fill');
  const clip: Clip = { subpaths, world, fillRule: (node.type === 'path' && node.fillRule) || 'nonzero' };
  const next = { chain, clips: [...(inner?.clips ?? []), clip], frame: inner?.frame ?? fill };
  for (const c of contents) visit(c, world, chain, layer, items, opacity, next);
  push('stroke');
}

/** Flache Liste aller sichtbaren Blätter in Zeichenreihenfolge. */
export function buildScene(page: Page): SceneItem[] {
  const items: SceneItem[] = [];
  for (const layer of page.layers) {
    if (!layer.visible) continue;
    for (const top of layer.children) visit(top, IDENTITY, [], layer, items, 1);
  }
  return items;
}
