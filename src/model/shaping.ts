// Formen-Befehle wie im Vorbild (Spec §7). Ziel = zuletzt gewähltes Objekt; die Rahmenauswahl fügt von oben
// nach unten ein, dort ist das Ziel also das unterste. Planen und Übernehmen sind rein, rechnen tut kw-core.
import { transformSubpath } from './bezier';
import { findNode, insertAbove, newId, removeNodes, updateNodes } from './document';
import { IDENTITY, invert } from './geometry';
import { DEFAULT_STROKE, toCurves } from './style';
import type { Doc, Node, PathNode, Subpath } from './types';
import { tr } from '../i18n/i18n.svelte';

export type ShapingName =
  | 'weld' | 'trim' | 'intersect' | 'simplify' | 'frontMinusBack' | 'backMinusFront' | 'boundary' | 'combine' | 'breakApart';

/** Auftrag an kw-core::boolean, Formen in Seitenkoordinaten. difference = erste minus alle übrigen. */
export interface ShapeJob {
  op: 'union' | 'intersect' | 'difference';
  shapes: { subpaths: Subpath[]; evenOdd: boolean }[];
}

export interface ShapingResult {
  doc: Doc;
  selected: string[];
}

export interface ShapingPlan {
  jobs: ShapeJob[];
  notice?: string;
  /** results[i] = Ergebnis von jobs[i] in Seitenkoordinaten */
  finish(results: Subpath[][]): ShapingResult;
}

interface Obj {
  node: PathNode;
  z: number;
}

const world = (o: Obj) => o.node.subpaths.map((sp) => transformSubpath(sp, o.node.transform));

/** Pfad mit neuen Teilpfaden aus Seitenkoordinaten; Transformation bleibt (mitskalierende Konturen), Füllregel fällt weg. */
export function withPaths(n: PathNode, paths: Subpath[], fillRule?: 'evenodd'): PathNode {
  const { fillRule: _, ...rest } = n;
  const m = n.transform;
  const flat = Math.abs(m[0] * m[3] - m[1] * m[2]) < 1e-12;
  const local = flat ? paths : paths.map((sp) => transformSubpath(sp, invert(m)));
  return { ...rest, transform: flat ? IDENTITY : m, subpaths: local, ...(fillRule ? { fillRule } : {}) };
}

/** Ersetzt ein oberstes Objekt in seiner Ebene durch beliebig viele (auch keins). */
export function splice(doc: Doc, id: string, nodes: (n: Node) => Node[]): Doc {
  const pages = doc.pages.map((p) => ({
    ...p,
    layers: p.layers.map((l) => {
      const i = l.children.findIndex((n) => n.id === id);
      return i < 0 ? l : { ...l, children: [...l.children.slice(0, i), ...nodes(l.children[i]), ...l.children.slice(i + 1)] };
    }),
  }));
  return { ...doc, pages };
}

/** Teilpfad s als eigenes Objekt direkt darüber (Knoten-Werkzeug, wie Vorbild); null = nur ein Teilpfad. */
export function extractSubpath(doc: Doc, id: string, s: number): { doc: Doc; id: string } | null {
  const n = findNode(doc, id);
  if (n?.type !== 'path' || n.subpaths.length < 2 || !n.subpaths[s]) return null;
  const { fillRule: _, ...rest } = n;
  const piece: PathNode = { ...rest, id: newId(), subpaths: [n.subpaths[s]] };
  const left = updateNodes(doc, [id], () => ({ ...n, subpaths: n.subpaths.filter((_, i) => i !== s) }));
  return { doc: insertAbove(left, id, [piece]), id: piece.id };
}

function collect(doc: Doc, selection: readonly string[]): Obj[] {
  const z = new Map<string, { node: Node; z: number }>();
  for (const p of doc.pages) for (const l of p.layers) for (const node of l.children) z.set(node.id, { node, z: z.size });
  return selection.flatMap((id) => {
    const hit = z.get(id);
    if (!hit && findNode(doc, id)) throw new Error(tr('Formen-Befehle gehen nicht mit Objekten in einer Gruppe – Gruppe erst auflösen.'));
    if (!hit) return [];
    if (hit.node.type === 'group' || hit.node.type === 'image') {
      throw new Error(tr('Formen-Befehle gehen nur mit Kurven und Formen – Gruppen und Bilder erst auflösen.'));
    }
    return [{ node: toCurves(hit.node) as PathNode, z: hit.z }];
  });
}

