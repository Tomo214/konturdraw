// Auswahl mit Objekten in Gruppen (wie Vorbild): nie eine Gruppe und eines ihrer Kinder zugleich.
import type { Doc, Node } from '../model/types';

// Umgebende Gruppen und alle Kinder von id.
function relatives(doc: Doc, id: string): Set<string> {
  const out = new Set<string>();
  const below = (n: Node): void => {
    if (n.type === 'group') for (const c of n.children) out.add(c.id), below(c);
  };
  const walk = (nodes: readonly Node[], path: readonly string[]): boolean =>
    nodes.some((n) => {
      if (n.id === id) {
        for (const a of path) out.add(a);
        below(n);
        return true;
      }
      return n.type === 'group' && walk(n.children, [...path, n.id]);
    });
  doc.pages.some((p) => p.layers.some((l) => walk(l.children, [])));
  return out;
}

/** additive: id dazu oder weg (Verwandte fallen raus); sonst nur id. */
export function choose(doc: Doc, selected: ReadonlySet<string>, id: string, additive: boolean): Set<string> {
  if (!additive) return new Set([id]);
  const rel = relatives(doc, id);
  const next = new Set([...selected].filter((s) => !rel.has(s)));
  if (selected.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Strg-Klick (Mac ⌘): eine Stufe unter dem tiefsten gewählten Glied; chain = oberstes Objekt → Blatt. */
export function deeper(selected: ReadonlySet<string>, chain: readonly string[]): string {
  let k = 0;
  chain.forEach((id, i) => selected.has(id) && (k = i));
  return chain[Math.min(k + 1, chain.length - 1)];
}
