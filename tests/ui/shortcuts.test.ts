import { expect, test } from 'vitest';
import { browserKey, commandFor, keyCommand, nativeMenu, type KeyInput } from '../../src/ui/shortcuts';

const key = (k: string, mods: Partial<KeyInput> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

test('Mod = Cmd auf dem Mac, Strg unter Windows', () => {
  expect(commandFor(key('z', { metaKey: true }), true)).toEqual({ name: 'undo' });
  expect(commandFor(key('z', { ctrlKey: true }), false)).toEqual({ name: 'undo' });
  expect(commandFor(key('z', { ctrlKey: true }), true)).toBeNull();
});

test('Wiederholen mit Shift, auch wenn key großgeschrieben ankommt', () => {
  expect(commandFor(key('Z', { metaKey: true, shiftKey: true }), true)).toEqual({ name: 'redo' });
});

test('Pfeiltasten verschieben um einen Verschiebe-Schritt, mit Shift um zehn (Spec §13)', () => {
  expect(commandFor(key('ArrowLeft'), true)).toEqual({ name: 'nudge', dx: -1, dy: 0 });
  expect(commandFor(key('ArrowUp', { shiftKey: true }), true)).toEqual({ name: 'nudge', dx: 0, dy: -10 });
});

test('Mod+Pfeil verschiebt fein (ein Zehntel Schritt), Alt+Pfeil rollt die Ansicht', () => {
  expect(commandFor(key('ArrowRight', { ctrlKey: true }), false)).toEqual({ name: 'nudge', dx: 0.1, dy: 0 });
  expect(commandFor(key('ArrowDown', { altKey: true }), false)).toEqual({ name: 'scroll', dx: 0, dy: 40 });
});

test('Objekt-Befehle wie Vorbild', () => {
  const win = (k: string, mods: Partial<KeyInput> = {}) => commandFor(key(k, { ctrlKey: true, ...mods }), false)?.name;
  expect(win('d')).toBe('duplicate');
  expect(win('g')).toBe('group');
  expect(win('u')).toBe('ungroup');
  expect(win('PageUp')).toBe('forward');
  expect(win('PageDown')).toBe('backward');
  expect(commandFor(key('PageUp', { shiftKey: true }), false)?.name).toBe('front');
  expect(commandFor(key('PageDown', { shiftKey: true }), false)?.name).toBe('back');
  expect(win('x')).toBe('cut');
  expect(win('c')).toBe('copy');
  expect(win('v')).toBe('paste');
  expect(commandFor(key('Delete'), true)?.name).toBe('delete');
  expect(commandFor(key('Backspace'), true)?.name).toBe('delete');
  expect(commandFor(key('Escape'), true)?.name).toBe('deselect');
});

test('Klammern bleiben für Tastaturen ohne Bild-Tasten, auch mit Alt (deutsche Mac-Tastatur)', () => {
  const mac = (k: string, mods: Partial<KeyInput> = {}) => commandFor(key(k, { metaKey: true, ...mods }), true)?.name;
  expect(mac(']')).toBe('forward');
  expect(mac('[')).toBe('backward');
  expect(mac('}', { shiftKey: true })).toBe('front');
  expect(mac('{', { shiftKey: true })).toBe('back');
  expect(mac(']', { altKey: true })).toBe('forward');
});

test('Zoom-Befehle', () => {
  const mac = (k: string) => commandFor(key(k, { metaKey: true }), true)?.name;
  expect(mac('0')).toBe('zoomFit');
  expect(mac('1')).toBe('zoom100');
  expect(mac('2')).toBe('zoomSelection');
  expect(mac('=')).toBe('zoomIn');
  expect(mac('+')).toBe('zoomIn');
  expect(mac('-')).toBe('zoomOut');
});

test('Formen-Befehle wie Vorbild: Mod+L kombinieren, Mod+K aufbrechen, Mod+Alt+U/T/I über den Tastencode', () => {
  const mac = (k: string, mods: Partial<KeyInput> = {}) => commandFor(key(k, { metaKey: true, ...mods }), true);
  expect(mac('l')).toEqual({ name: 'shaping', op: 'combine' });
  expect(mac('k')).toEqual({ name: 'shaping', op: 'breakApart' });
  // Mac: Option verändert key (¨ † ˆ), der Tastencode bleibt
  expect(mac('Dead', { altKey: true, code: 'KeyU' })).toEqual({ name: 'shaping', op: 'weld' });
  expect(mac('†', { altKey: true, code: 'KeyT' })).toEqual({ name: 'shaping', op: 'trim' });
  expect(commandFor(key('i', { ctrlKey: true, altKey: true, code: 'KeyI' }), false)).toEqual({ name: 'shaping', op: 'intersect' });
});

test('unbekannte Taste ergibt keinen Befehl', () => {
  expect(commandFor(key('q'), true)).toBeNull();
  expect(commandFor(key('v'), true)).toBeNull();
  expect(commandFor(key('P', { shiftKey: true }), true)).toBeNull();
});

test('Ausrichten L/R/T/B/C/E/P und Verteilen mit Shift wie Vorbild', () => {
  const k = (s: string, shiftKey = false) => commandFor(key(shiftKey ? s.toUpperCase() : s, { shiftKey }), false);
  expect(k('l')).toEqual({ name: 'align', edge: 'left' });
  expect(k('r')).toEqual({ name: 'align', edge: 'right' });
  expect(k('t')).toEqual({ name: 'align', edge: 'top' });
  expect(k('b')).toEqual({ name: 'align', edge: 'bottom' });
  // C: Mitten senkrecht übereinander (gleiches X), E: waagerecht nebeneinander (gleiches Y).
  expect(k('c')).toEqual({ name: 'align', edge: 'centerX' });
  expect(k('e')).toEqual({ name: 'align', edge: 'centerY' });
  expect(k('p')).toEqual({ name: 'align', edge: 'page' });
  expect(k('l', true)).toEqual({ name: 'distribute', mode: 'left' });
  expect(k('r', true)).toEqual({ name: 'distribute', mode: 'right' });
  expect(k('t', true)).toEqual({ name: 'distribute', mode: 'top' });
  expect(k('b', true)).toEqual({ name: 'distribute', mode: 'bottom' });
  expect(k('c', true)).toEqual({ name: 'distribute', mode: 'centerX' });
  expect(k('e', true)).toEqual({ name: 'distribute', mode: 'centerY' });
  expect(commandFor(key('l', { altKey: true }), false)).toBeNull();
});

test('Andockfenster Ausrichten und Verteilen: Mod+Shift+A', () => {
  expect(commandFor(key('A', { ctrlKey: true, shiftKey: true }), false)).toEqual({ name: 'docker', id: 'align' });
  expect(commandFor(key('A', { metaKey: true, shiftKey: true }), true)).toEqual({ name: 'docker', id: 'align' });
});

test('Werkzeug-Tasten wie Vorbild (Kurzreferenz 2019), Enter bestätigt', () => {
  const tool = (k: string) => commandFor(key(k), false);
  expect(tool('F10')).toEqual({ name: 'tool', tool: 'node' });
  expect(tool('F5')).toEqual({ name: 'tool', tool: 'freehand' });
  expect(tool('F6')).toEqual({ name: 'tool', tool: 'rect' });
  expect(tool('F7')).toEqual({ name: 'tool', tool: 'ellipse' });
  expect(tool('Y')).toEqual({ name: 'tool', tool: 'polygon' });
  expect(tool('F8')).toEqual({ name: 'tool', tool: 'text' });
  expect(tool('g')).toEqual({ name: 'tool', tool: 'gradient' });
  expect(tool('h')).toEqual({ name: 'tool', tool: 'hand' });
  expect(tool('z')).toEqual({ name: 'tool', tool: 'zoom' });
  expect(tool('x')).toEqual({ name: 'tool', tool: 'eraser' });
  expect(tool('Enter')).toEqual({ name: 'confirm' });
  expect(commandFor(key('F10', { ctrlKey: true }), false)).toBeNull();
});

test('Leertaste wechselt zur Auswahl und zurück, Mod+Leertaste auch', () => {
  expect(commandFor(key(' '), false)).toEqual({ name: 'pickToggle' });
  expect(commandFor(key(' ', { ctrlKey: true }), false)).toEqual({ name: 'pickToggle' });
});

test('Datei-Befehle Mod+N/O/S/Shift+S/I/E/P', () => {
  const win = (k: string, shiftKey = false) => commandFor(key(k, { ctrlKey: true, shiftKey }), false)?.name;
  expect(win('n')).toBe('new');
  expect(win('o')).toBe('open');
  expect(win('s')).toBe('save');
  expect(win('S', true)).toBe('saveAs');
  expect(win('i')).toBe('import');
  expect(win('e')).toBe('export');
  expect(win('p')).toBe('print');
});

test('Nachzeichnen Mod+Shift+B, Andockfenster Alt+Enter und Mod+T', () => {
  expect(commandFor(key('B', { metaKey: true, shiftKey: true }), true)).toEqual({ name: 'trace' });
  expect(commandFor(key('b', { metaKey: true }), true)).toBeNull();
  expect(commandFor(key('Enter', { altKey: true }), false)).toEqual({ name: 'docker', id: 'properties' });
  expect(commandFor(key('t', { ctrlKey: true }), false)).toEqual({ name: 'docker', id: 'text' });
});

test('In Kurven Mod+Q; auf dem Mac beendet Cmd+Q, dort Cmd+Shift+O', () => {
  expect(commandFor(key('q', { ctrlKey: true }), false)).toEqual({ name: 'toCurves' });
  expect(commandFor(key('q', { metaKey: true }), true)).toBeNull();
  expect(commandFor(key('O', { metaKey: true, shiftKey: true }), true)).toEqual({ name: 'toCurves' });
  expect(commandFor(key('o', { ctrlKey: true, shiftKey: true }), false)).toEqual({ name: 'toCurves' });
});

test('Kontur in Objekt: Windows Strg+Umschalt+Q; Mac ohne Kürzel (⇧⌘Q meldet ab)', () => {
  expect(commandFor(key('Q', { ctrlKey: true, shiftKey: true }), false)).toEqual({ name: 'outline' });
  expect(commandFor(key('Q', { metaKey: true, shiftKey: true }), true)).toBeNull();
});

test('Fangen wie Vorbild: Alt+Z Objekte, Alt+Y Raster, Alt+Q aus; Umschalt+F9 Drahtmodell', () => {
  const alt = (k: string, code: string, isMac = false) => commandFor(key(k, { altKey: true, code }), isMac);
  expect(alt('z', 'KeyZ')).toEqual({ name: 'snap', what: 'objects' });
  expect(alt('y', 'KeyY')).toEqual({ name: 'snap', what: 'grid' });
  expect(alt('q', 'KeyQ')).toEqual({ name: 'snap', what: 'off' });
  // Windows mit deutscher Tastatur: key ist der Buchstabe, code die US-Lage (Z und Y vertauscht).
  expect(alt('z', 'KeyY')).toEqual({ name: 'snap', what: 'objects' });
  // Mac: Option liefert Sonderzeichen; US und deutsch gleich für Ω/¥, Q unterscheidet sich (œ / «).
  expect(alt('Ω', 'KeyY', true)).toEqual({ name: 'snap', what: 'objects' });
  expect(alt('¥', 'KeyZ', true)).toEqual({ name: 'snap', what: 'grid' });
  expect(alt('œ', 'KeyQ', true)).toEqual({ name: 'snap', what: 'off' });
  expect(alt('«', 'KeyQ', true)).toEqual({ name: 'snap', what: 'off' });
  // Ohne Alt bleibt Y das Polygon-Werkzeug, Z der Zoom.
  expect(commandFor(key('y'), false)).toEqual({ name: 'tool', tool: 'polygon' });
  expect(commandFor(key('F9', { shiftKey: true }), false)).toEqual({ name: 'show', what: 'wire' });
  expect(commandFor(key('F9'), false)).toBeNull();
});

test('Bild auf/ab ohne Zusatztaste blättert Seiten; mit Umschalt bleibt Stapelfolge', () => {
  expect(commandFor(key('PageUp'), false)).toEqual({ name: 'page', op: 'prev' });
  expect(commandFor(key('PageDown'), true)).toEqual({ name: 'page', op: 'next' });
  expect(commandFor(key('PageUp', { shiftKey: true }), false)).toEqual({ name: 'front' });
});

test('keyCommand: Felder und Dialoge behalten ihre Tasten, Mod+Leertaste wechselt trotzdem; Wiederholung schaltet nicht hin und her', () => {
  const at = (tagName: string, dialog = false) => ({ tagName, closest: (s: string) => (dialog && s === 'dialog' ? {} : null) });
  const ev = (k: string, target: object, mods: Partial<KeyInput & { repeat: boolean }> = {}) => ({ ...key(k, mods), repeat: false, ...mods, target });
  expect(keyCommand(ev('Delete', at('CANVAS')), false)).toEqual({ name: 'delete' });
  expect(keyCommand(ev('Delete', at('INPUT')), false)).toBeNull();
  expect(keyCommand(ev('Delete', at('TEXTAREA')), false)).toBeNull();
  expect(keyCommand(ev('Delete', at('SELECT')), false)).toBeNull();
  expect(keyCommand(ev('Delete', at('BUTTON', true)), false)).toBeNull();
  expect(keyCommand(ev(' ', at('TEXTAREA'), { ctrlKey: true }), false)).toEqual({ name: 'pickToggle' });
  expect(keyCommand(ev(' ', at('CANVAS'), { repeat: true }), false)).toBeNull();
  expect(keyCommand(ev('Delete', null as unknown as object), false)).toEqual({ name: 'delete' });
});

test('keyCommand: Leertaste und Eingabe drücken den Knopf mit Tastaturfokus, andere Kürzel wirken weiter', () => {
  const btn = { tagName: 'BUTTON', closest: () => null };
  const ev = (k: string) => ({ ...key(k), repeat: false, target: btn });
  expect(keyCommand(ev(' '), false)).toBeNull();
  expect(keyCommand(ev('Enter'), false)).toBeNull();
  expect(keyCommand(ev('Delete'), false)).toEqual({ name: 'delete' });
});

test('Windows: Browser-Tasten von WebView2 werden geschluckt (Neu laden verwirft das Dokument)', () => {
  for (const k of [key('F5'), key('F5', { ctrlKey: true }), key('F3'), key('F7'), key('BrowserRefresh')]) expect(browserKey(k, false)).toBe(true);
  for (const c of ['r', 'R', 'f', 'g', 'p', 's']) expect(browserKey(key(c, { ctrlKey: true, shiftKey: c === 'R' }), false)).toBe(true);
  for (const k of [key('c', { ctrlKey: true }), key('v', { ctrlKey: true }), key('r'), key('F8')]) expect(browserKey(k, false)).toBe(false);
  expect(browserKey(key('r', { metaKey: true }), true)).toBe(false);
  expect(browserKey(key('F5'), true)).toBe(false);
});

test('Windows: AltGr-Zeichen (Strg+Alt) lösen keine Befehle aus, Strg+Alt+Buchstabe schon', () => {
  for (const c of ['[', ']', '{', '}', '@', '€', '\\'])
    expect(commandFor(key(c, { ctrlKey: true, altKey: true }), false), c).toBeNull();
  expect(commandFor(key('[', { ctrlKey: true }), false)).toEqual({ name: 'backward' });
  expect(commandFor(key('u', { ctrlKey: true, altKey: true, code: 'KeyU' }), false)).toEqual({ name: 'shaping', op: 'weld' });
  expect(commandFor(key('5', { metaKey: true, altKey: true }), true)).toBeNull();
  expect(commandFor(key('[', { metaKey: true, altKey: true }), true)).toEqual({ name: 'backward' });
});

test('Kontextmenü des Browsers nur in Textfeldern', () => {
  const el = (tagName: string, type = 'text') => ({ tagName, type, isContentEditable: false });
  expect(nativeMenu(el('INPUT'))).toBe(true);
  expect(nativeMenu(el('TEXTAREA'))).toBe(true);
  expect(nativeMenu(el('INPUT', 'checkbox'))).toBe(false);
  expect(nativeMenu(el('CANVAS'))).toBe(false);
  expect(nativeMenu({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  expect(nativeMenu(null)).toBe(false);
});
