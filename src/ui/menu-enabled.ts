// Ausgegraute Menüeinträge wie Vorbild: was gerade nichts bewirken kann, ist aus. Formen-Regeln kommen aus dem Modell selbst.
import { findNode } from '../model/document';
import { extractContents, placeInFrame } from '../model/frame';
import { planOutline } from '../model/outline';
import { patternFromSelection } from '../model/pattern';
import { planShaping } from '../model/shaping';
import type { Doc, Node } from '../model/types';
import type { Command } from './shortcuts';

export interface MenuContext {
  doc: Doc;
  /** aktuelle Seite */
  page: number;
  selected: readonly string[];
  /** Objekte im Zwischenspeicher */
  clipboard: number;
  canUndo: boolean;
  canRedo: boolean;
  /** Hilfslinie gewählt: Löschen und Aufheben wirken dann auf sie. */
  guide: boolean;
}

const leaves = (n: Node): Node[] => (n.type === 'group' ? n.children.flatMap(leaves) : [n]);
const works = (plan: () => unknown) => {
  try {
    plan();
    return true;
  } catch {
    return false;
  }
};

/** Unbekannte Befehle (Datei, Ansicht, Fenster …) sind immer an. */
export function enabledFor(cmd: Command, c: MenuContext): boolean {
  const n = c.selected.length;
  const last = c.doc.pages.length - 1;
  const leafs = () => c.selected.flatMap((id) => {
    const node = findNode(c.doc, id);
    return node ? leaves(node) : [];
  });
  switch (cmd.name) {
    case 'undo': return c.canUndo;
    case 'redo': return c.canRedo;
    case 'paste': return c.clipboard > 0;
    case 'delete': case 'deselect': return n > 0 || c.guide;
    case 'cut': case 'copy': case 'duplicate': case 'zoomSelection': case 'mirror': case 'align':
    case 'front': case 'back': case 'forward': case 'backward':
      return n > 0;
    case 'group': return n > 1;
    case 'ungroup': return c.selected.some((id) => findNode(c.doc, id)?.type === 'group');
    case 'shaping': return works(() => planShaping(c.doc, c.selected, cmd.op));
    case 'outline': return works(() => planOutline(c.doc, c.selected));
    case 'frameInsert': return works(() => placeInFrame(c.doc, c.selected));
    case 'frameExtract': return works(() => extractContents(c.doc, c.selected));
    case 'patternFromSelection': return works(() => patternFromSelection(c.doc, c.selected));
    case 'toCurves': return leafs().some((x) => x.type === 'shape' || x.type === 'text');
    case 'trace': return leafs().some((x) => x.type === 'image');
    case 'page':
      if (cmd.op === 'delete') return last > 0;
      if (cmd.op === 'first' || cmd.op === 'prev') return c.page > 0;
      if (cmd.op === 'next' || cmd.op === 'last') return c.page < last;
      return true;
    default:
      return true;
  }
}
