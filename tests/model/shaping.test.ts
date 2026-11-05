import { describe, expect, it } from 'vitest';
import { addNodes, createDocument } from '../../src/model/document';
import { IDENTITY, scale, translate } from '../../src/model/geometry';
import { insertPage } from '../../src/model/pages';
import { planShaping } from '../../src/model/shaping';
import { DEFAULT_STROKE } from '../../src/model/style';
import type { Doc, Node, PathNode, Subpath } from '../../src/model/types';
import { group, pt, square, sub } from './fixtures';

const red = { fill: { model: 'rgb' as const, values: [1, 0, 0] as [number, number, number] }, stroke: null };
const box = (x0: number, y0: number, x1: number, y1: number): Subpath => sub(true, pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1));
const docWith = (...nodes: Node[]): Doc => {
  const doc = createDocument(200, 200);
  return addNodes(doc, doc.pages[0].layers[0].id, nodes);
};
const kids = (d: Doc) => d.pages[0].layers[0].children;
const ids = (d: Doc) => kids(d).map((n) => n.id);
const get = (d: Doc, id: string) => kids(d).find((n) => n.id === id) as PathNode;
const firstNode = (n: PathNode) => [n.subpaths[0].nodes[0].x, n.subpaths[0].nodes[0].y];

// a unten, b Mitte (rot), c oben
const abc = () => docWith(square('a', 0, 0), { ...square('b', 5, 5), style: red }, square('c', 8, 8));

