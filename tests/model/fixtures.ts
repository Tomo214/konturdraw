import { translate } from '../../src/model/geometry';
import { splitCubic, type Cubic } from '../../src/model/bezier';
import type { GroupNode, PathNode, PathPoint, Subpath } from '../../src/model/types';

export const pt = (x: number, y: number, extra: Partial<PathPoint> = {}): PathPoint => ({ x, y, type: 'corner', ...extra });

export const sub = (closed: boolean, ...nodes: PathPoint[]): Subpath => ({ closed, nodes });

export function square(id: string, x = 0, y = 0, size = 10): PathNode {
  return {
    type: 'path',
    id,
    transform: translate(x, y),
    style: { fill: { model: 'rgb', values: [0, 0, 0] }, stroke: null },
    subpaths: [sub(true, pt(0, 0), pt(size, 0), pt(size, size), pt(0, size))],
  };
}

export function group(id: string, children: GroupNode['children'], x = 0, y = 0): GroupNode {
  return { type: 'group', id, transform: translate(x, y), children };
}

/** Eine Kurve in `parts` gleich lange Parameterstücke zerlegt → viele glatte Knoten auf derselben Form. */
export function chop(c: Cubic, parts: number): PathPoint[] {
  const pieces: Cubic[] = [];
  let rest = c;
  for (let i = parts; i > 1; i--) {
    const [a, b] = splitCubic(rest, 1 / i);
    pieces.push(a);
    rest = b;
  }
  pieces.push(rest);
  return [
    { ...pieces[0][0], type: 'corner', handleOut: pieces[0][1] },
    ...pieces.slice(1).map((q, i): PathPoint => ({ ...q[0], type: 'smooth', handleIn: pieces[i][2], handleOut: q[1] })),
    { ...rest[3], type: 'corner', handleIn: rest[2] },
  ];
}
