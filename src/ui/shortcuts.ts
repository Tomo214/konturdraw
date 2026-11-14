// Tastenbelegung wie Vorbild (Spec §13, Quelle: öffentliche Kurzreferenz 2019). Mod = Cmd (macOS) / Strg (Windows).
import type { AlignEdge, AlignTo, DistributeMode, DistributeTo, Field } from '../model/arrange';
import type { ShapingName } from '../model/shaping';
import type { Anchor, Transformation, TransformKind } from '../model/transform';
import type { Guide, Point } from '../model/types';
import type { Unit } from '../model/units';
import type { Lang } from '../i18n/i18n.svelte';

export type DockerId = 'objects' | 'properties' | 'text' | 'trace' | 'color' | 'align' | 'transform';
/** Ansicht-Schalter, nicht im Dokument gespeichert; wire = Drahtmodell. */
export type Shown = 'rulers' | 'grid' | 'guides' | 'wire';
/** Fang-Schalter wie Vorbild; off schaltet alles ab, ohne die Auswahl zu vergessen. */
export type SnapMode = 'objects' | 'grid' | 'guides' | 'off';

export type Command =
  | {
      name:
        | 'undo' | 'redo' | 'delete' | 'duplicate' | 'duplicateHere' | 'group' | 'ungroup'
        | 'forward' | 'backward' | 'front' | 'back' | 'cut' | 'copy' | 'paste' | 'deselect'
        | 'zoomFit' | 'zoom100' | 'zoomSelection' | 'zoomIn' | 'zoomOut' | 'toCurves' | 'outline' | 'trace' | 'print'
        | 'new' | 'open' | 'save' | 'saveAs' | 'import' | 'export' | 'pickToggle' | 'proof' | 'docOptions'
        | 'frameInsert' | 'frameExtract' | 'patternFromSelection';
    }
  /** dx/dy in Verschiebe-Schritten des Dokuments. */
  | { name: 'nudge'; dx: number; dy: number }
  | { name: 'align'; edge: AlignEdge; to?: AlignTo }
  | { name: 'distribute'; mode: DistributeMode; to?: DistributeTo }
  | { name: 'mirror'; axis: 'h' | 'v' }
  | { name: 'field'; field: Field; value: number; locked: boolean }
  | { name: 'pageSize'; width: number; height: number }
  | { name: 'settings'; units?: Unit; nudge?: number }
  | { name: 'scroll'; dx: number; dy: number }
  | { name: 'tool'; tool: Tool }
  | { name: 'shaping'; op: ShapingName }
  /** part wählt den Teil im Transformationen-Fenster (Alt+F7 … Alt+F10). */
  | { name: 'docker'; id: DockerId; part?: TransformKind }
  | { name: 'transform'; t: Transformation; anchor: Anchor; copies: number }
  /** Seiten wie Vorbild (Menü Layout, Seitenleiste, Bild↑/Bild↓); rename öffnet das Namensfeld im Reiter. */
  | { name: 'page'; op: PageOp }
  /** Hilfslinien, Nullpunkt, Raster in Seiten-mm; at: null = Nullpunkt zurück auf unten links. */
  | { name: 'addGuide'; axis: Guide['axis']; pos: number }
  | { name: 'guide'; id: string; pos?: number; locked?: boolean }
  | { name: 'origin'; at: Point | null }
  | { name: 'grid'; x: number; y: number }
  | { name: 'show'; what: Shown }
  | { name: 'snap'; what: SnapMode }
  | { name: 'lang'; lang: Lang }
  | { name: 'confirm' };

export type PageOp =
  | 'insertAfter' | 'insertBefore' | 'duplicate' | 'duplicateLayers' | 'delete' | 'rename' | 'first' | 'prev' | 'next' | 'last';

export type Tool =
  | 'select' | 'lasso' | 'node' | 'pen' | 'freehand' | 'rect' | 'ellipse' | 'polygon' | 'gradient' | 'text' | 'hand' | 'zoom'
  | 'knife' | 'eraser' | 'eyedropper' | 'contour';

// Stift, Messer und Pipette haben im Vorbild keine Taste, Auswahl kommt über die Leertaste.
const TOOLS: Record<string, Tool> = {
  F10: 'node', F5: 'freehand', F6: 'rect', F7: 'ellipse', y: 'polygon', F8: 'text', g: 'gradient', h: 'hand', z: 'zoom', x: 'eraser',
};

