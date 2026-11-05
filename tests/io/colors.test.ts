import { describe, expect, it } from 'vitest';
import { convertColor, DisplayColors, type Fetch } from '../../src/io/colors';
import { cmyk, gray, rgb } from '../../src/model/color';
import type { Color, ColorSettings } from '../../src/model/types';

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Gibt jede Farbe als [1, 2, 3] + Index zurück und merkt sich die Aufrufe. */
function fake(fail = false) {
  const calls: { settings: ColorSettings; colors: Color[]; proof: boolean }[] = [];
  const fetch: Fetch = async (settings, colors, proof) => {
    calls.push({ settings, colors, proof });
    if (fail) throw new Error('Dateien gehen nur in der Desktop-App.');
    return { profile: 'Testprofil', colors: colors.map((_, i) => [1, 2, 3 + i] as [number, number, number]) };
  };
  return { calls, fetch };
}

describe('Anzeigefarben', () => {
  it('RGB und Graustufen ohne Proof direkt, ohne Anfrage', async () => {
    const { calls, fetch } = fake();
    const d = new DisplayColors(fetch);
    d.use(undefined, false);
    expect(d.css(rgb(1, 0, 0.5))).toBe('rgb(255 0 128)');
    expect(d.css(gray(0.5))).toBe('rgb(128 128 128)');
    await tick();
    expect(calls.map((c) => c.colors.length)).toEqual([0]); // nur die Profilabfrage
  });

  it('CMYK erst Formel, nach der Antwort exakt; ein Aufruf je Schub', async () => {
    const { calls, fetch } = fake();
    const d = new DisplayColors(fetch);
    let changes = 0;
    d.onChange = () => changes++;
    d.use({ mode: 'cmyk', cmykProfile: null, intent: 'perceptual' }, false);
    expect(d.css(cmyk(1, 0, 0, 0))).toBe('rgb(0 255 255)');
    d.css(cmyk(0, 1, 0, 0));
    d.css(cmyk(1, 0, 0, 0));
    await tick();
    expect(calls).toHaveLength(1);
    expect(calls[0].colors).toEqual([cmyk(1, 0, 0, 0), cmyk(0, 1, 0, 0)]);
    expect(calls[0].settings.intent).toBe('perceptual');
    expect(d.css(cmyk(1, 0, 0, 0))).toBe('rgb(1 2 3)');
    expect(d.css(cmyk(0, 1, 0, 0))).toBe('rgb(1 2 4)');
    expect(d.profile).toBe('Testprofil');
    expect(changes).toBe(1);
  });

  it('Soft-Proof fragt auch RGB an', async () => {
    const { calls, fetch } = fake();
    const d = new DisplayColors(fetch);
    d.use(undefined, true);
    expect(d.css(rgb(0, 1, 0))).toBe('rgb(0 255 0)');
    await tick();
    expect(calls.at(-1)!.proof).toBe(true);
    expect(d.css(rgb(0, 1, 0))).toBe('rgb(1 2 3)');
  });

  it('Umschalten verwirft alte Werte und späte Antworten', async () => {
    const answers: ((r: Awaited<ReturnType<Fetch>>) => void)[] = [];
    const d = new DisplayColors(() => new Promise((r) => answers.push(r)));
    d.use(undefined, true);
    d.css(rgb(0, 1, 0));
    await tick(); // Anfrage läuft
    d.use(undefined, false);
    answers[0]({ profile: 'alt', colors: [[1, 2, 3]] });
    await tick();
    expect(d.css(rgb(0, 1, 0))).toBe('rgb(0 255 0)');
    d.use(undefined, true);
    expect(d.css(rgb(0, 1, 0))).toBe('rgb(0 255 0)'); // nichts Altes aus dem Cache
    expect(d.profile).toBeNull();
  });

  it('ohne Desktop-App bleibt die Formel, Fehler sichtbar, keine Endlosschleife', async () => {
    const { calls, fetch } = fake(true);
    const d = new DisplayColors(fetch);
    d.use(undefined, false);
    d.css(cmyk(0, 0, 0, 1));
    await tick();
    expect(d.css(cmyk(0, 0, 0, 1))).toBe('rgb(0 0 0)');
    await tick();
    expect(calls).toHaveLength(1);
    expect(d.profile).toBeNull();
    expect(d.error).toMatch(/Desktop-App/);
  });
});

describe('Modellwechsel', () => {
  const settings: ColorSettings = { mode: 'cmyk', cmykProfile: null, intent: 'relative' };

  it('fragt kw-core mit den Dokument-Einstellungen; gleiches Modell ohne Anfrage', async () => {
    const calls: unknown[][] = [];
    const call = async (...a: unknown[]) => (calls.push(a), [cmyk(0.1, 0.2, 0.3, 0.4)]);
    expect(await convertColor(rgb(1, 0, 0), 'cmyk', settings, call)).toEqual(cmyk(0.1, 0.2, 0.3, 0.4));
    expect(calls).toEqual([[settings, [rgb(1, 0, 0)], 'cmyk']]);
    const c = cmyk(0, 1, 0, 0);
    expect(await convertColor(c, 'cmyk', settings, call)).toBe(c);
    expect(calls).toHaveLength(1);
  });

  it('ohne Desktop-App die einfache Formel', async () => {
    const call = async () => Promise.reject(new Error('Dateien gehen nur in der Desktop-App.'));
    expect(await convertColor(cmyk(0, 1, 0, 0), 'rgb', undefined, call)).toEqual(rgb(1, 0, 1));
  });
});
