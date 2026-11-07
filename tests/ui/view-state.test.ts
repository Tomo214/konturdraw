import { expect, test } from 'vitest';
import { ViewState } from '../../src/ui/view-state.svelte';
import { getLang, setLang } from '../../src/i18n/i18n.svelte';

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

test('Sprache: Menü-Befehl schaltet um und setzt das Häkchen bei der aktiven Sprache', () => {
  const v = new ViewState();
  try {
    expect(v.checked({ name: 'lang', lang: 'de' })).toBe(true);
    expect(v.checked({ name: 'lang', lang: 'en' })).toBe(false);
    expect(v.run({ name: 'lang', lang: 'en' })).toBe(true);
    expect(getLang()).toBe('en');
    expect(v.checked({ name: 'lang', lang: 'en' })).toBe(true);
  } finally {
    setLang('de');
  }
});
