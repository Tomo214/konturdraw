// Seiten (Phase 4e): einfügen, duplizieren, löschen, verschieben, umbenennen. Alle Seiten sind gleich groß
// (Seitengröße gilt fürs ganze Dokument). Änderungen liefern ein neues Dokument oder null (nichts zu tun).
import { cloneWithNewIds, newId } from './document';
import type { Doc, Node, Page } from './types';

export const pageLabel = (doc: Doc, i: number): string => doc.pages[i].name ?? `Seite ${i + 1}`;

function withPages(doc: Doc, pages: Page[]): Doc {
  return { ...doc, pages };
}

// Leere Seite mit Größe und Ebenen (Name, Schalter) der Vorlage.
function blankLike(page: Page): Page {
  return {
    id: newId(),
    width: page.width,
    height: page.height,
    layers: page.layers.map((l) => ({ ...l, id: newId(), children: [] })),
  };
}

/** Neue Seite an Stelle `at` (0 … Anzahl) nach Vorlage der Seite `like`. */
export function insertPage(doc: Doc, at: number, like: number): Doc {
  const pages = [...doc.pages];
  pages.splice(at, 0, blankLike(doc.pages[like]));
  return withPages(doc, pages);
}

/** Kopie direkt hinter Seite i: nur Ebenen oder mit Objekten und Hilfslinien. Alles bekommt neue IDs. */
export function duplicatePage(doc: Doc, i: number, contents: boolean): Doc {
  const src = doc.pages[i];
  const blank = blankLike(src);
  const copy: Page = contents
    ? {
        ...blank,
        layers: blank.layers.map((l, j) => ({ ...l, children: src.layers[j].children.map(cloneWithNewIds) })),
        ...(src.guides && { guides: src.guides.map((g) => ({ ...g, id: newId() })) }),
      }
    : blank;
  const pages = [...doc.pages];
  pages.splice(i + 1, 0, copy);
  return withPages(doc, pages);
}

/** null, wenn es die letzte Seite ist. */
export function removePage(doc: Doc, i: number): Doc | null {
  return doc.pages.length < 2 ? null : withPages(doc, doc.pages.filter((_, j) => j !== i));
}

export function movePage(doc: Doc, from: number, to: number): Doc | null {
  if (from === to) return null;
  const pages = [...doc.pages];
  pages.splice(to, 0, ...pages.splice(from, 1));
  return withPages(doc, pages);
}

/** Name gekürzt; leer = zurück zu „Seite n“. */
export function renamePage(doc: Doc, i: number, name: string): Doc | null {
  const clean = name.trim();
  const page = doc.pages[i];
  if ((page.name ?? '') === clean) return null;
  const { name: _, ...rest } = page;
  return withPages(doc, doc.pages.map((p, j) => (j !== i ? p : clean ? { ...rest, name: clean } : rest)));
}

const contains = (nodes: readonly Node[], id: string): boolean =>
  nodes.some((n) => n.id === id || (n.type === 'group' && contains(n.children, id)));

/** Seite, auf der die Ebene oder das Objekt liegt; −1 = nirgends. */
export const pageIndexOf = (doc: Doc, id: string): number =>
  doc.pages.findIndex((p) => p.layers.some((l) => l.id === id || contains(l.children, id)));
