import { expect, test } from 'vitest';
import { isPick, TOOLBOX, toolCursor, toolName } from '../../src/ui/toolbox';
import { setLang } from '../../src/i18n/i18n.svelte';

test('Mauszeiger je Werkzeug: Pipette hat einen eigenen, Zeichenwerkzeuge das Fadenkreuz', () => {
  expect(toolCursor('eyedropper')).toBe('pick');
  expect(toolCursor('rect')).toBe('draw');
  expect(toolCursor('hand')).toBe('hand');
  expect(toolCursor('select')).toBe('');
});

test('Werkzeugname folgt der gewählten Sprache', () => {
  expect(toolName('select')).toBe('Auswahl');
  setLang('en');
  expect(toolName('select')).toBe('Selection');
  expect(toolName('rect')).toBe('Rectangle');
  setLang('de');
});

test('Freihand-Auswahl liegt wie im Vorbild im Ausklappmenü der Auswahl, mit normalem Pfeil', () => {
  expect(TOOLBOX[0].map((t) => t.tool)).toEqual(['select', 'lasso']);
  expect(toolCursor('lasso')).toBe('');
  expect(toolName('lasso')).toBe('Freihand-Auswahl');
  setLang('en');
  expect(toolName('lasso')).toBe('Freehand selection');
  setLang('de');
});

test('Auswahl und Freihand-Auswahl teilen Eigenschaftsleiste und Formen-Befehle', () => {
  expect(isPick('select')).toBe(true);
  expect(isPick('lasso')).toBe(true);
  expect(isPick('node')).toBe(false);
});

test('Glätten liegt wie im Vorbild im Ausklappmenü des Knoten-Werkzeugs', () => {
  expect(TOOLBOX[1].map((t) => t.tool)).toEqual(['node', 'smooth']);
  expect(toolName('smooth')).toBe('Glätten');
  setLang('en');
  expect(toolName('smooth')).toBe('Smooth');
  setLang('de');
});
