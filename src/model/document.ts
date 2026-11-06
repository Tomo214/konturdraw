import { IDENTITY, invert, multiply, translate, type Mat } from './geometry';
import type { Doc, GroupNode, Layer, Node, Page } from './types';

type Children = readonly Node[];
type LayerPatch = Partial<Pick<Layer, 'name' | 'visible' | 'locked' | 'printable'>>;
export type Order = 'forward' | 'backward' | 'front' | 'back';

export const newId = (): string => crypto.randomUUID();

function newLayer(name: string): Layer {
  return { id: newId(), name, visible: true, locked: false, printable: true, children: [] };
}

export function createDocument(width = 210, height = 297): Doc {
  return { schemaVersion: 1, pages: [{ id: newId(), width, height, layers: [newLayer('Ebene 1')] }] };
}

// ---------- Ebenen ----------

function mapPageOfLayer(doc: Doc, layerId: string, fn: (p: Page, index: number) => Page): Doc {
  let found = false;
  const pages = doc.pages.map((p) => {
    const i = p.layers.findIndex((l) => l.id === layerId);
    if (i < 0) return p;
    found = true;
    return fn(p, i);
  });
  if (!found) throw new Error(`Ebene ${layerId} nicht gefunden`);
  return { ...doc, pages };
}

function mapLayer(doc: Doc, layerId: string, fn: (l: Layer) => Layer): Doc {
  return mapPageOfLayer(doc, layerId, (p, i) => ({ ...p, layers: p.layers.map((l, j) => (j === i ? fn(l) : l)) }));
}

/** Neue Ebene ganz oben. */
export function addLayer(doc: Doc, pageIndex: number, name: string): Doc {
  const pages = doc.pages.map((p, i) => (i === pageIndex ? { ...p, layers: [...p.layers, newLayer(name)] } : p));
  return { ...doc, pages };
}

export function updateLayer(doc: Doc, layerId: string, patch: LayerPatch): Doc {
  return mapLayer(doc, layerId, (l) => ({ ...l, ...patch }));
}

export function moveLayer(doc: Doc, layerId: string, toIndex: number): Doc {
  return mapPageOfLayer(doc, layerId, (p, i) => {
    const layers = p.layers.filter((l) => l.id !== layerId);
    layers.splice(toIndex, 0, p.layers[i]);
    return { ...p, layers };
  });
}

/** Löscht die Ebene samt Inhalt; null, wenn sie die letzte ihrer Seite ist. */
export function removeLayer(doc: Doc, layerId: string): Doc | null {
  const page = doc.pages.find((p) => p.layers.some((l) => l.id === layerId));
  if (!page || page.layers.length < 2) return null;
  return mapPageOfLayer(doc, layerId, (p) => ({ ...p, layers: p.layers.filter((l) => l.id !== layerId) }));
}

/** Objekte oben auf die Ebene legen. */
export function addNodes(doc: Doc, layerId: string, nodes: readonly Node[]): Doc {
  return mapLayer(doc, layerId, (l) => ({ ...l, children: [...l.children, ...nodes] }));
}

// ---------- Objekte ----------

// Wendet fn auf jede Kinderliste an (Ebenen und Gruppen, innen zuerst).
// fn gibt dieselbe Liste zurück, wenn nichts zu tun ist → Unberührtes bleibt geteilt.
function mapChildren(children: Children, fn: (c: Children) => Children): Children {
  let changed = false;
  const inner = children.map((n) => {
    if (n.type !== 'group') return n;
    const c = mapChildren(n.children, fn);
    if (c === n.children) return n;
    changed = true;
    return { ...n, children: c };
  });
  return fn(changed ? inner : children);
}

function mapContainers(doc: Doc, fn: (c: Children) => Children): Doc {
  let docChanged = false;
  const pages = doc.pages.map((p) => {
    let pageChanged = false;
    const layers = p.layers.map((l) => {
      const c = mapChildren(l.children, fn);
      if (c === l.children) return l;
      pageChanged = true;
      return { ...l, children: c };
    });
    if (!pageChanged) return p;
    docChanged = true;
    return { ...p, layers };
  });
  return docChanged ? { ...doc, pages } : doc;
}

