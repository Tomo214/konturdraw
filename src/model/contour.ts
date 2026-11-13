// Kontur-Werkzeug wie im Vorbild, aber statisch (wie gleich „aufgebrochen“): die Schritte werden eigene
// Objekte im Stil des Originals. Rechnen tut kw-core (boolean::contour); Planen und Übernehmen sind rein.
import { transformSubpath } from './bezier';
import { findNode, insertAbove, insertBelow, newId, worldOf } from './document';
import { IDENTITY, invert, type Mat } from './geometry';
import type { ShapingResult } from './shaping';
import { toCurves } from './style';
import type { Doc, LeafNode, Node, PathNode, Stroke, Style, Subpath } from './types';
import { tr } from '../i18n/i18n.svelte';

/** Wie MAX_STEPS in kw-core::boolean::contour. */
export const MAX_CONTOUR_STEPS = 250;

export type ContourDirection = 'outside' | 'inside' | 'center';

/** Werte der Eigenschaftsleiste; Abstand in Seiten-mm. „center“ zählt die Schritte nicht. */
export interface ContourParams {
  direction: ContourDirection;
  steps: number;
  offset: number;
  join: Stroke['join'];
}

/** Auftrag an kw-core::boolean::contour, Formen in Seitenkoordinaten (alle zusammen = eine Fläche). */
export interface ContourJob extends ContourParams {
  shapes: { subpaths: Subpath[]; evenOdd: boolean }[];
}

export interface ContourPlan {
  jobs: ContourJob[];
  /** results[i] = Schritte von jobs[i] (vom Original weg) in Seitenkoordinaten; null = nichts entstanden */
  finish(results: (Subpath[][] | null)[]): ShapingResult | null;
}

interface Target {
  node: Node;
  world: Mat;
  style: Style;
}

const det = (m: Mat) => m[0] * m[3] - m[1] * m[2];
const leaves = (n: Node): LeafNode[] => (n.type === 'group' ? n.children.flatMap(leaves) : n.type === 'image' ? [] : [n]);

export function planContour(doc: Doc, selection: readonly string[], params: ContourParams): ContourPlan {
  const list: Target[] = [];
  const jobs: ContourJob[] = [];
  for (const id of selection) {
    const node = findNode(doc, id);
    const world = node && worldOf(doc, id);
    const ls = node ? leaves(node) : [];
    if (!node || !world || !ls.length || Math.abs(det(world)) < 1e-12) continue;
    const shapes = ls.map((l) => {
      const p = toCurves(l) as PathNode;
      return { subpaths: p.subpaths.map((sp) => transformSubpath(sp, worldOf(doc, l.id)!)), evenOdd: p.fillRule === 'evenodd' };
    });
    list.push({ node, world, style: ls[0].style });
    jobs.push({ shapes, ...params });
  }
  if (!list.length) throw new Error(tr('Kontur geht nur mit Kurven, Formen, Text und Gruppen.'));
  return {
    jobs,
    finish(results) {
      let d = doc;
      const selected: string[] = [];
      const outside = params.direction === 'outside';
      list.forEach(({ node, world, style }, i) => {
        if (!results[i]?.length) return;
        const back = invert(world);
        const paths = results[i]!.map((sps): PathNode => ({
          type: 'path',
          id: newId(),
          transform: IDENTITY,
          style,
          subpaths: sps.map((sp) => transformSubpath(sp, back)),
        }));
        // außen liegt der größte ganz hinten, innen der kleinste ganz vorn
        if (outside) paths.reverse();
        const made: Node =
          paths.length === 1 ? { ...paths[0], transform: node.transform } : { type: 'group', id: newId(), transform: node.transform, children: paths };
        d = outside ? insertBelow(d, node.id, [made]) : insertAbove(d, node.id, [made]);
        selected.push(made.id);
      });
      return selected.length ? { doc: d, selected } : null;
    },
  };
}
