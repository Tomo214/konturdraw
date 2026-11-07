import { afterEach, expect, test } from 'vitest';
import { N_, detect, getLang, locale, setLang, tm, tr } from '../../src/i18n/i18n.svelte';

afterEach(() => setLang('de'));

test('Sprache: gespeicherte Wahl zuerst, sonst erste deutsche oder englische Systemsprache, sonst Englisch', () => {
  expect(detect('en', ['de-DE'])).toBe('en');
  expect(detect('de', ['en-US'])).toBe('de');
  expect(detect('xx', ['de-AT', 'en'])).toBe('de');
  expect(detect(null, ['fr-FR', 'de-CH'])).toBe('de');
  expect(detect(null, ['fr-FR', 'en-GB', 'de'])).toBe('en');
  expect(detect(null, ['fr-FR'])).toBe('en');
  expect(detect(null, [])).toBe('en');
});

test('tr: Deutsch ist der Schlüssel, Englisch kommt aus dem Wörterbuch, Unbekanntes bleibt stehen', () => {
  expect(tr('Datei')).toBe('Datei');
  setLang('en');
  expect(getLang()).toBe('en');
  expect(tr('Datei')).toBe('File');
  expect(tr('Gibt es nicht im Wörterbuch')).toBe('Gibt es nicht im Wörterbuch');
});

test('tr füllt Platzhalter in beiden Sprachen; fehlende Werte bleiben als Platzhalter sichtbar', () => {
  expect(tr('{n} Objekte gewählt {where}', { n: 3, where: '' })).toBe('3 Objekte gewählt ');
  setLang('en');
  expect(tr('{n} Objekte gewählt {where}', { n: 3, where: 'auf X' })).toBe('3 objects selected auf X');
  expect(tr('Unbekannt {x}', {})).toBe('Unbekannt {x}');
});

test('setLang merkt sich die Wahl, ohne zu stolpern, wenn kein Speicher da ist', () => {
  const saved: Record<string, string> = {};
  const g = globalThis as { localStorage?: unknown };
  const before = g.localStorage;
  g.localStorage = { setItem: (k: string, v: string) => (saved[k] = v), getItem: () => null };
  setLang('en');
  expect(Object.values(saved)).toEqual(['en']);
  g.localStorage = { setItem: () => { throw new Error('voll'); } };
  expect(() => setLang('de')).not.toThrow();
  g.localStorage = before;
});

test('tm übersetzt Meldungen aus Rust: genau, nach Muster mit Platzhaltern, auch verschachtelt', () => {
  expect(tm('Nur PNG und JPG werden unterstützt.')).toBe('Nur PNG und JPG werden unterstützt.');
  setLang('en');
  expect(tm('Nur PNG und JPG werden unterstützt.')).toBe('Only PNG and JPG are supported.');
  expect(tm('Schrift nicht gefunden: Barlow')).toBe('Font not found: Barlow');
  expect(tm('/tmp/a.kwk nicht lesbar: No such file')).toBe('/tmp/a.kwk not readable: No such file');
  expect(tm('Bild übersprungen: Bild nicht lesbar: bad png')).toBe('Image skipped: Image not readable: bad png');
  expect(tm('Already English.')).toBe('Already English.');
});

test('N_ markiert Konstanten nur – übersetzt wird erst bei der Anzeige', () => {
  setLang('en');
  const label = N_('Datei');
  expect(label).toBe('Datei');
  expect(tr(label)).toBe('File');
});

test('Zahlenformat folgt der Sprache', () => {
  expect(locale()).toBe('de-DE');
  setLang('en');
  expect(locale()).toBe('en-US');
});

test('„Seiten“ am Vieleck sind Sides, nicht Pages', () => {
  setLang('en');
  expect(tr('Seiten')).toBe('Sides');
  expect(tr('Seitennavigation')).toBe('Page navigation');
});