export function updateNodes(doc: Doc, ids: Iterable<string>, fn: (n: Node) => Node): Doc {
  const set = new Set(ids);
  return mapContainers(doc, (ch) => (ch.some((n) => set.has(n.id)) ? ch.map((n) => (set.has(n.id) ? fn(n) : n)) : ch));
}

/** Fügt Objekte direkt über id in dessen Container (Ebene oder Gruppe) ein. */
export function insertAbove(doc: Doc, id: string, nodes: readonly Node[]): Doc {
  return mapContainers(doc, (ch) => {
    const i = ch.findIndex((n) => n.id === id);
    return i < 0 ? ch : [...ch.slice(0, i + 1), ...nodes, ...ch.slice(i + 1)];
  });
}

export function findNode(doc: Doc, id: string): Node | undefined {
  const search = (children: Children): Node | undefined => {
    for (const n of children) {
      if (n.id === id) return n;
      if (n.type === 'group') {
        const hit = search(n.children);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  for (const p of doc.pages) for (const l of p.layers) {
    const hit = search(l.children);
    if (hit) return hit;
  }
  return undefined;
}

export function removeNodes(doc: Doc, ids: Iterable<string>): Doc {
  const set = new Set(ids);
  return mapContainers(doc, (ch) => (ch.some((n) => set.has(n.id)) ? ch.filter((n) => !set.has(n.id)) : ch));
}

/** Löscht Objekte; Gruppen, die dadurch leer werden, verschwinden mit (auch verschachtelt). */
export function deleteNodes(doc: Doc, ids: Iterable<string>): Doc {
  const set = new Set(ids);
  const at = places(doc);
  return pruneEmpty(removeNodes(doc, set), [...set].flatMap((id) => at.get(id)?.path ?? []));
}

/** Lage des Objekts auf der Seite (umgebende Gruppen × eigene Matrix); null = nicht gefunden. */
export function worldOf(doc: Doc, id: string): Mat | null {
  const search = (children: Children, world: Mat): Mat | null => {
    for (const n of children) {
      const w = world === IDENTITY ? n.transform : multiply(world, n.transform);
      if (n.id === id) return w;
      const hit = n.type === 'group' ? search(n.children, w) : null;
      if (hit) return hit;
    }
    return null;
  };
  for (const p of doc.pages) for (const l of p.layers) {
    const hit = search(l.children, IDENTITY);
    if (hit) return hit;
  }
  return null;
}

/**
 * Je Objekt eine eigene Matrix in Seitenkoordinaten – auch für Objekte in verschobenen/gedrehten Gruppen.
 * Kinder einer ebenfalls gewählten Gruppe gehen nur mit ihr mit (nicht doppelt).
 */
export function transformEach(doc: Doc, mats: ReadonlyMap<string, Mat>): Doc {
  if (!mats.size) return doc;
  // Seiten-Matrix m im Container mit Weltmatrix W: lokal = W⁻¹ · m · W · alt.
  const walk = (children: Children, world: Mat): Children => {
    let changed = false;
    const out = children.map((n) => {
      const m = mats.get(n.id);
      if (m) {
        changed = true;
        const local = world === IDENTITY ? m : multiply(multiply(invert(world), m), world);
        return { ...n, transform: multiply(local, n.transform) };
      }
      if (n.type !== 'group') return n;
      const c = walk(n.children, world === IDENTITY ? n.transform : multiply(world, n.transform));
      if (c === n.children) return n;
      changed = true;
      return { ...n, children: c };
    });
    return changed ? out : children;
  };
  let docChanged = false;
  const pages = doc.pages.map((p) => {
    let pageChanged = false;
    const layers = p.layers.map((l) => {
      const c = walk(l.children, IDENTITY);
      if (c === l.children) return l;
      pageChanged = true;
      return { ...l, children: c };
    });
    if (!pageChanged) return p;
    docChanged = true;
    return { ...p, layers };
  });
  return docChanged ? { ...doc, pages } : doc;
}

/** Verschiebt auf der Seite. */
export function translateNodes(doc: Doc, ids: Iterable<string>, dx: number, dy: number): Doc {
  return transformNodes(doc, ids, translate(dx, dy));
}

/** m in Seitenkoordinaten, für jedes Objekt gleich. */
export function transformNodes(doc: Doc, ids: Iterable<string>, m: Mat): Doc {
  return transformEach(doc, new Map([...ids].map((id) => [id, m])));
}

/** Ziel für neue Objekte: die gewählte Ebene, sonst (oder wenn sie verborgen/gesperrt ist) die oberste benutzbare. */
export function activeLayer(page: Page, preferred?: string): Layer | undefined {
  const usable = (l: Layer) => l.visible && !l.locked;
  const chosen = page.layers.find((l) => l.id === preferred);
  return chosen && usable(chosen) ? chosen : [...page.layers].reverse().find(usable);
}

/** Name gekürzt; leer löscht ihn. null = nichts zu tun. */
export function renameNode(doc: Doc, id: string, name: string): Doc | null {
  const n = findNode(doc, id);
  const clean = name.trim();
  if (!n || (n.name ?? '') === clean) return null;
  return updateNodes(doc, [id], (it) => {
    if (clean) return { ...it, name: clean };
    const { name: _, ...rest } = it;
    return rest as Node;
  });
}

export function reorder(doc: Doc, ids: Iterable<string>, where: Order): Doc {
  const set = new Set(ids);
  return mapContainers(doc, (ch) => {
    if (!ch.some((n) => set.has(n.id))) return ch;
    const sel = ch.filter((n) => set.has(n.id));
    const rest = ch.filter((n) => !set.has(n.id));
    let out: Node[];
    if (where === 'front') out = [...rest, ...sel];
    else if (where === 'back') out = [...sel, ...rest];
    else {
      out = ch.slice();
      if (where === 'forward') {
        for (let i = out.length - 2; i >= 0; i--)
          if (set.has(out[i].id) && !set.has(out[i + 1].id)) [out[i], out[i + 1]] = [out[i + 1], out[i]];
      } else {
        for (let i = 1; i < out.length; i++)
          if (set.has(out[i].id) && !set.has(out[i - 1].id)) [out[i - 1], out[i]] = [out[i], out[i - 1]];
      }
    }
    return out.every((n, i) => n === ch[i]) ? ch : out;
  });
}

/** Gruppe landet an der Stelle des obersten Mitglieds. Nur innerhalb eines Containers. */
export function groupNodes(doc: Doc, ids: Iterable<string>, groupId = newId()): Doc {
  const set = new Set(ids);
  let containers = 0;
  mapContainers(doc, (ch) => {
    if (ch.some((n) => set.has(n.id))) containers++;
    return ch;
  });
  if (containers === 0) return doc;
  if (containers > 1) throw new Error('Gruppieren geht nur innerhalb einer Ebene oder Gruppe');
  return mapContainers(doc, (ch) => {
    if (!ch.some((n) => set.has(n.id))) return ch;
    let top = -1;
    ch.forEach((n, i) => set.has(n.id) && (top = i));
    const group: GroupNode = { type: 'group', id: groupId, transform: IDENTITY, children: ch.filter((n) => set.has(n.id)) };
    return ch.flatMap((n, i) => (i === top ? [group] : set.has(n.id) ? [] : [n]));
  });
}

/** Löst Gruppen auf; Kinder behalten ihre Lage auf der Seite. Liefert die IDs der Kinder. */
export function ungroupNodes(doc: Doc, ids: Iterable<string>): { doc: Doc; ids: string[] } {
  const set = new Set(ids);
  const released: string[] = [];
  const next = mapContainers(doc, (ch) => {
    if (!ch.some((n) => set.has(n.id) && n.type === 'group')) return ch;
    return ch.flatMap((n) => {
      if (!set.has(n.id) || n.type !== 'group') return [n];
      return n.children.map((c) => {
        released.push(c.id);
        // Transparenz der Gruppe wandert in die Kinder, damit das Aussehen bleibt
        const o = (n.opacity ?? 1) * (c.opacity ?? 1);
        return { ...c, transform: multiply(n.transform, c.transform), ...(o < 1 ? { opacity: o } : {}) };
      });
    });
  });
  return { doc: next, ids: released };
}

export function cloneWithNewIds(node: Node): Node {
  return node.type === 'group'
    ? { ...node, id: newId(), children: node.children.map(cloneWithNewIds) }
    : { ...node, id: newId() };
}

/** Kopie mit neuen IDs, auf der Seite versetzt, direkt über dem Original (in derselben Gruppe). */
export function duplicateNodes(doc: Doc, ids: Iterable<string>, dx: number, dy: number): { doc: Doc; ids: string[] } {
  const set = new Set(ids);
  const created: string[] = [];
  const next = mapContainers(doc, (ch) => {
    if (!ch.some((n) => set.has(n.id))) return ch;
    return ch.flatMap((n) => {
      if (!set.has(n.id)) return [n];
      const copy = cloneWithNewIds(n);
      created.push(copy.id);
      return [n, copy];
    });
  });
  return { doc: translateNodes(next, created, dx, dy), ids: created };
}

// ---------- Umhängen (Objekt-Manager) ----------

interface Place {
  /** Ebene oder Gruppe, in der das Objekt liegt. */
  parent: string;
  /** Matrix des Containers in Seitenkoordinaten. */
  world: Mat;
  /** Umgebende Gruppen von außen nach innen. */
  path: readonly string[];
}

// Reihenfolge der Map = Stapelfolge von unten nach oben über alle Seiten.
function places(doc: Doc): Map<string, Place> {
  const out = new Map<string, Place>();
  const walk = (children: Children, parent: string, world: Mat, path: readonly string[]) => {
    for (const n of children) {
      out.set(n.id, { parent, world, path });
      if (n.type === 'group') walk(n.children, n.id, multiply(world, n.transform), [...path, n.id]);
    }
  };
  for (const p of doc.pages) for (const l of p.layers) walk(l.children, l.id, IDENTITY, []);
  return out;
}

/**
 * Hängt Objekte in eine Ebene oder Gruppe um: sie landen direkt über `above` (null = ganz unten),
 * behalten Reihenfolge und Lage auf der Seite. Leer gewordene Gruppen fallen weg. null = nichts zu tun oder unmöglich.
 */
export function moveNodes(doc: Doc, ids: Iterable<string>, container: string, above: string | null): Doc | null {
  const set = new Set(ids);
  const at = places(doc);
  const inSet = (id: string) => set.has(id) || !!at.get(id)?.path.some((a) => set.has(a));
  const moving = [...at.keys()].filter((id) => set.has(id) && !at.get(id)!.path.some((a) => set.has(a)));
  const target = findNode(doc, container);
  const isLayer = doc.pages.some((p) => p.layers.some((l) => l.id === container));
  if (!moving.length || (!isLayer && target?.type !== 'group') || inSet(container)) return null;
  if (above !== null && (inSet(above) || at.get(above)?.parent !== container)) return null;

  const children = (d: Doc): Children => {
    if (!isLayer) return (findNode(d, container) as GroupNode).children;
    for (const p of d.pages) for (const l of p.layers) if (l.id === container) return l.children;
    return [];
  };
  const before = children(doc).map((n) => n.id);
  const toLocal = invert(isLayer ? IDENTITY : multiply(at.get(container)!.world, target!.transform));
  const nodes = moving.map((id) => {
    const n = findNode(doc, id)!;
    return { ...n, transform: multiply(toLocal, multiply(at.get(id)!.world, n.transform)) };
  });
  const insert = (ch: Children): Children => {
    const i = above === null ? 0 : ch.findIndex((n) => n.id === above) + 1;
    return [...ch.slice(0, i), ...nodes, ...ch.slice(i)];
  };
  let next = removeNodes(doc, moving);
  next = isLayer
    ? mapLayer(next, container, (l) => ({ ...l, children: insert(l.children) }))
    : updateNodes(next, [container], (g) => ({ ...g, children: insert((g as GroupNode).children) }));
  const after = children(next).map((n) => n.id);
  if (moving.every((id) => at.get(id)!.parent === container) && after.every((id, i) => id === before[i])) return null;

  return pruneEmpty(next, moving.flatMap((id) => at.get(id)!.path));
}

// Gruppen (aus candidates), die leer geworden sind, verschwinden – auch verschachtelt.
function pruneEmpty(doc: Doc, candidates: readonly string[]): Doc {
  const ids = [...new Set(candidates)];
  for (let next = doc; ; ) {
    const empty = ids.filter((id) => {
      const g = findNode(next, id);
      return g?.type === 'group' && g.children.length === 0;
    });
    if (!empty.length) return next;
    next = removeNodes(next, empty);
  }
}
