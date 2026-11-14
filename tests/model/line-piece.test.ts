import { describe, expect, it } from 'vitest';
import { addNodes, createDocument, findNode } from '../../src/model/document';
import { IDENTITY, translate } from '../../src/model/geometry';
import { deletePieces, pieceAt, piecesIn } from '../../src/model/line-piece';
import type { Doc, Node, PathNode, Subpath } from '../../src/model/types';
import { group, pt, square, sub } from './fixtures';

const line = (id: string, x0: number, y0: number, x1: number, y1: number, m = IDENTITY): PathNode => ({
  type: 'path',
  id,
  transform: m,
  style: { fill: null, stroke: null },
  subpaths: [sub(false, pt(x0, y0), pt(x1, y1))],
});
const docWith = (...nodes: Node[]): Doc => {
  const doc = createDocument(300, 300);
  return addNodes(doc, doc.pages[0].layers[0].id, nodes);
};
const subs = (d: Doc, id: string) => (findNode(d, id) as PathNode).subpaths;
const xy = (sp: Subpath) => sp.nodes.map((n) => [+n.x.toFixed(3), +n.y.toFixed(3)]);

describe('Linienstück löschen', () => {
  const cross = docWith(line('h', 0, 50, 100, 50), line('v', 50, 0, 50, 100));

  it('Kreuz: Stück zwischen Schnittpunkt und Ende', () => {
    expect(pieceAt(cross, 'h', 0, 0.75)).toEqual({ id: 'h', sub: 0, from: 0.5, to: 1 });
    expect(pieceAt(cross, 'h', 0, 0.2)).toEqual({ id: 'h', sub: 0, from: 0, to: 0.5 });
    const r = deletePieces(cross, [pieceAt(cross, 'h', 0, 0.75)!]);
    expect(subs(r, 'h').map(xy)).toEqual([[[0, 50], [50, 50]]]);
    expect(subs(r, 'v')).toEqual(subs(cross, 'v'));
  });

  it('Mittelstück zwischen zwei Kreuzungen: Objekt behält beide Enden als Teilpfade', () => {
    const d = docWith(line('h', 0, 50, 100, 50), line('a', 30, 0, 30, 100), line('b', 70, 0, 70, 100));
    const r = deletePieces(d, [pieceAt(d, 'h', 0, 0.5)!]);
    expect(subs(r, 'h').map(xy)).toEqual([[[0, 50], [30, 50]], [[70, 50], [100, 50]]]);
    expect(subs(r, 'h').every((s) => !s.closed)).toBe(true);
  });

  it('ohne Kreuzung verschwindet das ganze Objekt', () => {
    const d = docWith(line('h', 0, 50, 100, 50), line('far', 0, 200, 100, 200));
    const p = pieceAt(d, 'h', 0, 0.3)!;
    expect(p).toEqual({ id: 'h', sub: 0, from: 0, to: 1 });
    expect(findNode(deletePieces(d, [p]), 'h')).toBeUndefined();
  });

  it('geschlossener Pfad wird an den Kreuzungen geöffnet', () => {
    const d = docWith(square('s', 0, 0, 100), line('v', 50, -10, 50, 110));
    const p = pieceAt(d, 's', 0, 1.5)!;
    expect(p).toEqual({ id: 's', sub: 0, from: 0.5, to: 2.5 });
    const [sp, ...rest] = subs(deletePieces(d, [p]), 's');
    expect(rest).toEqual([]);
    expect(sp.closed).toBe(false);
    expect(xy(sp)).toEqual([[50, 100], [0, 100], [0, 0], [50, 0]]);
  });

  it('Form (Rechteck) wird zu Kurven und dann geöffnet', () => {
    const rect: Node = {
      type: 'shape',
      id: 'r',
      transform: IDENTITY,
      style: { fill: null, stroke: null },
      shape: { kind: 'rect', x: 0, y: 0, width: 100, height: 100, radius: 0 },
    };
    const d = docWith(rect, line('v', 50, -10, 50, 110));
    const r = findNode(deletePieces(d, [pieceAt(d, 'r', 0, 1.5)!]), 'r') as PathNode;
    expect(r.type).toBe('path');
    expect(r.subpaths).toHaveLength(1);
    expect(r.subpaths[0].closed).toBe(false);
    const ends = [r.subpaths[0].nodes[0], r.subpaths[0].nodes.at(-1)!].map((n) => n.x);
    expect(ends.map((x) => +x.toFixed(3))).toEqual([50, 50]);
  });

  it('Kurve: neue Enden liegen genau auf der Kreuzung, Form bleibt', () => {
    const hump: PathNode = {
      ...line('c', 0, 0, 100, 0),
      subpaths: [sub(false, pt(0, 0, { handleOut: { x: 0, y: 100 } }), pt(100, 0, { handleIn: { x: 100, y: 100 } }))],
    };
    const d = docWith(hump, line('h', -10, 50, 110, 50));
    const p = pieceAt(d, 'c', 0, 0.5)!;
    const t1 = (1 - Math.sqrt(1 / 3)) / 2;
    expect(p.from).toBeCloseTo(t1, 4);
    expect(p.to).toBeCloseTo(1 - t1, 4);
    const [left, right] = subs(deletePieces(d, [p]), 'c');
    const end = left.nodes.at(-1)!;
    expect(end.y).toBeCloseTo(50, 3);
    expect(end.handleIn).toBeDefined();
    expect(right.nodes[0].y).toBeCloseTo(50, 3);
    expect(left.nodes[0]).toMatchObject({ x: 0, y: 0 });
    expect(right.nodes.at(-1)).toMatchObject({ x: 100, y: 0 });
  });

  it('Pfad, der sich selbst kreuzt', () => {
    const z: PathNode = { ...line('z', 0, 0, 0, 0), subpaths: [sub(false, pt(0, 0), pt(100, 100), pt(100, 0), pt(0, 100))] };
    const d = docWith(z);
    const p = pieceAt(d, 'z', 0, 1.5)!;
    expect(p).toEqual({ id: 'z', sub: 0, from: 0.5, to: 2.5 });
    expect(subs(deletePieces(d, [p]), 'z').map(xy)).toEqual([[[0, 0], [50, 50]], [[50, 50], [0, 100]]]);
  });

  it('Objekt in verschobener Gruppe kreuzt Objekt außerhalb', () => {
    const d = docWith(group('g', [line('h', 0, 50, 100, 50)], 100, 0), line('v', 150, 0, 150, 100));
    expect(pieceAt(d, 'h', 0, 0.9)).toEqual({ id: 'h', sub: 0, from: 0.5, to: 1 });
    expect(subs(deletePieces(d, [pieceAt(d, 'h', 0, 0.9)!]), 'h').map(xy)).toEqual([[[0, 50], [50, 50]]]);
  });

  it('Rahmen: alle berührten Stücke, auch aus verschiedenen Objekten', () => {
    const d = docWith(line('h', 0, 50, 100, 50, translate(0, 0)), line('a', 30, 0, 30, 100), line('b', 70, 0, 70, 100));
    const hits = piecesIn(d, ['h', 'a', 'b'], { minX: 20, minY: 80, maxX: 80, maxY: 100 });
    expect(hits).toEqual([
      { id: 'a', sub: 0, from: 0.5, to: 1 },
      { id: 'b', sub: 0, from: 0.5, to: 1 },
    ]);
    const r = deletePieces(d, hits);
    expect(subs(r, 'a').map(xy)).toEqual([[[30, 0], [30, 50]]]);
    expect(subs(r, 'b').map(xy)).toEqual([[[70, 0], [70, 50]]]);
  });

  it('T-Stoß: Linie endet auf der Kante (auch mit Rundungsfehler) und teilt sie', () => {
    for (const end of [100, 100 - 1e-9, 100 + 1e-9]) {
      const d = docWith(square('s', 0, 0, 100), line('h', -50, 50, end, 50));
      const p = pieceAt(d, 's', 0, 1.2)!;
      expect(p.from).toBeCloseTo(3.5, 6);
      expect(p.to).toBeCloseTo(5.5, 6);
    }
  });

  it('mehrere Stücke desselben Pfads auf einmal', () => {
    const d = docWith(line('h', 0, 50, 100, 50), line('a', 30, 0, 30, 100), line('b', 70, 0, 70, 100));
    const r = deletePieces(d, [pieceAt(d, 'h', 0, 0.1)!, pieceAt(d, 'h', 0, 0.9)!]);
    expect(subs(r, 'h').map(xy)).toEqual([[[30, 50], [70, 50]]]);
  });
});
