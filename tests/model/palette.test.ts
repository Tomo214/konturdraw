import { describe, expect, it } from 'vitest';
import { parseDocument, serialize } from '../../src/io/kwk';
import { cmyk, rgb } from '../../src/model/color';
import { createDocument } from '../../src/model/document';
import {
  addEntry,
  addPalette,
  paletteFile,
  parsePaletteFile,
  removeEntry,
  removePalette,
  renameEntry,
  setEntryColor,
  setSpot,
  STANDARD,
  updatePalette,
} from '../../src/model/palette';
import type { Palette } from '../../src/model/types';

const empty: Palette = { id: 'p1', name: 'Stencils', colors: [] };

describe('Paletten', () => {
  it('Standardpalette: eigene Namen, eindeutig, gültige CMYK-Farben', () => {
    const names = STANDARD.colors.map((e) => e.name);
    expect(names.length).toBeGreaterThanOrEqual(20);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('Stencil-Violett');
    for (const e of STANDARD.colors) {
      expect(e.color.model).toBe('cmyk');
      expect(e.color.values.every((v) => v >= 0 && v <= 1)).toBe(true);
    }
  });

  it('Einträge: Name eindeutig, Sonderfarbe folgt dem Namen, Löschen', () => {
    let p = addEntry(empty, { name: 'Rot', color: cmyk(0, 1, 1, 0) });
    p = addEntry(p, { name: 'Rot', color: rgb(1, 0, 0) });
    expect(p.colors.map((e) => e.name)).toEqual(['Rot', 'Rot 2']);
    p = setSpot(p, 0, true);
    expect(p.colors[0].color.spot).toBe('Rot');
    p = renameEntry(p, 0, 'Signalrot');
    expect(p.colors[0]).toEqual({ name: 'Signalrot', color: { ...cmyk(0, 1, 1, 0), spot: 'Signalrot' } });
    p = setSpot(p, 0, false);
    expect('spot' in p.colors[0].color).toBe(false);
    expect(removeEntry(p, 0).colors.map((e) => e.name)).toEqual(['Rot 2']);
    p = setEntryColor(setSpot(p, 1, true), 1, cmyk(0, 0.9, 0.9, 0.1));
    expect(p.colors[1].color).toEqual({ ...cmyk(0, 0.9, 0.9, 0.1), spot: 'Rot 2' }); // bleibt Sonderfarbe
    expect(setEntryColor(p, 0, { ...rgb(1, 0, 0), spot: 'fremd' }).colors[0].color).toEqual(rgb(1, 0, 0));
    expect(empty.colors).toEqual([]); // unverändert
  });

  it('Dokument: anlegen, ändern, löschen; übersteht .kwk-Rundreise', () => {
    let doc = addPalette(createDocument(100, 100), empty);
    doc = updatePalette(doc, 'p1', (p) => addEntry(p, { name: 'Haut', color: cmyk(0, 0.2, 0.3, 0) }));
    expect(doc.palettes![0].colors[0].name).toBe('Haut');
    expect(parseDocument(serialize(doc), new Set())).toEqual(doc);
    expect(removePalette(doc, 'p1').palettes).toEqual([]);
  });

  it('Datei: Rundreise; Kaputtes → deutsche Meldung', () => {
    const p = setSpot(addEntry(empty, { name: 'Gold', color: cmyk(0.15, 0.3, 0.9, 0.05) }), 0, true);
    const back = parsePaletteFile(paletteFile(p), 'neu');
    expect(back).toEqual({ ...p, id: 'neu' });
    expect(() => parsePaletteFile('{kaputt', 'x')).toThrow(/Palette/);
    expect(() => parsePaletteFile('{"format":"anderes","version":1,"name":"a","colors":[]}', 'x')).toThrow(/keine KonturDraw-Palette/);
    const bad = JSON.parse(paletteFile(p));
    bad.colors[0].color.values = [2, 0, 0, 0];
    expect(() => parsePaletteFile(JSON.stringify(bad), 'x')).toThrow(/Farbe/);
  });
});
