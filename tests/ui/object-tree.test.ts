import { describe, expect, it } from 'vitest';
import { addLayer, addNodes, createDocument, updateLayer } from '../../src/model/document';
import type { Doc } from '../../src/model/types';
import { insertPage } from '../../src/model/pages';
import { docRows, dragIds, dropFor, dropMark, edgeScroll, freshLayerName, idsIn, layerMove, reveal, rowIcon, treeKey, treeRows } from '../../src/ui/object-tree';
import { group, square } from '../model/fixtures';

// Ebene 1: a (unten), g = Gruppe aus b, c (oben). Ebene „Oben“: leer, liegt über Ebene 1.
function sample(): Doc {
  let doc = createDocument();
  doc = addNodes(doc, doc.pages[0].layers[0].id, [{ ...square('a'), name: 'Rose' }, group('g', [square('b'), square('c')])]);
  return addLayer(doc, 0, 'Oben');
}

const view = (doc: Doc, flip: string[] = []) =>
  treeRows(doc.pages[0], new Set(flip)).map((r) => `${'  '.repeat(r.depth)}${r.label}${r.open === null ? '' : r.open ? ' ▾' : ' ▸'}`);

describe('treeRows', () => {
  it('oberste Ebene und vorderstes Objekt zuerst; Ebenen offen, Gruppen zu; Name vor Objektart', () => {
    expect(view(sample())).toEqual(['Oben ▾', 'Ebene 1 ▾', '  Gruppe aus 2 Objekten ▸', '  Rose']);
  });

  it('flip klappt Gruppen auf und Ebenen zu; Kinder kennen Gruppe, Ebene und Nachbarn', () => {
    const doc = sample();
    const [low, high] = doc.pages[0].layers;
    expect(view(doc, ['g', high.id])).toEqual(['Oben ▸', 'Ebene 1 ▾', '  Gruppe aus 2 Objekten ▾', '    Kurve', '    Kurve', '  Rose']);
    const rows = treeRows(doc.pages[0], new Set(['g']));
    const b = rows.find((r) => r.id === 'b')!;
    expect([b.parent, b.layer.id, b.below]).toEqual(['g', low.id, null]);
    expect(rows.find((r) => r.id === 'c')!.below).toBe('b');
    expect(rows.find((r) => r.id === low.id)!.topChild).toBe('g');
  });
});

describe('reveal', () => {
  it('Strg-Klick-Auswahl im Baum sichtbar: Gruppe und Ebene darüber gehen auf, sonst bleibt alles', () => {
    const doc = sample();
    const low = doc.pages[0].layers[0].id;
    const flip = new Set([low]);
    expect(view(doc, [...reveal(doc.pages[0], flip, new Set(['b']))])).toEqual(['Oben ▾', 'Ebene 1 ▾', '  Gruppe aus 2 Objekten ▾', '    Kurve', '    Kurve', '  Rose']);
    // Nichts zu tun → dieselbe Menge (kein unnötiges Neuzeichnen), Zuklappen wird nie erzwungen.
    const open = new Set(['g']);
    expect(reveal(doc.pages[0], open, new Set(['a']))).toBe(open);
    expect(reveal(doc.pages[0], open, new Set())).toBe(open);
  });
});

describe('dropFor', () => {
  const at = (doc: Doc, id: string, flip: string[] = []) => {
    const rows = treeRows(doc.pages[0], new Set(flip));
    return [rows, rows.findIndex((r) => r.id === id)] as const;
  };

  it('Objekte: obere Hälfte = direkt darüber, untere = direkt darunter, Mitte einer Gruppe = hinein (oben)', () => {
    const doc = sample();
    const low = doc.pages[0].layers[0].id;
    expect(dropFor(...at(doc, 'a'), 'top', 'node')).toEqual({ container: low, above: 'a' });
    expect(dropFor(...at(doc, 'a'), 'bottom', 'node')).toEqual({ container: low, above: null });
    expect(dropFor(...at(doc, 'g'), 'bottom', 'node')).toEqual({ container: low, above: 'a' });
    expect(dropFor(...at(doc, 'g'), 'mid', 'node')).toEqual({ container: 'g', above: 'c' });
    expect(dropFor(...at(doc, 'g', ['g']), 'bottom', 'node')).toEqual({ container: 'g', above: 'c' });
  });

  it('Objekte auf eine Ebenen-Zeile: oben auf die Ebene; gesperrte Ebene nimmt nichts an', () => {
    let doc = sample();
    const high = doc.pages[0].layers[1].id;
    expect(dropFor(...at(doc, high), 'top', 'node')).toEqual({ container: high, above: null });
    doc = updateLayer(doc, high, { locked: true });
    expect(dropFor(...at(doc, high), 'mid', 'node')).toBeNull();
  });

  it('Ebenen: über oder unter eine andere Ebene; Objekt-Zeilen zählen als „unter ihrer Ebene“', () => {
    const doc = sample();
    const [low, high] = doc.pages[0].layers.map((l) => l.id);
    expect(dropFor(...at(doc, low), 'top', 'layer')).toEqual({ layerAbove: low });
    expect(dropFor(...at(doc, high), 'bottom', 'layer')).toEqual({ layerAbove: low });
    expect(dropFor(...at(doc, 'a'), 'top', 'layer')).toEqual({ layerAbove: null });
  });
});

