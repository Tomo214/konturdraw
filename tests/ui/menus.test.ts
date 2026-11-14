import { expect, test } from 'vitest';
import { MENUS, keyLabel, keysFor, parseKeys, type MenuEntry } from '../../src/ui/menus';
import { commandFor } from '../../src/ui/shortcuts';
import { TOOLBOX } from '../../src/ui/toolbox';
import { setLang, tr } from '../../src/i18n/i18n.svelte';

type Item = Extract<MenuEntry, { cmd: unknown }>;
const items = (list: readonly MenuEntry[]): Item[] =>
  list.flatMap((e) => (!e ? [] : 'items' in e ? items(e.items) : [e]));
const all = MENUS.flatMap((m) => items(m.items));

test('Menüleiste wie Vorbild: Datei zuerst, Fenster zuletzt', () => {
  const names = MENUS.map((m) => m.label);
  expect(names[0]).toBe('Datei');
  expect(names[1]).toBe('Bearbeiten');
  expect(names.at(-1)).toBe('Fenster');
});

test('angezeigtes Kürzel löst genau den Befehl des Menüpunkts aus (Windows und Mac)', () => {
  const checked = all.filter((it) => it.keys);
  expect(checked.length).toBeGreaterThan(25);
  for (const it of checked) {
    expect(commandFor(parseKeys(it.keys!, false), false), `${it.label} Windows`).toEqual(it.cmd);
    // macKeys '' = auf dem Mac bewusst ohne Kürzel (System belegt es)
    if (it.macKeys === '') expect(commandFor(parseKeys(it.keys!, true), true), `${it.label} Mac frei`).toBeNull();
    else expect(commandFor(parseKeys(it.macKeys ?? it.keys!, true), true), `${it.label} Mac`).toEqual(it.cmd);
  }
});

test('keine doppelten Beschriftungen innerhalb eines Menüs (Untermenü = eigenes Menü)', () => {
  const check = (label: string, list: readonly MenuEntry[]) => {
    const labels = list.flatMap((e) => (e ? [e.label] : []));
    expect(new Set(labels).size, label).toBe(labels.length);
    for (const e of list) if (e && 'items' in e) check(e.label, e.items);
  };
  for (const m of MENUS) check(m.label, m.items);
});

test('Kürzel-Beschriftung: Windows ausgeschrieben, Mac mit Symbolen', () => {
  expect(keyLabel('Mod+Shift+S', false)).toBe('Strg+Umschalt+S');
  expect(keyLabel('Mod+Shift+S', true)).toBe('⇧⌘S');
  expect(keyLabel('Shift+PageUp', false)).toBe('Umschalt+Bild↑');
  expect(keyLabel('Alt+Enter', false)).toBe('Alt+Eingabe');
  expect(keyLabel('Mod+Alt+U', true)).toBe('⌥⌘U');
  expect(keyLabel('Delete', false)).toBe('Entf');
  expect(keyLabel('F10', true)).toBe('F10');
});

test('Werkzeugkasten: jedes Werkzeug genau einmal, Taste passt zum Kürzel', () => {
  const tools = TOOLBOX.flat();
  expect(tools.map((t) => t.tool).sort()).toEqual(
    ['contour', 'ellipse', 'eraser', 'eyedropper', 'freehand', 'gradient', 'hand', 'knife', 'lasso', 'node', 'pen', 'piece', 'polygon', 'rect', 'select', 'smooth', 'text', 'zoom'],
  );
  expect(TOOLBOX[0].map((t) => t.tool)).toEqual(['select', 'lasso']);
  for (const t of tools) {
    expect(t.label).not.toBe('');
    if (t.key) expect(commandFor(parseKeys(t.key, false), false)).toEqual({ name: 'tool', tool: t.tool });
  }
});

test('Ansicht schaltet Lineale, Raster, Hilfslinien; Layout nach Ansicht öffnet die Dokumentoptionen', () => {
  const view = items(MENUS.find((m) => m.label === 'Ansicht')!.items);
  const shown = view.filter((it) => it.toggle && it.cmd.name === 'show').map((it) => it.cmd);
  expect(shown).toEqual([{ name: 'show', what: 'wire' }, { name: 'show', what: 'rulers' }, { name: 'show', what: 'grid' }, { name: 'show', what: 'guides' }]);
  const names = MENUS.map((m) => m.label);
  expect(names.indexOf('Layout')).toBe(names.indexOf('Ansicht') + 1);
  expect(items(MENUS.find((m) => m.label === 'Layout')!.items).map((it) => it.cmd)).toContainEqual({ name: 'docOptions' });
});

