import type { ImageNode, LeafNode, PathPoint, Shape, Subpath } from './types';

// Viertelkreis als kubische Bézierkurve: Anfasserlänge = KAPPA · Radius (Fehler < 0,03 %).
const KAPPA = (4 / 3) * (Math.SQRT2 - 1);

const cache = new WeakMap<Shape, readonly Subpath[]>();

/** Form → Bézier-Teilpfade (gleiche Form = dasselbe Array, damit Render-Caches greifen). */
export function shapeSubpaths(s: Shape): readonly Subpath[] {
  let sps = cache.get(s);
  if (!sps) {
    sps = [{ closed: true, nodes: s.kind === 'rect' ? rect(s) : s.kind === 'ellipse' ? ellipse(s) : polygon(s) }];
    cache.set(s, sps);
  }
  return sps;
}

// Bildgröße ändert sich nach dem Import nie → je Größe ein Rechteck reicht.
const imageRects = new Map<string, readonly Subpath[]>();

/** Zeichenbare Geometrie eines Blatts (Bild: sein Rechteck). */
export function geometry(n: LeafNode | ImageNode): readonly Subpath[] {
  if (n.type === 'path') return n.subpaths;
  if (n.type === 'shape') return shapeSubpaths(n.shape);
  if (n.type === 'text') return n.outline;
  const key = `${n.width}x${n.height}`;
  let sps = imageRects.get(key);
  if (!sps) {
    sps = [{ closed: true, nodes: [corner(0, 0), corner(n.width, 0), corner(n.width, n.height), corner(0, n.height)] }];
    imageRects.set(key, sps);
  }
  return sps;
}

const corner = (x: number, y: number): PathPoint => ({ x, y, type: 'corner' });

function rect({ x, y, width: w, height: h, radius }: Extract<Shape, { kind: 'rect' }>): PathPoint[] {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r === 0) return [corner(x, y), corner(x + w, y), corner(x + w, y + h), corner(x, y + h)];
  const k = KAPPA * r;
  const n = (px: number, py: number, hin?: [number, number], hout?: [number, number]): PathPoint => ({
    x: px,
    y: py,
    type: 'smooth',
    ...(hin && { handleIn: { x: hin[0], y: hin[1] } }),
    ...(hout && { handleOut: { x: hout[0], y: hout[1] } }),
  });
  // Je Kante zwei Knoten; die Bögen liegen zwischen den Kanten (letzter → erster = Bogen oben links).
  const pairs: [PathPoint, PathPoint][] = [
    [n(x + r, y, [x + r - k, y]), n(x + w - r, y, undefined, [x + w - r + k, y])],
    [n(x + w, y + r, [x + w, y + r - k]), n(x + w, y + h - r, undefined, [x + w, y + h - r + k])],
    [n(x + w - r, y + h, [x + w - r + k, y + h]), n(x + r, y + h, undefined, [x + r - k, y + h])],
    [n(x, y + h - r, [x, y + h - r + k]), n(x, y + r, undefined, [x, y + r - k])],
  ];
  // Radius = halbe Seite → Kante hat Länge 0: beide Knoten zu einem verschmelzen.
  return pairs.flatMap(([a, b]) =>
    Math.hypot(a.x - b.x, a.y - b.y) < 1e-9 ? [{ ...a, handleOut: b.handleOut }] : [a, b],
  );
}

function ellipse({ x, y, width: w, height: h }: Extract<Shape, { kind: 'ellipse' }>): PathPoint[] {
  const [rx, ry, cx, cy] = [w / 2, h / 2, x + w / 2, y + h / 2];
  const [kx, ky] = [KAPPA * rx, KAPPA * ry];
  const n = (px: number, py: number, dx: number, dy: number): PathPoint => ({
    x: px,
    y: py,
    type: 'symmetric',
    handleIn: { x: px - dx, y: py - dy },
    handleOut: { x: px + dx, y: py + dy },
  });
  return [n(cx, y, kx, 0), n(x + w, cy, 0, ky), n(cx, y + h, -kx, 0), n(x, cy, 0, -ky)];
}

function polygon({ x, y, width: w, height: h, sides, inner }: Extract<Shape, { kind: 'polygon' }>): PathPoint[] {
  const count = Math.max(3, Math.round(sides)) * (inner === null ? 1 : 2);
  const [rx, ry, cx, cy] = [w / 2, h / 2, x + w / 2, y + h / 2];
  return Array.from({ length: count }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    const r = inner !== null && i % 2 ? inner : 1;
    return corner(cx + rx * r * Math.cos(a), cy + ry * r * Math.sin(a));
  });
}
