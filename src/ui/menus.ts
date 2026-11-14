// Menüleiste im Fenster, Aufbau wie Vorbild (Datei … Fenster), Texte eigen. Kürzel in neutraler Schreibweise:
// Mod = Cmd/Strg, Tasten wie KeyboardEvent.key. menus.test.ts prüft, dass jedes Kürzel genau seinen Befehl auslöst.
import type { TransformKind } from '../model/transform';
import type { Command, KeyInput, PageOp } from './shortcuts';
import { N_, getLang, tr } from '../i18n/i18n.svelte';

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
const transform = (label: string, part: TransformKind, keys?: string) => item(label, { name: 'docker', id: 'transform', part }, keys);

/** key/enKey = Merkbuchstabe für Alt + Buchstabe je Sprache (nicht Z/Y/Q: Fangen). */
export const MENUS: readonly { label: string; key: string; enKey: string; items: readonly MenuEntry[] }[] = [
  {
    label: N_('Datei'), key: 'D', enKey: 'F',
    items: [
      item(N_('Neu'), { name: 'new' }, 'Mod+N'),
      item(N_('Öffnen …'), { name: 'open' }, 'Mod+O'),
      null,
      item(N_('Speichern'), { name: 'save' }, 'Mod+S'),
      item(N_('Speichern unter …'), { name: 'saveAs' }, 'Mod+Shift+S'),
      null,
      item(N_('Importieren …'), { name: 'import' }, 'Mod+I'),
      item(N_('Exportieren …'), { name: 'export' }, 'Mod+E'),
      null,
      item(N_('Drucken …'), { name: 'print' }, 'Mod+P'),
    ],
  },
  {
    label: N_('Bearbeiten'), key: 'B', enKey: 'E',
    items: [
      item(N_('Rückgängig'), { name: 'undo' }, 'Mod+Z'),
      item(N_('Wiederholen'), { name: 'redo' }, 'Mod+Shift+Z'),
      null,
      item(N_('Ausschneiden'), { name: 'cut' }, 'Mod+X'),
      item(N_('Kopieren'), { name: 'copy' }, 'Mod+C'),
      item(N_('Einfügen'), { name: 'paste' }, 'Mod+V'),
      item(N_('Löschen'), { name: 'delete' }, 'Delete'),
      null,
      item(N_('Duplizieren'), { name: 'duplicate' }, 'Mod+D'),
      item(N_('Alles auswählen'), { name: 'selectAll' }, 'Mod+A'),
      item(N_('Auswahl aufheben'), { name: 'deselect' }, 'Escape'),
    ],
  },
  {
    label: N_('Ansicht'), key: 'A', enKey: 'V',
    items: [
      { label: N_('Drahtmodell'), cmd: { name: 'show', what: 'wire' }, keys: 'Shift+F9', toggle: true },
      null,
      item(N_('Ganze Seite'), { name: 'zoomFit' }, 'Mod+0'),
      item(N_('Originalgröße 100 %'), { name: 'zoom100' }, 'Mod+1'),
      item(N_('Auswahl zeigen'), { name: 'zoomSelection' }, 'Mod+2'),
      item(N_('Vergrößern'), { name: 'zoomIn' }, 'Mod+='),
      item(N_('Verkleinern'), { name: 'zoomOut' }, 'Mod+-'),
      null,
      { label: N_('Farbproof'), cmd: { name: 'proof' }, toggle: true },
      null,
      { label: N_('Lineale'), cmd: { name: 'show', what: 'rulers' }, toggle: true },
      { label: N_('Raster'), cmd: { name: 'show', what: 'grid' }, toggle: true },
      { label: N_('Hilfslinien'), cmd: { name: 'show', what: 'guides' }, toggle: true },
      null,
      { label: N_('Fangen aus'), cmd: { name: 'snap', what: 'off' }, keys: 'Alt+Q', toggle: true },
      {
        label: N_('Fangen an'),
        items: [
          { label: N_('Objekte'), cmd: { name: 'snap', what: 'objects' }, keys: 'Alt+Z', toggle: true },
          { label: N_('Dokumentraster'), cmd: { name: 'snap', what: 'grid' }, keys: 'Alt+Y', toggle: true },
          { label: N_('Hilfslinien'), cmd: { name: 'snap', what: 'guides' }, toggle: true },
        ],
      },
    ],
  },
  {
    label: 'Layout', key: 'L', enKey: 'L',
    items: [
      page(N_('Seite davor einfügen'), 'insertBefore'),
      page(N_('Seite danach einfügen'), 'insertAfter'),
      { label: N_('Seite duplizieren'), items: [page(N_('Mit Inhalt'), 'duplicate'), page(N_('Nur Ebenen'), 'duplicateLayers')] },
      page(N_('Seite umbenennen'), 'rename'),
      page(N_('Seite löschen'), 'delete'),
      null,
      {
        label: N_('Gehe zu Seite'),
        items: [page(N_('Erste Seite'), 'first'), page(N_('Vorige Seite'), 'prev', 'PageUp'), page(N_('Nächste Seite'), 'next', 'PageDown'), page(N_('Letzte Seite'), 'last')],
      },
      null,
      item(N_('Dokumentoptionen …'), { name: 'docOptions' }),
    ],
  },
  {
    label: N_('Objekt'), key: 'O', enKey: 'O',
    items: [
      item(N_('Gruppieren'), { name: 'group' }, 'Mod+G'),
      item(N_('Gruppierung aufheben'), { name: 'ungroup' }, 'Mod+U'),
      null,
      shaping(N_('Kombinieren'), 'combine', 'Mod+L'),
      shaping(N_('Aufbrechen'), 'breakApart', 'Mod+K'),
      {
        label: N_('Formen'),
        items: [
          shaping(N_('Verschmelzen'), 'weld', 'Mod+Alt+U'),
          shaping(N_('Zuschneiden'), 'trim', 'Mod+Alt+T'),
          shaping(N_('Schnittmenge'), 'intersect', 'Mod+Alt+I'),
          shaping(N_('Vereinfachen'), 'simplify'),
          shaping(N_('Vorne minus hinten'), 'frontMinusBack'),
          shaping(N_('Hinten minus vorne'), 'backMinusFront'),
          shaping(N_('Umrandung'), 'boundary'),
        ],
      },
      {
        label: N_('Rahmen'),
        items: [item(N_('In Rahmen einfügen'), { name: 'frameInsert' }), item(N_('Inhalt herausnehmen'), { name: 'frameExtract' })],
      },
      item(N_('Muster aus Auswahl'), { name: 'patternFromSelection' }),
      {
        label: N_('Ausrichten und Verteilen'),
        items: [
          align(N_('Links ausrichten'), 'left', 'L'),
          align(N_('Rechts ausrichten'), 'right', 'R'),
          align(N_('Oben ausrichten'), 'top', 'T'),
          align(N_('Unten ausrichten'), 'bottom', 'B'),
          align(N_('Mitten senkrecht ausrichten'), 'centerX', 'C'),
          align(N_('Mitten waagerecht ausrichten'), 'centerY', 'E'),
          align(N_('Auf Seite zentrieren'), 'page', 'P'),
          null,
          item(N_('Ausrichten und Verteilen …'), { name: 'docker', id: 'align' }, 'Mod+Shift+A'),
        ],
      },
      {
        label: N_('Transformationen'),
        items: [
          transform(N_('Position'), 'position', 'Alt+F7'),
          transform(N_('Drehen'), 'rotate', 'Alt+F8'),
          transform(N_('Skalieren und Spiegeln'), 'scale', 'Alt+F9'),
          transform(N_('Größe'), 'size', 'Alt+F10'),
          transform(N_('Neigen'), 'skew'),
        ],
      },
      item(N_('Waagerecht spiegeln'), { name: 'mirror', axis: 'h' }),
      item(N_('Senkrecht spiegeln'), { name: 'mirror', axis: 'v' }),
      {
        label: N_('Reihenfolge'),
        items: [
          item(N_('Ganz nach vorn'), { name: 'front' }, 'Shift+PageUp'),
          item(N_('Ganz nach hinten'), { name: 'back' }, 'Shift+PageDown'),
          item(N_('Eine Stufe nach vorn'), { name: 'forward' }, 'Mod+PageUp'),
          item(N_('Eine Stufe nach hinten'), { name: 'backward' }, 'Mod+PageDown'),
        ],
      },
      null,
      item(N_('In Kurven umwandeln'), { name: 'toCurves' }, 'Mod+Q', 'Mod+Shift+O'),
      item(N_('Kontur in Objekt umwandeln'), { name: 'outline' }, 'Mod+Shift+Q', ''),
      null,
      item(N_('Objekteigenschaften'), { name: 'docker', id: 'properties' }, 'Alt+Enter'),
    ],
  },
  {
    label: 'Bitmaps', key: 'I', enKey: 'B',
    items: [
      item(N_('Nachzeichnen'), { name: 'trace' }, 'Mod+Shift+B'),
      item(N_('Nachzeichnen-Fenster'), { name: 'docker', id: 'trace' }),
    ],
  },
  { label: 'Text', key: 'T', enKey: 'T', items: [item(N_('Text-Eigenschaften'), { name: 'docker', id: 'text' }, 'Mod+T')] },
  {
    label: N_('Fenster'), key: 'F', enKey: 'W',
    items: [
      {
        label: N_('Andockfenster'),
        items: [
          item(N_('Objekte'), { name: 'docker', id: 'objects' }),
          item(N_('Eigenschaften'), { name: 'docker', id: 'properties' }, 'Alt+Enter'),
          item('Text', { name: 'docker', id: 'text' }, 'Mod+T'),
          item(N_('Nachzeichnen'), { name: 'docker', id: 'trace' }),
          item(N_('Farbeinstellungen'), { name: 'docker', id: 'color' }),
          item(N_('Ausrichten und Verteilen'), { name: 'docker', id: 'align' }, 'Mod+Shift+A'),
          item(N_('Transformationen'), { name: 'docker', id: 'transform' }),
        ],
      },
      null,
      {
        // Sprachnamen bleiben in der eigenen Sprache, damit man zurückfindet.
        label: 'Sprache · Language',
        items: [
          { label: 'Deutsch', cmd: { name: 'lang', lang: 'de' }, toggle: true },
          { label: 'English', cmd: { name: 'lang', lang: 'en' }, toggle: true },
        ],
      },
    ],
  },
];

