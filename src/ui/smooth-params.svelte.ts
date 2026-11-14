// Werte des Glätten-Werkzeugs (Eigenschaftsleiste); Shift-/Alt-Ziehen auf der Zeichenfläche schreibt Radius und Tempo zurück.
import type { SmoothParams } from './tools/smooth-tool';

export const smoothParams: SmoothParams = $state({ radius: 5, rate: 50, pressure: false });
