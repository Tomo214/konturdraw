// Menüleiste im Fenster, Aufbau wie Vorbild (Datei … Fenster), Texte eigen. Kürzel in neutraler Schreibweise:
// Mod = Cmd/Strg, Tasten wie KeyboardEvent.key. menus.test.ts prüft, dass jedes Kürzel genau seinen Befehl auslöst.
import type { Command, KeyInput, PageOp } from './shortcuts';

export type MenuEntry =
  | { label: string; cmd: Command; keys?: string; macKeys?: string; toggle?: boolean }
  | { label: string; items: readonly MenuEntry[] }
  | null;

const item = (label: string, cmd: Command, keys?: string, macKeys?: string): MenuEntry => ({ label, cmd, keys, macKeys });

/** Angezeigtes Kürzel; macKeys '' = auf dem Mac bewusst keins (System belegt es). */
export const keysFor = (e: { keys?: string; macKeys?: string }, mac: boolean): string => (mac && e.macKeys !== undefined ? e.macKeys : e.keys) ?? '';
const shaping = (label: string, op: Extract<Command, { name: 'shaping' }>['op'], keys?: string) => item(label, { name: 'shaping', op }, keys);
const page = (label: string, op: PageOp, keys?: string) => item(label, { name: 'page', op }, keys);
const align = (label: string, edge: Extract<Command, { name: 'align' }>['edge'], keys: string) => item(label, { name: 'align', edge }, keys);

/** key = Merkbuchstabe für Alt + Buchstabe (nicht Z/Y/Q: Fangen). */
export const MENUS: readonly { label: string; key: string; items: readonly MenuEntry[] }[] = [
  {
    label: 'Datei', key: 'D',
    items: [
      item('Neu', { name: 'new' }, 'Mod+N'),
      item('Öffnen …', { name: 'open' }, 'Mod+O'),
      null,
      item('Speichern', { name: 'save' }, 'Mod+S'),
      item('Speichern unter …', { name: 'saveAs' }, 'Mod+Shift+S'),
      null,
      item('Importieren …', { name: 'import' }, 'Mod+I'),
      item('Exportieren …', { name: 'export' }, 'Mod+E'),
      null,
      item('Drucken …', { name: 'print' }, 'Mod+P'),
    ],
  },
  {
    label: 'Bearbeiten', key: 'B',
    items: [
      item('Rückgängig', { name: 'undo' }, 'Mod+Z'),
      item('Wiederholen', { name: 'redo' }, 'Mod+Shift+Z'),
      null,
      item('Ausschneiden', { name: 'cut' }, 'Mod+X'),
      item('Kopieren', { name: 'copy' }, 'Mod+C'),
      item('Einfügen', { name: 'paste' }, 'Mod+V'),
      item('Löschen', { name: 'delete' }, 'Delete'),
      null,
      item('Duplizieren', { name: 'duplicate' }, 'Mod+D'),
      item('Auswahl aufheben', { name: 'deselect' }, 'Escape'),
    ],
  },
  {
    label: 'Ansicht', key: 'A',
    items: [
      { label: 'Drahtmodell', cmd: { name: 'show', what: 'wire' }, keys: 'Shift+F9', toggle: true },
      null,
      item('Ganze Seite', { name: 'zoomFit' }, 'Mod+0'),
      item('Originalgröße 100 %', { name: 'zoom100' }, 'Mod+1'),
      item('Auswahl zeigen', { name: 'zoomSelection' }, 'Mod+2'),
      item('Vergrößern', { name: 'zoomIn' }, 'Mod+='),
      item('Verkleinern', { name: 'zoomOut' }, 'Mod+-'),
      null,
      { label: 'Farbproof', cmd: { name: 'proof' }, toggle: true },
      null,
      { label: 'Lineale', cmd: { name: 'show', what: 'rulers' }, toggle: true },
      { label: 'Raster', cmd: { name: 'show', what: 'grid' }, toggle: true },
      { label: 'Hilfslinien', cmd: { name: 'show', what: 'guides' }, toggle: true },
      null,
      { label: 'Fangen aus', cmd: { name: 'snap', what: 'off' }, keys: 'Alt+Q', toggle: true },
      {
        label: 'Fangen an',
        items: [
          { label: 'Objekte', cmd: { name: 'snap', what: 'objects' }, keys: 'Alt+Z', toggle: true },
          { label: 'Dokumentraster', cmd: { name: 'snap', what: 'grid' }, keys: 'Alt+Y', toggle: true },
          { label: 'Hilfslinien', cmd: { name: 'snap', what: 'guides' }, toggle: true },
        ],
      },
    ],
  },
  {
    label: 'Layout', key: 'L',
    items: [
      page('Seite davor einfügen', 'insertBefore'),
      page('Seite danach einfügen', 'insertAfter'),
      { label: 'Seite duplizieren', items: [page('Mit Inhalt', 'duplicate'), page('Nur Ebenen', 'duplicateLayers')] },
      page('Seite umbenennen', 'rename'),
      page('Seite löschen', 'delete'),
      null,
      {
        label: 'Gehe zu Seite',
        items: [page('Erste Seite', 'first'), page('Vorige Seite', 'prev', 'PageUp'), page('Nächste Seite', 'next', 'PageDown'), page('Letzte Seite', 'last')],
      },
      null,
      item('Dokumentoptionen …', { name: 'docOptions' }),
    ],
  },
  {
    label: 'Objekt', key: 'O',
    items: [
      item('Gruppieren', { name: 'group' }, 'Mod+G'),
      item('Gruppierung aufheben', { name: 'ungroup' }, 'Mod+U'),
      null,
      shaping('Kombinieren', 'combine', 'Mod+L'),
      shaping('Aufbrechen', 'breakApart', 'Mod+K'),
      {
        label: 'Formen',
        items: [
          shaping('Verschmelzen', 'weld', 'Mod+Alt+U'),
          shaping('Zuschneiden', 'trim', 'Mod+Alt+T'),
          shaping('Schnittmenge', 'intersect', 'Mod+Alt+I'),
          shaping('Vereinfachen', 'simplify'),
          shaping('Vorne minus hinten', 'frontMinusBack'),
          shaping('Hinten minus vorne', 'backMinusFront'),
          shaping('Umrandung', 'boundary'),
        ],
      },
      {
        label: 'Rahmen',
        items: [item('In Rahmen einfügen', { name: 'frameInsert' }), item('Inhalt herausnehmen', { name: 'frameExtract' })],
      },
      item('Muster aus Auswahl', { name: 'patternFromSelection' }),
      {
        label: 'Ausrichten und Verteilen',
        items: [
          align('Links ausrichten', 'left', 'L'),
          align('Rechts ausrichten', 'right', 'R'),
          align('Oben ausrichten', 'top', 'T'),
          align('Unten ausrichten', 'bottom', 'B'),
          align('Mitten senkrecht ausrichten', 'centerX', 'C'),
          align('Mitten waagerecht ausrichten', 'centerY', 'E'),
          align('Auf Seite zentrieren', 'page', 'P'),
          null,
          item('Ausrichten und Verteilen …', { name: 'docker', id: 'align' }, 'Mod+Shift+A'),
        ],
      },
      item('Waagerecht spiegeln', { name: 'mirror', axis: 'h' }),
      item('Senkrecht spiegeln', { name: 'mirror', axis: 'v' }),
      {
        label: 'Reihenfolge',
        items: [
          item('Ganz nach vorn', { name: 'front' }, 'Shift+PageUp'),
          item('Ganz nach hinten', { name: 'back' }, 'Shift+PageDown'),
          item('Eine Stufe nach vorn', { name: 'forward' }, 'Mod+PageUp'),
          item('Eine Stufe nach hinten', { name: 'backward' }, 'Mod+PageDown'),
        ],
      },
      null,
      item('In Kurven umwandeln', { name: 'toCurves' }, 'Mod+Q', 'Mod+Shift+O'),
      item('Kontur in Objekt umwandeln', { name: 'outline' }, 'Mod+Shift+Q', ''),
      null,
      item('Objekteigenschaften', { name: 'docker', id: 'properties' }, 'Alt+Enter'),
    ],
  },
  {
    label: 'Bitmaps', key: 'I',
    items: [
      item('Nachzeichnen', { name: 'trace' }, 'Mod+Shift+B'),
      item('Nachzeichnen-Fenster', { name: 'docker', id: 'trace' }),
    ],
  },
  { label: 'Text', key: 'T', items: [item('Text-Eigenschaften', { name: 'docker', id: 'text' }, 'Mod+T')] },
  {
    label: 'Fenster', key: 'F',
    items: [
      {
        label: 'Andockfenster',
        items: [
          item('Objekte', { name: 'docker', id: 'objects' }),
          item('Eigenschaften', { name: 'docker', id: 'properties' }, 'Alt+Enter'),
          item('Text', { name: 'docker', id: 'text' }, 'Mod+T'),
          item('Nachzeichnen', { name: 'docker', id: 'trace' }),
          item('Farbeinstellungen', { name: 'docker', id: 'color' }),
          item('Ausrichten und Verteilen', { name: 'docker', id: 'align' }, 'Mod+Shift+A'),
        ],
      },
    ],
  },
];

