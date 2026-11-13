import { expect, test } from 'vitest';
import { canvasMenu, selectForMenu, type CanvasItem } from '../../src/ui/canvas-menu';
import { MENUS, type MenuEntry } from '../../src/ui/menus';
import type { Command } from '../../src/ui/shortcuts';

const labels = (m: readonly (CanvasItem | null)[]) => m.map((it) => it && it.label);
const all = () => true;

test('Objektmenü wie Vorbild: Bearbeiten, Umwandeln, Reihenfolge, Eigenschaften zuletzt', () => {
  expect(labels(canvasMenu(true, all))).toEqual([
    'Rückgängig',
    null,
    'Ausschneiden', 'Kopieren', 'Einfügen', 'Löschen',
    null,
    'Duplizieren',
    null,
    'In Kurven umwandeln', 'Kontur in Objekt umwandeln', 'Kombinieren', 'Aufbrechen', 'Gruppieren', 'Gruppierung aufheben', 'In Rahmen einfügen', 'Inhalt herausnehmen',
    null,
    'Ganz nach vorn', 'Ganz nach hinten', 'Eine Stufe nach vorn', 'Eine Stufe nach hinten',
    null,
    'Objekteigenschaften',
  ]);
});

test('leere Fläche: Verlauf, Einfügen, Ganze Seite, Dokumentoptionen', () => {
  expect(labels(canvasMenu(false, all))).toEqual(['Rückgängig', 'Wiederholen', null, 'Einfügen', null, 'Ganze Seite', null, 'Dokumentoptionen …']);
});

test('was zur Auswahl nicht passt (Gruppieren, Kombinieren …), fehlt; Grundbefehle bleiben grau stehen', () => {
  const off = new Set(['undo', 'paste', 'group', 'ungroup', 'shaping', 'toCurves', 'outline', 'frameInsert', 'frameExtract']);
  const m = canvasMenu(true, (c) => !off.has(c.name));
  expect(labels(m)).toEqual([
    'Rückgängig', null, 'Ausschneiden', 'Kopieren', 'Einfügen', 'Löschen', null, 'Duplizieren', null,
    'Ganz nach vorn', 'Ganz nach hinten', 'Eine Stufe nach vorn', 'Eine Stufe nach hinten', null, 'Objekteigenschaften',
  ]);
  expect(m.filter((it) => it?.disabled).map((it) => it!.label)).toEqual(['Rückgängig', 'Einfügen']);
});

test('jeder Eintrag hat Beschriftung und Befehl eines Hauptmenü-Punkts (gleiche Übersetzung, gleiches Kürzel)', () => {
  const flat = (list: readonly MenuEntry[]): { label: string; cmd: Command }[] =>
    list.flatMap((e) => (!e ? [] : 'items' in e ? flat(e.items) : [e]));
  const main = MENUS.flatMap((m) => flat(m.items));
  for (const it of [...canvasMenu(true, all), ...canvasMenu(false, all)]) {
    if (it) expect(main.find((e) => e.label === it.label)?.cmd, it.label).toEqual(it.cmd);
  }
});

test('Rechtsklick wählt das Objekt darunter, außer es ist schon (mit Gruppe oder Kind) gewählt', () => {
  const hit = (topId: string, ...below: string[]) => ({ topId, chain: [topId, ...below] });
  const none = new Set<string>();
  expect([...selectForMenu(none, hit('a'))]).toEqual(['a']);
  const two = new Set(['a', 'b']);
  expect(selectForMenu(two, hit('b'))).toBe(two);
  const child = new Set(['kind']);
  expect(selectForMenu(child, hit('gruppe', 'kind'))).toBe(child);
  expect([...selectForMenu(two, hit('c'))]).toEqual(['c']);
  expect(selectForMenu(two, null)).toBe(two);
});
