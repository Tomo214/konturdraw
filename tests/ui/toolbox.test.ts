import { expect, test } from 'vitest';
import { toolCursor } from '../../src/ui/toolbox';

test('Mauszeiger je Werkzeug: Pipette hat einen eigenen, Zeichenwerkzeuge das Fadenkreuz', () => {
  expect(toolCursor('eyedropper')).toBe('pick');
  expect(toolCursor('rect')).toBe('draw');
  expect(toolCursor('hand')).toBe('hand');
  expect(toolCursor('select')).toBe('');
});
