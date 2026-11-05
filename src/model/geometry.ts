// Affine Matrix [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (wie Canvas/SVG).
export type Mat = readonly [number, number, number, number, number, number];

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export const translate = (dx: number, dy: number): Mat => [1, 0, 0, 1, dx, dy];

export const scale = (sx: number, sy: number): Mat => [sx, 0, 0, sy, 0, 0];

/** Winkel in Radiant; positiv = im Uhrzeigersinn, da y nach unten zeigt. */
export const rotate = (a: number): Mat => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];

/** x' = x + kx·y, y' = y + ky·x */
export const skew = (kx: number, ky: number): Mat => [1, ky, kx, 1, 0, 0];

/** m mit (cx, cy) als Fixpunkt. */
export const about = (m: Mat, cx: number, cy: number): Mat => multiply(translate(cx, cy), multiply(m, translate(-cx, -cy)));

/** m ∘ n: erst n, dann m anwenden. */
export function multiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function transformBox(m: Mat, b: Box): Box {
  const corners = [apply(m, b.minX, b.minY), apply(m, b.maxX, b.minY), apply(m, b.maxX, b.maxY), apply(m, b.minX, b.maxY)];
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}
