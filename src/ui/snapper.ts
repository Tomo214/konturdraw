// Fangen zwischen Zeiger und Werkzeug: beim Schweben gegen die aktuelle Seite, beim Ziehen gegen den Stand beim Drücken
// (sonst finge das bewegte oder gerade gezeichnete Objekt an sich selbst).
import { SNAP_PX, snapPoint, type Snap, type SnapTo, type SnapWorld } from '../render/snap';
import type { Pointer } from './tools/tool';

export class Snapper {
  /** Letzter Treffer, für die Fangpunkt-Anzeige. */
  hit: Snap | null = null;
  private frozen: SnapWorld | null = null;

  /** to: eingeschaltete Ziele, null = Fangen aus. */
  constructor(
    private world: () => SnapWorld,
    private to: () => SnapTo | null,
  ) {}

  /** Zeiger auf das nächste Fangziel setzen; sx, sy bleiben roh. */
  at(p: Pointer, zoom: number): Pointer {
    const to = this.to();
    this.hit = to ? snapPoint(p.x, p.y, SNAP_PX / zoom, to, this.frozen ?? this.world()) : null;
    return this.hit ? { ...p, x: this.hit.x, y: this.hit.y, snap: this.hit.kind } : p;
  }

  /** Nach dem Drücken: Ziele einfrieren, skip = bewegte Objekte/Hilfslinien. */
  freeze(skip?: ReadonlySet<string>): void {
    this.frozen = { ...this.world(), skip };
  }

  release(): void {
    this.frozen = null;
  }
}
