// Sprache der Oberfläche. Der deutsche Text ist der Schlüssel, Englisch steht im Wörterbuch;
// fehlt ein Eintrag, bleibt Deutsch stehen. Umschalten wirkt sofort, weil die Sprache ein Svelte-Zustand ist.
import { EN, MESSAGES } from './en';

export type Lang = 'de' | 'en';
const STORE = 'konturdraw.lang';

/** Gespeicherte Wahl zuerst, sonst erste deutsche oder englische Systemsprache, sonst Englisch. */
export function detect(stored: string | null, languages: readonly string[]): Lang {
  if (stored === 'de' || stored === 'en') return stored;
  for (const l of languages) {
    const base = l.slice(0, 2).toLowerCase();
    if (base === 'de' || base === 'en') return base;
  }
  return 'en';
}

function initial(): Lang {
  let stored: string | null = null;
  try {
    stored = globalThis.localStorage?.getItem(STORE) ?? null;
  } catch {
    // Speicher gesperrt (privates Fenster): Systemsprache reicht.
  }
  return detect(stored, globalThis.navigator?.languages ?? []);
}

let lang = $state<Lang>(initial());
if (typeof document !== 'undefined') document.documentElement.lang = lang; // index.html startet mit de

export const getLang = (): Lang => lang;
export const locale = (): string => (lang === 'en' ? 'en-US' : 'de-DE');

export function setLang(l: Lang): void {
  lang = l;
  try {
    globalThis.localStorage?.setItem(STORE, l);
  } catch {
    // ohne Speicher gilt die Wahl bis zum Neustart
  }
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}

type Vars = Record<string, string | number>;
const fill = (s: string, vars?: Vars) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;

/** Text der Oberfläche in der gewählten Sprache; {name} wird aus vars gefüllt. */
export function tr(key: string, vars?: Vars): string {
  return fill(lang === 'en' ? (EN[key] ?? key) : key, vars);
}

/** Markiert Text in Konstanten für das Wörterbuch; übersetzt wird erst bei der Anzeige mit tr(). */
export const N_ = (key: string): string => key;

// Meldungen aus Rust kommen fertig formuliert an: Muster mit {x} werden zu Regex, die Teile darin rekursiv übersetzt.
// Längerer fester Anfang zuerst, dann mehr fester Text: „Bild übersprungen: {e}“ vor „Bild {image} nicht lesbar: {e}“,
// „Bild nicht lesbar: …“ vor „{path} nicht lesbar: …“.
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERNS = Object.keys(MESSAGES)
  .filter((k) => /\{\w+\}/.test(k))
  .map((k) => ({
    re: new RegExp(`^${escape(k).replace(/\\\{(\w+)\\\}/g, '(?<$1>[\\s\\S]+?)')}$`),
    en: MESSAGES[k],
    lead: k.indexOf('{'),
    weight: k.replace(/\{\w+\}/g, '').length,
  }))
  .sort((a, b) => b.lead - a.lead || b.weight - a.weight);

/** Fertige Meldung (Rust, Warnungen) in der gewählten Sprache; Unbekanntes und schon Englisches bleibt. */
export function tm(msg: string): string {
  if (lang !== 'en') return msg;
  const exact = EN[msg];
  if (exact !== undefined) return exact;
  for (const p of PATTERNS) {
    const m = p.re.exec(msg);
    if (m) return p.en.replace(/\{(\w+)\}/g, (_, k: string) => tm(m.groups![k]));
  }
  return msg;
}