describe('planShaping', () => {
  it('Verschmelzen: Vereinigung in Weltkoordinaten, Ergebnis = Ziel (zuletzt gewählt) mit Stil und Platz, Rest weg', () => {
    const doc = abc();
    const plan = planShaping(doc, ['a', 'b'], 'weld');
    expect(plan.jobs).toEqual([
      { op: 'union', shapes: [{ subpaths: [box(0, 0, 10, 10)], evenOdd: false }, { subpaths: [box(5, 5, 15, 15)], evenOdd: false }] },
    ]);
    const r = plan.finish([[box(0, 0, 15, 15)]]);
    expect(ids(r.doc)).toEqual(['b', 'c']);
    const b = get(r.doc, 'b');
    expect(b.style).toBe(red);
    expect(b.transform).toEqual(translate(5, 5));
    expect(firstNode(b)).toEqual([-5, -5]);
    expect(r.selected).toEqual(['b']);
  });

  it('Zuschneiden: Ziel minus Rest; Rest bleibt unberührt; leeres Ergebnis entfernt das Ziel', () => {
    const doc = abc();
    const plan = planShaping(doc, ['b', 'a'], 'trim');
    expect(plan.jobs[0].op).toBe('difference');
    expect(plan.jobs[0].shapes[0].subpaths).toEqual([box(0, 0, 10, 10)]);
    const r = plan.finish([[box(0, 0, 5, 10)]]);
    expect(get(r.doc, 'b')).toBe(get(doc, 'b'));
    expect(firstNode(get(r.doc, 'a'))).toEqual([0, 0]);
    expect(ids(plan.finish([[]]).doc)).toEqual(['b', 'c']);
  });

  it('Schnittmenge: neues Objekt über dem obersten gewählten, Stil des Ziels, Originale bleiben', () => {
    const doc = docWith(square('a', 0, 0), { ...square('b', 5, 5), style: red }, square('x', 50, 50));
    const plan = planShaping(doc, ['b', 'a'], 'intersect');
    expect(plan.jobs[0].op).toBe('intersect');
    const r = plan.finish([[box(5, 5, 10, 10)]]);
    expect(ids(r.doc).slice(0, 2)).toEqual(['a', 'b']);
    expect(ids(r.doc)[3]).toBe('x');
    const n = kids(r.doc)[2] as PathNode;
    expect(n.style).toEqual(get(doc, 'a').style);
    expect(r.selected).toEqual([n.id]);
    expect(() => plan.finish([[]])).toThrow('Keine gemeinsame Fläche');
  });

  it('Vereinfachen: jedes Objekt minus alle darüber; oberstes bleibt; leeres fällt weg', () => {
    const doc = abc();
    const plan = planShaping(doc, ['c', 'a', 'b'], 'simplify');
    expect(plan.jobs.map((j) => j.shapes.length)).toEqual([3, 2]);
    expect(plan.jobs[0].shapes[0].subpaths).toEqual([box(0, 0, 10, 10)]);
    const r = plan.finish([[], [box(5, 5, 8, 15)]]);
    expect(ids(r.doc)).toEqual(['b', 'c']);
    expect(get(r.doc, 'c')).toBe(get(doc, 'c'));
    expect(r.selected).toEqual(['b', 'c']);
  });

  it('Vorne minus hinten / Hinten minus vorne: Basis nach Ebenenreihenfolge, Rest weg', () => {
    const doc = abc();
    const front = planShaping(doc, ['c', 'a'], 'frontMinusBack');
    expect(front.jobs[0].shapes[0].subpaths).toEqual([box(8, 8, 18, 18)]);
    expect(ids(front.finish([[box(10, 10, 18, 18)]]).doc)).toEqual(['b', 'c']);
    const back = planShaping(doc, ['a', 'b', 'c'], 'backMinusFront');
    expect(back.jobs[0].shapes[0].subpaths).toEqual([box(0, 0, 10, 10)]);
    expect(ids(back.finish([[box(0, 0, 5, 10)]]).doc)).toEqual(['a']);
  });

  it('Umrandung: neues Objekt ohne Füllung mit Standardkontur ganz oben in der Auswahl, Originale bleiben', () => {
    const doc = abc();
    const r = planShaping(doc, ['a', 'b'], 'boundary').finish([[box(0, 0, 15, 15)]]);
    expect(ids(r.doc).slice(0, 2)).toEqual(['a', 'b']);
    const n = kids(r.doc)[2] as PathNode;
    expect(n).toMatchObject({ type: 'path', transform: IDENTITY, style: { fill: null, stroke: DEFAULT_STROKE }, subpaths: [box(0, 0, 15, 15)] });
    expect(ids(r.doc)[3]).toBe('c');
  });

  it('Kombinieren: ohne Rechenauftrag, Teilpfade in Zielkoordinaten, gerade/ungerade, Stil des Ziels', () => {
    const doc = docWith(square('a', 0, 0), { ...square('b', 5, 5), style: red, transform: scale(2, 2) });
    const plan = planShaping(doc, ['a', 'b'], 'combine');
    expect(plan.jobs).toEqual([]);
    const r = plan.finish([]);
    expect(ids(r.doc)).toEqual(['b']);
    const b = get(r.doc, 'b');
    expect(b).toMatchObject({ fillRule: 'evenodd', style: red, transform: scale(2, 2) });
    expect(b.subpaths).toEqual([box(0, 0, 5, 5), box(0, 0, 10, 10)]);
  });

  it('Aufbrechen: je Teilpfad ein Objekt an gleicher Stelle, Füllregel fällt weg', () => {
    const combined: PathNode = { ...square('k', 1, 1), fillRule: 'evenodd', subpaths: [box(0, 0, 4, 4), box(10, 0, 14, 4)] };
    const doc = docWith(square('a'), combined, square('c'));
    const r = planShaping(doc, ['k'], 'breakApart').finish([]);
    expect(kids(r.doc)).toHaveLength(4);
    const [p, q] = kids(r.doc).slice(1, 3) as PathNode[];
    expect([p.id, p.subpaths, q.subpaths, q.transform]).toEqual(['k', [box(0, 0, 4, 4)], [box(10, 0, 14, 4)], translate(1, 1)]);
    expect('fillRule' in p || 'fillRule' in q).toBe(false);
    expect(r.selected).toEqual([p.id, q.id]);
    expect(() => planShaping(doc, ['a'], 'breakApart')).toThrow('Nichts aufzubrechen');
  });

  it('Formen werden Kurven, gerade/ungerade wird weitergereicht, offene Pfade → Hinweis', () => {
    const rect: Node = { type: 'shape', id: 'r', transform: IDENTITY, style: red, shape: { kind: 'rect', x: 0, y: 0, width: 4, height: 2, radius: 0 } };
    const open: PathNode = { ...square('o'), fillRule: 'evenodd', subpaths: [sub(false, pt(0, 0), pt(4, 0), pt(4, 4))] };
    const plan = planShaping(docWith(rect, open), ['r', 'o'], 'weld');
    expect(plan.jobs[0].shapes.map((s) => s.evenOdd)).toEqual([false, true]);
    expect(plan.jobs[0].shapes[0].subpaths[0].nodes).toHaveLength(4);
    expect(plan.notice).toMatch(/[Oo]ffene Pfade/);
    expect(planShaping(abc(), ['a', 'b'], 'weld').notice).toBeUndefined();
  });

  it('arbeitet auch auf Seite 2', () => {
    let doc = insertPage(createDocument(200, 200), 1, 0);
    doc = addNodes(doc, doc.pages[1].layers[0].id, [square('p'), square('q', 5, 5)]);
    expect(planShaping(doc, ['p', 'q'], 'weld').jobs).toHaveLength(1);
  });

  it('Gruppen und Bilder abgelehnt, zu wenige Objekte abgelehnt', () => {
    const doc = docWith(square('a'), group('g', [square('x')]));
    expect(() => planShaping(doc, ['a', 'g'], 'weld')).toThrow('Gruppen');
    // Strg-Klick-Auswahl in einer Gruppe: klar melden statt stillschweigend übergehen.
    expect(() => planShaping(doc, ['a', 'x'], 'weld')).toThrow('in einer Gruppe');
    expect(() => planShaping(doc, ['a'], 'weld')).toThrow('zwei Objekte');
    expect(() => planShaping(doc, [], 'boundary')).toThrow('Objekt wählen');
  });
});
