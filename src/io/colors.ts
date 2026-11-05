// Bildschirmfarben (3f): CMYK und Soft-Proof rechnet kw-core exakt über das Dokumentprofil.
// Bis die Antwort da ist (und ohne Desktop-App) gilt die einfache Formel; Anfragen werden je Schub gebündelt.
import { createSubscriber } from 'svelte/reactivity';
import { colorKey, DEFAULT_COLOR_SETTINGS, naiveConvert, naiveSrgb } from '../model/color';
import type { Color, ColorSettings } from '../model/types';
import * as bridge from './bridge';

type Rgb8 = [number, number, number];
export type Fetch = (settings: ColorSettings, colors: Color[], proof: boolean) => Promise<{ profile: string | null; colors: Rgb8[] }>;

const css = ([r, g, b]: Rgb8): string => `rgb(${r} ${g} ${b})`;
const bytes = (c: Color): Rgb8 => naiveSrgb(c).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)) as Rgb8;

// Getter melden Svelte-Vorlagen an (createSubscriber): Farbfelder zeichnen nach jeder Antwort selbst neu.
export class DisplayColors {
  private current = DEFAULT_COLOR_SETTINGS;
  private proof = false;
  private state = '';
  private cache = new Map<string, Rgb8>();
  private pending = new Map<string, Color>();
  private queued = false;
  private v = 0;
  private name: string | null = null;
  private failure: string | null = null;
  private notify = (): void => {};
  private subscribe = createSubscriber((update) => {
    this.notify = update;
    return () => (this.notify = () => {});
  });
  /** Neue exakte Werte oder neues Profil → Zeichenfläche neu zeichnen. */
  onChange = (): void => {};

  constructor(private fetch: Fetch) {}

  /** Zählt jede Änderung der Anzeigewerte – für Caches der Aufrufer. */
  get version(): number {
    this.subscribe();
    return this.v;
  }
  /** Profil der letzten Antwort; null = einfache Formel. */
  get profile(): string | null {
    this.subscribe();
    return this.name;
  }
  get error(): string | null {
    this.subscribe();
    return this.failure;
  }
  /** Einstellungen, mit denen gerade angezeigt wird (für Modellwechsel). */
  get settings(): ColorSettings {
    this.subscribe();
    return this.current;
  }

  /** Dokument-Einstellungen + Soft-Proof; bei Änderung verfallen alle Werte. */
  use(settings: ColorSettings | undefined, proof: boolean): void {
    const s = settings ?? DEFAULT_COLOR_SETTINGS;
    const state = JSON.stringify([s, proof]);
    if (state === this.state) return;
    this.state = state;
    this.current = s;
    this.proof = proof;
    this.cache.clear();
    this.pending.clear();
    this.v++;
    this.notify();
    this.schedule(); // Profilname und Fehler auch ohne CMYK-Farben
  }

  /** Anzeige als sRGB-Bytes (Farbfelder, Wähler). */
  rgb(c: Color): Rgb8 {
    this.subscribe();
    if (c.model !== 'cmyk' && !this.proof) return bytes(c);
    const key = colorKey(c);
    const hit = this.cache.get(key);
    if (hit) return hit;
    this.pending.set(key, c);
    this.schedule();
    return bytes(c);
  }

  css(c: Color): string {
    return css(this.rgb(c));
  }

  private schedule(): void {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => this.flush());
  }

  private flush(): void {
    this.queued = false;
    const state = this.state;
    const batch = [...this.pending];
    this.pending.clear();
    const settle = (profile: string | null, error: string | null, values: (c: Color, i: number) => Rgb8) => {
      if (state !== this.state) return; // umgeschaltet, Antwort veraltet
      batch.forEach(([key, c], i) => this.cache.set(key, values(c, i)));
      this.name = profile;
      this.failure = error;
      this.v++;
      this.notify();
      this.onChange();
    };
    this.fetch(this.current, batch.map(([, c]) => c), this.proof).then(
      (r) => settle(r.profile, null, (c, i) => r.colors[i] ?? bytes(c)),
      (e: unknown) => settle(null, e instanceof Error ? e.message : String(e), bytes),
    );
  }
}

/** Modellwechsel im Farbwähler: exakt über das Dokumentprofil, ohne Desktop-App die einfache Formel. */
export async function convertColor(
  c: Color,
  to: Color['model'],
  settings: ColorSettings | undefined,
  call: (s: ColorSettings, colors: Color[], to: Color['model']) => Promise<Color[]> = bridge.convertColors,
): Promise<Color> {
  if (c.model === to) return c;
  try {
    return (await call(settings ?? DEFAULT_COLOR_SETTINGS, [c], to))[0];
  } catch {
    return naiveConvert(c, to);
  }
}

/** Eine Anzeige für die ganze Sitzung. */
export const display = new DisplayColors(bridge.displayColors);
