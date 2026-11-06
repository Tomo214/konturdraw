import { describe, expect, test } from 'vitest';
import { addNodes, cloneWithNewIds, createDocument, duplicateNodes, findNode, worldOf } from '../../src/model/document';
import { extractContents, placeInFrame } from '../../src/model/frame';
import { multiply, scale, translate, type Mat } from '../../src/model/geometry';
import { History } from '../../src/model/history';
import type { Doc, Node, PathNode } from '../../src/model/types';
import { group, pt, square, sub } from './fixtures';

function docWith(...nodes: Node[]): Doc {
  const doc = createDocument();
  return addNodes(doc, doc.pages[0].layers[0].id, nodes);
}

const top = (doc: Doc) => doc.pages[0].layers[0].children.map((n) => n.id);
const near = (a: Mat, b: Mat) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
const frameOf = (doc: Doc, id: string) => findNode(doc, id) as PathNode;
// Rahmen 50 mm, um 2 skaliert und verschoben: Inhalt muss in dessen Koordinaten umgerechnet werden
const frame = (): PathNode => ({ ...square('f', 0, 0, 25), transform: multiply(translate(100, 100), scale(2, 2)) });

describe('In Rahmen einfügen', () => {
  test('Inhalt wandert in den Rahmen (zuletzt gewählt), Lage auf der Seite bleibt', () => {
    const doc = docWith(frame(), square('a', 110, 120), square('b', 130, 90));
    const r = placeInFrame(doc, ['a', 'b', 'f']);
    expect(top(r.doc)).toEqual(['f']);
    expect(r.selected).toEqual(['f']);
    const f = frameOf(r.doc, 'f');
    expect(f.contents?.map((c) => c.id)).toEqual(['a', 'b']);
    for (const c of f.contents ?? []) near(multiply(f.transform, c.transform), worldOf(doc, c.id)!);
  });

  test('Stapelfolge bleibt, neuer Inhalt kommt über vorhandenen', () => {
    const doc = docWith(frame(), square('b', 0, 0), square('a', 5, 5), square('c', 9, 9));
    const once = placeInFrame(doc, ['b', 'a', 'f']).doc; // gewählt b, a – gestapelt b unter a
    expect(frameOf(once, 'f').contents?.map((c) => c.id)).toEqual(['b', 'a']);
    const twice = placeInFrame(once, ['c', 'f']).doc;
    expect(frameOf(twice, 'f').contents?.map((c) => c.id)).toEqual(['b', 'a', 'c']);
  });

  test('Objekt aus einer Gruppe: Gruppe behält den Rest, leere Gruppe verschwindet', () => {
    const doc = docWith(frame(), group('g', [square('a', 1, 1), square('b', 2, 2)], 30, 40), group('h', [square('c')], 5, 5));
    const r = placeInFrame(doc, ['a', 'c', 'f']).doc;
    expect(top(r)).toEqual(['f', 'g']);
    expect((findNode(r, 'g') as { children: readonly Node[] }).children.map((n) => n.id)).toEqual(['b']);
    const f = frameOf(r, 'f');
    near(multiply(f.transform, f.contents![0].transform), worldOf(doc, 'a')!);
  });

  test('Ziel muss eine geschlossene Form sein, mindestens ein Inhalt, Rahmen nicht im Inhalt', () => {
    const open: PathNode = { ...square('o'), subpaths: [sub(false, pt(0, 0), pt(10, 0))] };
    const doc = docWith(frame(), open, group('g', [square('x')]), square('a'));
    expect(() => placeInFrame(doc, ['a', 'o'])).toThrow('geschlossene Form');
    expect(() => placeInFrame(doc, ['a', 'g'])).toThrow('geschlossene Form');
    expect(() => placeInFrame(doc, ['f'])).toThrow('mindestens');
    expect(() => placeInFrame(doc, ['g', 'x'])).toThrow('Rahmen liegt im Inhalt');
  });

  test('Rückgängig stellt den alten Stand wieder her', () => {
    const doc = docWith(frame(), square('a', 110, 120));
    const h = new History(doc);
    h.push(placeInFrame(doc, ['a', 'f']).doc);
    h.undo();
    expect(h.current).toBe(doc);
  });
});

describe('Inhalt herausnehmen', () => {
  test('Inhalt kommt direkt über den Rahmen, Lage bleibt, Deckkraft des Rahmens wird eingerechnet', () => {
    const doc = docWith(frame(), square('a', 110, 120), square('b', 130, 90), square('z', 0, 0));
    const inside = placeInFrame(doc, ['a', 'b', 'f']).doc;
    const faded = { ...inside, pages: inside.pages.map((p) => ({ ...p, layers: p.layers.map((l) => ({ ...l, children: l.children.map((n) => (n.id === 'f' ? { ...n, opacity: 0.5 } : n)) })) })) };
    const r = extractContents(faded, ['f']);
    expect(top(r.doc)).toEqual(['f', 'a', 'b', 'z']);
    expect(r.selected).toEqual(['a', 'b']);
    expect(frameOf(r.doc, 'f').contents).toBeUndefined();
    near(worldOf(r.doc, 'a')!, worldOf(doc, 'a')!);
    expect(findNode(r.doc, 'a')?.opacity).toBe(0.5);
  });

  test('ohne Rahmen mit Inhalt: Fehler', () => {
    expect(() => extractContents(docWith(frame()), ['f'])).toThrow('Kein Rahmen mit Inhalt');
  });
});

test('Duplizieren und Kopieren geben auch dem Inhalt neue IDs', () => {
  const doc = placeInFrame(docWith(frame(), square('a', 110, 120)), ['a', 'f']).doc;
  const copy = cloneWithNewIds(frameOf(doc, 'f')) as PathNode;
  expect(copy.contents?.[0].id).not.toBe('a');
  const dup = duplicateNodes(doc, ['f'], 5, 5);
  expect((findNode(dup.doc, dup.ids[0]) as PathNode).contents?.[0].id).not.toBe('a');
});
