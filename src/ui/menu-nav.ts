// Menüleiste per Tastatur wie unter Windows: Alt antippen oder Alt + Merkbuchstabe, Pfeile, Pos1/Ende,
// Eingabe/Leertaste, Escape stufenweise, Buchstabe springt zum Eintrag. Reiner Zustand (menu-nav.test.ts).
import { MENUS, menuKey, type MenuEntry } from './menus';
import { tr } from '../i18n/i18n.svelte';
import type { Command } from './shortcuts';

/** top = aktives Hauptmenü (null = zu); path = markierter Eintrag je offener Ebene ([] = nur Titel markiert, -1 = keiner);
 *  keys = per Tastatur bedient: Merkbuchstaben unterstrichen, Escape führt zurück in die Leiste. */
export interface MenuNav {
  top: number | null;
  path: readonly number[];
  keys: boolean;
}

export const CLOSED: MenuNav = { top: null, path: [], keys: false };

/** Nächster Eintrag ohne Trennlinie in Richtung dir, im Kreis; from = -1 bzw. length für Anfang/Ende. */
function step(items: readonly MenuEntry[], from: number, dir: 1 | -1): number {
  const n = items.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + dir * k) % n) + n) % n;
    if (items[i]) return i;
  }
  return -1;
}

/** Hauptmenü per Tastatur öffnen, erster Eintrag markiert. */
export const openTop = (top: number): MenuNav => ({ top, path: [step(MENUS[top].items, -1, 1)], keys: true });

/** Einträge auf Ebene depth des offenen Menüs. */
export function listAt(nav: MenuNav, depth: number): readonly MenuEntry[] {
  let items = nav.top === null ? [] : MENUS[nav.top].items;
  for (let d = 0; d < depth; d++) {
    const e = items[nav.path[d]];
    items = e && 'items' in e ? e.items : [];
  }
  return items;
}

/** Alt + Merkbuchstabe → Hauptmenü, sonst -1. Tastencode statt Zeichen, damit Mac-Option-Zeichen nicht stören. */
export function altMenu(e: { code?: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return -1;
  const letter = /^Key([A-Z])$/.exec(e.code ?? '')?.[1];
  return letter ? MENUS.findIndex((m) => menuKey(m) === letter) : -1;
}

/** Eine Taste bei offener Leiste/offenem Menü; run = auszuführender Befehl (ausgegraute nie). */
export function navKey(nav: MenuNav, key: string, enabled: (c: Command) => boolean): { nav: MenuNav; run?: Command } {
  if (nav.top === null) return { nav };
  const go = (top: number, path: readonly number[]) => ({ nav: { top, path, keys: true } });
  const turn = (dir: number) => {
    const t = (nav.top! + dir + MENUS.length) % MENUS.length;
    return nav.path.length ? { nav: openTop(t) } : go(t, []);
  };
  const letter = key.length === 1 ? key.toLowerCase() : '';
  if (!nav.path.length) {
    if (key === 'ArrowLeft' || key === 'ArrowRight') return turn(key === 'ArrowLeft' ? -1 : 1);
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') return { nav: openTop(nav.top) };
    if (key === 'Escape') return { nav: CLOSED };
    const t = letter ? MENUS.findIndex((m) => menuKey(m).toLowerCase() === letter) : -1;
    return t >= 0 ? { nav: openTop(t) } : { nav };
  }
  const d = nav.path.length - 1;
  const items = listAt(nav, d);
  const cur = nav.path[d];
  const head = nav.path.slice(0, d);
  const mark = (i: number) => go(nav.top!, [...head, i]);
  const activate = (i: number) => {
    const e = items[i]!;
    if ('items' in e) return go(nav.top!, [...head, i, step(e.items, -1, 1)]);
    return enabled(e.cmd) ? { nav: CLOSED, run: e.cmd } : mark(i);
  };
  switch (key) {
    case 'ArrowDown': return mark(step(items, cur, 1));
    case 'ArrowUp': return mark(step(items, cur < 0 ? items.length : cur, -1));
    case 'Home': return mark(step(items, -1, 1));
    case 'End': return mark(step(items, items.length, -1));
    case 'ArrowRight': {
      const e = items[cur];
      return e && 'items' in e ? activate(cur) : turn(1);
    }
    case 'ArrowLeft': return d > 0 ? go(nav.top, head) : turn(-1);
    case 'Enter': case ' ': return cur >= 0 ? activate(cur) : { nav };
    case 'Escape': return d > 0 ? go(nav.top, head) : nav.keys ? go(nav.top, []) : { nav: CLOSED };
  }
  // Merkbuchstabe der Einträge = erster Buchstabe: ein Treffer löst aus, mehrere werden der Reihe nach markiert.
  const hits = letter ? items.flatMap((e, i) => (e && tr(e.label)[0].toLowerCase() === letter ? [i] : [])) : [];
  if (hits.length === 1) return activate(hits[0]);
  return hits.length ? mark(hits.find((i) => i > cur) ?? hits[0]) : { nav };
}
