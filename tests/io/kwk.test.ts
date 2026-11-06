import { describe, expect, it } from 'vitest';
import { parseDocument, serialize, usedImages } from '../../src/io/kwk';
import { addNodes, createDocument } from '../../src/model/document';
import { translate } from '../../src/model/geometry';
import { createText } from '../../src/model/text';
import type { Doc, Node } from '../../src/model/types';
import { group, pt, square, sub } from '../model/fixtures';
import { goldenPage } from '../render/golden-scene';

const img = (id: string, hash: string): Node => ({ type: 'image', id, transform: translate(1, 2), image: hash, width: 4, height: 3 });

function sample(): Doc {
  const doc = { ...createDocument(200, 140), pages: [goldenPage()] };
  return addNodes(doc, doc.pages[0].layers[0].id, [group('g', [img('i', 'aa'), square('s')]), img('j', 'bb')]);
}

describe('.kwk-Dokument', () => {
  it('Rundreise serialize → parseDocument ist verlustfrei', () => {
    const doc = sample();
    expect(parseDocument(serialize(doc), new Set(['aa', 'bb']))).toEqual(doc);
  });

  it('usedImages findet Bilder auch in Gruppen, jeden Hash einmal', () => {
    const base = sample();
    const doc = addNodes(base, base.pages[0].layers[0].id, [img('k', 'aa')]);
    expect([...usedImages(doc)].sort()).toEqual(['aa', 'bb']);
  });

  it('Rahmen-Inhalt: Rundreise, Bilder darin zählen, Unsinn und fehlendes Bild → Fehler', () => {
    const base = sample();
    const doc = addNodes(base, base.pages[0].layers[0].id, [{ ...square('f'), contents: [img('m', 'cc'), square('n')] }]);
    expect([...usedImages(doc)].sort()).toEqual(['aa', 'bb', 'cc']);
    expect(parseDocument(serialize(doc), new Set(['aa', 'bb', 'cc']))).toEqual(doc);
    expect(() => parseDocument(serialize(doc), new Set(['aa', 'bb']))).toThrow(/Bild cc fehlt/);
    const d = JSON.parse(serialize(doc));
    d.pages[0].layers[0].children.at(-1).contents = 'x';
    expect(() => parseDocument(JSON.stringify(d), new Set(['aa', 'bb', 'cc']))).toThrow(/Rahmeninhalt/);
  });

  const bad = (mutate: (d: any) => void) => {
    const d = JSON.parse(serialize(sample()));
    mutate(d);
    return () => parseDocument(JSON.stringify(d), new Set(['aa', 'bb']));
  };

  it('lehnt Unlesbares mit deutscher Meldung ab', () => {
    expect(() => parseDocument('{kaputt', new Set())).toThrow(/kein gültiges JSON/);
    expect(bad((d) => (d.schemaVersion = 2))).toThrow(/neueren Konturwerk-Version/);
    expect(bad((d) => delete d.pages)).toThrow(/Seiten/);
    expect(bad((d) => (d.pages = []))).toThrow(/Seiten/);
  });

  it('Einheit und Verschiebe-Schritt: Rundreise, Unsinn → Fehler', () => {
    const doc = { ...sample(), units: 'cm' as const, nudge: 0.5 };
    expect(parseDocument(serialize(doc), new Set(['aa', 'bb']))).toEqual(doc);
    expect(bad((d) => (d.units = 'km'))).toThrow(/Einheit/);
    expect(bad((d) => (d.nudge = 0))).toThrow(/Verschiebe-Schritt/);
  });

  it('Nullpunkt, Raster und Hilfslinien: Rundreise, Unsinn → Fehler', () => {
    const base = sample();
    const guides = [{ id: 'g1', axis: 'h' as const, pos: 20 }, { id: 'g2', axis: 'v' as const, pos: -5.5, locked: true }];
    const doc = { ...base, origin: { x: 10, y: 130 }, grid: { x: 5, y: 2.5 }, pages: [{ ...base.pages[0], guides }] };
    expect(parseDocument(serialize(doc), new Set(['aa', 'bb']))).toEqual(doc);
    expect(bad((d) => (d.origin = { x: 1 }))).toThrow(/Nullpunkt/);
    expect(bad((d) => (d.grid = { x: 5, y: 0 }))).toThrow(/Raster/);
    expect(bad((d) => (d.pages[0].guides = [{ id: 'g', axis: 'd', pos: 1 }]))).toThrow(/Hilfslinie/);
    expect(bad((d) => (d.pages[0].guides = [{ id: 'g', axis: 'h', pos: 'x' }]))).toThrow(/Hilfslinie/);
    expect(bad((d) => (d.pages[0].guides = [{ id: 'g', axis: 'h', pos: 1, locked: 1 }]))).toThrow(/Hilfslinie/);
  });

  it('Seitenname: Rundreise, Unsinn → Fehler', () => {
    const base = sample();
    const doc = { ...base, pages: [{ ...base.pages[0], name: 'Vorne' }] };
    expect(parseDocument(serialize(doc), new Set(['aa', 'bb']))).toEqual(doc);
    expect(bad((d) => (d.pages[0].name = 7))).toThrow(/Seitenname/);
  });

  it('prüft Knoten bis in die Tiefe', () => {
    const top = (d: any) => d.pages[0].layers[0].children;
    expect(bad((d) => (top(d)[0].transform = [1, 0, 0, 1, 0]))).toThrow(/Matrix/);
    expect(bad((d) => (top(d)[0].transform[4] = 'x'))).toThrow(/Matrix/);
    expect(bad((d) => (top(d)[0].type = 'blob'))).toThrow(/Objektart/);
    expect(bad((d) => (top(d)[6].subpaths[0].nodes[1].x = null))).toThrow(/Zahl/);
    expect(bad((d) => (top(d)[0].style.fill.values = [1, 2]))).toThrow(/Farbe/);
    expect(bad((d) => (top(d).at(-2).children[0].width = -1))).toThrow(/Bild/);
  });

  it('Text samt Pfad und Umriss übersteht die Rundreise; kaputte Satzfelder → Fehler', () => {
    const onPath = { path: sub(false, pt(0, 0), pt(9, 0)), offset: 1, distance: 0, side: 'below' as const };
    const t = { ...createText('t', translate(3, 4), { onPath }), text: 'Ink', outline: [sub(true, pt(0, 0), pt(1, -2), pt(2, 0))] };
    const base = createDocument(100, 100);
    const json = serialize(addNodes(base, base.pages[0].layers[0].id, [t]));
    expect(parseDocument(json, new Set())).toEqual(JSON.parse(json));
    const broken = (f: (n: any) => void) => {
      const d = JSON.parse(json);
      f(d.pages[0].layers[0].children[0]);
      return () => parseDocument(JSON.stringify(d), new Set());
    };
    expect(broken((n) => (n.align = 'justify'))).toThrow(/Ausrichtung/);
    expect(broken((n) => (n.font.size = 'x'))).toThrow(/Schriftgröße/);
    expect(broken((n) => (n.text = 5))).toThrow(/Text/);
    expect(broken((n) => (n.onPath.side = 'links'))).toThrow(/Pfadseite/);
    expect(broken((n) => (n.frame = { width: -1, height: 5 }))).toThrow(/Rahmen/);
    expect(broken((n) => (n.outline[0].nodes[0].type = 'x'))).toThrow(/Knotenart/);
  });

  it('Farben: CMYK, Graustufen, Sonderfarben + Dokument-Farbeinstellungen', () => {
    const top = (d: any) => d.pages[0].layers[0].children;
    const ok = bad((d) => {
      top(d)[0].style.fill = { model: 'cmyk', values: [0, 1, 0, 0], spot: 'Stencil-Violett' };
      top(d)[0].style.stroke = { color: { model: 'gray', values: [0.5] }, width: 1, cap: 'butt', join: 'miter' };
      d.color = { mode: 'cmyk', cmykProfile: '/x/druck.icc', intent: 'perceptual' };
    });
    expect(ok().color).toEqual({ mode: 'cmyk', cmykProfile: '/x/druck.icc', intent: 'perceptual' });
    expect(bad((d) => (top(d)[0].style.fill = { model: 'cmyk', values: [0, 1, 0] }))).toThrow(/Farbe/);
    expect(bad((d) => (top(d)[0].style.fill = { model: 'gray', values: [1.5] }))).toThrow(/Farbe/);
    expect(bad((d) => (top(d)[0].style.fill = { model: 'lab', values: [0, 0, 0] }))).toThrow(/Farbe/);
    expect(bad((d) => (top(d)[0].style.fill = { model: 'rgb', values: [0, 0, 0], spot: '' }))).toThrow(/Sonderfarbe/);
    expect(bad((d) => (d.color = { mode: 'lab', cmykProfile: null, intent: 'relative' }))).toThrow(/Farbmodus/);
    expect(bad((d) => (d.color = { mode: 'rgb', cmykProfile: 5, intent: 'relative' }))).toThrow(/Profil/);
    expect(bad((d) => (d.color = { mode: 'rgb', cmykProfile: null, intent: 'bunt' }))).toThrow(/Wiedergabe/);
    expect(bad((d) => (d.palettes = [{ id: 'p', name: 'P', colors: [{ name: 'x', color: { model: 'rgb', values: [0] } }] }]))).toThrow(/Farbe/);
    expect(bad((d) => (d.palettes = [{ id: 'p', colors: [] }]))).toThrow(/Palette/);
  });

  it('Bild-Transparenz: Rundreise, Unsinn → Fehler', () => {
    const base = sample();
    const doc = addNodes(base, base.pages[0].layers[0].id, [{ ...img('t', 'aa'), opacity: 0.25 } as Node]);
    expect(parseDocument(serialize(doc), new Set(['aa', 'bb']))).toEqual(doc);
    expect(bad((d) => (d.pages[0].layers[0].children.at(-1).opacity = 2))).toThrow(/Deckkraft/);
    expect(bad((d) => (d.pages[0].layers[0].children.at(-1).opacity = 'x'))).toThrow(/Deckkraft/);
  });

  it('Transparenz an Pfaden und Gruppen: Rundreise, Unsinn → Fehler', () => {
    const base = sample();
    const doc = addNodes(base, base.pages[0].layers[0].id, [{ ...square('o'), opacity: 0.4 }, { ...group('og', [square('oi')]), opacity: 0.6 }]);
    expect(parseDocument(serialize(doc), new Set(['aa', 'bb']))).toEqual(doc);
    expect(bad((d) => (d.pages[0].layers[0].children.at(-1).opacity = -0.1))).toThrow(/Deckkraft/);
    expect(bad((d) => (d.pages[0].layers[0].children.at(-2).opacity = NaN))).toThrow(/Deckkraft/);
  });

  it('Strichmuster: Rundreise, Unsinn → Fehler', () => {
    const doc = sample();
    expect(parseDocument(serialize(doc), new Set(['aa', 'bb']))).toEqual(doc);
    const dashed = (d: any) => d.pages[0].layers[0].children.find((n: any) => n.style?.stroke?.dash).style.stroke;
    expect(bad((d) => (dashed(d).dash = [1]))).toThrow(/Strichmuster/);
    expect(bad((d) => (dashed(d).dash = [1, -1]))).toThrow(/Strichmuster/);
    expect(bad((d) => (dashed(d).dash = [0, 0]))).toThrow(/Strichmuster/);
    expect(bad((d) => (dashed(d).dash = 'x'))).toThrow(/Strichmuster/);
  });

  it('Bild ohne Datei in der Ablage → Fehler', () => {
    expect(() => parseDocument(serialize(sample()), new Set(['aa']))).toThrow(/Bild bb fehlt/);
  });
});
