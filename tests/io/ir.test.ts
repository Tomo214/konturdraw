import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromIr, placeImport, toIr, type IrItem, type IrPattern, type IrScene } from '../../src/io/ir';
import { addLayer, addNodes, createDocument, updateLayer } from '../../src/model/document';
import { IDENTITY, multiply, scale, translate } from '../../src/model/geometry';

const IDENTITY_T = translate(0, 0);
import type { Doc, Node, Pattern, Stroke } from '../../src/model/types';
import { square } from '../model/fixtures';
import { goldenPage, PROBES } from '../render/golden-scene';

const FIXTURE = 'tests/fixtures/golden-scene.json';
const stroke = (width: number, scaleWithObject = false): Stroke => ({ color: { model: 'rgb', values: [0, 0, 0] }, width, cap: 'butt', join: 'miter', scaleWithObject });

function docWith(nodes: Node[]): Doc {
  const doc = createDocument(100, 50);
  return addNodes(doc, doc.pages[0].layers[0].id, nodes);
}

const path = (it: IrItem) => (it.kind === 'path' ? it : null);

describe('toIr', () => {
  // Die Rust-Export-Tests lesen dieselbe Datei → TS-Modell und kw-core prüfen gegen eine Szene.
  it('Golden-Szene = Vorlage für kw-core', () => {
    const want = { scene: toIr(goldenPage()), probes: PROBES };
    if (process.env.FIXTURE_UPDATE) writeFileSync(FIXTURE, JSON.stringify(want, null, 1) + '\n');
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(want);
  });

  it('Seitengröße und Formen als Bézier-Teilpfade', () => {
    const ir = toIr(goldenPage());
    expect([ir.width, ir.height]).toEqual([200, 140]);
    expect(ir.items).toHaveLength(20); // Rahmen = Füllung, Beschneidung, Kontur; + 2 Musterobjekte
    expect(path(ir.items[10])?.fillRule).toBe('evenodd');
    expect(path(ir.items[0])?.subpaths[0].nodes).toHaveLength(4);
    expect(path(ir.items[2])?.subpaths[0].nodes.every((n) => n.handleIn && n.handleOut)).toBe(true);
  });

  it('Konturbreite in Seiten-mm: fest bleibt, mitskalierend × Maßstab', () => {
    const fixed = { ...square('a'), style: { fill: null, stroke: stroke(1) }, transform: scale(3, 3) };
    const scaled = { ...square('b'), style: { fill: null, stroke: stroke(1, true) }, transform: scale(3, 3) };
    const ir = toIr(docWith([fixed, scaled]).pages[0]);
    expect(ir.items.map((it) => path(it)?.stroke?.width)).toEqual([1, 3]);
    expect(path(ir.items[0])?.stroke).toEqual({ color: { model: 'rgb', values: [0, 0, 0] }, width: 1, cap: 'butt', join: 'miter' });
  });

  it('Strichmuster: im Modell × Breite, im IR in Seiten-mm, Rückweg wieder × Breite', () => {
    const fixed = { ...square('a'), style: { fill: null, stroke: { ...stroke(2), dash: [3, 1] } }, transform: scale(3, 3) };
    const scaled = { ...square('b'), style: { fill: null, stroke: { ...stroke(1, true), dash: [3, 1] } }, transform: scale(3, 3) };
    const ir = toIr(docWith([fixed, scaled]).pages[0]);
    expect(ir.items.map((it) => path(it)?.stroke?.dash)).toEqual([[6, 2], [9, 3]]);
    const back = fromIr(ir.items).map((n) => (n.type === 'path' ? n.style.stroke : null));
    expect(back.map((s) => [s?.width, s?.dash])).toEqual([[2, [3, 1]], [3, [3, 1]]]);
    const hair = fromIr([{ ...ir.items[0], stroke: { ...path(ir.items[0])!.stroke!, width: 0 } } as IrItem])[0];
    expect(hair.type === 'path' && hair.style.stroke).not.toHaveProperty('dash');
  });

  it('Gruppen: Weltmatrix landet am Blatt', () => {
    const g: Node = { type: 'group', id: 'g', transform: translate(10, 0), children: [square('a', 5, 0)] };
    expect(toIr(docWith([g]).pages[0]).items[0].matrix).toEqual([1, 0, 0, 1, 15, 0]);
  });

  it('unsichtbare und nicht druckbare Ebenen fehlen', () => {
    let doc = docWith([square('a')]);
    doc = addLayer(doc, 0, 'Hilfslinien');
    const helper = doc.pages[0].layers[1].id;
    doc = addNodes(doc, helper, [square('b')]);
    doc = updateLayer(doc, helper, { printable: false });
    expect(toIr(doc.pages[0]).items).toHaveLength(1);
    doc = updateLayer(doc, doc.pages[0].layers[0].id, { visible: false });
    expect(toIr(doc.pages[0]).items).toHaveLength(0);
  });

  it('Bild: Weltmatrix, Größe in mm, Hash', () => {
    const img: Node = { type: 'image', id: 'i', transform: translate(5, 2), image: 'abc', width: 20, height: 10 };
    const g: Node = { type: 'group', id: 'g', transform: translate(1, 0), children: [img] };
    const ir = toIr(docWith([g]).pages[0]);
    expect(ir.items).toEqual([{ kind: 'image', matrix: [1, 0, 0, 1, 6, 2], width: 20, height: 10, image: 'abc' }]);
    expect(toIr(docWith([g]).pages[0], new Set(['g']))).toMatchObject({ width: 20, height: 10 });
  });

  it('Bild-Transparenz: nur unter 1 im IR, Rückweg setzt sie wieder', () => {
    const img: Node = { type: 'image', id: 'i', transform: translate(5, 2), image: 'abc', width: 20, height: 10, opacity: 0.5 };
    const [item] = toIr(docWith([img]).pages[0]).items;
    expect(item).toEqual({ kind: 'image', matrix: [1, 0, 0, 1, 5, 2], width: 20, height: 10, image: 'abc', opacity: 0.5 });
    expect(fromIr([item])[0]).toMatchObject({ type: 'image', opacity: 0.5 });
    expect('opacity' in fromIr([{ ...item, opacity: undefined } as IrItem])[0]).toBe(false);
  });

  it('Transparenz: Pfade und Bilder tragen das Produkt der Kette, Rückweg setzt sie am Pfad', () => {
    const img: Node = { type: 'image', id: 'i', transform: IDENTITY_T, image: 'abc', width: 20, height: 10, opacity: 0.5 };
    const g: Node = { type: 'group', id: 'g', transform: IDENTITY_T, opacity: 0.5, children: [{ ...square('a'), opacity: 0.5 }, img] };
    const [p, i] = toIr(docWith([g]).pages[0]).items;
    expect(p).toMatchObject({ kind: 'path', opacity: 0.25 });
    expect(i).toMatchObject({ kind: 'image', opacity: 0.25 });
    expect('opacity' in toIr(docWith([square('b')]).pages[0]).items[0]).toBe(false);
    expect(fromIr([p])[0]).toMatchObject({ type: 'path', opacity: 0.25 });
    expect('opacity' in fromIr([{ ...p, opacity: undefined } as IrItem])[0]).toBe(false);
  });

  it('nur Auswahl: Fläche = Box inkl. halber Kontur, auf 0/0 verschoben', () => {
    const a = { ...square('a', 20, 10), style: { fill: null, stroke: stroke(2) } };
    const ir = toIr(docWith([a, square('b', 60, 10)]).pages[0], new Set(['a']));
    expect(ir.items).toHaveLength(1);
    expect([ir.width, ir.height]).toEqual([12, 12]);
    expect(ir.items[0].matrix).toEqual(multiply(translate(-19, -9), translate(20, 10)));
  });
});