test('Objekt › Ausrichten und Verteilen wie Vorbild: L/R/T/B/C/E/P, Fenster Mod+Shift+A', () => {
  const obj = MENUS.find((m) => m.label === 'Objekt')!;
  const sub = obj.items.find((e) => e && 'items' in e && e.label === 'Ausrichten und Verteilen');
  const keys = items(sub && 'items' in sub ? sub.items : []).map((it) => it.keys);
  expect(keys).toEqual(expect.arrayContaining(['L', 'R', 'T', 'B', 'C', 'E', 'P', 'Mod+Shift+A']));
  expect(all.some((it) => it.cmd.name === 'mirror')).toBe(true);
});

test('Ansicht › Fangen an wie Vorbild (Objekte Alt+Z, Raster Alt+Y, Hilfslinien), Fangen aus Alt+Q, Drahtmodell Umschalt+F9', () => {
  const view = MENUS.find((m) => m.label === 'Ansicht')!.items;
  const sub = view.find((e) => e && 'items' in e && e.label === 'Fangen an');
  const snap = items(sub && 'items' in sub ? sub.items : []);
  expect(snap.map((it) => [it.cmd, it.keys, !!it.toggle])).toEqual([
    [{ name: 'snap', what: 'objects' }, 'Alt+Z', true],
    [{ name: 'snap', what: 'grid' }, 'Alt+Y', true],
    [{ name: 'snap', what: 'guides' }, undefined, true],
  ]);
  const flat = items(view);
  expect(flat.find((it) => it.label === 'Fangen aus')).toMatchObject({ cmd: { name: 'snap', what: 'off' }, keys: 'Alt+Q', toggle: true });
  expect(flat.find((it) => it.label === 'Drahtmodell')).toMatchObject({ cmd: { name: 'show', what: 'wire' }, keys: 'Shift+F9', toggle: true });
  expect(keyLabel('Shift+F9', false)).toBe('Umschalt+F9');
  expect(keyLabel('Alt+Z', true)).toBe('⌥Z');
});

test('Layout verwaltet Seiten wie Vorbild, Bild auf/ab blättert; Fenster › Andockfenster › Objekte', () => {
  const layout = items(MENUS.find((m) => m.label === 'Layout')!.items);
  const pages = layout.flatMap((it) => (it.cmd.name === 'page' ? [[it.cmd.op, it.keys]] : []));
  expect(pages).toEqual([
    ['insertBefore', undefined],
    ['insertAfter', undefined],
    ['duplicate', undefined],
    ['duplicateLayers', undefined],
    ['rename', undefined],
    ['delete', undefined],
    ['first', undefined],
    ['prev', 'PageUp'],
    ['next', 'PageDown'],
    ['last', undefined],
  ]);
  expect(layout.at(-1)?.cmd).toEqual({ name: 'docOptions' });
  const dockers = items(MENUS.at(-1)!.items);
  expect(dockers[0]).toMatchObject({ label: 'Objekte', cmd: { name: 'docker', id: 'objects' } });
});

test('Kontur in Objekt im Objekt-Menü: Windows Strg+Umschalt+Q, Mac ohne Kürzel', () => {
  const it = all.find((e) => e.label === 'Kontur in Objekt umwandeln');
  expect(it?.cmd).toEqual({ name: 'outline' });
  expect(keysFor(it!, false)).toBe('Mod+Shift+Q');
  expect(keysFor(it!, true)).toBe('');
  const curves = all.find((e) => e.label === 'In Kurven umwandeln')!;
  expect([keysFor(curves, false), keysFor(curves, true)]).toEqual(['Mod+Q', 'Mod+Shift+O']);
});

test('Fenster › Sprache · Language: Deutsch und English als Umschalter, Namen in der eigenen Sprache', () => {
  const win = MENUS.find((m) => m.label === 'Fenster')!.items;
  const sub = win.find((e) => e && 'items' in e && e.label === 'Sprache · Language');
  const langs = items(sub && 'items' in sub ? sub.items : []);
  expect(langs.map((it) => [it.label, it.cmd, !!it.toggle])).toEqual([
    ['Deutsch', { name: 'lang', lang: 'de' }, true],
    ['English', { name: 'lang', lang: 'en' }, true],
  ]);
});

test('Englisch: keine doppelten Beschriftungen innerhalb eines Menüs, jedes Wort übersetzt', () => {
  setLang('en');
  try {
    const check = (label: string, list: readonly MenuEntry[]) => {
      const labels = list.flatMap((e) => (e ? [tr(e.label)] : []));
      expect(new Set(labels).size, tr(label)).toBe(labels.length);
      for (const e of list) if (e && 'items' in e) check(e.label, e.items);
    };
    for (const m of MENUS) check(m.label, m.items);
    expect(keyLabel('Mod+Shift+S', false)).toBe('Ctrl+Shift+S');
    expect(keyLabel('Delete', false)).toBe('Del');
    expect(keyLabel('Shift+PageUp', false)).toBe('Shift+PgUp');
  } finally {
    setLang('de');
  }
});
