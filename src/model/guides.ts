// Lineal-Nullpunkt, Hilfslinien und Raster (Phase 4c). Gerechnet wird in Seiten-mm (oben links, y nach unten);
// angezeigt wird wie im Vorbild ab dem Nullpunkt mit y nach oben. Alle Änderungen: neues Dokument oder null (nichts zu tun).
import { newId } from './document';
import type { Doc, Guide, Point } from './types';

/** Rasterabstand ohne Angabe im Dokument, mm. */
export const DEFAULT_GRID = 10;

// Alle Seiten sind gleich groß → Nullpunkt gilt fürs ganze Dokument.
export const originOf = (doc: Doc): Point => doc.origin ?? { x: 0, y: doc.pages[0].height };

/** Seiten-mm → Anzeige (ab Nullpunkt, y nach oben). */
export function toUser(doc: Doc, x: number, y: number): [number, number] {
  const o = originOf(doc);
  return [x - o.x, o.y - y];
}

/** Anzeige → Seiten-mm. */
export function fromUser(doc: Doc, ux: number, uy: number): [number, number] {
  const o = originOf(doc);
  return [ux + o.x, o.y - uy];
}

export function setOrigin(doc: Doc, at: Point | null): Doc | null {
  if (!at) {
    if (!doc.origin) return null;
    const { origin: _, ...rest } = doc;
    return rest;
  }
  if (doc.origin && doc.origin.x === at.x && doc.origin.y === at.y) return null;
  return { ...doc, origin: { x: at.x, y: at.y } };
}

/** Hilfslinien der Seite pi. */
export const guidesOf = (doc: Doc, pi = 0): readonly Guide[] => doc.pages[pi].guides ?? [];

// Wendet fn auf die Linien jeder Seite an; null = auf keiner Seite etwas geändert.
function mapGuides(doc: Doc, fn: (gs: readonly Guide[]) => readonly Guide[] | null): Doc | null {
  let changed = false;
  const pages = doc.pages.map((p) => {
    const next = fn(p.guides ?? []);
    if (!next) return p;
    changed = true;
    return { ...p, guides: next };
  });
  return changed ? { ...doc, pages } : null;
}

export const addGuide = (doc: Doc, axis: Guide['axis'], pos: number, id = newId(), pi = 0): Doc => ({
  ...doc,
  pages: doc.pages.map((p, i) => (i === pi ? { ...p, guides: [...(p.guides ?? []), { id, axis, pos }] } : p)),
});

export function moveGuide(doc: Doc, id: string, pos: number): Doc | null {
  return mapGuides(doc, (gs) => {
    const g = gs.find((it) => it.id === id);
    if (!g || g.locked || g.pos === pos) return null;
    return gs.map((it) => (it === g ? { ...g, pos } : it));
  });
}

/** Gesperrte Linien bleiben stehen. */
export function removeGuides(doc: Doc, ids: Iterable<string>): Doc | null {
  const drop = new Set(ids);
  return mapGuides(doc, (gs) => {
    const kept = gs.filter((g) => g.locked || !drop.has(g.id));
    return kept.length === gs.length ? null : kept;
  });
}

export function lockGuides(doc: Doc, ids: Iterable<string>, locked: boolean): Doc | null {
  const set = new Set(ids);
  return mapGuides(doc, (gs) => {
    let changed = false;
    const guides = gs.map((g) => {
      if (!set.has(g.id) || !!g.locked === locked) return g;
      changed = true;
      if (locked) return { ...g, locked: true };
      const { locked: _, ...rest } = g;
      return rest;
    });
    return changed ? guides : null;
  });
}

/** Nächste Linie zum Seitenpunkt innerhalb tol (mm). */
export function guideAt(guides: readonly Guide[], x: number, y: number, tol: number): Guide | undefined {
  let best: Guide | undefined;
  let bestD = tol;
  for (const g of guides) {
    const d = Math.abs((g.axis === 'h' ? y : x) - g.pos);
    if (d <= bestD) [best, bestD] = [g, d];
  }
  return best;
}

export const gridOf = (doc: Doc): { x: number; y: number } => doc.grid ?? { x: DEFAULT_GRID, y: DEFAULT_GRID };

export function setGrid(doc: Doc, x: number, y: number): Doc | null {
  if (!(x > 0 && y > 0 && Number.isFinite(x) && Number.isFinite(y))) throw new Error('Rasterabstand muss größer als 0 sein.');
  const g = gridOf(doc);
  return g.x === x && g.y === y ? null : { ...doc, grid: { x, y } };
}
