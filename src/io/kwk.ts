// .kwk-Dokument (architecture.md §5): document.json ↔ Doc. Packen/Hash-Prüfung macht kw-core (kwk.rs),
// hier wird der Inhalt an der Systemgrenze geprüft, bevor er ins Modell darf.
import type { Doc, Node } from '../model/types';
import { UNITS } from '../model/units';
import { tr } from '../i18n/i18n.svelte';

/** Höchste lesbare Schema-Version (wie kw-core kwk::SCHEMA_MAX). */
const SCHEMA = 1;

export const serialize = (doc: Doc): string => JSON.stringify(doc);

/** Alle Bild-Hashes eines Dokuments – genau diese kommen nach images/. */
export function usedImages(doc: Doc): Set<string> {
  const out = new Set<string>();
  const visit = (n: Node): void => {
    if (n.type === 'group') n.children.forEach(visit);
    else if (n.type === 'image') out.add(n.image);
    else {
      if (n.style.fill && 'kind' in n.style.fill && n.style.fill.kind === 'pattern') n.style.fill.tile.forEach(visit);
      if (n.type !== 'text') n.contents?.forEach(visit);
    }
  };
  for (const p of doc.pages) for (const l of p.layers) l.children.forEach(visit);
  return out;
}

type Json = Record<string, any>;

function fail(msg: string): never {
  throw new Error(tr('Datei beschädigt: {msg}', { msg }));
}
const finite = (v: unknown): boolean => Number.isFinite(v);
const num = (v: unknown, what: string) => finite(v) || fail(tr('{what}: keine Zahl.', { what }));
const str = (v: unknown, what: string) => typeof v === 'string' || fail(tr('{what} fehlt.', { what }));
const bool = (v: unknown, what: string) => typeof v === 'boolean' || fail(tr('{what} fehlt.', { what }));
const oneOf = (v: unknown, opts: readonly string[], what: string) => opts.includes(v as string) || fail(tr('{what} unbekannt: {v}.', { what, v: String(v) }));
const obj = (v: unknown, what: string): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : fail(tr('{what} fehlt.', { what })));
const list = (v: unknown, what: string): unknown[] => (Array.isArray(v) ? v : fail(tr('{what} fehlen.', { what })));

const CHANNELS: Record<string, number> = { rgb: 3, cmyk: 4, gray: 1 };

function color(v: unknown): void {
  const c = obj(v, tr('Farbe'));
  const ok = Array.isArray(c.values) && c.values.length === CHANNELS[c.model] && c.values.every((x: unknown) => finite(x) && (x as number) >= 0 && (x as number) <= 1);
  if (!ok) fail(tr('Farbe ungültig.'));
  if (c.spot !== undefined && !(typeof c.spot === 'string' && c.spot.trim())) fail(tr('Sonderfarbe ohne Namen.'));
}

function colorSettings(v: unknown): void {
  const c = obj(v, tr('Farbeinstellungen'));
  oneOf(c.mode, ['rgb', 'cmyk'], tr('Farbmodus'));
  if (c.cmykProfile !== null && typeof c.cmykProfile !== 'string') fail(tr('Profil ungültig.'));
  oneOf(c.intent, ['perceptual', 'relative', 'saturation', 'absolute'], tr('Wiedergabe'));
}

/** Eine Palette (im Dokument oder als .kwp-Datei); wirft deutsche Meldungen. */
export function checkPalette(v: unknown): void {
  const p = obj(v, tr('Palette'));
  str(p.id, tr('Paletten-ID'));
  str(p.name, tr('Palettenname'));
  for (const ev of list(p.colors, tr('Palettenfarben'))) {
    const e = obj(ev, tr('Palettenfarbe'));
    str(e.name, tr('Farbname'));
    color(e.color);
  }
}

function point(v: unknown, what: string): void {
  const p = obj(v, what);
  num(p.x, what);
  num(p.y, what);
}