describe('layerMove', () => {
  it('Zielplatz nach dem Herausnehmen; gleicher Platz = null', () => {
    const doc = addLayer(sample(), 0, 'Ganz oben');
    const [l0, l1, l2] = doc.pages[0].layers.map((l) => l.id);
    expect(layerMove(doc.pages[0], l2, null)).toBe(0);
    expect(layerMove(doc.pages[0], l0, l2)).toBe(2);
    expect(layerMove(doc.pages[0], l1, l0)).toBeNull();
    expect(layerMove(doc.pages[0], l1, l1)).toBeNull();
  });
});

describe('Helfer des Objekt-Managers', () => {
  it('neue Ebene heißt „Ebene n“ ohne Doppel', () => {
    const doc = sample();
    expect(freshLayerName(doc.pages[0])).toBe('Ebene 3');
    expect(freshLayerName(addLayer(doc, 0, 'Ebene 3').pages[0])).toBe('Ebene 4');
  });

  it('Symbol je Zeile: Ebene, Gruppe, Objektart', () => {
    expect(treeRows(sample().pages[0], new Set(['g'])).map(rowIcon)).toEqual(['layer', 'layer', 'group', 'freehand', 'freehand', 'freehand']);
  });

  it('gezogen wird die Auswahl, wenn die Zeile dazugehört, sonst nur die Zeile', () => {
    const rows = treeRows(sample().pages[0], new Set(['g']));
    const row = (id: string) => rows.find((r) => r.id === id)!;
    expect(dragIds(row('a'), new Set(['a', 'g']))).toEqual(['a', 'g']);
    expect(dragIds(row('a'), new Set(['g']))).toEqual(['a']);
    expect(dragIds(row('b'), new Set(['g']))).toEqual(['b']);
    expect(dragIds(row('b'), new Set(['b', 'a']))).toEqual(['b', 'a']);
  });

  it('idsIn: alle Objekte einer Ebene samt Gruppenkindern (fallen beim Sperren aus der Auswahl)', () => {
    expect(idsIn(sample().pages[0].layers[0].children)).toEqual(new Set(['a', 'g', 'b', 'c']));
  });
});

describe('docRows: alle Seiten wie Vorbild', () => {
  // Seite 1 wie sample, Seite 2 leer mit denselben Ebenen.
  const two = () => insertPage(sample(), 1, 0);
  const show = (doc: Doc, current: number, flip: string[] = []) =>
    docRows(doc, current, new Set(flip)).map((r) => `${'  '.repeat(r.depth)}${r.label}${r.open === null ? '' : r.open ? ' ▾' : ' ▸'}`);

  it('Seiten zuoberst; aktuelle Seite immer offen, andere zu, flip öffnet sie', () => {
    const doc = two();
    expect(show(doc, 0)).toEqual(['Seite 1', '  Oben ▾', '  Ebene 1 ▾', '    Gruppe aus 2 Objekten ▸', '    Rose', 'Seite 2 ▸']);
    expect(show(doc, 1)).toEqual(['Seite 1 ▸', 'Seite 2', '  Oben ▾', '  Ebene 1 ▾']);
    expect(show(doc, 0, [doc.pages[1].id]).slice(-3)).toEqual(['Seite 2 ▾', '  Oben ▾', '  Ebene 1 ▾']);
  });

  it('jede Zeile kennt ihre Seite; Seitenzeilen haben weder Objekt noch Ebene', () => {
    const doc = two();
    const rows = docRows(doc, 1, new Set([doc.pages[0].id]));
    expect(rows.find((r) => r.id === 'a')!.page).toBe(0);
    expect(rows.find((r) => r.id === doc.pages[1].layers[0].id)!.page).toBe(1);
    expect(rows[0]).toMatchObject({ page: 0, node: null, layer: null });
  });

  it('Ablegen: nicht auf Seitenzeilen; Ebenen nur innerhalb ihrer Seite, Objekte auch auf Ebenen anderer Seiten', () => {
    const doc = two();
    const rows = docRows(doc, 0, new Set([doc.pages[1].id]));
    const i = (id: string) => rows.findIndex((r) => r.id === id);
    const other = doc.pages[1].layers[0].id;
    expect(dropFor(rows, 0, 'mid', 'node')).toBeNull();
    expect(dropFor(rows, i(other), 'top', 'layer', 0)).toBeNull();
    expect(dropFor(rows, i(other), 'top', 'node')).toEqual({ container: other, above: null });
    expect(dropFor(rows, i(doc.pages[0].layers[0].id), 'top', 'layer', 0)).toEqual({ layerAbove: doc.pages[0].layers[0].id });
  });
});

