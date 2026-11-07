import { expect, test } from 'vitest';
import { toolCursor, toolName } from '../../src/ui/toolbox';
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
