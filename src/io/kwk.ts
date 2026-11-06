// .kwk-Dokument (architecture.md §5): document.json ↔ Doc. Packen/Hash-Prüfung macht kw-core (kwk.rs),
// hier wird der Inhalt an der Systemgrenze geprüft, bevor er ins Modell darf.
import type { Doc, Node } from '../model/types';
import { UNITS } from '../model/units';

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
  throw new Error(`Datei beschädigt: ${msg}`);
}
const finite = (v: unknown): boolean => Number.isFinite(v);
const num = (v: unknown, what: string) => finite(v) || fail(`${what}: keine Zahl.`);
const str = (v: unknown, what: string) => typeof v === 'string' || fail(`${what} fehlt.`);
const bool = (v: unknown, what: string) => typeof v === 'boolean' || fail(`${what} fehlt.`);
const oneOf = (v: unknown, opts: readonly string[], what: string) => opts.includes(v as string) || fail(`${what} unbekannt: ${String(v)}.`);
const obj = (v: unknown, what: string): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : fail(`${what} fehlt.`));
const list = (v: unknown, what: string): unknown[] => (Array.isArray(v) ? v : fail(`${what} fehlen.`));

const CHANNELS: Record<string, number> = { rgb: 3, cmyk: 4, gray: 1 };

function color(v: unknown): void {
  const c = obj(v, 'Farbe');
  const ok = Array.isArray(c.values) && c.values.length === CHANNELS[c.model] && c.values.every((x: unknown) => finite(x) && (x as number) >= 0 && (x as number) <= 1);
  if (!ok) fail('Farbe ungültig.');
  if (c.spot !== undefined && !(typeof c.spot === 'string' && c.spot.trim())) fail('Sonderfarbe ohne Namen.');
}

function colorSettings(v: unknown): void {
  const c = obj(v, 'Farbeinstellungen');
  oneOf(c.mode, ['rgb', 'cmyk'], 'Farbmodus');
  if (c.cmykProfile !== null && typeof c.cmykProfile !== 'string') fail('Profil ungültig.');
  oneOf(c.intent, ['perceptual', 'relative', 'saturation', 'absolute'], 'Wiedergabe');
}

/** Eine Palette (im Dokument oder als .kwp-Datei); wirft deutsche Meldungen. */
export function checkPalette(v: unknown): void {
  const p = obj(v, 'Palette');
  str(p.id, 'Paletten-ID');
  str(p.name, 'Palettenname');
  for (const ev of list(p.colors, 'Palettenfarben')) {
    const e = obj(ev, 'Palettenfarbe');
    str(e.name, 'Farbname');
    color(e.color);
  }
}

function point(v: unknown, what: string): void {
  const p = obj(v, what);
  num(p.x, what);
  num(p.y, what);
}

function style(v: unknown, images: ReadonlySet<string>): void {
  const s = obj(v, 'Stil');
  if (s.fill !== null) {
    const f = obj(s.fill, 'Füllung');
    if (f.kind === undefined) color(f);
    else if (f.kind === 'pattern') {
      if (!(finite(f.width) && f.width > 0 && finite(f.height) && f.height > 0)) fail('Muster: Kachelgröße ungültig.');
      if (!Array.isArray(f.matrix) || f.matrix.length !== 6 || !f.matrix.every(finite)) fail('Muster: Matrix ungültig.');
      for (const c of list(f.tile, 'Musterkachel')) node(c, images);
      if (f.twoColor !== undefined) {
        const t = obj(f.twoColor, 'Zweifarb-Muster');
        str(t.name, 'Mustervorlage');
        color(t.fg);
        color(t.bg);
      }
    } else {
      oneOf(f.kind, ['linear', 'radial'], 'Verlauf');
      point(f.from, 'Verlauf');
      point(f.to, 'Verlauf');
      const stops = list(f.stops, 'Verlaufsfarben');
      if (!stops.length) fail('Verlauf ohne Farben.');
      for (const st of stops) num(obj(st, 'Verlaufsfarbe').offset, 'Verlaufsfarbe'), color((st as Json).color);
    }
  }
  if (s.stroke !== null) {
    const k = obj(s.stroke, 'Kontur');
    color(k.color);
    num(k.width, 'Konturbreite');
    oneOf(k.cap, ['butt', 'round', 'square'], 'Linienende');
    oneOf(k.join, ['miter', 'round', 'bevel'], 'Ecke');
    if (k.scaleWithObject !== undefined) bool(k.scaleWithObject, 'Konturskalierung');
    if (k.dash !== undefined) {
      const d = Array.isArray(k.dash) ? k.dash : [];
      const ok = d.length >= 2 && d.length % 2 === 0 && d.every((x) => finite(x) && (x as number) >= 0) && d.some((x) => (x as number) > 0);
      if (!ok) fail('Strichmuster ungültig.');
    }
  }
}

function shape(v: unknown): void {
  const s = obj(v, 'Form');
  oneOf(s.kind, ['rect', 'ellipse', 'polygon'], 'Form');
  for (const key of ['x', 'y', 'width', 'height']) num(s[key], 'Form');
  if (s.kind === 'rect') num(s.radius, 'Eckenradius');
  if (s.kind === 'polygon') num(s.sides, 'Ecken'), s.inner === null || num(s.inner, 'Sterntiefe');
}

function subpath(v: unknown): void {
  bool(obj(v, 'Teilpfad').closed, 'Teilpfad');
  for (const p of list((v as Json).nodes, 'Knoten')) {
    point(p, 'Knoten');
    oneOf((p as Json).type, ['corner', 'smooth', 'symmetric'], 'Knotenart');
    for (const h of ['handleIn', 'handleOut']) if ((p as Json)[h] !== undefined) point((p as Json)[h], 'Anfasser');
  }
}

