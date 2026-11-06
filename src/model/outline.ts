// Kontur in Objekt wie im Vorbild: die Kontur wird ein eigenes, gefülltes Objekt direkt über dem Original,
// die Optik bleibt gleich. Rechnen tut kw-core (boolean::outline); Planen und Übernehmen sind rein.
import { transformSubpath } from './bezier';
import { findNode, insertAbove, newId, removeNodes, updateNodes, worldOf } from './document';
import { invert, type Mat } from './geometry';
import type { ShapingResult } from './shaping';
import { setStroke, toCurves } from './style';
import type { Doc, LeafNode, Node, PathNode, Stroke, Subpath } from './types';

/** Auftrag an kw-core::boolean::outline, alles in Seitenkoordinaten (Breite in Seiten-mm). */
export interface OutlineJob {
  subpaths: Subpath[];
  width: number;
  cap: Stroke['cap'];
  join: Stroke['join'];
  /** Strich, Lücke, … in Seiten-mm; fehlt = durchgehend */
  dash?: number[];
}

export interface OutlinePlan {
  jobs: OutlineJob[];
  /** results[i] = Umriss von jobs[i] in Seitenkoordinaten */
  finish(results: Subpath[][]): ShapingResult;
}

interface Target {
  node: LeafNode;
  stroke: Stroke;
  world: Mat;
}

const det = (m: Mat) => m[0] * m[3] - m[1] * m[2];

// Blätter mit sichtbarer Kontur, auch in gewählten Gruppen; Bilder haben keine. Plattgedrückte zeichnet der Renderer nicht.
function targets(doc: Doc, selection: readonly string[]): Target[] {
  const out: Target[] = [];
  const seen = new Set<string>();
  const visit = (n: Node): void => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    if (n.type === 'group') return n.children.forEach(visit);
    const stroke = n.type === 'image' ? null : n.style.stroke;
    const world = worldOf(doc, n.id);
    if (n.type !== 'image' && stroke && stroke.width > 0 && world && Math.abs(det(world)) > 1e-12) out.push({ node: n, stroke, world });
  };
  for (const id of selection) {
    const n = findNode(doc, id);
    if (n) visit(n);
  }
  return out;
}

export function planOutline(doc: Doc, selection: readonly string[]): OutlinePlan {
  const list = targets(doc, selection);
  if (!list.length) throw new Error('Kein gewähltes Objekt hat eine Kontur.');
  const jobs = list.map(({ node, stroke: s, world }): OutlineJob => {
    // wie renderer.ts: mitskalierende Konturen wachsen mit dem Weltmaßstab
    const width = s.scaleWithObject ? s.width * Math.sqrt(Math.abs(det(world))) : s.width;
    return {
      subpaths: (toCurves(node) as PathNode).subpaths.map((sp) => transformSubpath(sp, world)),
      width,
      cap: s.cap,
      join: s.join,
      ...(s.dash ? { dash: s.dash.map((d) => d * width) } : {}),
    };
  });
  return {
    jobs,
    finish(results) {
      let d = doc;
      const selected: string[] = [];
      list.forEach(({ node, stroke, world }, i) => {
        if (!results[i]?.length) return;
        const back = invert(world);
        const made: PathNode = {
          type: 'path',
          id: newId(),
          transform: node.transform,
          style: { fill: stroke.color, stroke: null },
          subpaths: results[i].map((sp) => transformSubpath(sp, back)),
        };
        d = insertAbove(d, node.id, [made]);
        d = node.style.fill ? updateNodes(d, [node.id], (n) => setStroke(n as LeafNode, null)) : removeNodes(d, [node.id]);
        selected.push(made.id);
      });
      return { doc: d, selected };
    },
  };
}
