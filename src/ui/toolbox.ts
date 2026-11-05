// Werkzeugkasten links wie Vorbild: Gruppen mit Ausklappmenü, erstes Werkzeug der Gruppe sichtbar. Texte eigen.
import type { Tool } from './shortcuts';

export interface ToolInfo {
  tool: Tool;
  label: string;
  /** Taste in Schreibweise von menus.ts; fehlt, wenn das Vorbild keine hat. */
  key?: string;
  /** Nur Anzeige, wenn die Taste kein Werkzeug-Befehl ist. */
  hint?: string;
}

export const TOOLBOX: readonly (readonly ToolInfo[])[] = [
  [{ tool: 'select', label: 'Auswahl', hint: 'Leertaste' }],
  [{ tool: 'node', label: 'Knoten', key: 'F10' }],
  [
    { tool: 'knife', label: 'Messer' },
    { tool: 'eraser', label: 'Radierer', key: 'X' },
  ],
  [
    { tool: 'zoom', label: 'Zoom', key: 'Z' },
    { tool: 'hand', label: 'Hand', key: 'H' },
  ],
  [
    { tool: 'freehand', label: 'Freihand', key: 'F5' },
    { tool: 'pen', label: 'Stift' },
  ],
  [{ tool: 'rect', label: 'Rechteck', key: 'F6' }],
  [{ tool: 'ellipse', label: 'Ellipse', key: 'F7' }],
  [{ tool: 'polygon', label: 'Vieleck', key: 'Y' }],
  [{ tool: 'text', label: 'Text', key: 'F8' }],
  [{ tool: 'eyedropper', label: 'Pipette' }],
  [{ tool: 'gradient', label: 'Verlauf', key: 'G' }],
];

export const toolInfo = (t: Tool): ToolInfo => TOOLBOX.flat().find((i) => i.tool === t)!;

/** CSS-Klasse des Mauszeigers auf der Zeichenfläche; '' = Standardpfeil. */
export const toolCursor = (t: Tool): string =>
  t === 'hand' || t === 'zoom' ? t : t === 'select' || t === 'node' ? '' : t === 'eyedropper' ? 'pick' : 'draw';
