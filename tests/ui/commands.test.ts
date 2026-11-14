import { describe, expect, it } from 'vitest';
import { addLayer, addNodes, createDocument, findNode } from '../../src/model/document';
import { insertPage, pageLabel, renamePage } from '../../src/model/pages';
import { IDENTITY } from '../../src/model/geometry';
import { isPattern } from '../../src/model/pattern';
import type { Doc, Node } from '../../src/model/types';
import { MM_TO_PX, fitBox, fitPage, screenToPage } from '../../src/render/viewport';
import { editCommand, pageCommand, pickToggle, viewCommand } from '../../src/ui/commands';

const rect = (id: string, x = 0): Node => ({
  type: 'shape',
  id,
  transform: IDENTITY,
  style: { fill: null, stroke: null },
  shape: { kind: 'rect', x, y: 0, width: 10, height: 5, radius: 0 },
});

function docWith(...nodes: Node[]): Doc {
  const doc = createDocument();
  return addNodes(doc, doc.pages[0].layers[0].id, nodes);
}

const ids = (doc: Doc) => doc.pages[0].layers[0].children.map((n) => n.id);

describe('editCommand', () => {
  it('Ausschneiden: Objekte weg, in der Ablage, Auswahl leer', () => {
    const r = editCommand(docWith(rect('a'), rect('b')), ['a'], { name: 'cut' }, [])!;
    expect(ids(r.doc!)).toEqual(['b']);
    expect(r.clipboard!.map((n) => n.id)).toEqual(['a']);
    expect(r.selected!.size).toBe(0);
  });

  it('In Rahmen einfügen (Ziel zuletzt gewählt) und Inhalt herausnehmen', () => {
    const r = editCommand(docWith(rect('a'), rect('f', 20)), ['a', 'f'], { name: 'frameInsert' }, [])!;
    expect(ids(r.doc!)).toEqual(['f']);
    expect([...r.selected!]).toEqual(['f']);
    const back = editCommand(r.doc!, ['f'], { name: 'frameExtract' }, [])!;
    expect(ids(back.doc!)).toEqual(['f', 'a']);
    expect([...back.selected!]).toEqual(['a']);
  });

  it('Muster aus Auswahl: Ziel (zuletzt gewählt) bekommt die Kachel, Originale bleiben, nur Ziel gewählt', () => {
    const r = editCommand(docWith(rect('a'), rect('f', 20)), ['a', 'f'], { name: 'patternFromSelection' }, [])!;
    expect(ids(r.doc!)).toEqual(['a', 'f']);
    expect([...r.selected!]).toEqual(['f']);
    const f = r.doc!.pages[0].layers[0].children[1];
    expect(f.type !== 'group' && f.type !== 'image' && isPattern(f.style.fill)).toBe(true);
  });

  it('Einfügen nach Ausschneiden: neue IDs, eingefügtes gewählt', () => {
    const cut = editCommand(docWith(rect('a')), ['a'], { name: 'cut' }, [])!;
    const r = editCommand(cut.doc!, [], { name: 'paste' }, cut.clipboard!)!;
    const [id] = ids(r.doc!);
    expect(id).not.toBe('a');
    expect([...r.selected!]).toEqual([id]);
  });

  it('Kopieren ändert das Dokument nicht', () => {
    const r = editCommand(docWith(rect('a')), ['a'], { name: 'copy' }, [])!;
    expect(r.doc).toBeUndefined();
    expect(r.clipboard!.map((n) => n.id)).toEqual(['a']);
  });

  it('Einfügen mit leerer Ablage tut nichts', () => {
    expect(editCommand(docWith(rect('a')), [], { name: 'paste' }, [])).toBeNull();
  });

  it('Gruppieren braucht zwei Objekte', () => {
    expect(editCommand(docWith(rect('a')), ['a'], { name: 'group' }, [])).toBeNull();
    const r = editCommand(docWith(rect('a'), rect('b')), ['a', 'b'], { name: 'group' }, [])!;
    expect(ids(r.doc!)).toEqual([...r.selected!]);
  });

  it('Verschieben in Schritten, Vorgabe 0,1 mm', () => {
    const r = editCommand(docWith(rect('a')), ['a'], { name: 'nudge', dx: 1, dy: -10 }, [])!;
    expect(findNode(r.doc!, 'a')!.transform).toEqual([1, 0, 0, 1, 0.1, -1]);
  });

  it('Verschiebe-Schritt aus dem Dokument', () => {
    const doc = { ...docWith(rect('a')), nudge: 2.5 };
    const r = editCommand(doc, ['a'], { name: 'nudge', dx: -1, dy: 10 }, [])!;
    expect(findNode(r.doc!, 'a')!.transform).toEqual([1, 0, 0, 1, -2.5, 25]);
  });

  it('Ausrichten, Verteilen, Spiegeln und Maßfelder: je ein Dokument = ein Rückgängig-Schritt', () => {
    const doc = docWith(rect('a'), rect('b', 30), rect('c', 100));
    const left = (d: Doc, id: string) => {
      const n = findNode(d, id)!;
      return n.type === 'shape' ? n.shape.x + n.transform[4] : NaN;
    };
    expect(left(editCommand(doc, ['a', 'b'], { name: 'align', edge: 'right' }, [])!.doc!, 'a')).toBeCloseTo(30, 9);
    expect(left(editCommand(doc, ['a', 'b', 'c'], { name: 'distribute', mode: 'left', to: 'selection' }, [])!.doc!, 'b')).toBeCloseTo(50, 9);
    expect(findNode(editCommand(doc, ['a'], { name: 'mirror', axis: 'h' }, [])!.doc!, 'a')!.transform[0]).toBe(-1);
    expect(left(editCommand(doc, ['a'], { name: 'field', field: 'x', value: 50, locked: false }, [])!.doc!, 'a')).toBeCloseTo(45, 9);
  });

  it('Transformieren mit Kopien: ein Schritt, gewählt = letzte Kopie; ohne Wirkung → null', () => {
    const doc = docWith(rect('a'));
    const t = { kind: 'position', x: 20, y: 0, relative: true } as const;
    const r = editCommand(doc, ['a'], { name: 'transform', t, anchor: 'c', copies: 2 }, [])!;
    expect(ids(r.doc!)).toHaveLength(3);
    expect([...r.selected!]).toEqual([ids(r.doc!)[2]]);
    expect(editCommand(doc, ['a'], { name: 'transform', t: { ...t, x: 0 }, anchor: 'c', copies: 0 }, [])).toBeNull();
  });

  it('nichts zu tun (Bezug schon ausgerichtet, nichts gewählt) → kein Schritt', () => {
    const doc = docWith(rect('a'), rect('b'));
    expect(editCommand(doc, ['a', 'b'], { name: 'align', edge: 'left' }, [])).toBeNull();
    expect(editCommand(doc, [], { name: 'mirror', axis: 'v' }, [])).toBeNull();
  });

  it('Seitengröße, Einheit und Verschiebe-Schritt landen im Dokument', () => {
    const r = editCommand(docWith(rect('a')), [], { name: 'pageSize', width: 297, height: 210 }, [])!;
    expect(r.doc!.pages[0]).toMatchObject({ width: 297, height: 210 });
    const s = editCommand(r.doc!, [], { name: 'settings', units: 'in', nudge: 0.5 }, [])!;
    expect(s.doc).toMatchObject({ units: 'in', nudge: 0.5 });
    // Unverändert → kein leerer Rückgängig-Schritt.
    expect(editCommand(r.doc!, [], { name: 'pageSize', width: 297, height: 210 }, [])).toBeNull();
    expect(editCommand(s.doc!, [], { name: 'settings', units: 'in' }, [])).toBeNull();
    expect(() => editCommand(r.doc!, [], { name: 'pageSize', width: 0, height: 10 }, [])).toThrow(/Seitengröße/);
    expect(() => editCommand(r.doc!, [], { name: 'settings', nudge: -1 }, [])).toThrow(/Verschiebe-Schritt/);
  });

  it('Seitengröße gilt für alle Seiten', () => {
    const r = editCommand(insertPage(docWith(), 1, 0), [], { name: 'pageSize', width: 100, height: 80 }, [])!;
    expect(r.doc!.pages.map((p) => [p.width, p.height])).toEqual([[100, 80], [100, 80]]);
  });

  it('Einfügen und neue Hilfslinie landen auf der aktuellen Seite, Einfügen auf der gewählten Ebene', () => {
    const doc = addLayer(insertPage(docWith(rect('a')), 1, 0), 1, 'Oben');
    const [low] = doc.pages[1].layers;
    const r = editCommand(doc, [], { name: 'paste' }, [rect('x')], { page: 1, layer: low.id })!;
    expect(r.doc!.pages[1].layers[0].children).toHaveLength(1);
    expect(r.doc!.pages[1].layers[1].children).toHaveLength(0);
    const g = editCommand(doc, [], { name: 'addGuide', axis: 'h', pos: 3 }, [], { page: 1 })!;
    expect(g.doc!.pages[1].guides).toHaveLength(1);
    expect(g.doc!.pages[0].guides).toBeUndefined();
  });

  it('Ansicht-Befehle sind keine Dokument-Befehle', () => {
    expect(editCommand(docWith(rect('a')), ['a'], { name: 'zoomIn' }, [])).toBeNull();
  });

  it('Hilfslinien, Nullpunkt und Raster: je ein Schritt, Unverändertes → null', () => {
    const add = editCommand(docWith(), [], { name: 'addGuide', axis: 'v', pos: 12 }, [])!;
    const [g] = add.doc!.pages[0].guides!;
    expect(g).toMatchObject({ axis: 'v', pos: 12 });
    const moved = editCommand(add.doc!, [], { name: 'guide', id: g.id, pos: 30 }, [])!;
    expect(moved.doc!.pages[0].guides![0].pos).toBe(30);
    const locked = editCommand(moved.doc!, [], { name: 'guide', id: g.id, locked: true }, [])!;
    expect(locked.doc!.pages[0].guides![0].locked).toBe(true);
    expect(editCommand(locked.doc!, [], { name: 'guide', id: g.id, pos: 40 }, [])).toBeNull();
    const o = editCommand(docWith(), [], { name: 'origin', at: { x: 5, y: 6 } }, [])!;
    expect(o.doc!.origin).toEqual({ x: 5, y: 6 });
    expect(editCommand(o.doc!, [], { name: 'origin', at: null }, [])!.doc!.origin).toBeUndefined();
    expect(editCommand(docWith(), [], { name: 'origin', at: null }, [])).toBeNull();
    expect(editCommand(docWith(), [], { name: 'grid', x: 5, y: 2 }, [])!.doc!.grid).toEqual({ x: 5, y: 2 });
    expect(editCommand(docWith(), [], { name: 'grid', x: 10, y: 10 }, [])).toBeNull();
  });
});

