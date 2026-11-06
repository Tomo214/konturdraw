// Dokument-Befehle ohne Ansicht: Dokument und Auswahl rein, ein Rückgängig-Schritt und neue Auswahl raus.
import { align, distribute, mirror, setField } from '../model/arrange';
import {
  activeLayer,
  addNodes,
  cloneWithNewIds,
  deleteNodes,
  duplicateNodes,
  findNode,
  groupNodes,
  newId,
  reorder,
  translateNodes,
  ungroupNodes,
  worldOf,
} from '../model/document';
import { extractContents, placeInFrame } from '../model/frame';
import { patternFromSelection } from '../model/pattern';
import type { Box } from '../model/geometry';
import { addGuide, lockGuides, moveGuide, setGrid, setOrigin } from '../model/guides';
import { duplicatePage, insertPage, removePage } from '../model/pages';
import type { Doc, Node } from '../model/types';
import { DEFAULT_NUDGE } from '../model/units';
import { MM_TO_PX, fitBox, fitPage, zoomAt, zoomTo, type Viewport } from '../render/viewport';
import type { Command, Tool } from './shortcuts';

export interface EditResult {
  /** Fehlt, wenn das Dokument gleich bleibt (Kopieren). */
  doc?: Doc;
  selected?: Set<string>;
  clipboard?: Node[];
}

/** Abstand des Duplikats in mm. */
const DUPLICATE_OFFSET = 5;

// Kopien tragen ihre Lage auf der Seite: ein Kind aus einer Gruppe landet beim Einfügen an derselben Stelle.
const copyOf = (doc: Doc, ids: readonly string[]) =>
  ids.flatMap((id) => {
    const [n, w] = [findNode(doc, id), worldOf(doc, id)];
    return n && w ? [{ ...n, transform: w }] : [];
  });
const changed = (doc: Doc | null): EditResult | null => (doc ? { doc } : null);
const positive = (v: number) => Number.isFinite(v) && v > 0;

/** Wohin Neues kommt: aktuelle Seite und im Objekt-Manager gewählte Ebene. */
export interface Target {
  page: number;
  layer?: string;
}

/** null = kein Dokument-Befehl oder nichts zu tun. */
export function editCommand(
  doc: Doc,
  ids: readonly string[],
  cmd: Command,
  clipboard: readonly Node[],
  at: Target = { page: 0 },
): EditResult | null {
  switch (cmd.name) {
    case 'delete':
      return { doc: deleteNodes(doc, ids), selected: new Set() };
    case 'cut':
      return { doc: deleteNodes(doc, ids), selected: new Set(), clipboard: copyOf(doc, ids) };
    case 'copy':
      return { clipboard: copyOf(doc, ids) };
    case 'paste': {
      // An gleicher Stelle auf die aktive Ebene.
      if (!clipboard.length) return null;
      const layer = activeLayer(doc.pages[at.page], at.layer);
      if (!layer) throw new Error('Keine sichtbare, entsperrte Ebene');
      const clones = clipboard.map(cloneWithNewIds);
      return { doc: addNodes(doc, layer.id, clones), selected: new Set(clones.map((c) => c.id)) };
    }
    case 'duplicate': {
      const r = duplicateNodes(doc, ids, DUPLICATE_OFFSET, DUPLICATE_OFFSET);
      return { doc: r.doc, selected: new Set(r.ids) };
    }
    case 'group': {
      if (ids.length < 2) return null;
      const id = newId();
      return { doc: groupNodes(doc, ids, id), selected: new Set([id]) };
    }
    case 'ungroup': {
      const r = ungroupNodes(doc, ids);
      return r.ids.length ? { doc: r.doc, selected: new Set(r.ids) } : { doc: r.doc };
    }
    case 'forward': case 'backward': case 'front': case 'back':
      return { doc: reorder(doc, ids, cmd.name) };
    case 'nudge': {
      const step = doc.nudge ?? DEFAULT_NUDGE;
      return { doc: translateNodes(doc, ids, cmd.dx * step, cmd.dy * step) };
    }
    case 'frameInsert': case 'frameExtract': {
      const r = (cmd.name === 'frameInsert' ? placeInFrame : extractContents)(doc, ids);
      return { doc: r.doc, selected: new Set(r.selected) };
    }
    case 'patternFromSelection': {
      const r = patternFromSelection(doc, ids);
      return { doc: r.doc, selected: new Set(r.selected) };
    }
    case 'align': return changed(align(doc, ids, cmd.edge, cmd.to));
    case 'distribute': return changed(distribute(doc, ids, cmd.mode, cmd.to));
    case 'mirror': return changed(mirror(doc, ids, cmd.axis));
    case 'field': return changed(setField(doc, ids, cmd.field, cmd.value, cmd.locked));
    case 'pageSize': {
      if (!positive(cmd.width) || !positive(cmd.height)) throw new Error('Seitengröße muss größer als 0 sein.');
      // Wie Vorbild-Standard: gilt für alle Seiten.
      const [w, h] = [cmd.width, cmd.height];
      if (doc.pages.every((p) => p.width === w && p.height === h)) return null;
      return { doc: { ...doc, pages: doc.pages.map((p) => ({ ...p, width: w, height: h })) } };
    }
    case 'settings': {
      if (cmd.nudge !== undefined && !positive(cmd.nudge)) throw new Error('Verschiebe-Schritt muss größer als 0 sein.');
      const next = { ...doc, ...(cmd.units && { units: cmd.units }), ...(cmd.nudge !== undefined && { nudge: cmd.nudge }) };
      return next.units === doc.units && next.nudge === doc.nudge ? null : { doc: next };
    }
    case 'addGuide': return { doc: addGuide(doc, cmd.axis, cmd.pos, undefined, at.page) };
    case 'guide': {
      if (cmd.locked !== undefined) return changed(lockGuides(doc, [cmd.id], cmd.locked));
      return cmd.pos === undefined ? null : changed(moveGuide(doc, cmd.id, cmd.pos));
    }
    case 'origin': return changed(setOrigin(doc, cmd.at));
    case 'grid': return changed(setGrid(doc, cmd.x, cmd.y));
  }
  return null;
}