export interface KeyInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** Physische Taste; zählt bei Alt (Option verändert key auf dem Mac: ¨ † ˆ) und für den Ziffernblock. */
  code?: string;
}

const ALT_SHAPING: Record<string, ShapingName> = { KeyU: 'weld', KeyT: 'trim', KeyI: 'intersect' };

const ALT_SNAP: Record<string, SnapMode> = { z: 'objects', y: 'grid', q: 'off' };
// Option-Zeichen auf dem Mac (US und deutsch); code allein vertauscht Z/Y auf deutschen Tastaturen.
const OPTION: Record<string, string> = { 'Ω': 'z', '¥': 'y', 'œ': 'q', '«': 'q' };
const altLetter = (e: KeyInput) =>
  /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : (OPTION[e.key] ?? e.code?.replace(/^Key/, '').toLowerCase() ?? '');

// Transformationen-Fenster wie Vorbild; die F-Tasten ohne Alt bleiben Werkzeuge.
const TRANSFORM: Record<string, TransformKind> = { F7: 'position', F8: 'rotate', F9: 'scale', F10: 'size' };

// Ausrichten ohne Mod; mit Shift verteilen (P hat kein Verteilen).
const ALIGN: Record<string, AlignEdge> = { l: 'left', r: 'right', t: 'top', b: 'bottom', c: 'centerX', e: 'centerY', p: 'page' };

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Alt+Pfeil rollt die Ansicht um so viele Bildschirmpixel. */
const SCROLL_PX = 40;

export function commandFor(e: KeyInput, isMac: boolean): Command | null {
  // Windows meldet AltGr als Strg+Alt: AltGr+8 tippt „[“ und ist kein Strg+[.
  if (!isMac && e.ctrlKey && e.altKey && e.key.length === 1 && !/[a-z0-9]/i.test(e.key)) return null;
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  const arrow = ARROWS[e.key];
  if (!mod) {
    if (e.metaKey || e.ctrlKey) return null;
    if (arrow && e.altKey) return { name: 'scroll', dx: arrow[0] * SCROLL_PX, dy: arrow[1] * SCROLL_PX };
    if (arrow) {
      const step = e.shiftKey ? 10 : 1;
      return { name: 'nudge', dx: arrow[0] * step, dy: arrow[1] * step };
    }
    if (e.key === 'Delete' || e.key === 'Backspace') return { name: 'delete' };
    if (e.code === 'NumpadAdd') return { name: 'duplicateHere' };
    if (e.key === 'Escape') return { name: 'deselect' };
    if (e.key === 'Enter') return e.altKey ? { name: 'docker', id: 'properties' } : { name: 'confirm' };
    if (e.key === ' ') return { name: 'pickToggle' };
    if (e.shiftKey && e.key === 'PageUp') return { name: 'front' };
    if (e.shiftKey && e.key === 'PageDown') return { name: 'back' };
    if (!e.altKey && (e.key === 'PageUp' || e.key === 'PageDown')) return { name: 'page', op: e.key === 'PageUp' ? 'prev' : 'next' };
    if (e.shiftKey && e.key === 'F9') return { name: 'show', what: 'wire' };
    const part = e.altKey && !e.shiftKey ? TRANSFORM[e.key] : undefined;
    if (part) return { name: 'docker', id: 'transform', part };
    const snap = e.altKey && !e.shiftKey ? ALT_SNAP[altLetter(e)] : undefined;
    if (snap) return { name: 'snap', what: snap };
    const edge = e.altKey ? undefined : ALIGN[e.key.toLowerCase()];
    if (edge && !e.shiftKey) return { name: 'align', edge };
    if (edge && edge !== 'page') return { name: 'distribute', mode: edge };
    const tool = e.altKey ? undefined : TOOLS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    return tool ? { name: 'tool', tool } : null;
  }
  if (arrow) return { name: 'nudge', dx: arrow[0] * 0.1, dy: arrow[1] * 0.1 };
  const op = e.altKey ? ALT_SHAPING[e.code ?? ''] : undefined;
  if (op) return { name: 'shaping', op };
  // Alt wird bei Klammern ignoriert: deutsche Mac-Tastatur tippt [ ] mit Alt.
  switch (e.key.toLowerCase()) {
    case 'z': return { name: e.shiftKey ? 'redo' : 'undo' };
    case 'd': return { name: 'duplicate' };
    case 'g': return { name: 'group' };
    case 'u': return { name: 'ungroup' };
    case 'pageup': case ']': case '}': return { name: e.shiftKey ? 'front' : 'forward' };
    case 'pagedown': case '[': case '{': return { name: e.shiftKey ? 'back' : 'backward' };
    case 'x': return { name: 'cut' };
    case 'c': return { name: 'copy' };
    case 'v': return { name: 'paste' };
    case '0': return { name: 'zoomFit' };
    case '1': return { name: 'zoom100' };
    case '2': return { name: 'zoomSelection' };
    case '=': case '+': return { name: 'zoomIn' };
    case '-': return { name: 'zoomOut' };
    // Cmd+Q beendet auf dem Mac die App; dort gilt Cmd+Shift+O.
    // Mac: ⌘Q beendet, ⇧⌘Q meldet ab → beide nur im Menü bzw. über ⇧⌘O
    case 'q': return isMac ? null : { name: e.shiftKey ? 'outline' : 'toCurves' };
    case 'o': return { name: e.shiftKey ? 'toCurves' : 'open' };
    case 'b': return e.shiftKey ? { name: 'trace' } : null;
    case 'n': return { name: 'new' };
    case 's': return { name: e.shiftKey ? 'saveAs' : 'save' };
    case 'i': return { name: 'import' };
    case 'a': return e.shiftKey ? { name: 'docker', id: 'align' } : null;
    case 'e': return { name: 'export' };
    case 'p': return { name: 'print' };
    case 't': return { name: 'docker', id: 'text' };
    case 'l': return { name: 'shaping', op: 'combine' };
    case 'k': return { name: 'shaping', op: 'breakApart' };
    case ' ': return { name: 'pickToggle' };
  }
  return null;
}

