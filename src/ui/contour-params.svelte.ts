// Werte des Kontur-Werkzeugs (Eigenschaftsleiste); Ziehen auf der Zeichenfläche schreibt Richtung und Schritte zurück.
import type { ContourParams } from '../model/contour';

export const contourParams: ContourParams = $state({ direction: 'outside', steps: 1, offset: 2, join: 'round' });