export function planShaping(doc: Doc, selection: readonly string[], name: ShapingName): ShapingPlan {
  const objs = collect(doc, selection);
  const byZ = [...objs].sort((a, b) => a.z - b.z);
  const plan = (jobs: ShapeJob[], finish: (r: Subpath[][]) => ShapingResult): ShapingPlan => {
    const open = jobs.length > 0 && objs.some((o) => o.node.subpaths.some((sp) => !sp.closed));
    return { jobs, finish, ...(open ? { notice: tr('Offene Pfade wurden als geschlossen behandelt.') } : {}) };
  };
  const job = (op: ShapeJob['op'], list: Obj[]): ShapeJob => ({
    op,
    shapes: list.map((o) => ({ subpaths: world(o), evenOdd: o.node.fillRule === 'evenodd' })),
  });
  const replace = (d: Doc, o: Obj, paths: Subpath[]) => splice(d, o.node.id, () => (paths.length ? [withPaths(o.node, paths)] : []));
  const notEmpty = (r: Subpath[], msg: string) => {
    if (!r.length) throw new Error(msg);
    return r;
  };

  if (name === 'breakApart') {
    const parts = objs.filter((o) => o.node.subpaths.length > 1);
    if (!parts.length) throw new Error(tr('Nichts aufzubrechen – Objekt hat nur einen Teilpfad.'));
    return plan([], () => {
      let d = doc;
      const selected: string[] = [];
      for (const o of parts) {
        const { fillRule: _, ...rest } = o.node;
        const pieces = o.node.subpaths.map((sp, i): PathNode => ({ ...rest, id: i ? newId() : rest.id, subpaths: [sp] }));
        d = splice(d, o.node.id, () => pieces);
        selected.push(...pieces.map((p) => p.id));
      }
      return { doc: d, selected };
    });
  }

  const min = name === 'boundary' ? 1 : 2;
  if (objs.length < min) throw new Error(min === 1 ? tr('Erst ein Objekt wählen.') : tr('Mindestens zwei Objekte wählen.'));
  const target = objs[objs.length - 1];
  const [back, front] = [byZ[0], byZ[byZ.length - 1]];
  const rest = (o: Obj) => objs.filter((x) => x !== o);
  const drop = (o: Obj) => removeNodes(doc, rest(o).map((x) => x.node.id));
  // Neues Objekt direkt über dem obersten gewählten
  const above = (d: Doc, n: PathNode) => ({ doc: splice(d, front.node.id, (f) => [f, n]), selected: [n.id] });

  switch (name) {
    case 'weld':
      return plan([job('union', objs)], ([r]) => ({ doc: replace(drop(target), target, notEmpty(r, tr('Ergebnis ist leer.'))), selected: [target.node.id] }));
    case 'trim':
      return plan([job('difference', [target, ...rest(target)])], ([r]) => ({ doc: replace(doc, target, r), selected: r.length ? [target.node.id] : [] }));
    case 'intersect':
      return plan([job('intersect', objs)], ([r]) => above(doc, { ...withPaths(target.node, notEmpty(r, tr('Keine gemeinsame Fläche.'))), id: newId() }));
    case 'simplify': {
      const lower = byZ.slice(0, -1);
      return plan(lower.map((o, i) => job('difference', [o, ...byZ.slice(i + 1)])), (res) => {
        const d = lower.reduce((acc, o, i) => replace(acc, o, res[i]), doc);
        return { doc: d, selected: byZ.filter((o, i) => i === lower.length || res[i].length).map((o) => o.node.id) };
      });
    }
    case 'frontMinusBack':
    case 'backMinusFront': {
      const base = name === 'frontMinusBack' ? front : back;
      return plan([job('difference', [base, ...rest(base)])], ([r]) => ({ doc: replace(drop(base), base, notEmpty(r, tr('Ergebnis ist leer.'))), selected: [base.node.id] }));
    }
    case 'boundary':
      return plan([job('union', objs)], ([r]) => {
        const style = { fill: null, stroke: DEFAULT_STROKE };
        return above(doc, { type: 'path', id: newId(), transform: IDENTITY, style, subpaths: notEmpty(r, tr('Ergebnis ist leer.')) });
      });
    case 'combine':
      return plan([], () => {
        const paths = byZ.flatMap((o) => (o === target ? target.node.subpaths.map((sp) => transformSubpath(sp, target.node.transform)) : world(o)));
        return { doc: splice(drop(target), target.node.id, () => [withPaths(target.node, paths, 'evenodd')]), selected: [target.node.id] };
      });
  }
}