const BROWSER_KEYS = ['F3', 'F5', 'F7', 'BrowserRefresh', 'BrowserSearch', 'BrowserBack', 'BrowserForward'];

/** WebView2 (Windows) hat eigene Browser-Tasten: Neu laden verwirft das Dokument, dazu Suchen, Drucken, Seite speichern, Caret-Browsing. Auch in Feldern schlucken. */
export function browserKey(e: KeyInput, isMac: boolean): boolean {
  if (isMac) return false;
  return BROWSER_KEYS.includes(e.key) || (e.ctrlKey && !e.altKey && ['r', 'f', 'g', 'p', 's'].includes(e.key.toLowerCase()));
}

/** Browser-Kontextmenü (Neu laden, Drucken …) nur, wo es Kopieren/Einfügen bringt: Textfelder. */
export function nativeMenu(t: { tagName?: string; type?: string; isContentEditable?: boolean } | null): boolean {
  if (!t) return false;
  if (t.tagName === 'TEXTAREA' || t.isContentEditable) return true;
  return t.tagName === 'INPUT' && ['text', 'search', 'number', 'email', 'url', ''].includes(t.type ?? '');
}

/** Wie commandFor; Felder und Dialoge behalten ihre Tasten (auch das versteckte Textfeld des Text-Werkzeugs), Mod+Leertaste wechselt trotzdem.
 *  popover = Farbwähler offen: zählt wie ein Dialog, Esc schließt nur ihn (Fokus kann außerhalb stehen). */
export function keyCommand(e: KeyInput & { repeat: boolean; target: unknown }, isMac: boolean, popover = false): Command | null {
  const cmd = commandFor(e, isMac);
  if (!cmd || (e.repeat && cmd.name === 'pickToggle')) return null;
  const t = e.target as { tagName?: string; closest?: (s: string) => unknown } | null;
  const field = popover || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t?.tagName ?? '') || !!t?.closest?.('dialog');
  const swap = cmd.name === 'pickToggle' && (e.ctrlKey || e.metaKey);
  // ein Knopf mit Tastaturfokus wird mit Leertaste/Eingabe gedrückt; alle anderen Kürzel wirken weiter
  const press = t?.tagName === 'BUTTON' && (cmd.name === 'confirm' || cmd.name === 'pickToggle');
  return (field || press) && !swap ? null : cmd;
}
