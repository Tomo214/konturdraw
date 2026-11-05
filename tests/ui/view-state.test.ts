import { expect, test } from 'vitest';
import { ViewState } from '../../src/ui/view-state.svelte';

test('Ansicht-Befehle schalten um und setzen die Häkchen im Menü; andere Befehle gehören nicht dazu', () => {
  const v = new ViewState();
  expect(v.checked({ name: 'show', what: 'grid' })).toBe(false);
  expect(v.run({ name: 'show', what: 'grid' })).toBe(true);
  expect(v.checked({ name: 'show', what: 'grid' })).toBe(true);
  expect(v.run({ name: 'snap', what: 'objects' })).toBe(true);
  expect(v.checked({ name: 'snap', what: 'objects' })).toBe(false);
  v.run({ name: 'proof' });
  expect(v.checked({ name: 'proof' })).toBe(true);
  v.run({ name: 'docker', id: 'trace' });
  expect(v.docker).toBe('trace');
  expect(v.run({ name: 'undo' })).toBe(false);
  expect(v.checked({ name: 'undo' })).toBe(false);
});
