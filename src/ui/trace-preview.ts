// Nachzeichnen-Vorschau: SVG-Pfade, Ergebniszeile und Zwischenspeicher-Schlüssel – rein, ohne DOM.
import type { TracePiece } from '../io/bridge';
import type { TraceParams } from '../io/trace';
import { segmentsOf } from '../model/bezier';
import type { Subpath } from '../model/types';

const n = (v: number) => +v.toFixed(3);

export function pathData(subpaths: readonly Subpath[]): string {
  return subpaths
    .map((sp) => {
      if (!sp.nodes.length) return '';
      let d = `M${n(sp.nodes[0].x)} ${n(sp.nodes[0].y)}`;
      for (const seg of segmentsOf(sp)) {
        const [, c1, c2, q] = seg.c;
        if (seg.line && sp.closed && seg.b === 0) break; // Z schließt mit einer Geraden
        d += seg.line ? `L${n(q.x)} ${n(q.y)}` : `C${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(q.x)} ${n(q.y)}`;
      }
      return sp.closed ? `${d}Z` : d;
    })
    .join('');
}

export function traceStats(pieces: readonly TracePiece[]): { curves: number; nodes: number; colors: number } {
  const subpaths = pieces.flatMap((pc) => pc.subpaths);
  const colors = new Set(pieces.map((pc) => (pc.rgb ? pc.rgb.join() : 'schwarz'))).size;
  return { curves: subpaths.length, nodes: subpaths.reduce((s, sp) => s + sp.nodes.length, 0), colors };
}

/** Gleicher Schlüssel = gleiches Ergebnis; die Linienstärke wirkt erst beim Übernehmen. */
export function previewKey(image: string, p: TraceParams): string {
  const { lineWidth: _, ...core } = p;
  return JSON.stringify([image, core]);
}
