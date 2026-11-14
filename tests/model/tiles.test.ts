import { describe, expect, it } from 'vitest';
import { PAPERS, tileLayout, toSheets } from '../../src/model/tiles';

const A4 = { paper: PAPERS.A4, margin: 5, overlap: 10 };

describe('Druck in Kacheln', () => {
  it('breite Seite: Spalten mit Überlappung, eine Reihe', () => {
    const l = tileLayout(400, 250, A4)!;
    expect([l.cols, l.rows, l.width, l.height]).toEqual([3, 1, 200, 287]);
    expect(l.tiles.map((t) => [t.label, t.x, t.y])).toEqual([
      ['A1', 0, 0],
      ['B1', 190, 0],
      ['C1', 380, 0],
    ]);
  });

  it('Reihen und Spalten: Reihenfolge zeilenweise, Spalten = Buchstaben', () => {
    const l = tileLayout(210, 600, A4)!;
    expect([l.cols, l.rows]).toEqual([2, 3]);
    expect(l.tiles.map((t) => [t.label, t.x, t.y])).toEqual([
      ['A1', 0, 0],
      ['B1', 190, 0],
      ['A2', 0, 277],
      ['B2', 190, 277],
      ['A3', 0, 554],
      ['B3', 190, 554],
    ]);
  });

  it('passt die Seite aufs Papier: ein Blatt ohne Passkreuze', () => {
    const l = tileLayout(150, 200, A4)!;
    expect(l.tiles).toEqual([{ x: 0, y: 0, label: 'A1', marks: [] }]);
  });

  it('Querformat dreht das Papier', () => {
    const l = tileLayout(400, 200, { ...A4, paper: { width: PAPERS.A4.height, height: PAPERS.A4.width } })!;
    expect([l.cols, l.rows, l.width, l.height]).toEqual([2, 1, 287, 200]);
  });

  it('kurzes Nahtstück: ein Kreuz in der Mitte', () => {
    expect(tileLayout(15, 400, A4)!.tiles.map((t) => t.marks)).toEqual([[{ x: 7.5, y: 282 }], [{ x: 7.5, y: 282 }]]);
  });

  it('Kreuzgröße passt in die Überlappung; ohne Überlappung keine Kreuze', () => {
    expect(tileLayout(400, 250, A4)!.mark).toBe(2.5);
    const thin = tileLayout(400, 250, { ...A4, overlap: 3 })!;
    expect(thin.mark).toBe(1.5);
    expect(thin.tiles[0].marks).toHaveLength(2);
    const none = tileLayout(400, 250, { ...A4, overlap: 0 })!;
    expect(none.cols).toBe(2);
    expect(none.tiles.flatMap((t) => t.marks)).toEqual([]);
  });

  it('Passkreuze mitten in der Überlappung, auf beiden Nachbarblättern, innerhalb der Seite', () => {
    const l = tileLayout(400, 250, A4)!;
    const [a, b, c] = l.tiles.map((t) => t.marks);
    expect(a).toEqual([{ x: 195, y: 10 }, { x: 195, y: 240 }]);
    expect(b).toEqual([{ x: 195, y: 10 }, { x: 195, y: 240 }, { x: 385, y: 10 }, { x: 385, y: 240 }]);
    expect(c).toEqual([{ x: 385, y: 10 }, { x: 385, y: 240 }]);
  });

  it('waagerechte Naht bekommt Kreuze in der Höhe der Überlappung', () => {
    const l = tileLayout(150, 400, A4)!;
    expect(l.tiles.map((t) => t.marks)).toEqual([
      [{ x: 10, y: 282 }, { x: 140, y: 282 }],
      [{ x: 10, y: 282 }, { x: 140, y: 282 }],
    ]);
  });

  it('für den Druck: Papier, Rand, Fläche; ohne Kachelmarken weder Kreuze noch Namen', () => {
    const l = tileLayout(400, 250, A4)!;
    const s = toSheets(l, A4, true);
    expect([s.paper, s.margin, s.area, s.mark]).toEqual([[210, 297], 5, [200, 287], 2.5]);
    expect(s.tiles).toEqual(l.tiles);
    expect(toSheets(l, A4, false).tiles).toEqual([
      { x: 0, y: 0, label: '', marks: [] },
      { x: 190, y: 0, label: '', marks: [] },
      { x: 380, y: 0, label: '', marks: [] },
    ]);
  });

  it('unmögliche Werte: kein Layout', () => {
    expect(tileLayout(400, 250, { ...A4, overlap: 200 })).toBeNull();
    expect(tileLayout(400, 250, { ...A4, margin: 110 })).toBeNull();
    expect(tileLayout(400, 250, { ...A4, overlap: -1 })).toBeNull();
    expect(tileLayout(0, 250, A4)).toBeNull();
  });
});
