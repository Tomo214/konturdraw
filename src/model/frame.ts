// In Rahmen einfügen / Inhalt herausnehmen (Phase 8b). Ziel = zuletzt gewähltes Objekt wie bei den Formen-Befehlen.
// Inhalt liegt im Koordinatensystem des Rahmens: Lage auf der Seite = Rahmen-Welt × Inhalt.transform.
import { deleteNodes, findNode, insertAbove, places, updateNodes, worldOf } from './document';
import { invert, multiply } from './geometry';
import type { Doc, Node, PathNode, ShapeNode } from './types';

export type FrameNode = PathNode | ShapeNode;

export interface FrameResult {
  doc: Doc;
  selected: string[];
}

/** Formen sind immer geschlossen; Pfade brauchen mindestens einen geschlossenen Teilpfad. */
export const isFrame = (n: Node | undefined): n is FrameNode =>
  n?.type === 'shape' || (n?.type === 'path' && n.subpaths.some((sp) => sp.closed));

export function placeInFrame(doc: Doc, ids: readonly string[]): FrameResult {
  const frameId = ids.at(-1) ?? '';
  if (!isFrame(findNode(doc, frameId))) throw new Error('Rahmen muss eine geschlossene Form sein.');
  const chosen = new Set(ids.filter((id) => id !== frameId));
  if (!chosen.size) throw new Error('Für den Rahmen mindestens ein weiteres Objekt wählen.');
  const at = places(doc);
  if (at.get(frameId)?.path.some((g) => chosen.has(g))) throw new Error('Rahmen liegt im Inhalt.');
  const fw = worldOf(doc, frameId)!;
  if (Math.abs(fw[0] * fw[3] - fw[1] * fw[2]) < 1e-12) throw new Error('Rahmen hat keine Fläche.');
  // Stapelfolge von unten nach oben; gewählte Kinder gewählter Gruppen gehen mit der Gruppe.
  const order = [...at.keys()].filter((id) => chosen.has(id) && !at.get(id)!.path.some((g) => chosen.has(g)));
  const inv = invert(fw);
  const moved = order.map((id) => ({ ...findNode(doc, id)!, transform: multiply(inv, worldOf(doc, id)!) }));
  const next = updateNodes(deleteNodes(doc, order), [frameId], (f) => ({ ...f, contents: [...((f as FrameNode).contents ?? []), ...moved] }) as Node);
  return { doc: next, selected: [frameId] };
}

/** Inhalt direkt über den Rahmen in dessen Container; Deckkraft des Rahmens wird eingerechnet, damit das Aussehen bleibt. */
export function extractContents(doc: Doc, ids: readonly string[]): FrameResult {
  const frames = ids.map((id) => findNode(doc, id)).filter((n): n is FrameNode => isFrame(n) && !!n.contents?.length);
  if (!frames.length) throw new Error('Kein Rahmen mit Inhalt gewählt.');
  let next = doc;
  const selected: string[] = [];
  for (const f of frames) {
    const o = f.opacity ?? 1;
    const out = f.contents!.map((c): Node => {
      const a = o * (c.opacity ?? 1);
      return { ...c, transform: multiply(f.transform, c.transform), ...(a < 1 ? { opacity: a } : {}) };
    });
    const { contents: _, ...bare } = f;
    next = insertAbove(updateNodes(next, [f.id], () => bare), f.id, out);
    selected.push(...out.map((c) => c.id));
  }
  return { doc: next, selected };
}
