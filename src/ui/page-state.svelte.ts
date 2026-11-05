// Aktuelle Seite und gewählte Ebene: Ansicht-Zustand wie Zoom, kein Rückgängig-Schritt.
// Verschwindet die Seite (Rückgängig, Löschen), bleibt die Nummer stehen, so weit es Seiten gibt.
import type { Doc } from '../model/types';

export class PageState {
  id = $state('');
  /** Im Objekt-Manager angeklickte Ebene; activeLayer fällt zurück, wenn sie fehlt, verborgen oder gesperrt ist. */
  layer = $state<string | undefined>();
  #last = 0;

  constructor(doc: Doc) {
    this.id = doc.pages[0].id;
  }

  index(doc: Doc): number {
    const i = doc.pages.findIndex((p) => p.id === this.id);
    if (i >= 0) this.#last = i;
    return Math.min(this.#last, doc.pages.length - 1);
  }

  go(doc: Doc, i: number): void {
    [this.id, this.#last, this.layer] = [doc.pages[i].id, i, undefined];
  }
}
