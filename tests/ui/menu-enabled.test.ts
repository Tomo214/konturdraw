import { expect, test } from 'vitest';
import { addNodes, createDocument, groupNodes } from '../../src/model/document';
import { insertPage } from '../../src/model/pages';
import type { Doc, Node, PathNode } from '../../src/model/types';
import { enabledFor, type MenuContext } from '../../src/ui/menu-enabled';
import type { Command } from '../../src/ui/shortcuts';
import { pt, square, sub } from '../model/fixtures';

const base = createDocument();
const layer = base.pages[0].layers[0].id;
const img: Node = { type: 'image', id: 'bild', transform: [1, 0, 0, 1, 0, 0], image: 'h', width: 5, height: 5 };
const twoParts: PathNode = { ...square('zwei'), subpaths: [...square('a').subpaths, sub(true, pt(20, 0), pt(30, 0), pt(30, 10))] };
const doc = addNodes(base, layer, [square('a'), square('b', 20), img, twoParts]);

const ctx = (selected: string[], more: Partial<MenuContext> = {}): MenuContext => ({
  doc, page: 0, selected, clipboard: 0, canUndo: false, canRedo: false, guide: false, ...more,
});
const on = (cmd: Command, c: MenuContext) => enabledFor(cmd, c);

test('Rückgängig/Wiederholen folgen dem Verlauf, Einfügen dem Zwischenspeicher', () => {
  expect(on({ name: 'undo' }, ctx([]))).toBe(false);
  expect(on({ name: 'undo' }, ctx([], { canUndo: true }))).toBe(true);
  expect(on({ name: 'redo' }, ctx([], { canRedo: true }))).toBe(true);
  expect(on({ name: 'paste' }, ctx([]))).toBe(false);
  expect(on({ name: 'paste' }, ctx([], { clipboard: 1 }))).toBe(true);
});

test('Auswahl-Befehle brauchen eine Auswahl; Löschen und Aufheben auch bei gewählter Hilfslinie', () => {
  for (const cmd of [{ name: 'cut' }, { name: 'copy' }, { name: 'duplicate' }, { name: 'zoomSelection' }, { name: 'front' }, { name: 'mirror', axis: 'h' }, { name: 'align', edge: 'left' }] as Command[]) {
    expect([cmd.name, on(cmd, ctx([]))]).toEqual([cmd.name, false]);
    expect([cmd.name, on(cmd, ctx(['a']))]).toEqual([cmd.name, true]);
  }
  expect(on({ name: 'delete' }, ctx([]))).toBe(false);
  expect(on({ name: 'delete' }, ctx([], { guide: true }))).toBe(true);
  expect(on({ name: 'deselect' }, ctx([], { guide: true }))).toBe(true);
});

test('Gruppieren ab zwei Objekten, Gruppierung aufheben nur mit Gruppe', () => {
  expect(on({ name: 'group' }, ctx(['a']))).toBe(false);
  expect(on({ name: 'group' }, ctx(['a', 'b']))).toBe(true);
  expect(on({ name: 'ungroup' }, ctx(['a']))).toBe(false);
  const grouped = groupNodes(doc, ['a', 'b'], 'g');
  expect(on({ name: 'ungroup' }, ctx(['g'], { doc: grouped }))).toBe(true);
});

test('Formen-Befehle wie die Formen-Regeln: Kombinieren ab zwei, Aufbrechen nur mit Teilpfaden, Bilder nie', () => {
  const shaping = (op: Extract<Command, { name: 'shaping' }>['op']): Command => ({ name: 'shaping', op });
  expect(on(shaping('combine'), ctx(['a']))).toBe(false);
  expect(on(shaping('combine'), ctx(['a', 'b']))).toBe(true);
  expect(on(shaping('weld'), ctx(['a', 'bild']))).toBe(false);
  expect(on(shaping('breakApart'), ctx(['a']))).toBe(false);
  expect(on(shaping('breakApart'), ctx(['zwei']))).toBe(true);
  expect(on(shaping('boundary'), ctx(['a']))).toBe(true);
  expect(on({ name: 'outline' }, ctx([]))).toBe(false);
});

test('Rahmen: Einfügen braucht Inhalt plus geschlossenes Ziel, Herausnehmen einen Rahmen mit Inhalt', () => {
  expect(on({ name: 'frameInsert' }, ctx(['a']))).toBe(false);
  expect(on({ name: 'frameInsert' }, ctx(['bild', 'a']))).toBe(true);
  expect(on({ name: 'frameInsert' }, ctx(['a', 'bild']))).toBe(false);
  expect(on({ name: 'frameExtract' }, ctx(['a']))).toBe(false);
  const framed = addNodes(base, layer, [{ ...square('f'), contents: [square('c')] }]);
  expect(on({ name: 'frameExtract' }, ctx(['f'], { doc: framed }))).toBe(true);
});

test('Muster aus Auswahl: Kachel-Objekte plus Ziel mit Füllung (zuletzt gewählt)', () => {
  expect(on({ name: 'patternFromSelection' }, ctx(['a']))).toBe(false);
  expect(on({ name: 'patternFromSelection' }, ctx(['a', 'b']))).toBe(true);
  expect(on({ name: 'patternFromSelection' }, ctx(['a', 'bild']))).toBe(false);
});

test('Nachzeichnen nur mit Bild, In Kurven nur mit Form oder Text', () => {
  expect(on({ name: 'trace' }, ctx(['a']))).toBe(false);
  expect(on({ name: 'trace' }, ctx(['bild']))).toBe(true);
  expect(on({ name: 'toCurves' }, ctx(['a']))).toBe(false);
  const rect: Node = { type: 'shape', id: 'r', transform: [1, 0, 0, 1, 0, 0], style: square('x').style, shape: { kind: 'rect', x: 0, y: 0, width: 5, height: 5, radius: 0 } } as Node;
  const withRect: Doc = addNodes(doc, layer, [rect]);
  expect(on({ name: 'toCurves' }, ctx(['r'], { doc: withRect }))).toBe(true);
});

test('Seiten: Löschen erst ab zwei Seiten, Blättern nur wenn es weitergeht; Rest immer an', () => {
  const page = (op: Extract<Command, { name: 'page' }>['op']): Command => ({ name: 'page', op });
  expect(on(page('delete'), ctx([]))).toBe(false);
  expect(on(page('next'), ctx([]))).toBe(false);
  const two = insertPage(doc, 1, 0);
  expect(on(page('delete'), ctx([], { doc: two }))).toBe(true);
  expect(on(page('next'), ctx([], { doc: two }))).toBe(true);
  expect(on(page('last'), ctx([], { doc: two, page: 1 }))).toBe(false);
  expect(on(page('prev'), ctx([], { doc: two, page: 1 }))).toBe(true);
  for (const cmd of [{ name: 'new' }, { name: 'save' }, { name: 'zoomFit' }, { name: 'show', what: 'grid' }, page('insertAfter'), { name: 'docker', id: 'objects' }] as Command[]) {
    expect([cmd.name, on(cmd, ctx([]))]).toEqual([cmd.name, true]);
  }
});
