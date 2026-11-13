// Rechtsklick auf der Zeichenfläche (wie Vorbild): auf einem Objekt dessen Befehle, auf leerer Fläche Verlauf, Seite und Dokument.
import { N_ } from '../i18n/i18n.svelte';
import type { Command } from './shortcuts';

/** fit = nur zeigen, wenn der Befehl zur Auswahl passt; sonst grau stehen lassen. */
type Entry = { label: string; cmd: Command; fit?: true } | null;
export type CanvasItem = { label: string; cmd: Command; disabled: boolean };

const e = (label: string, cmd: Command, fit?: true): Entry => ({ label, cmd, fit });
const UNDO = e(N_('Rückgängig'), { name: 'undo' });
const PASTE = e(N_('Einfügen'), { name: 'paste' });

const OBJECT: readonly Entry[] = [
  UNDO,
  null,
  e(N_('Ausschneiden'), { name: 'cut' }),
  e(N_('Kopieren'), { name: 'copy' }),
  PASTE,
  e(N_('Löschen'), { name: 'delete' }),
  null,
  e(N_('Duplizieren'), { name: 'duplicate' }),
  null,
  e(N_('In Kurven umwandeln'), { name: 'toCurves' }, true),
  e(N_('Kontur in Objekt umwandeln'), { name: 'outline' }, true),
  e(N_('Kombinieren'), { name: 'shaping', op: 'combine' }, true),
  e(N_('Aufbrechen'), { name: 'shaping', op: 'breakApart' }, true),
  e(N_('Gruppieren'), { name: 'group' }, true),
  e(N_('Gruppierung aufheben'), { name: 'ungroup' }, true),
  e(N_('In Rahmen einfügen'), { name: 'frameInsert' }, true),
  e(N_('Inhalt herausnehmen'), { name: 'frameExtract' }, true),
  null,
  e(N_('Ganz nach vorn'), { name: 'front' }),
  e(N_('Ganz nach hinten'), { name: 'back' }),
  e(N_('Eine Stufe nach vorn'), { name: 'forward' }),
  e(N_('Eine Stufe nach hinten'), { name: 'backward' }),
  null,
  e(N_('Objekteigenschaften'), { name: 'docker', id: 'properties' }),
];

const PAGE: readonly Entry[] = [
  UNDO,
  e(N_('Wiederholen'), { name: 'redo' }),
  null,
  PASTE,
  null,
  e(N_('Ganze Seite'), { name: 'zoomFit' }),
  null,
  e(N_('Dokumentoptionen …'), { name: 'docOptions' }),
];

/** Einträge in Hauptmenü-Wortlaut (Übersetzung über tr); Trenner nie doppelt oder am Rand. */
export function canvasMenu(onObject: boolean, enabled: (c: Command) => boolean): (CanvasItem | null)[] {
  const out: (CanvasItem | null)[] = [];
  for (const it of onObject ? OBJECT : PAGE) {
    if (!it) {
      if (out.length && out.at(-1) !== null) out.push(null);
      continue;
    }
    const on = enabled(it.cmd);
    if (it.fit && !on) continue;
    out.push({ label: it.label, cmd: it.cmd, disabled: !on });
  }
  if (out.at(-1) === null) out.pop();
  return out;
}

/** Getroffenes Objekt wählen, außer es (oder eine Gruppenstufe darin) ist schon gewählt; leere Fläche lässt die Auswahl. */
export function selectForMenu(selected: Set<string>, hit: { topId: string; chain: readonly string[] } | null): Set<string> {
  if (!hit || hit.chain.some((id) => selected.has(id))) return selected;
  return new Set([hit.topId]);
}
