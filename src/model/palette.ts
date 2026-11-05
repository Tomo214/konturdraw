// Paletten (3f): Standardpalette des Programms, eigene Paletten im Dokument, .kwp-Dateien.
// Volltonfarbe = Eintrag mit spot; der Sonderfarbname folgt immer dem Eintragsnamen.
import { checkPalette } from '../io/kwk';
import { cmyk } from './color';
import type { Color, Doc, Palette, PaletteEntry } from './types';

const entry = (name: string, color: Color): PaletteEntry => ({ name, color });

/** Eigene Auswahl, reine CMYK-Werte (keine Herstellerfarben). */
export const STANDARD: Palette = {
  id: 'standard',
  name: 'Standard',
  colors: [
    entry('Schwarz', cmyk(0, 0, 0, 1)),
    entry('Tiefschwarz', cmyk(0.6, 0.5, 0.4, 1)),
    entry('Dunkelgrau', cmyk(0, 0, 0, 0.7)),
    entry('Mittelgrau', cmyk(0, 0, 0, 0.5)),
    entry('Hellgrau', cmyk(0, 0, 0, 0.2)),
    entry('Papierweiß', cmyk(0, 0, 0, 0)),
    entry('Cyan', cmyk(1, 0, 0, 0)),
    entry('Magenta', cmyk(0, 1, 0, 0)),
    entry('Gelb', cmyk(0, 0, 1, 0)),
    entry('Rot', cmyk(0, 1, 1, 0)),
    entry('Weinrot', cmyk(0.2, 1, 0.8, 0.3)),
    entry('Orange', cmyk(0, 0.6, 1, 0)),
    entry('Ocker', cmyk(0.1, 0.35, 0.9, 0.1)),
    entry('Gold', cmyk(0.15, 0.3, 0.9, 0.05)),
    entry('Braun', cmyk(0.3, 0.6, 0.8, 0.4)),
    entry('Grün', cmyk(1, 0, 1, 0)),
    entry('Waldgrün', cmyk(0.85, 0.3, 0.9, 0.3)),
    entry('Petrol', cmyk(0.9, 0.3, 0.4, 0.2)),
    entry('Blau', cmyk(1, 1, 0, 0)),
    entry('Marine', cmyk(1, 0.85, 0.3, 0.4)),
    entry('Stencil-Violett', cmyk(0.6, 0.9, 0, 0)),
    entry('Flieder', cmyk(0.35, 0.45, 0, 0)),
    entry('Haut hell', cmyk(0, 0.15, 0.25, 0)),
    entry('Haut dunkel', cmyk(0.2, 0.45, 0.6, 0.15)),
  ],
};

function uniqueName(taken: readonly PaletteEntry[], name: string): string {
  const names = new Set(taken.map((e) => e.name));
  if (!names.has(name)) return name;
  let n = 2;
  while (names.has(`${name} ${n}`)) n++;
  return `${name} ${n}`;
}

const withSpot = (c: Color, spot: string | undefined): Color => {
  const { spot: _, ...rest } = c;
  return (spot ? { ...rest, spot } : rest) as Color;
};

const mapAt = (p: Palette, i: number, fn: (e: PaletteEntry) => PaletteEntry): Palette => ({
  ...p,
  colors: p.colors.map((e, j) => (j === i ? fn(e) : e)),
});

export const addEntry = (p: Palette, e: PaletteEntry): Palette => ({
  ...p,
  colors: [...p.colors, { ...e, name: uniqueName(p.colors, e.name) }],
});

export const removeEntry = (p: Palette, i: number): Palette => ({ ...p, colors: p.colors.filter((_, j) => j !== i) });

export function renameEntry(p: Palette, i: number, name: string): Palette {
  const unique = uniqueName(p.colors.filter((_, j) => j !== i), name);
  return mapAt(p, i, (e) => ({ name: unique, color: e.color.spot ? withSpot(e.color, unique) : e.color }));
}

/** Farbe eines Eintrags ersetzen; Sonderfarbe bleibt Sonderfarbe unter dem Eintragsnamen. */
export const setEntryColor = (p: Palette, i: number, c: Color): Palette =>
  mapAt(p, i, (e) => ({ ...e, color: withSpot(c, e.color.spot ? e.name : undefined) }));

export const setSpot = (p: Palette, i: number, on: boolean): Palette =>
  mapAt(p, i, (e) => ({ ...e, color: withSpot(e.color, on ? e.name : undefined) }));

export const addPalette = (doc: Doc, p: Palette): Doc => ({ ...doc, palettes: [...(doc.palettes ?? []), p] });

export const updatePalette = (doc: Doc, id: string, fn: (p: Palette) => Palette): Doc => ({
  ...doc,
  palettes: (doc.palettes ?? []).map((p) => (p.id === id ? fn(p) : p)),
});

export const removePalette = (doc: Doc, id: string): Doc => ({ ...doc, palettes: (doc.palettes ?? []).filter((p) => p.id !== id) });

// .kwp: JSON mit Kennung, damit fremde Dateien sauber abgelehnt werden.
const FORMAT = 'konturwerk-palette';

export const paletteFile = (p: Palette): string => JSON.stringify({ format: FORMAT, version: 1, name: p.name, colors: p.colors }, null, 2);

/** .kwp-Text → Palette mit neuer id; wirft deutsche Meldungen. */
export function parsePaletteFile(text: string, id: string): Palette {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Palette-Datei ist kein gültiges JSON.');
  }
  if (raw?.format !== FORMAT) throw new Error('Das ist keine Konturwerk-Palette.');
  if (raw.version !== 1) throw new Error(`Palette stammt aus einer neueren Konturwerk-Version (${String(raw.version)}).`);
  const p = { id, name: raw.name, colors: raw.colors };
  checkPalette(p);
  return p as Palette;
}
