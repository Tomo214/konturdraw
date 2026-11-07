// Objekt-Manager (4e, 5f) ohne Oberfläche: Zeilen des Baums, Ablegeziele beim Ziehen, Pfeiltasten, Rand-Rollen.
// Anzeige wie Vorbild: Seiten zuoberst, darin oberste Ebene und vorderstes Objekt oben; Arrays im Modell laufen von unten nach oben.
import { pageLabel } from '../model/pages';
import type { Doc, Layer, Node, Page } from '../model/types';
import type { IconName } from './icons';
import { kind } from './status';
import { tr } from '../i18n/i18n.svelte';

export interface Row {
  id: string;
  /** 0 = Ebene, 1 = Objekt auf der Ebene, 2 = in einer Gruppe … */
  depth: number;
  label: string;
  node: Node | null;
  layer: Layer;
  /** Index der Seite im Dokument. */
  page: number;
  /** Container (Ebene oder Gruppe); null bei Ebenen. */
  parent: string | null;
  /** Geschwister direkt darunter in der Stapelfolge. */
  below: string | null;
  /** Vorderstes Kind (Ebenen, Gruppen). */
  topChild: string | null;
  /** null = nicht aufklappbar. */
  open: boolean | null;
}

/** Seitenzeile; open = null bei der aktuellen Seite (immer offen). */
export interface PageLine {
  id: string;
  depth: number;
  label: string;
  page: number;
  open: boolean | null;
  node: null;
  layer: null;
}
export type Line = Row | PageLine;

/** flip: Ebenen-IDs = zugeklappt, Gruppen-IDs = aufgeklappt (Vorgabe: Ebenen offen, Gruppen zu). */
export function treeRows(page: Page, flip: ReadonlySet<string>, index = 0): Row[] {
  const rows: Row[] = [];
  const add = (children: readonly Node[], layer: Layer, parent: string, depth: number) => {
    for (let i = children.length - 1; i >= 0; i--) {
      const n = children[i];
      const group = n.type === 'group';
      const open = group ? flip.has(n.id) : null;
      rows.push({
        id: n.id,
        depth,
        label: n.name ?? kind(n),
        node: n,
        layer,
        page: index,
        parent,
        below: children[i - 1]?.id ?? null,
        topChild: group ? (n.children.at(-1)?.id ?? null) : null,
        open,
      });
      if (group && open) add(n.children, layer, n.id, depth + 1);
    }
  };
  for (let i = page.layers.length - 1; i >= 0; i--) {
    const l = page.layers[i];
    const open = !flip.has(l.id);
    rows.push({ id: l.id, depth: 0, label: l.name, node: null, layer: l, page: index, parent: null, below: null, topChild: l.children.at(-1)?.id ?? null, open });
    if (open) add(l.children, l, l.id, 1);
  }
  return rows;
}

/** Alle Seiten wie Vorbild: Seitenzeile, darunter ihr Baum eine Stufe tiefer. Aktuelle Seite offen, andere zu (flip-Seiten-IDs = offen). */
export function docRows(doc: Doc, current: number, flip: ReadonlySet<string>): Line[] {
  return doc.pages.flatMap((p, i): Line[] => {
    const head: PageLine = { id: p.id, depth: 0, label: pageLabel(doc, i), page: i, open: i === current ? null : flip.has(p.id), node: null, layer: null };
    return head.open === false ? [head] : [head, ...treeRows(p, flip, i).map((r) => ({ ...r, depth: r.depth + 1 }))];
  });
}

/** Klappt Ebenen und Gruppen auf, in denen Gewähltes liegt; nichts zu tun → dieselbe Menge. */
export function reveal(page: Page, flip: ReadonlySet<string>, selected: ReadonlySet<string>): ReadonlySet<string> {
  const next = new Set(flip);
  const walk = (nodes: readonly Node[], groups: readonly string[], layer: string): void => {
    for (const n of nodes) {
      if (selected.has(n.id)) next.delete(layer), groups.forEach((g) => next.add(g));
      if (n.type === 'group') walk(n.children, [...groups, n.id], layer);
    }
  };
  for (const l of page.layers) walk(l.children, [], l.id);
  return next.size === flip.size && [...next].every((id) => flip.has(id)) ? flip : next;
}

export type Part = 'top' | 'mid' | 'bottom';
/** Objekte: in container direkt über above (null = ganz unten). Ebenen: direkt über layerAbove (null = ganz unten). */
export type Drop = { container: string; above: string | null } | { layerAbove: string | null };

