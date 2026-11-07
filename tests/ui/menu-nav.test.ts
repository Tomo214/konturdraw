import { expect, test } from 'vitest';
import { MENUS, menuKey, type MenuEntry } from '../../src/ui/menus';
import { setLang, tr } from '../../src/i18n/i18n.svelte';
import { CLOSED, altMenu, navKey, openTop, type MenuNav } from '../../src/ui/menu-nav';
import type { Command } from '../../src/ui/shortcuts';

const all = () => true;
const top = (label: string) => MENUS.findIndex((m) => m.label === label);
/** Beschriftung des markierten Eintrags auf der tiefsten offenen Ebene. */
function current(nav: MenuNav): string {
  let items: readonly MenuEntry[] = MENUS[nav.top!].items;
  let e: MenuEntry | undefined;
  for (const i of nav.path) {
    e = items[i];
    if (e && 'items' in e) items = e.items;
  }
  return e?.label ?? '';
}
function press(nav: MenuNav, keys: string[], enabled: (c: Command) => boolean = all) {
  let run: Command | undefined;
  for (const k of keys) ({ nav, run } = navKey(nav, k, enabled));
  return { nav, run };
}

test('Pfeil runter/hoch überspringt Trennlinien und läuft im Kreis', () => {
  const nav = openTop(top('Bearbeiten'));
  expect(current(nav)).toBe('Rückgängig');
  expect(current(press(nav, ['ArrowDown', 'ArrowDown']).nav)).toBe('Ausschneiden');
  expect(current(press(nav, ['ArrowUp']).nav)).toBe('Auswahl aufheben');
  expect(current(press(nav, ['End', 'Home']).nav)).toBe('Rückgängig');
});

test('rechts öffnet ein Untermenü, links schließt es; sonst wechseln die Pfeile das Hauptmenü', () => {
  let { nav } = press(openTop(top('Ansicht')), ['End']);
  expect(current(nav)).toBe('Fangen an');
  ({ nav } = press(nav, ['ArrowRight']));
  expect(current(nav)).toBe('Objekte');
  ({ nav } = press(nav, ['ArrowLeft']));
  expect(current(nav)).toBe('Fangen an');
  ({ nav } = press(nav, ['ArrowLeft']));
  expect([nav.top, current(nav)]).toEqual([top('Bearbeiten'), 'Rückgängig']);
  ({ nav } = press(nav, ['ArrowRight']));
  expect(nav.top).toBe(top('Ansicht'));
  expect(press(openTop(top('Fenster')), ['ArrowLeft', 'ArrowLeft', 'ArrowRight', 'ArrowRight']).nav.top).toBe(top('Fenster'));
});

test('Eingabe führt aus und schließt; ausgegraute Einträge bleiben stehen und lösen nichts aus', () => {
  const noUndo = (c: Command) => c.name !== 'undo';
  const stuck = press(openTop(top('Bearbeiten')), ['Enter'], noUndo);
  expect(stuck.run).toBeUndefined();
  expect(current(stuck.nav)).toBe('Rückgängig');
  const done = press(stuck.nav, ['ArrowDown', ' '], noUndo);
  expect(done.run).toEqual({ name: 'redo' });
  expect(done.nav).toEqual(CLOSED);
});

test('Buchstabe: eindeutig = auslösen, mehrere Treffer = der Reihe nach markieren', () => {
  const nav = openTop(top('Datei'));
  expect(press(nav, ['n']).run).toEqual({ name: 'new' });
  const s = press(nav, ['S']);
  expect([current(s.nav), s.run]).toEqual(['Speichern', undefined]);
  expect(current(press(s.nav, ['s']).nav)).toBe('Speichern unter …');
  expect(current(press(s.nav, ['s', 's']).nav)).toBe('Speichern');
  expect(press(openTop(top('Objekt')), ['f']).nav.path.length).toBe(2);
});

test('Escape: Untermenü zu, dann zurück in die Leiste, dann ganz zu; per Maus geöffnet sofort zu', () => {
  let { nav } = press(openTop(top('Ansicht')), ['End', 'ArrowRight']);
  ({ nav } = press(nav, ['Escape']));
  expect(current(nav)).toBe('Fangen an');
  ({ nav } = press(nav, ['Escape']));
  expect(nav).toEqual({ top: top('Ansicht'), path: [], keys: true });
  expect(press(nav, ['Escape']).nav).toEqual(CLOSED);
  expect(press({ top: 0, path: [-1], keys: false }, ['Escape']).nav).toEqual(CLOSED);
});

test('Leiste (Alt angetippt): Pfeile wechseln den Titel, runter öffnet, Merkbuchstabe öffnet sein Menü', () => {
  const bar: MenuNav = { top: 0, path: [], keys: true };
  expect(press(bar, ['ArrowLeft']).nav).toEqual({ top: top('Fenster'), path: [], keys: true });
  expect(current(press(bar, ['ArrowDown']).nav)).toBe('Neu');
  expect(current(press(bar, ['o']).nav)).toBe('Gruppieren');
});

test('Alt + Merkbuchstabe per Tastencode (Mac-Option-Zeichen egal); nicht mit Strg/⌘/Umschalt, Fangen-Tasten bleiben frei', () => {
  const alt = (code: string, more: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) =>
    altMenu({ code, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, ...more });
  expect(alt('KeyD')).toBe(top('Datei'));
  expect(alt('KeyI')).toBe(top('Bitmaps'));
  expect(alt('KeyF')).toBe(top('Fenster'));
  for (const code of ['KeyZ', 'KeyY', 'KeyQ', 'Enter']) expect(alt(code)).toBe(-1);
  expect(alt('KeyI', { ctrlKey: true })).toBe(-1);
  expect(alt('KeyD', { metaKey: true })).toBe(-1);
  expect(altMenu({ code: 'KeyD', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false })).toBe(-1);
  const keys = MENUS.map((m) => m.key);
  expect(new Set(keys).size).toBe(MENUS.length);
  for (const m of MENUS) expect(m.label.toUpperCase()).toContain(m.key);
});

test('Englisch: eigene Merkbuchstaben (File F … Window W), eindeutig, im Wort enthalten, Fangen-Tasten frei', () => {
  setLang('en');
  try {
    const alt = (code: string) => altMenu({ code, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false });
    expect(alt('KeyF')).toBe(top('Datei'));
    expect(alt('KeyE')).toBe(top('Bearbeiten'));
    expect(alt('KeyW')).toBe(top('Fenster'));
    expect(alt('KeyB')).toBe(top('Bitmaps'));
    expect(alt('KeyD')).toBe(-1);
    const keys = MENUS.map(menuKey);
    expect(new Set(keys).size).toBe(MENUS.length);
    for (const k of keys) expect(['Z', 'Y', 'Q']).not.toContain(k);
    for (const m of MENUS) expect(tr(m.label).toUpperCase()).toContain(menuKey(m));
    expect(navKey({ top: 0, path: [], keys: true }, 'e', all).nav.top).toBe(top('Bearbeiten'));
  } finally {
    setLang('de');
  }
});

test('Englisch: Buchstabe springt zum Eintrag nach seinem englischen Anfangsbuchstaben', () => {
  setLang('en');
  try {
    // Datei: New, Open …, Save, Save as …, Import …, Export … → „o“ trifft nur Open.
    const r = navKey(openTop(top('Datei')), 'o', all);
    expect(r.run).toEqual({ name: 'open' });
  } finally {
    setLang('de');
  }
});
