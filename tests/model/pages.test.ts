import { describe, expect, it } from 'vitest';
import { addLayer, addNodes, createDocument, updateLayer } from '../../src/model/document';
import { addGuide } from '../../src/model/guides';
import { duplicatePage, insertPage, movePage, pageIndexOf, pageLabel, removePage, renamePage } from '../../src/model/pages';
import type { Doc } from '../../src/model/types';
import { group, square } from './fixtures';

// Zwei Ebenen auf Seite 1, oben gesperrt; ein Quadrat und eine Gruppe auf der unteren Ebene.
function sample(): Doc {
  let doc = addLayer(createDocument(100, 50), 0, 'Oben');
  const [low, high] = doc.pages[0].layers;
  doc = updateLayer(doc, high.id, { locked: true });
  return addNodes(doc, low.id, [square('a'), group('g', [square('b')])]);
}

const ids = (doc: Doc, pi: number) => doc.pages[pi].layers.flatMap((l) => [l.id, ...l.children.map((n) => n.id)]);

describe('Seitenname', () => {
  it('zeigt ohne eigenen Namen „Seite n“, sonst den Namen', () => {
    const doc = renamePage(insertPage(sample(), 1, 0), 1, 'Rückseite')!;
    expect([pageLabel(doc, 0), pageLabel(doc, 1)]).toEqual(['Seite 1', 'Rückseite']);
  });

  it('kürzt Leerraum, leerer Name löscht ihn, gleicher Name ändert nichts', () => {
    const doc = renamePage(sample(), 0, '  Vorne ')!;
    expect(doc.pages[0].name).toBe('Vorne');
    expect(renamePage(doc, 0, 'Vorne')).toBeNull();
    expect('name' in renamePage(doc, 0, '   ')!.pages[0]).toBe(false);
    expect(renamePage(sample(), 0, '')).toBeNull();
  });
});

describe('Seite einfügen', () => {
  it('übernimmt Größe und Ebenen der Vorlage – leer, mit neuen IDs und gleichen Schaltern', () => {
    const src = sample();
    const doc = insertPage(src, 1, 0);
    expect(doc.pages).toHaveLength(2);
    const [p0, p1] = doc.pages;
    expect(p0).toBe(src.pages[0]);
    expect([p1.width, p1.height]).toEqual([100, 50]);
    expect(p1.layers.map((l) => [l.name, l.locked, l.children.length])).toEqual([['Ebene 1', false, 0], ['Oben', true, 0]]);
    expect(p1.id).not.toBe(p0.id);
    expect(ids(doc, 1).some((id) => ids(doc, 0).includes(id))).toBe(false);
    expect(p1.guides).toBeUndefined();
  });

  it('landet vor der Vorlage, wenn davor eingefügt wird', () => {
    const src = sample();
    const doc = insertPage(src, 0, 0);
    expect(doc.pages[1]).toBe(src.pages[0]);
    expect(doc.pages[0].layers[0].children).toEqual([]);
  });
});

describe('Seite duplizieren', () => {
  it('nur Ebenen: Kopie direkt dahinter, Ebenen leer, keine Hilfslinien', () => {
    const src = addGuide(sample(), 'h', 10);
    const doc = duplicatePage(src, 0, false);
    expect(doc.pages).toHaveLength(2);
    expect(doc.pages[1].layers.map((l) => l.children.length)).toEqual([0, 0]);
    expect(doc.pages[1].guides).toBeUndefined();
  });

  it('mit Inhalt: Objekte, Gruppen und Hilfslinien kopiert, alles mit neuen IDs, Name nicht übernommen', () => {
    const src = renamePage(addGuide(sample(), 'v', 20, 'g1'), 0, 'Vorne')!;
    const doc = duplicatePage(src, 0, true);
    const copy = doc.pages[1];
    const low = copy.layers[0].children;
    expect(low.map((n) => n.type)).toEqual(['path', 'group']);
    expect(low[1].type === 'group' && low[1].children.length).toBe(1);
    const all = [copy.id, ...ids(doc, 1), low[1].type === 'group' ? low[1].children[0].id : '', copy.guides![0].id];
    const old = [src.pages[0].id, ...ids(src, 0), 'b', 'g1'];
    expect(all.some((id) => old.includes(id))).toBe(false);
    expect(copy.guides).toEqual([{ id: copy.guides![0].id, axis: 'v', pos: 20 }]);
    expect(copy.name).toBeUndefined();
  });
});

describe('Seite löschen und verschieben', () => {
  it('löscht eine Seite, die letzte bleibt stehen', () => {
    const two = insertPage(sample(), 1, 0);
    const doc = removePage(two, 0)!;
    expect(doc.pages).toEqual([two.pages[1]]);
    expect(removePage(doc, 0)).toBeNull();
  });

  it('verschiebt eine Seite an einen neuen Platz; gleicher Platz ändert nichts', () => {
    const three = renamePage(renamePage(insertPage(insertPage(sample(), 1, 0), 2, 0), 1, 'B')!, 2, 'C')!;
    const doc = movePage(three, 2, 0)!;
    expect(doc.pages.map((_, i) => pageLabel(doc, i))).toEqual(['C', 'Seite 2', 'B']);
    expect(movePage(three, 1, 1)).toBeNull();
  });
});

describe('Seite eines Objekts', () => {
  it('findet die Seite zu Ebene, Objekt und Gruppenkind; unbekannt = −1', () => {
    const doc = duplicatePage(sample(), 0, true);
    const copyLayer = doc.pages[1].layers[0];
    const inner = copyLayer.children[1].type === 'group' ? copyLayer.children[1].children[0].id : '';
    expect([pageIndexOf(doc, 'a'), pageIndexOf(doc, 'b'), pageIndexOf(doc, copyLayer.id), pageIndexOf(doc, inner)]).toEqual([0, 0, 1, 1]);
    expect(pageIndexOf(doc, 'fehlt')).toBe(-1);
  });
});