describe('pickToggle (Leertaste wie Vorbild)', () => {
  it('von einem Werkzeug zur Auswahl und zurück', () => {
    expect(pickToggle('rect', null)).toEqual({ tool: 'select', prev: 'rect' });
    expect(pickToggle('select', 'rect')).toEqual({ tool: 'rect', prev: null });
  });

  it('Auswahl ohne Vorgänger bleibt Auswahl', () => {
    expect(pickToggle('select', null)).toEqual({ tool: 'select', prev: null });
  });
});

describe('viewCommand', () => {
  const vp = { x: 10, y: 20, zoom: 2 };
  const size = [800, 600] as const;
  const page = { width: 210, height: 297 };

  it('Vergrößern hält die Mitte fest', () => {
    const v = viewCommand(vp, size, { name: 'zoomIn' }, null, page)!;
    expect(v.zoom).toBeCloseTo(2.5);
    expect(screenToPage(v, 400, 300)).toEqual(screenToPage(vp, 400, 300).map((c) => expect.closeTo(c, 9)));
  });

  it('100 % = echte Millimeter', () => {
    expect(viewCommand(vp, size, { name: 'zoom100' }, null, page)!.zoom).toBe(MM_TO_PX);
  });

  it('Ganze Seite und Auswahl passen ein', () => {
    expect(viewCommand(vp, size, { name: 'zoomFit' }, null, page)).toEqual(fitPage(210, 297, 800, 600));
    const box = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(viewCommand(vp, size, { name: 'zoomSelection' }, box, page)).toEqual(fitBox(box, 800, 600));
  });

  it('Auswahl zeigen ohne Auswahl lässt die Ansicht stehen', () => {
    expect(viewCommand(vp, size, { name: 'zoomSelection' }, null, page)).toBe(vp);
  });

  it('Rollen verschiebt die Ansicht gegen die Richtung', () => {
    expect(viewCommand(vp, size, { name: 'scroll', dx: 40, dy: 0 }, null, page)).toEqual({ ...vp, x: -30 });
  });

  it('Dokument-Befehle sind keine Ansicht-Befehle', () => {
    expect(viewCommand(vp, size, { name: 'delete' }, null, page)).toBeNull();
  });
});

