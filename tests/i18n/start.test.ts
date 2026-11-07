import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

test('Start mit gespeichertem Englisch setzt auch <html lang> (Screenreader, Silbentrennung)', async () => {
  const doc = { documentElement: { lang: 'de' } };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('localStorage', { getItem: () => 'en', setItem: () => {} });
  vi.resetModules();
  const { getLang } = await import('../../src/i18n/i18n.svelte');
  expect(getLang()).toBe('en');
  expect(doc.documentElement.lang).toBe('en');
});
