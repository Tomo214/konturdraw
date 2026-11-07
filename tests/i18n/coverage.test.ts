import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { EN, MESSAGES, PARTS } from '../../src/i18n/en';

const read = (dir: string, ext: RegExp) =>
  (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => ext.test(f) && !/(^|\/)(i18n|cdr-import|tauri|core)\//.test(f))
    .map((f) => readFileSync(join(dir, f), 'utf8'));

const unquote = (s: string) => s.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n');
const KEY = /\b(?:tr|N_)\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
const used = new Set(read('src', /\.(ts|svelte)$/).flatMap((code) => [...code.matchAll(KEY)].map((m) => unquote(m[2]))));
const rust = ['src/core/src', 'src/tauri/src'].flatMap((d) => read(d, /\.rs$/)).join('\n');
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('jeder Text mit tr() oder N_() hat einen englischen Eintrag', () => {
  const missing = [...used].filter((k) => !(k in EN));
  expect(missing).toEqual([]);
});

test('kein Eintrag ohne Verwendung: Oberfläche im TS-Code, Meldungen dort oder in Rust', () => {
  const stale = Object.keys(EN).filter((k) => {
    if (used.has(k)) return false;
    if (!(k in MESSAGES)) return true;
    const parts = k.split(/\{\w+\}/).map((p) => p.trim()).filter((p) => p.length >= 3);
    return parts.length === 0 || parts.some((p) => !rust.includes(p));
  });
  expect(stale).toEqual([]);
});

test('Platzhalter stimmen zwischen Deutsch und Englisch überein', () => {
  const wrong = Object.entries(EN).filter(([k, v]) => holes(k).join() !== holes(v).join());
  expect(wrong).toEqual([]);
});

test('kein Schlüssel steht in zwei Teilen des Wörterbuchs', () => {
  const total = Object.values(PARTS).reduce((n, p) => n + Object.keys(p).length, 0);
  expect(total).toBe(Object.keys(EN).length);
});