function style(v: unknown, images: ReadonlySet<string>): void {
  const s = obj(v, tr('Stil'));
  if (s.fill !== null) {
    const f = obj(s.fill, tr('Füllung'));
    if (f.kind === undefined) color(f);
    else if (f.kind === 'pattern') {
      if (!(finite(f.width) && f.width > 0 && finite(f.height) && f.height > 0)) fail(tr('Muster: Kachelgröße ungültig.'));
      if (!Array.isArray(f.matrix) || f.matrix.length !== 6 || !f.matrix.every(finite)) fail(tr('Muster: Matrix ungültig.'));
      for (const c of list(f.tile, tr('Musterkachel'))) node(c, images);
      if (f.twoColor !== undefined) {
        const t = obj(f.twoColor, tr('Zweifarb-Muster'));
        str(t.name, tr('Mustervorlage'));
        color(t.fg);
        color(t.bg);
      }
    } else {
      oneOf(f.kind, ['linear', 'radial'], tr('Verlauf'));
      point(f.from, tr('Verlauf'));
      point(f.to, tr('Verlauf'));
      const stops = list(f.stops, tr('Verlaufsfarben'));
      if (!stops.length) fail(tr('Verlauf ohne Farben.'));
      for (const st of stops) num(obj(st, tr('Verlaufsfarbe')).offset, tr('Verlaufsfarbe')), color((st as Json).color);
    }
  }
  if (s.stroke !== null) {
    const k = obj(s.stroke, tr('Kontur'));
    color(k.color);
    num(k.width, tr('Konturbreite'));
    oneOf(k.cap, ['butt', 'round', 'square'], tr('Linienende'));
    oneOf(k.join, ['miter', 'round', 'bevel'], tr('Ecke'));
    if (k.scaleWithObject !== undefined) bool(k.scaleWithObject, tr('Konturskalierung'));
    if (k.dash !== undefined) {
      const d = Array.isArray(k.dash) ? k.dash : [];
      const ok = d.length >= 2 && d.length % 2 === 0 && d.every((x) => finite(x) && (x as number) >= 0) && d.some((x) => (x as number) > 0);
      if (!ok) fail(tr('Strichmuster ungültig.'));
    }
  }
}

function shape(v: unknown): void {
  const s = obj(v, tr('Form'));
  oneOf(s.kind, ['rect', 'ellipse', 'polygon'], tr('Form'));
  for (const key of ['x', 'y', 'width', 'height']) num(s[key], tr('Form'));
  if (s.kind === 'rect') num(s.radius, tr('Eckenradius'));
  if (s.kind === 'polygon') num(s.sides, tr('Ecken')), s.inner === null || num(s.inner, tr('Sterntiefe'));
}

function subpath(v: unknown): void {
  bool(obj(v, tr('Teilpfad')).closed, tr('Teilpfad'));
  for (const p of list((v as Json).nodes, tr('Knoten'))) {
    point(p, tr('Knoten'));
    oneOf((p as Json).type, ['corner', 'smooth', 'symmetric'], tr('Knotenart'));
    for (const h of ['handleIn', 'handleOut']) if ((p as Json)[h] !== undefined) point((p as Json)[h], tr('Anfasser'));
  }
}

function text(n: Json): void {
  str(n.text, 'Text');
  const f = obj(n.font, tr('Schrift'));
  str(f.family, tr('Schriftname'));
  num(f.weight, tr('Schriftstärke'));
  bool(f.italic, tr('Kursiv'));
  if (!(f.size > 0 && finite(f.size))) fail(tr('Schriftgröße ungültig.'));
  num(n.tracking, tr('Laufweite'));
  num(n.lineSpacing, tr('Zeilenabstand'));
  oneOf(n.align, ['left', 'center', 'right'], tr('Ausrichtung'));
  if (n.frame !== undefined) {
    const r = obj(n.frame, tr('Rahmen'));
    if (!(r.width > 0 && r.height > 0 && finite(r.width) && finite(r.height))) fail(tr('Rahmen ungültig.'));
  }
  if (n.onPath !== undefined) {
    const p = obj(n.onPath, tr('Textpfad'));
    subpath(p.path);
    num(p.offset, tr('Versatz'));
    num(p.distance, tr('Abstand'));
    oneOf(p.side, ['above', 'below'], tr('Pfadseite'));
  }
  list(n.outline, tr('Textumriss')).forEach(subpath);
}

function contents(n: Json, images: ReadonlySet<string>): void {
  if (n.contents !== undefined) for (const c of list(n.contents, tr('Rahmeninhalt'))) node(c, images);
}

