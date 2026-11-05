import { expect, test } from 'vitest';
import { TRACE_DEFAULTS } from '../../src/io/trace';
import type { Subpath } from '../../src/model/types';
import { pathData, previewKey, traceStats } from '../../src/ui/trace-preview';

const line: Subpath = { closed: false, nodes: [{ x: 0, y: 0, type: 'corner' }, { x: 5, y: 0, type: 'corner' }] };
const tri: Subpath = { closed: true, nodes: [{ x: 0, y: 0, type: 'corner' }, { x: 5, y: 0, type: 'corner' }, { x: 5, y: 5.12345, type: 'corner' }] };
const bulge = (back: boolean): Subpath => ({
  closed: true,
  nodes: [
    { x: 0, y: 0, type: 'smooth', handleOut: { x: 1, y: -1 }, ...(back ? { handleIn: { x: 0, y: 5 } } : {}) },
    { x: 5, y: 0, type: 'smooth', handleIn: { x: 4, y: -1 }, ...(back ? { handleOut: { x: 5, y: 5 } } : {}) },
  ],
});

test('SVG-Pfad: Linien, Kurven, Schließen ohne doppelte Gerade, 3 Nachkommastellen', () => {
  expect(pathData([line])).toBe('M0 0L5 0');
  expect(pathData([tri])).toBe('M0 0L5 0L5 5.123Z');
  expect(pathData([bulge(false)])).toBe('M0 0C1 -1 4 -1 5 0Z');
  expect(pathData([bulge(true)])).toBe('M0 0C1 -1 4 -1 5 0C5 5 0 5 0 0Z');
  expect(pathData([line, tri])).toBe('M0 0L5 0M0 0L5 0L5 5.123Z');
  expect(pathData([])).toBe('');
});

test('Ergebniszeile: Kurven = Teilpfade, Knoten, verschiedene Farben', () => {
  const red = [1, 0, 0] as [number, number, number];
  expect(traceStats([{ rgb: red, subpaths: [tri] }, { rgb: red, subpaths: [line] }, { rgb: [0, 0, 1], subpaths: [tri] }])).toEqual({ curves: 3, nodes: 8, colors: 2 });
  expect(traceStats([{ rgb: null, subpaths: [tri, line] }])).toEqual({ curves: 2, nodes: 5, colors: 1 });
  expect(traceStats([])).toEqual({ curves: 0, nodes: 0, colors: 0 });
});

test('Vorschau-Schlüssel: Bild + Regler, die das Ergebnis ändern; Linienstärke zählt nicht', () => {
  const k = previewKey('h1', TRACE_DEFAULTS);
  expect(previewKey('h1', { ...TRACE_DEFAULTS, lineWidth: 2 })).toBe(k);
  expect(previewKey('h2', TRACE_DEFAULTS)).not.toBe(k);
  for (const change of [{ threshold: 90 }, { corners: 0.8 }, { colors: 3 }, { mode: 'color' as const }, { merge: false }, { background: 'all' as const }, { cutout: true }])
    expect(previewKey('h1', { ...TRACE_DEFAULTS, ...change })).not.toBe(k);
});