function text(n: Json): void {
  str(n.text, 'Text');
  const f = obj(n.font, 'Schrift');
  str(f.family, 'Schriftname');
  num(f.weight, 'Schriftstärke');
  bool(f.italic, 'Kursiv');
  if (!(f.size > 0 && finite(f.size))) fail('Schriftgröße ungültig.');
  num(n.tracking, 'Laufweite');
  num(n.lineSpacing, 'Zeilenabstand');
  oneOf(n.align, ['left', 'center', 'right'], 'Ausrichtung');
  if (n.frame !== undefined) {
    const r = obj(n.frame, 'Rahmen');
    if (!(r.width > 0 && r.height > 0 && finite(r.width) && finite(r.height))) fail('Rahmen ungültig.');
  }
  if (n.onPath !== undefined) {
    const p = obj(n.onPath, 'Textpfad');
    subpath(p.path);
    num(p.offset, 'Versatz');
    num(p.distance, 'Abstand');
    oneOf(p.side, ['above', 'below'], 'Pfadseite');
  }
  list(n.outline, 'Textumriss').forEach(subpath);
}

function contents(n: Json, images: ReadonlySet<string>): void {
  if (n.contents !== undefined) for (const c of list(n.contents, 'Rahmeninhalt')) node(c, images);
}

function node(v: unknown, images: ReadonlySet<string>): void {
  const n = obj(v, 'Objekt');
  str(n.id, 'Objekt-ID');
  if (!Array.isArray(n.transform) || n.transform.length !== 6 || !n.transform.every(finite)) fail('Matrix ungültig.');
  if (n.opacity !== undefined && !(finite(n.opacity) && n.opacity >= 0 && n.opacity <= 1)) fail('Deckkraft muss zwischen 0 und 1 liegen.');
  switch (n.type) {
    case 'group':
      for (const c of list(n.children, 'Gruppenobjekte')) node(c, images);
      return;
    case 'image':
      str(n.image, 'Bild');
      if (!(n.width > 0 && n.height > 0 && finite(n.width) && finite(n.height))) fail('Bildgröße ungültig.');
      if (!images.has(n.image)) fail(`Bild ${n.image} fehlt.`);
      return;
    case 'shape':
      style(n.style, images);
      shape(n.shape);
      contents(n, images);
      return;
    case 'path':
      style(n.style, images);
      list(n.subpaths, 'Teilpfade').forEach(subpath);
      contents(n, images);
      return;
    case 'text':
      style(n.style, images);
      text(n);
      return;
    default:
      fail(`Objektart unbekannt: ${String(n.type)}.`);
  }
}

function guide(v: unknown): void {
  const g = obj(v, 'Hilfslinie');
  const ok = typeof g.id === 'string' && (g.axis === 'h' || g.axis === 'v') && finite(g.pos) && (g.locked === undefined || typeof g.locked === 'boolean');
  if (!ok) fail('Hilfslinie ungültig.');
}

/** document.json → Doc; images = Hashes, die in der Datei liegen. Wirft deutsche Meldungen. */
export function parseDocument(json: string, images: ReadonlySet<string>): Doc {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    fail('document.json ist kein gültiges JSON.');
  }
  const d = obj(raw, 'Dokument');
  num(d.schemaVersion, 'schemaVersion');
  if (d.schemaVersion > SCHEMA) throw new Error(`Datei stammt aus einer neueren Konturwerk-Version (Schema ${d.schemaVersion}).`);
  if (d.schemaVersion !== SCHEMA) fail(`Schema ${d.schemaVersion} unbekannt.`);
  const pages = list(d.pages, 'Seiten');
  if (!pages.length) fail('Seiten fehlen.');
  for (const pv of pages) {
    const p = obj(pv, 'Seite');
    str(p.id, 'Seiten-ID');
    if (p.name !== undefined) str(p.name, 'Seitenname');
    if (!(p.width > 0 && p.height > 0 && finite(p.width) && finite(p.height))) fail('Seitengröße ungültig.');
    const layers = list(p.layers, 'Ebenen');
    if (!layers.length) fail('Ebenen fehlen.');
    for (const lv of layers) {
      const l = obj(lv, 'Ebene');
      str(l.id, 'Ebenen-ID');
      str(l.name, 'Ebenenname');
      for (const key of ['visible', 'locked', 'printable']) bool(l[key], 'Ebenen-Schalter');
      for (const c of list(l.children, 'Ebenenobjekte')) node(c, images);
    }
    if (p.guides !== undefined) list(p.guides, 'Hilfslinien').forEach(guide);
  }
  if (d.origin !== undefined && !(finite(d.origin?.x) && finite(d.origin?.y))) fail('Nullpunkt ungültig.');
  if (d.grid !== undefined && !(finite(d.grid?.x) && finite(d.grid?.y) && d.grid.x > 0 && d.grid.y > 0)) fail('Rasterabstand ungültig.');
  if (d.color !== undefined) colorSettings(d.color);
  if (d.palettes !== undefined) list(d.palettes, 'Paletten').forEach(checkPalette);
  if (d.units !== undefined && !Object.hasOwn(UNITS, d.units)) fail(`Einheit unbekannt: ${String(d.units)}.`);
  if (d.nudge !== undefined && !(finite(d.nudge) && d.nudge > 0)) fail('Verschiebe-Schritt ungültig.');
  return d as Doc;
}
