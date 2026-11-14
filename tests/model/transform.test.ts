import { describe, expect, it } from 'vitest';
import { measure } from '../../src/model/arrange';
import { addNodes, createDocument, worldOf } from '../../src/model/document';
import { apply } from '../../src/model/geometry';
import { MAX_COPIES, transformSelection, type Transformation } from '../../src/model/transform';
import type { Doc, Node, PathNode } from '../../src/model/types';
import { group, pt, square, sub } from './fixtures';

const docWith = (...nodes: Node[]): Doc => {
  const doc = createDocument(200, 200);
  return addNodes(doc, doc.pages[0].layers[0].id, nodes);
};
const kids = (d: Doc) => d.pages[0].layers[0].children;
const box = (d: Doc, id: string) => {
  const b = measure(d, [id])!.box;
  return [b.minX, b.minY, b.maxX, b.maxY].map((v) => Math.round(v * 1e6) / 1e6 + 0);
};
const run = (d: Doc, t: Transformation, anchor: Parameters<typeof transformSelection>[3] = 'c', copies = 0, ids = ['a']) =>
  transformSelection(d, ids, t, anchor, copies);

describe('transformSelection (Transformationen-Fenster)', () => {
  it('Position absolut setzt den Bezugspunkt, relativ verschiebt um x/y', () => {
    const d = docWith(square('a'));
    expect(box(run(d, { kind: 'position', x: 20, y: 30, relative: false }, 'tl')!.doc, 'a')).toEqual([20, 30, 30, 40]);
    expect(box(run(d, { kind: 'position', x: 20, y: 30, relative: false }, 'c')!.doc, 'a')).toEqual([15, 25, 25, 35]);
    expect(box(run(d, { kind: 'position', x: 5, y: -3, relative: true }, 'br')!.doc, 'a')).toEqual([5, -3, 15, 7]);
  });

  it('Drehen: positiv = gegen den Uhrzeigersinn um den Bezugspunkt', () => {
    const r = run(docWith(square('a')), { kind: 'rotate', angle: 90, x: 0, y: 0, relative: true }, 'c')!;
    // rechte obere Ecke (10|0) wandert nach links oben (0|0)
    expect(apply(worldOf(r.doc, 'a')!, 10, 0).map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([0, 0]);
    expect(r.selected).toEqual(['a']);
  });

  it('Kopien: Original bleibt, jede Kopie eine Stufe weiter, gestapelt darüber; gewählt = letzte Kopie', () => {
    const r = run(docWith(square('a')), { kind: 'rotate', angle: 90, x: 5, y: 20, relative: false }, 'c', 3)!;
    const ids = kids(r.doc).map((n) => n.id);
    expect(ids).toHaveLength(4);
    expect(ids[0]).toBe('a');
    expect(box(r.doc, 'a')).toEqual([0, 0, 10, 10]);
    expect(box(r.doc, ids[1])).toEqual([-15, 15, -5, 25]); // 90° gegen den Uhrzeigersinn: von oben nach links
    expect(box(r.doc, ids[2])).toEqual([0, 30, 10, 40]);
    expect(box(r.doc, ids[3])).toEqual([15, 15, 25, 25]);
    expect(r.selected).toEqual([ids[3]]);
  });

  it('Relative Mitte = Bezugspunkt plus Versatz', () => {
    const r = run(docWith(square('a')), { kind: 'rotate', angle: 180, x: 0, y: 5, relative: true }, 't')!;
    // Mitte (5|5): Quadrat dreht in sich
    expect(box(r.doc, 'a')).toEqual([0, 0, 10, 10]);
  });

  it('Skalieren in % mit festem Bezugspunkt, Spiegeln dazu; ≤ 0 % tut nichts', () => {
    const d = docWith(square('a'));
    expect(box(run(d, { kind: 'scale', sx: 200, sy: 200, mirrorH: false, mirrorV: false }, 'tl')!.doc, 'a')).toEqual([0, 0, 20, 20]);
    const m = run(d, { kind: 'scale', sx: 100, sy: 100, mirrorH: true, mirrorV: false }, 'l')!;
    expect(box(m.doc, 'a')).toEqual([-10, 0, 0, 10]);
    expect(apply(worldOf(m.doc, 'a')!, 10, 0)[0]).toBeCloseTo(-10);
    expect(run(d, { kind: 'scale', sx: 0, sy: 100, mirrorH: false, mirrorV: false })).toBeNull();
  });

  it('Größe in mm mit festem Bezugspunkt; Linie ohne Höhe behält Höhe 0', () => {
    const d = docWith(square('a'));
    expect(box(run(d, { kind: 'size', w: 30, h: 5 }, 'br')!.doc, 'a')).toEqual([-20, 5, 10, 10]);
    const line: PathNode = { ...square('a'), subpaths: [sub(false, pt(0, 0), pt(10, 0))] };
    expect(box(run(docWith(line), { kind: 'size', w: 20, h: 0 }, 'l')!.doc, 'a')).toEqual([0, 0, 20, 0]);
    expect(run(d, { kind: 'size', w: -1, h: 10 })).toBeNull();
  });

  it('Neigen wie das Feld der Eigenschaftsleiste; 90° tut nichts', () => {
    const d = docWith(square('a'));
    expect(box(run(d, { kind: 'skew', h: 45, v: 0 }, 'c')!.doc, 'a')).toEqual([-5, 0, 15, 10]);
    expect(run(d, { kind: 'skew', h: 90, v: 0 })).toBeNull();
  });

  it('in Gruppen in Seitenkoordinaten; ohne Wirkung und ohne Kopien = null; Kopien begrenzt', () => {
    const d = docWith(group('g', [square('a')], 10, 10));
    expect(box(run(d, { kind: 'position', x: 0, y: 0, relative: false }, 'tl')!.doc, 'a')).toEqual([0, 0, 10, 10]);
    expect(run(d, { kind: 'position', x: 0, y: 0, relative: true })).toBeNull();
    expect(run(d, { kind: 'position', x: 0, y: 0, relative: true }, 'c', 2)!.selected).toHaveLength(1);
    expect(run(d, { kind: 'position', x: 1, y: 0, relative: true }, 'c', MAX_COPIES + 1)).toBeNull();
    expect(run(d, { kind: 'position', x: 1, y: 0, relative: true }, 'c', 0, [])).toBeNull();
    expect(run(d, { kind: 'position', x: NaN, y: 0, relative: true })).toBeNull(); // leeres Feld
    expect(run(d, { kind: 'rotate', angle: Infinity, x: 0, y: 0, relative: true })).toBeNull();
  });
});
