import { describe, expect, it } from 'vitest';
import { createDocument } from '../../src/model/document';
import { insertPage } from '../../src/model/pages';
import {
  DEFAULT_GRID,
  addGuide,
  fromUser,
  gridOf,
  guideAt,
  guidesOf,
  lockGuides,
  moveGuide,
  originOf,
  removeGuides,
  setGrid,
  setOrigin,
  toUser,
} from '../../src/model/guides';

// A4 hochkant: Modell oben links, y nach unten; Anzeige wie Vorbild ab Nullpunkt, y nach oben.
const a4 = () => createDocument(210, 297);

describe('Nullpunkt', () => {
  it('liegt ohne Angabe unten links auf der Seite', () => {
    expect(originOf(a4())).toEqual({ x: 0, y: 297 });
  });

  it('rechnet Seitenpunkte in Anzeige-Koordinaten mit y nach oben um und zurück', () => {
    const doc = a4();
    expect(toUser(doc, 10, 287)).toEqual([10, 10]);
    expect(fromUser(doc, 10, 10)).toEqual([10, 287]);
    const moved = setOrigin(doc, { x: 105, y: 148.5 })!;
    expect(toUser(moved, 115, 138.5)).toEqual([10, 10]);
    expect(fromUser(moved, -5, -1.5)).toEqual([100, 150]);
  });

  it('setOrigin ist ein Schritt, null setzt zurück, gleicher Wert = nichts zu tun', () => {
    const doc = setOrigin(a4(), { x: 20, y: 30 })!;
    expect(doc.origin).toEqual({ x: 20, y: 30 });
    expect(setOrigin(doc, { x: 20, y: 30 })).toBeNull();
    expect(setOrigin(doc, null)!.origin).toBeUndefined();
    expect(setOrigin(a4(), null)).toBeNull();
  });
});

describe('Hilfslinien', () => {
  it('fügt waagerechte und senkrechte Linien der Seite hinzu', () => {
    const doc = addGuide(addGuide(a4(), 'h', 50, 'g1'), 'v', 30, 'g2');
    expect(guidesOf(doc)).toEqual([
      { id: 'g1', axis: 'h', pos: 50 },
      { id: 'g2', axis: 'v', pos: 30 },
    ]);
  });

  it('verschiebt eine Linie; gesperrt oder gleiche Lage = nichts zu tun', () => {
    const doc = addGuide(a4(), 'h', 50, 'g1');
    expect(guidesOf(moveGuide(doc, 'g1', 60)!)[0].pos).toBe(60);
    expect(moveGuide(doc, 'g1', 50)).toBeNull();
    expect(moveGuide(lockGuides(doc, ['g1'], true)!, 'g1', 60)).toBeNull();
    expect(moveGuide(doc, 'fehlt', 60)).toBeNull();
  });

  it('löscht nur entsperrte Linien', () => {
    let doc = addGuide(addGuide(a4(), 'h', 50, 'g1'), 'v', 30, 'g2');
    doc = lockGuides(doc, ['g2'], true)!;
    const after = removeGuides(doc, ['g1', 'g2'])!;
    expect(guidesOf(after).map((g) => g.id)).toEqual(['g2']);
    expect(removeGuides(after, ['g2'])).toBeNull();
  });

  it('sperrt und entsperrt; ohne Änderung = nichts zu tun', () => {
    const doc = addGuide(a4(), 'v', 30, 'g1');
    const locked = lockGuides(doc, ['g1'], true)!;
    expect(guidesOf(locked)[0].locked).toBe(true);
    expect(lockGuides(locked, ['g1'], true)).toBeNull();
    expect(guidesOf(lockGuides(locked, ['g1'], false)!)[0].locked).toBeUndefined();
  });

  it('trifft die nächste Linie innerhalb der Toleranz', () => {
    const doc = addGuide(addGuide(addGuide(a4(), 'h', 50, 'g1'), 'v', 30, 'g2'), 'v', 31, 'g3');
    expect(guideAt(guidesOf(doc), 100, 51, 1.5)?.id).toBe('g1');
    expect(guideAt(guidesOf(doc), 30.8, 200, 1.5)?.id).toBe('g3');
    expect(guideAt(guidesOf(doc), 100, 200, 1.5)).toBeUndefined();
  });
});

describe('Hilfslinien auf mehreren Seiten', () => {
  it('jede Seite hat ihre eigenen Linien; Ändern per ID wirkt auf jeder Seite', () => {
    const two = insertPage(a4(), 1, 0);
    let doc = addGuide(addGuide(two, 'h', 50, 'g1'), 'v', 30, 'g2', 1);
    expect(guidesOf(doc).map((g) => g.id)).toEqual(['g1']);
    expect(guidesOf(doc, 1).map((g) => g.id)).toEqual(['g2']);
    doc = moveGuide(doc, 'g2', 40)!;
    doc = lockGuides(doc, ['g2'], true)!;
    expect(guidesOf(doc, 1)).toEqual([{ id: 'g2', axis: 'v', pos: 40, locked: true }]);
    doc = removeGuides(lockGuides(doc, ['g2'], false)!, ['g2'])!;
    expect(guidesOf(doc, 1)).toEqual([]);
    expect(guidesOf(doc).map((g) => g.id)).toEqual(['g1']);
  });
});

describe('Raster', () => {
  it('hat einen Vorgabe-Abstand und speichert eigene Werte', () => {
    expect(gridOf(a4())).toEqual({ x: DEFAULT_GRID, y: DEFAULT_GRID });
    const doc = setGrid(a4(), 5, 2.5)!;
    expect(gridOf(doc)).toEqual({ x: 5, y: 2.5 });
    expect(setGrid(doc, 5, 2.5)).toBeNull();
  });

  it('lehnt Abstände ≤ 0 ab', () => {
    expect(() => setGrid(a4(), 0, 5)).toThrow('Rasterabstand muss größer als 0 sein.');
  });
});