function node(v: unknown, images: ReadonlySet<string>): void {
  const n = obj(v, tr('Objekt'));
  str(n.id, tr('Objekt-ID'));
  if (!Array.isArray(n.transform) || n.transform.length !== 6 || !n.transform.every(finite)) fail(tr('Matrix ungültig.'));
  if (n.opacity !== undefined && !(finite(n.opacity) && n.opacity >= 0 && n.opacity <= 1)) fail(tr('Deckkraft muss zwischen 0 und 1 liegen.'));
  switch (n.type) {
    case 'group':
      for (const c of list(n.children, tr('Gruppenobjekte'))) node(c, images);
      return;
    case 'image':
      str(n.image, tr('Bild'));
      if (!(n.width > 0 && n.height > 0 && finite(n.width) && finite(n.height))) fail(tr('Bildgröße ungültig.'));
      if (!images.has(n.image)) fail(tr('Bild {image} fehlt.', { image: n.image }));
      return;
    case 'shape':
      style(n.style, images);
      shape(n.shape);
      contents(n, images);
      return;
    case 'path':
      style(n.style, images);
      list(n.subpaths, tr('Teilpfade')).forEach(subpath);
      contents(n, images);
      return;
    case 'text':
      style(n.style, images);
      text(n);
      return;
    default:
      fail(tr('Objektart unbekannt: {type}.', { type: String(n.type) }));
  }
}

function guide(v: unknown): void {
  const g = obj(v, tr('Hilfslinie'));
  const ok = typeof g.id === 'string' && (g.axis === 'h' || g.axis === 'v') && finite(g.pos) && (g.locked === undefined || typeof g.locked === 'boolean');
  if (!ok) fail(tr('Hilfslinie ungültig.'));
}

/** document.json → Doc; images = Hashes, die in der Datei liegen. Wirft deutsche Meldungen. */
export function parseDocument(json: string, images: ReadonlySet<string>): Doc {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    fail(tr('document.json ist kein gültiges JSON.'));
  }
  const d = obj(raw, tr('Dokument'));
  num(d.schemaVersion, 'schemaVersion');
  if (d.schemaVersion > SCHEMA) throw new Error(tr('Datei stammt aus einer neueren KonturDraw-Version (Schema {v}).', { v: d.schemaVersion }));
  if (d.schemaVersion !== SCHEMA) fail(tr('Schema {v} unbekannt.', { v: d.schemaVersion }));
  // Kein Array oder leer: dieselbe Meldung (list() würde „Seiten“ als Vieleck-Seiten übersetzen).
  const pages = Array.isArray(d.pages) && d.pages.length ? (d.pages as unknown[]) : fail(tr('Seiten fehlen.'));
  for (const pv of pages) {
    const p = obj(pv, tr('Seite'));
    str(p.id, tr('Seiten-ID'));
    if (p.name !== undefined) str(p.name, tr('Seitenname'));
    if (!(p.width > 0 && p.height > 0 && finite(p.width) && finite(p.height))) fail(tr('Seitengröße ungültig.'));
    const layers = list(p.layers, tr('Ebenen'));
    if (!layers.length) fail(tr('Ebenen fehlen.'));
    for (const lv of layers) {
      const l = obj(lv, tr('Ebene'));
      str(l.id, tr('Ebenen-ID'));
      str(l.name, tr('Ebenenname'));
      for (const key of ['visible', 'locked', 'printable']) bool(l[key], tr('Ebenen-Schalter'));
      for (const c of list(l.children, tr('Ebenenobjekte'))) node(c, images);
    }
    if (p.guides !== undefined) list(p.guides, tr('Hilfslinien')).forEach(guide);
  }
  if (d.origin !== undefined && !(finite(d.origin?.x) && finite(d.origin?.y))) fail(tr('Nullpunkt ungültig.'));
  if (d.grid !== undefined && !(finite(d.grid?.x) && finite(d.grid?.y) && d.grid.x > 0 && d.grid.y > 0)) fail(tr('Rasterabstand ungültig.'));
  if (d.color !== undefined) colorSettings(d.color);
  if (d.palettes !== undefined) list(d.palettes, tr('Paletten')).forEach(checkPalette);
  if (d.units !== undefined && !Object.hasOwn(UNITS, d.units)) fail(tr('Einheit unbekannt: {unit}.', { unit: String(d.units) }));
  if (d.nudge !== undefined && !(finite(d.nudge) && d.nudge > 0)) fail(tr('Verschiebe-Schritt ungültig.'));
  return d as Doc;
}
