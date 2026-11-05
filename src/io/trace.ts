// Nachzeichnen (Spec §8): Bild → kw-core → Objekte auf eigener Ebene; das Bild bleibt liegen.
import { addLayer, addNodes, newId } from '../model/document';
import { IDENTITY, type Mat } from '../model/geometry';
import { BLACK, DEFAULT_STROKE } from '../model/style';
import type { Doc, ImageNode, Node } from '../model/types';
import * as bridge from './bridge';
import { images } from './images';

export interface TraceParams extends bridge.TraceCore {
  /** Mittellinie: Kontur in mm */
  lineWidth: number;
}

export const TRACE_DEFAULTS: TraceParams = {
  mode: 'centerline',
  threshold: 128,
  speckle: 16,
  smooth: 0.5,
  corners: 0.3,
  colors: 8,
  merge: true,
  background: 'edge',
  cutout: false,
  lineWidth: 0.5,
};

/**
 * In Seitenlage des Bilds. Umriss = ein gefüllter Pfad (sonst gehen Löcher verloren), Mittellinie = Gruppe einzelner Linien,
 * farbig = Gruppe gefüllter Flächen, unterste zuerst.
 */
export function tracedNode(pieces: readonly bridge.TracePiece[], world: Mat, p: TraceParams): Node {
  if (p.mode === 'color') {
    const children: Node[] = pieces.map((pc) => ({
      type: 'path',
      id: newId(),
      transform: IDENTITY,
      style: { fill: pc.rgb ? { model: 'rgb', values: pc.rgb } : BLACK, stroke: null },
      subpaths: pc.subpaths,
    }));
    return { type: 'group', id: newId(), transform: world, children };
  }
  const subpaths = pieces.flatMap((pc) => pc.subpaths);
  if (p.mode === 'outline') return { type: 'path', id: newId(), transform: world, style: { fill: BLACK, stroke: null }, subpaths };
  const stroke = { ...DEFAULT_STROKE, width: p.lineWidth };
  const children: Node[] = subpaths.map((sp) => ({ type: 'path', id: newId(), transform: IDENTITY, style: { fill: null, stroke }, subpaths: [sp] }));
  return { type: 'group', id: newId(), transform: world, children };
}

/** Neue oberste Ebene „Nachzeichnung“ auf Seite pi mit dem Ergebnis. */
export function addTrace(doc: Doc, node: Node, pi = 0): Doc {
  const next = addLayer(doc, pi, 'Nachzeichnung');
  const layers = next.pages[pi].layers;
  return addNodes(next, layers[layers.length - 1].id, [node]);
}

/** Rohergebnis in Bild-mm (für Vorschau und Übernehmen); leer → verständlicher Fehler. */
export async function tracePieces(img: ImageNode, p: TraceParams): Promise<bridge.TracePiece[]> {
  const { lineWidth: _, ...core } = p;
  const pieces = await bridge.traceImage(images.pick([img.image])[img.image], core, img.width, img.height);
  if (!pieces.some((pc) => pc.subpaths.length))
    throw new Error(p.mode === 'color' ? 'Nichts gefunden – Hintergrund behalten?' : 'Nichts gefunden – Schwellwert erhöhen?');
  return pieces;
}
