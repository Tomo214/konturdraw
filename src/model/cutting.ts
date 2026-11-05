// Messer und Radierer (Spec §5). Planen und Übernehmen sind rein, rechnen tut kw-core::boolean::cut.
// Gruppen und Bilder bleiben unberührt; Formen und Text werden nur zu Kurven, wenn sie sich wirklich ändern.
import { transformSubpath } from './bezier';
import { newId } from './document';
import { splice, withPaths, type ShapingResult } from './shaping';
import { toCurves } from './style';
import type { Doc, Node, PathNode, Subpath } from './types';

interface CutShape {
  subpaths: Subpath[];
  evenOdd: boolean;
}
export interface KnifeJob {
  shape: CutShape;
  cut: Subpath;
}
export interface EraseJob {
  shape: CutShape;
  trail: Subpath;
  width: number;
  square: boolean;
}

/** results[i] gehört zu jobs[i]; null = nicht getroffen. finish → null, wenn sich nichts geändert hat. */
export interface CutPlan<J, R> {
  jobs: J[];
  finish(results: (R | null)[]): ShapingResult | null;
}

function targets(doc: Doc, ids: readonly string[]): PathNode[] {
  const want = new Set(ids);
  const out: PathNode[] = [];
  for (const p of doc.pages) for (const l of p.layers) for (const n of l.children) {
    if (want.has(n.id) && n.type !== 'group' && n.type !== 'image') out.push(toCurves(n) as PathNode);
  }
  return out;
}

const shapeOf = (n: PathNode): CutShape => ({
  subpaths: n.subpaths.map((sp) => transformSubpath(sp, n.transform)),
  evenOdd: n.fillRule === 'evenodd',
});

function plan<J, R>(doc: Doc, objs: PathNode[], jobs: J[], apply: (n: PathNode, r: R) => Node[]): CutPlan<J, R> {
  return {
    jobs,
    finish(results) {
      let out = doc;
      const selected: string[] = [];
      objs.forEach((n, i) => {
        const r = results[i];
        if (r == null) return;
        const nodes = apply(n, r);
        out = splice(out, n.id, () => nodes);
        selected.push(...nodes.map((x) => x.id));
      });
      return out === doc ? null : { doc: out, selected };
    },
  };
}

/** Teilt jedes getroffene Objekt in ein Objekt je Seite des Schnitts; das erste behält die Kennung. */
export function planKnife(doc: Doc, ids: readonly string[], cut: Subpath): CutPlan<KnifeJob, Subpath[][]> {
  const objs = targets(doc, ids);
  return plan(doc, objs, objs.map((n) => ({ shape: shapeOf(n), cut })), (n, groups: Subpath[][]) =>
    groups.map((g, i) => ({ ...withPaths(n, g), id: i ? newId() : n.id })),
  );
}

/** Radiert mit runder oder eckiger Spitze; ganz weggeradierte Objekte verschwinden. */
export function planErase(doc: Doc, ids: readonly string[], trail: Subpath, width: number, square: boolean): CutPlan<EraseJob, Subpath[]> {
  const objs = targets(doc, ids);
  return plan(doc, objs, objs.map((n) => ({ shape: shapeOf(n), trail, width, square })), (n, paths: Subpath[]) =>
    paths.length ? [withPaths(n, paths)] : [],
  );
}