const SPECIAL: Record<string, string> = { Space: ' ' };

/** Kürzel-Text → Tastendruck, wie ihn der Browser meldet. */
export function parseKeys(spec: string, isMac: boolean): KeyInput {
  const parts = spec.split('+');
  // „Mod+=“ und „Mod+-“: die Taste ist der letzte Teil, auch wenn er leer ist („Mod++“ gibt es nicht).
  const name = parts.pop()!;
  const has = (m: string) => parts.includes(m);
  const shiftKey = has('Shift');
  const key = SPECIAL[name] ?? (name.length === 1 ? (shiftKey ? name.toUpperCase() : name.toLowerCase()) : name);
  const code = /^[a-z]$/i.test(name) ? `Key${name.toUpperCase()}` : /^\d$/.test(name) ? `Digit${name}` : undefined;
  return {
    key,
    code,
    shiftKey,
    altKey: has('Alt'),
    metaKey: isMac && has('Mod'),
    ctrlKey: !isMac && has('Mod'),
  };
}

const WIN: Record<string, string> = {
  Mod: 'Strg', Shift: 'Umschalt', PageUp: 'Bild↑', PageDown: 'Bild↓', Enter: 'Eingabe', Delete: 'Entf', Escape: 'Esc', Space: 'Leertaste',
};
const MAC: Record<string, string> = {
  Alt: '⌥', Shift: '⇧', Mod: '⌘', PageUp: '⇞', PageDown: '⇟', Enter: '↩', Delete: '⌦', Escape: '⎋', Space: 'Leertaste',
};

/** Anzeige im Menü: Windows „Strg+Umschalt+S“, Mac „⇧⌘S“ (Reihenfolge ⌥⇧⌘ wie im System). */
export function keyLabel(spec: string, isMac: boolean): string {
  const parts = spec.split('+');
  const name = parts.pop()!;
  const key = (isMac ? MAC : WIN)[name] ?? name.toUpperCase();
  if (!isMac) return [...parts.map((p) => WIN[p] ?? p), key].join('+');
  return ['Alt', 'Shift', 'Mod'].filter((m) => parts.includes(m)).map((m) => MAC[m]).join('') + key;
}
