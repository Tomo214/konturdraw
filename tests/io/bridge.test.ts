import { afterEach, expect, test, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { saveKwk } from '../../src/io/bridge';
import { setLang } from '../../src/i18n/i18n.svelte';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn(() => Promise.resolve(null)) }));
afterEach(() => setLang('de'));

test('Speichern unter schlägt den Dateinamen in der gewählten Sprache vor', async () => {
  await saveKwk(null, '{}', {});
  expect(vi.mocked(invoke).mock.lastCall![1]).toMatchObject({ name: 'Unbenannt.kwk' });
  setLang('en');
  await saveKwk(null, '{}', {});
  expect(vi.mocked(invoke).mock.lastCall![1]).toMatchObject({ name: 'Untitled.kwk' });
});
