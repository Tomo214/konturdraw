import { describe, expect, it } from 'vitest';
import { addNodes, createDocument } from '../../src/model/document';
import { IDENTITY, scale, translate } from '../../src/model/geometry';
import { planOutline } from '../../src/model/outline';
import type { Color, Doc, GroupNode, Node, PathNode, Stroke, Subpath } from '../../src/model/types';
import { pt, square, sub } from './fixtures';

const blue: Color = { model: 'rgb', values: [0, 0, 1] };
const pen = (extra: Partial<Stroke> = {}): Stroke => ({ color: blue, width: 2, cap: 'butt', join: 'miter', ...extra });
const box = (x0: number, y0: number, x1: number, y1: number): Subpath => sub(true, pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1));
const docWith = (...nodes: Node[]): Doc => {
  const doc = createDocument(200, 200);
  return addNodes(doc, doc.pages[0].layers[0].id, nodes);
};
const kids = (d: Doc) => d.pages[0].layers[0].children;
const stroked = (id: string, x: number, y: number, stroke: Stroke, fill = true): PathNode => {
  const n = square(id, x, y);
  return { ...n, style: { fill: fill ? n.style.fill : null, stroke } };
};
const first = (n: Node) => [(n as PathNode).subpaths[0].nodes[0].x, (n as PathNode).subpaths[0].nodes[0].y];

describe('planOutline', () => {
  it('Kontur wird eigenes Objekt direkt darüber (Füllung = Konturfarbe); Original behält Füllung ohne Kontur', () => {
    const doc = docWith(stroked('a', 5, 5, pen()), square('c', 30, 30));
    const plan = planOutline(doc, ['a']);
    expect(plan.jobs).toEqual([{ subpaths: [box(5, 5, 15, 15)], width: 2, cap: 'butt', join: 'miter' }]);
    const r = plan.finish([[box(4, 4, 16, 16), box(6, 6, 14, 14)]]);
    const [a, made, c] = kids(r.doc);
    expect([a.id, c.id]).toEqual(['a', 'c']);
    expect(made).toMatchObject({ type: 'path', transform: translate(5, 5), style: { fill: blue, stroke: null } });
    expect(first(made)).toEqual([-1, -1]);
    expect((made as PathNode).subpaths).toHaveLength(2);
    expect((a as PathNode).style).toEqual({ fill: square('a').style.fill, stroke: null });
    expect(r.selected).toEqual([made.id]);
  });

  it('ohne Füllung verschwindet das Original, nur die Kontur-Fläche bleibt', () => {
    const doc = docWith(stroked('a', 0, 0, pen(), false));
    const r = planOutline(doc, ['a']).finish([[box(-1, -1, 11, 11)]]);
    expect(kids(r.doc)).toHaveLength(1);
    expect(kids(r.doc)[0].id).not.toBe('a');
  });

  it('in einer skalierten Gruppe: Auftrag in Seitenkoordinaten, mitskalierende Breite × Maßstab, Ergebnis bleibt in der Gruppe', () => {
    const leaf = stroked('k', 1, 1, pen({ width: 1, scaleWithObject: true }));
    const g: GroupNode = { type: 'group', id: 'g', transform: scale(2, 2), children: [leaf, stroked('m', 20, 0, pen({ width: 1 }))] };
    const doc = docWith(g);
    const plan = planOutline(doc, ['g']);
    expect(plan.jobs.map((j) => j.width)).toEqual([2, 1]);
    expect(plan.jobs[0].subpaths).toEqual([box(2, 2, 22, 22)]);
    const r = plan.finish([[box(1, 1, 23, 23)], [box(39, -1, 61, 21)]]);
    const inner = (kids(r.doc)[0] as GroupNode).children;
    expect(inner.map((n) => n.id).filter((id) => id === 'k' || id === 'm')).toEqual(['k', 'm']);
    expect(inner).toHaveLength(4);
    expect(inner[1].transform).toEqual(translate(1, 1));
    expect(first(inner[1])).toEqual([-0.5, -0.5]);
    expect(r.selected).toEqual([inner[1].id, inner[3].id]);
  });

  it('Strichmuster: Auftrag in Seiten-mm (× wirksame Breite), durchgehend ohne Muster', () => {
    const leaf = stroked('k', 1, 1, pen({ width: 1, scaleWithObject: true, dash: [3, 1] }));
    const g: GroupNode = { type: 'group', id: 'g', transform: scale(2, 2), children: [leaf, stroked('m', 20, 0, pen())] };
    const plan = planOutline(docWith(g), ['g']);
    expect(plan.jobs.map((j) => j.dash)).toEqual([[6, 2], undefined]);
  });

  it('Formen zählen als Kurven; Bilder und Objekte ohne Kontur bleiben außen vor', () => {
    const rect: Node = { type: 'shape', id: 'r', transform: IDENTITY, style: { fill: null, stroke: pen() }, shape: { kind: 'rect', x: 0, y: 0, width: 4, height: 2, radius: 0 } };
    const img: Node = { type: 'image', id: 'i', transform: IDENTITY, image: 'x', width: 5, height: 5 } as Node;
    const doc = docWith(rect, img, square('s'));
    const plan = planOutline(doc, ['r', 'i', 's']);
    expect(plan.jobs).toHaveLength(1);
    expect(plan.jobs[0].subpaths[0].nodes).toHaveLength(4);
  });

  it('nichts mit Kontur gewählt → verständlicher Fehler; leeres Ergebnis lässt alles unverändert', () => {
    const doc = docWith(square('s'), stroked('a', 0, 0, pen()));
    expect(() => planOutline(doc, ['s'])).toThrow('Kein gewähltes Objekt hat eine Kontur.');
    expect(() => planOutline(doc, [])).toThrow('Kein gewähltes Objekt hat eine Kontur.');
    expect(planOutline(doc, ['a']).finish([[]]).doc).toBe(doc);
  });
});
