import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromIr, placeImport, toIr, type IrItem, type IrScene } from '../../src/io/ir';
import { addLayer, addNodes, createDocument, updateLayer } from '../../src/model/document';
import { multiply, scale, translate } from '../../src/model/geometry';
import type { Doc, Node, Stroke } from '../../src/model/types';
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
    expect(ir.items).toHaveLength(12);
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

  it('nur Auswahl: Fläche = Box inkl. halber Kontur, auf 0/0 verschoben', () => {
    const a = { ...square('a', 20, 10), style: { fill: null, stroke: stroke(2) } };
    const ir = toIr(docWith([a, square('b', 60, 10)]).pages[0], new Set(['a']));
    expect(ir.items).toHaveLength(1);
    expect([ir.width, ir.height]).toEqual([12, 12]);
    expect(ir.items[0].matrix).toEqual(multiply(translate(-19, -9), translate(20, 10)));
  });
});

describe('fromIr', () => {
  const pageOf = (ir: IrScene, nodes: Node[]) => {
    const doc = createDocument(ir.width, ir.height);
    return addNodes(doc, doc.pages[0].layers[0].id, nodes).pages[0];
  };

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
