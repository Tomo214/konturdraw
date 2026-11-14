// Werkzeugkasten links wie Vorbild: Gruppen mit Ausklappmenü, erstes Werkzeug der Gruppe sichtbar. Texte eigen.
import type { Tool } from './shortcuts';
import { N_, tr } from '../i18n/i18n.svelte';

export interface ToolInfo {
  tool: Tool;
  label: string;
  /** Taste in Schreibweise von menus.ts; fehlt, wenn das Vorbild keine hat. */
  key?: string;
  /** Nur Anzeige, wenn die Taste kein Werkzeug-Befehl ist. */
  hint?: string;
}

export const TOOLBOX: readonly (readonly ToolInfo[])[] = [
  [
    { tool: 'select', label: N_('Auswahl'), hint: N_('Leertaste') },
    { tool: 'lasso', label: N_('Freihand-Auswahl') },
  ],
  [{ tool: 'node', label: N_('Knoten'), key: 'F10' }],
  [
    { tool: 'knife', label: N_('Messer') },
    { tool: 'piece', label: N_('Linienstück löschen') },
    { tool: 'eraser', label: N_('Radierer'), key: 'X' },
  ],
  [
    { tool: 'zoom', label: 'Zoom', key: 'Z' },
    { tool: 'hand', label: 'Hand', key: 'H' },
  ],
  [
    { tool: 'freehand', label: N_('Freihand'), key: 'F5' },
    { tool: 'pen', label: N_('Stift') },
  ],
  [{ tool: 'rect', label: N_('Rechteck'), key: 'F6' }],
  [{ tool: 'ellipse', label: 'Ellipse', key: 'F7' }],
  [{ tool: 'polygon', label: N_('Vieleck'), key: 'Y' }],
  [{ tool: 'text', label: 'Text', key: 'F8' }],
  [{ tool: 'contour', label: N_('Kontureffekt') }],
  [{ tool: 'eyedropper', label: N_('Pipette') }],
  [{ tool: 'gradient', label: N_('Verlauf'), key: 'G' }],
];

export const toolInfo = (t: Tool): ToolInfo => TOOLBOX.flat().find((i) => i.tool === t)!;
/** Anzeigename in der gewählten Sprache. */
export const toolName = (t: Tool): string => tr(toolInfo(t).label);

/** Auswahl-Werkzeuge: gleiche Eigenschaftsleiste und Formen-Befehle. */
export const isPick = (t: Tool): boolean => t === 'select' || t === 'lasso';

/** CSS-Klasse des Mauszeigers auf der Zeichenfläche; '' = Standardpfeil. */
export const toolCursor = (t: Tool): string =>
  t === 'hand' || t === 'zoom' ? t : isPick(t) || t === 'node' ? '' : t === 'eyedropper' ? 'pick' : 'draw';