/** Seiten-Befehle: neue aktuelle Seite und ggf. neues Dokument; null = nichts zu tun. Umbenennen erledigt der Reiter. */
export function pageCommand(doc: Doc, cur: number, cmd: Command): { doc?: Doc; page: number } | null {
  if (cmd.name !== 'page') return null;
  const last = doc.pages.length - 1;
  const go = (page: number) => (page === cur || page < 0 || page > last ? null : { page });
  switch (cmd.op) {
    case 'insertAfter': return { doc: insertPage(doc, cur + 1, cur), page: cur + 1 };
    case 'insertBefore': return { doc: insertPage(doc, cur, cur), page: cur };
    case 'duplicate': case 'duplicateLayers': return { doc: duplicatePage(doc, cur, cmd.op === 'duplicate'), page: cur + 1 };
    case 'delete': {
      const next = removePage(doc, cur);
      return next && { doc: next, page: Math.min(cur, last - 1) };
    }
    case 'first': return go(0);
    case 'prev': return go(cur - 1);
    case 'next': return go(cur + 1);
    case 'last': return go(last);
    case 'rename': return null;
  }
}

/** Ansicht-Befehle; null = kein Ansicht-Befehl. Zoomen um die Mitte der Fläche. */
export function viewCommand(
  vp: Viewport,
  [w, h]: readonly [number, number],
  cmd: Command,
  selection: Box | null,
  page: { width: number; height: number },
): Viewport | null {
  switch (cmd.name) {
    case 'zoomFit': return fitPage(page.width, page.height, w, h);
    case 'zoom100': return zoomTo(vp, MM_TO_PX, w / 2, h / 2);
    case 'zoomIn': return zoomAt(vp, w / 2, h / 2, 1.25);
    case 'zoomOut': return zoomAt(vp, w / 2, h / 2, 0.8);
    case 'zoomSelection': return selection ? fitBox(selection, w, h) : vp;
    case 'scroll': return { ...vp, x: vp.x - cmd.dx, y: vp.y - cmd.dy };
  }
  return null;
}

/** Leertaste: zur Auswahl und beim nächsten Druck zurück zum vorigen Werkzeug. */
export function pickToggle(tool: Tool, prev: Tool | null): { tool: Tool; prev: Tool | null } {
  if (tool !== 'select') return { tool: 'select', prev: tool };
  return { tool: prev ?? 'select', prev: null };
}