const pageOf = (ir: IrScene, nodes: Node[]) => {
  const doc = createDocument(ir.width, ir.height);
  return addNodes(doc, doc.pages[0].layers[0].id, nodes).pages[0];
};

describe('fromIr', () => {

  it('Rundreise toIr → fromIr → toIr: Golden-Szene unverändert', () => {
    const ir = toIr(goldenPage());
    expect(toIr(pageOf(ir, fromIr(ir.items)))).toEqual(ir);
  });

  it('Gruppen bleiben Gruppen, Bilder werden Bildknoten, neue IDs', () => {
    const items: IrItem[] = [
      { kind: 'group', matrix: scale(2, 2), children: [{ kind: 'image', matrix: translate(1, 1), width: 4, height: 3, image: 'h' }] },
    ];
    const [g] = fromIr(items);
    expect(g).toMatchObject({ type: 'group', transform: scale(2, 2), children: [{ type: 'image', image: 'h', width: 4, height: 3 }] });
    const ids = [g.id, g.type === 'group' ? g.children[0].id : ''];
    expect(new Set(ids).size).toBe(2);
    expect(toIr(pageOf({ width: 50, height: 50, items }, [g])).items[0].matrix).toEqual([2, 0, 0, 2, 2, 2]);
  });

  it('Kontur bleibt in Seiten-mm, auch wenn die Gruppe skaliert', () => {
    const sq = toIr(docWith([{ ...square('a'), style: { fill: null, stroke: stroke(0.7) } }]).pages[0]).items[0];
    const [g] = fromIr([{ kind: 'group', matrix: scale(3, 3), children: [sq] }]);
    expect(path(toIr(pageOf({ width: 50, height: 50, items: [] }, [g])).items[0])?.stroke?.width).toBe(0.7);
  });
});