describe('pageCommand', () => {
  const three = () => renamePage(renamePage(insertPage(insertPage(docWith(), 1, 0), 2, 0), 0, 'A')!, 2, 'C')!;
  const labels = (doc: Doc) => doc.pages.map((_, i) => pageLabel(doc, i));

  it('Einfügen danach/davor: neue Seite wird die aktuelle', () => {
    const after = pageCommand(three(), 0, { name: 'page', op: 'insertAfter' })!;
    expect([labels(after.doc!), after.page]).toEqual([['A', 'Seite 2', 'Seite 3', 'C'], 1]);
    const before = pageCommand(three(), 0, { name: 'page', op: 'insertBefore' })!;
    expect([labels(before.doc!), before.page]).toEqual([['Seite 1', 'A', 'Seite 3', 'C'], 0]);
  });

  it('Duplizieren mit Inhalt oder nur Ebenen: Kopie dahinter wird aktuell', () => {
    const doc = docWith(rect('a'));
    const full = pageCommand(doc, 0, { name: 'page', op: 'duplicate' })!;
    expect([full.doc!.pages[1].layers[0].children.length, full.page]).toEqual([1, 1]);
    const empty = pageCommand(doc, 0, { name: 'page', op: 'duplicateLayers' })!;
    expect(empty.doc!.pages[1].layers[0].children).toHaveLength(0);
  });

  it('Löschen: Nachbar wird aktuell, letzte Seite bleibt', () => {
    const del = pageCommand(three(), 2, { name: 'page', op: 'delete' })!;
    expect([labels(del.doc!), del.page]).toEqual([['A', 'Seite 2'], 1]);
    expect(pageCommand(docWith(), 0, { name: 'page', op: 'delete' })).toBeNull();
  });

  it('Blättern ändert nur die aktuelle Seite und bleibt in den Grenzen', () => {
    const doc = three();
    const go = (cur: number, op: 'first' | 'prev' | 'next' | 'last') => pageCommand(doc, cur, { name: 'page', op });
    expect([go(1, 'first'), go(1, 'prev'), go(1, 'next'), go(0, 'last')]).toEqual([{ page: 0 }, { page: 0 }, { page: 2 }, { page: 2 }]);
    expect([go(0, 'prev'), go(2, 'next'), go(0, 'first')]).toEqual([null, null, null]);
  });
});