export const menuKey = (m: { key: string; enKey: string }): string => (getLang() === 'en' ? m.enKey : m.key);

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
  Mod: N_('Strg'), Shift: N_('Umschalt'), PageUp: N_('Bild↑'), PageDown: N_('Bild↓'), Enter: N_('Eingabe'), Delete: N_('Entf'), Escape: 'Esc', Space: N_('Leertaste'),
};
const MAC: Record<string, string> = {
  Alt: '⌥', Shift: '⇧', Mod: '⌘', PageUp: '⇞', PageDown: '⇟', Enter: '↩', Delete: '⌦', Escape: '⎋', Space: N_('Leertaste'),
};

/** Anzeige im Menü: Windows „Strg+Umschalt+S“, Mac „⇧⌘S“ (Reihenfolge ⌥⇧⌘ wie im System). */
export function keyLabel(spec: string, isMac: boolean): string {
  const parts = spec.split('+');
  const name = parts.pop()!;
  const named = (isMac ? MAC : WIN)[name];
  const key = named ? tr(named) : name.toUpperCase();
  if (!isMac) return [...parts.map((p) => (WIN[p] ? tr(WIN[p]) : p)), key].join('+');
  return ['Alt', 'Shift', 'Mod'].filter((m) => parts.includes(m)).map((m) => MAC[m]).join('') + key;
}