describe('Musterfüllung', () => {
  const RED = { model: 'rgb' as const, values: [1, 0, 0] as const };
  const tile = [square('t', 0, 0, 2)];
  const filled = (): Node => ({ ...square('a', 10, 5), style: { fill: { kind: 'pattern', width: 4, height: 4, matrix: [2, 0, 0, 2, 1, 1], tile, twoColor: { name: 'Punkte', fg: RED, bg: RED } }, stroke: null } });

  it('toIr: Kachel als IR-Objekte in Kachel-Koordinaten, Matrix Kachel → Objekt, Vorlagenname entfällt', () => {
    const f = path(toIr(docWith([filled()]).pages[0]).items[0])!.fill as IrPattern;
    expect(f).toEqual({ kind: 'pattern', width: 4, height: 4, matrix: [2, 0, 0, 2, 1, 1], items: toIr({ id: '', width: 4, height: 4, layers: [{ id: 'l', name: '', visible: true, locked: false, printable: true, children: tile }] }).items });
    expect(path(f.items[0])!.matrix).toEqual(IDENTITY_T);
  });

  it('fromIr: Kachel wird wieder Modell-Kachel; Rundreise gleich', () => {
    const ir = toIr(docWith([filled()]).pages[0]);
    const back = fromIr(ir.items);
    const fill = (back[0] as Extract<Node, { type: 'path' }>).style.fill as Pattern;
    expect(fill.kind).toBe('pattern');
    expect(fill.tile[0].type).toBe('path');
    expect(fill.twoColor).toBeUndefined();
    expect(toIr(docWith(back).pages[0])).toEqual(ir);
  });
});

describe('placeImport', () => {
  const page = createDocument(200, 100).pages[0];

  it('mittig auf der Seite, SVG behält seine Größe', () => {
    expect(placeImport(page, { width: 300, height: 50, items: [] }, false)).toEqual(translate(-50, 25));
  });

  it('Pixelbild: zu groß → auf Seite eingepasst und mittig', () => {
    expect(placeImport(page, { width: 400, height: 100, items: [] }, true)).toEqual(multiply(translate(0, 25), scale(0.5, 0.5)));
    expect(placeImport(page, { width: 20, height: 10, items: [] }, true)).toEqual(translate(90, 45));
  });
});

describe('Rahmen mit Inhalt', () => {
  const black = { model: 'rgb' as const, values: [0, 0, 0] as const };
  // Kurzform: Pfad = [Matrix-Versatz, Füllung?, Kontur?, Deckkraft], Beschneidung = ['clip', Regel, Kinder]
  const brief = (it: IrItem): unknown =>
    it.kind === 'clip'
      ? ['clip', it.matrix.slice(4), it.fillRule ?? 'nonzero', it.children.map(brief)]
      : it.kind === 'path' ? [it.matrix.slice(4), !!it.fill, !!it.stroke, it.opacity ?? 1] : it.kind;

  it('toIr: Füllung, Beschneidung mit dem Inhalt in Weltlage, Kontur; leere Teile entfallen, Deckkraft wirkt auf alles', () => {
    const inner = { ...square('i', 0, 0, 10), fillRule: 'evenodd' as const, contents: [square('b')] };
    const f = { ...square('f', 10, 10, 20), style: { fill: black, stroke: stroke(1) }, opacity: 0.5, contents: [square('a', 5, 5), inner] };
    expect(toIr(docWith([f]).pages[0]).items.map(brief)).toEqual([
      [[10, 10], true, false, 0.5],
      ['clip', [10, 10], 'nonzero', [
        [[15, 15], true, false, 0.5],
        [[10, 10], true, false, 0.5],
        ['clip', [10, 10], 'evenodd', [[[10, 10], true, false, 0.5]]],
      ]],
      [[10, 10], false, true, 0.5],
    ]);
  });

  it('toIr mit Auswahl: Fläche = Rahmen (Inhalt außerhalb zählt nicht), Versatz auch im Inhalt', () => {
    const f = { ...square('f', 10, 10, 20), contents: [square('a', 30, 30)] };
    const ir = toIr(docWith([f]).pages[0], new Set(['f']));
    expect([ir.width, ir.height]).toEqual([20, 20]);
    expect(ir.items.map(brief)).toEqual([[[0, 0], true, false, 1], ['clip', [0, 0], 'nonzero', [[[30, 30], true, false, 1]]]]);
  });

  it('fromIr: Beschneidung wird unsichtbarer Rahmen, Inhalt in seinen Koordinaten; Rundreise gleich', () => {
    const sq = toIr(docWith([square('x', 7, 7)]).pages[0]).items[0];
    const items: IrItem[] = [{ kind: 'clip', matrix: translate(5, 5), subpaths: square('c').subpaths, fillRule: 'evenodd', children: [sq] }];
    const [f] = fromIr(items);
    expect(f).toMatchObject({ type: 'path', transform: translate(5, 5), style: { fill: null, stroke: null }, fillRule: 'evenodd', contents: [{ type: 'path', transform: translate(2, 2) }] });
    expect(toIr(pageOf({ width: 50, height: 50, items }, [f])).items.map(brief)).toEqual([['clip', [5, 5], 'evenodd', [[[7, 7], true, false, 1]]]]);
    // Nicht umkehrbare Matrix: Umriss wird eingerechnet, Inhalt behält seine Matrizen.
    const [flat] = fromIr([{ ...items[0], matrix: scale(0, 1) }] as IrItem[]);
    expect(flat).toMatchObject({ transform: IDENTITY, contents: [{ transform: translate(7, 7) }] });
  });
});