/** Ziel, wenn über Zeile i (Teil part) losgelassen wird; null = hier nicht ablegbar. Ebenen bleiben auf ihrer Seite (from). */
export function dropFor(rows: readonly Line[], i: number, part: Part, drag: 'node' | 'layer', from = 0): Drop | null {
  const r = rows[i];
  if (!r?.layer) return null;
  if (drag === 'layer') {
    if (r.page !== from) return null;
    const layers = rows.filter((it): it is Row => it.layer !== null && it.node === null && it.page === from).map((it) => it.layer);
    const k = layers.indexOf(r.layer);
    // Darunter = die nächste Ebene in der Liste (eine Stufe tiefer im Stapel).
    return { layerAbove: r.node || part === 'bottom' ? (layers[k + 1]?.id ?? null) : r.layer.id };
  }
  if (r.layer.locked) return null;
  const into = (container: string, top: string | null) => ({ container, above: top });
  if (!r.node) return into(r.id, r.topChild);
  if (r.node.type === 'group' && (part === 'mid' || (part === 'bottom' && r.open))) return into(r.id, r.topChild);
  return part === 'top' ? { container: r.parent!, above: r.id } : { container: r.parent!, above: r.below };
}

/** Ablagemarke für Ziel t beim Ziehen über Zeile over: Linie über Zeile i oder Rahmen um Zeile i (into). from = Seite der gezogenen Zeile. */
export function dropMark(rows: readonly Line[], t: Drop, over: number, from: number): { i: number; into: boolean } {
  const at = (id: string | null) => (id === null ? -1 : rows.findIndex((r) => r.id === id));
  if ('layerAbove' in t) {
    const k = at(t.layerAbove);
    const next = rows.findIndex((r) => r.page > from);
    return { i: k >= 0 ? k : next < 0 ? rows.length : next, into: false };
  }
  const k = at(t.above);
  if (k >= 0) return { i: k, into: false };
  const c = at(t.container);
  const r = rows[c];
  if (t.above === null && r?.layer && r.topChild !== null && r.open) return { i: over + 1, into: false };
  return { i: c, into: true };
}

/** Zielplatz für moveLayer; null = bleibt, wo sie ist. */
export function layerMove(page: Page, id: string, above: string | null): number | null {
  if (id === above) return null;
  const rest = page.layers.filter((l) => l.id !== id);
  const to = above === null ? 0 : rest.findIndex((l) => l.id === above) + 1;
  return to === page.layers.findIndex((l) => l.id === id) ? null : to;
}

/** „Ebene n“ mit n = Anzahl + 1, bei Doppel weiterzählen. */
export function freshLayerName(page: Page): string {
  let n = page.layers.length + 1;
  while (page.layers.some((l) => l.name === tr('Ebene {n}', { n }))) n++;
  return tr('Ebene {n}', { n });
}

export function rowIcon(r: Row): IconName {
  const n = r.node;
  if (!n) return 'layer';
  if (n.type === 'shape') return n.shape.kind === 'rect' || n.shape.kind === 'ellipse' ? n.shape.kind : 'polygon';
  return n.type === 'path' ? 'freehand' : n.type;
}

/** Gewählte Zeile zieht die ganze Auswahl mit (auch Kinder in Gruppen), sonst nur sich selbst. */
export const dragIds = (r: Row, selected: ReadonlySet<string>): string[] => (selected.has(r.id) ? [...selected] : [r.id]);

/** Alle Objekte samt Gruppenkindern. */
export function idsIn(nodes: readonly Node[]): Set<string> {
  const out = new Set<string>();
  const walk = (ns: readonly Node[]): void => {
    for (const n of ns) {
      out.add(n.id);
      if (n.type === 'group') walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** Pfeiltasten wie in Baumansichten: auf/ab = Nachbarzeile, Pos1/Ende, rechts = aufklappen bzw. erstes Kind,
 *  links = zuklappen bzw. Elternzeile. toggle = diese Zeile auf-/zuklappen. null = keine Baumtaste. */
export function treeKey(rows: readonly Line[], i: number, key: string): { i: number; toggle?: string } | null {
  const last = rows.length - 1;
  if (i < 0 || i > last) return ['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(key) ? { i: key === 'End' || key === 'ArrowUp' ? last : 0 } : null;
  const r = rows[i];
  switch (key) {
    case 'ArrowUp': return { i: Math.max(0, i - 1) };
    case 'ArrowDown': return { i: Math.min(last, i + 1) };
    case 'Home': return { i: 0 };
    case 'End': return { i: last };
    case 'ArrowRight':
      if (r.open === false) return { i, toggle: r.id };
      return { i: rows[i + 1]?.depth > r.depth ? i + 1 : i };
    case 'ArrowLeft': {
      if (r.open === true) return { i, toggle: r.id };
      for (let k = i - 1; k >= 0; k--) if (rows[k].depth < r.depth) return { i: k };
      return { i };
    }
  }
  return null;
}

/** Ziehen nahe am Listenrand rollt mit: Pixel pro Bild (negativ = nach oben), je näher am Rand desto schneller. */
export function edgeScroll(y: number, top: number, bottom: number, zone = 24, max = 14): number {
  if (y < top + zone) return -Math.ceil(max * Math.min(1, (top + zone - y) / zone));
  if (y > bottom - zone) return Math.ceil(max * Math.min(1, (y - bottom + zone) / zone));
  return 0;
}