describe('treeKey: Pfeiltasten im Baum', () => {
  // 0 Seite 1 · 1 Oben · 2 Ebene 1 · 3 Gruppe (zu) · 4 Rose · 5 Seite 2 (zu)
  const doc = insertPage(sample(), 1, 0);
  const rows = docRows(doc, 0, new Set());
  const low = doc.pages[0].layers[0].id;

  it('auf/ab = Nachbarzeile, an den Enden stehen bleiben; Pos1/Ende; ohne Zeile beginnt ab oben', () => {
    expect(treeKey(rows, 4, 'ArrowDown')).toEqual({ i: 5 });
    expect(treeKey(rows, 5, 'ArrowDown')).toEqual({ i: 5 });
    expect(treeKey(rows, 0, 'ArrowUp')).toEqual({ i: 0 });
    expect(treeKey(rows, -1, 'ArrowDown')).toEqual({ i: 0 });
    expect(treeKey(rows, 3, 'Home')).toEqual({ i: 0 });
    expect(treeKey(rows, 0, 'End')).toEqual({ i: 5 });
    expect(treeKey(rows, 2, 'a')).toBeNull();
  });

  it('rechts klappt auf bzw. geht zum ersten Kind, links klappt zu bzw. geht zur Elternzeile', () => {
    expect(treeKey(rows, 3, 'ArrowRight')).toEqual({ i: 3, toggle: 'g' });
    expect(treeKey(rows, 5, 'ArrowRight')).toEqual({ i: 5, toggle: doc.pages[1].id });
    expect(treeKey(rows, 2, 'ArrowRight')).toEqual({ i: 3 });
    expect(treeKey(rows, 0, 'ArrowRight')).toEqual({ i: 1 });
    expect(treeKey(rows, 4, 'ArrowRight')).toEqual({ i: 4 });
    expect(treeKey(rows, 2, 'ArrowLeft')).toEqual({ i: 2, toggle: low });
    expect(treeKey(rows, 3, 'ArrowLeft')).toEqual({ i: 2 });
    expect(treeKey(rows, 1, 'ArrowLeft')).toEqual({ i: 1, toggle: doc.pages[0].layers[1].id });
    expect(treeKey(rows, 0, 'ArrowLeft')).toEqual({ i: 0 });
  });
});

describe('edgeScroll: Rollen beim Ziehen an den Rand', () => {
  it('in der Mitte 0, am Rand bis max, je näher desto schneller, außerhalb gedeckelt', () => {
    expect(edgeScroll(150, 100, 400)).toBe(0);
    expect(edgeScroll(100, 100, 400)).toBe(-14);
    expect(edgeScroll(112, 100, 400)).toBe(-7);
    expect(edgeScroll(50, 100, 400)).toBe(-14);
    expect(edgeScroll(400, 100, 400)).toBe(14);
    expect(edgeScroll(900, 100, 400)).toBe(14);
  });
});

describe('dropMark: Ablagemarke im Baum', () => {
  // 0 Seite 1 · 1 Oben · 2 Ebene 1 · 3 Gruppe (zu) · 4 Rose · 5 Seite 2 (zu)
  const doc = insertPage(sample(), 1, 0);
  const rows = docRows(doc, 0, new Set());
  const [low, high] = doc.pages[0].layers.map((l) => l.id);

  it('Linie über der Zeile darunter; ganz unten auf einer Seite = vor der nächsten Seite, nicht am Listenende', () => {
    expect(dropMark(rows, { layerAbove: low }, 1, 0)).toEqual({ i: 2, into: false });
    expect(dropMark(rows, { layerAbove: null }, 4, 0)).toEqual({ i: 5, into: false });
    expect(dropMark(rows, { container: low, above: 'a' }, 3, 0)).toEqual({ i: 4, into: false });
  });

  it('in eine zugeklappte oder leere Ebene/Gruppe: Rahmen um den Container', () => {
    expect(dropMark(rows, { container: 'g', above: 'c' }, 3, 0)).toEqual({ i: 3, into: true });
    expect(dropMark(rows, { container: high, above: null }, 1, 0)).toEqual({ i: 1, into: true });
  });
});
