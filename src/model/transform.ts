// Transformationen-Fenster (Ablauf wie Vorbild): Position, Drehen, Skalieren und Spiegeln, Größe, Neigen –
// auf die Auswahl oder auf Kopien. Jede Kopie geht eine Stufe weiter (Drehen 15° × 23 Kopien = Kranz).
// Alles in Seitenkoordinaten (mm, y nach unten); Winkel gegen den Uhrzeigersinn wie die Eigenschaftsleiste.
import { measure } from './arrange';
import { duplicateNodes, transformNodes } from './document';
import { IDENTITY, about, multiply, rotate, scale, skew, translate, type Box, type Mat } from './geometry';
import type { Doc } from './types';

export const MAX_COPIES = 1000;

export type TransformKind = 'position' | 'rotate' | 'scale' | 'size' | 'skew';
/** Bezugspunkt im Auswahlrahmen: t = oben, b = unten, l = links, r = rechts, c = Mitte. */
export type Anchor = 'tl' | 't' | 'tr' | 'l' | 'c' | 'r' | 'bl' | 'b' | 'br';

/** relative: Position = Versatz, Drehen = Mitte ab Bezugspunkt; sonst Seitenkoordinaten. sx/sy in %, w/h in mm, Winkel in Grad. */
export type Transformation =
  | { kind: 'position'; x: number; y: number; relative: boolean }
  | { kind: 'rotate'; angle: number; x: number; y: number; relative: boolean }
  | { kind: 'scale'; sx: number; sy: number; mirrorH: boolean; mirrorV: boolean }
  | { kind: 'size'; w: number; h: number }
  | { kind: 'skew'; h: number; v: number };

export function anchorPoint(b: Box, a: Anchor): [number, number] {
  const x = a.endsWith('l') ? b.minX : a.endsWith('r') ? b.maxX : (b.minX + b.maxX) / 2;
  const y = a.startsWith('t') ? b.minY : a.startsWith('b') ? b.maxY : (b.minY + b.maxY) / 2;
  return [x, y];
}

const ok = (v: number) => Number.isFinite(v) && v > 0;
// Ein Maß 0 bleibt 0 (Linie ohne Höhe); sonst lässt es sich nicht auf ein anderes Maß bringen.
const factor = (to: number, from: number) => (Math.abs(to - from) < 1e-9 ? 1 : from > 1e-9 ? to / from : NaN);
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Matrix für einen Schritt; null = ungültig. */
export function transformMatrix(b: Box, t: Transformation, anchor: Anchor): Mat | null {
  const [ax, ay] = anchorPoint(b, anchor);
  switch (t.kind) {
    case 'position':
      return t.relative ? translate(t.x, t.y) : translate(t.x - ax, t.y - ay);
    case 'rotate': {
      const [cx, cy] = t.relative ? [ax + t.x, ay + t.y] : [t.x, t.y];
      // y zeigt nach unten: gegen den Uhrzeigersinn = mathematisch negativ
      return about(rotate(-rad(t.angle)), cx, cy);
    }
    case 'scale':
      if (!ok(t.sx) || !ok(t.sy)) return null;
      return about(scale((t.sx / 100) * (t.mirrorH ? -1 : 1), (t.sy / 100) * (t.mirrorV ? -1 : 1)), ax, ay);
    case 'size': {
      const [sx, sy] = [factor(t.w, b.maxX - b.minX), factor(t.h, b.maxY - b.minY)];
      return ok(sx) && ok(sy) ? about(scale(sx, sy), ax, ay) : null;
    }
    case 'skew': {
      if (!(Math.abs(t.h) < 90 && Math.abs(t.v) < 90)) return null; // 90° = flach, nicht umkehrbar
      // wie die Neigen-Felder der Eigenschaftsleiste: waagerecht kippt die Oberkante nach links, senkrecht hebt die rechte Kante
      return about(multiply(skew(0, -Math.tan(rad(t.v))), skew(Math.tan(rad(t.h)), 0)), ax, ay);
    }
  }
}

const nearIdentity = (m: Mat) => m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9);

/** copies = 0: die Auswahl selbst; sonst bleibt sie, und Kopie k bekommt den Schritt k-mal. null = nichts zu tun. */
export function transformSelection(doc: Doc, ids: readonly string[], t: Transformation, anchor: Anchor, copies: number): { doc: Doc; selected: string[] } | null {
  if (!Number.isInteger(copies) || copies < 0 || copies > MAX_COPIES) return null;
  const b = measure(doc, ids)?.box;
  const m = b && transformMatrix(b, t, anchor);
  if (!m?.every(Number.isFinite)) return null; // leeres Feld (NaN) nie in eine Matrix
  if (!copies) return nearIdentity(m) ? null : { doc: transformNodes(doc, ids, m), selected: [...ids] };
  let d = doc;
  let cur = [...ids];
  for (let k = 0; k < copies; k++) {
    const r = duplicateNodes(d, cur, 0, 0); // direkt über der vorigen Stufe
    d = transformNodes(r.doc, r.ids, m);
    cur = r.ids;
  }
  return { doc: d, selected: cur };
}
