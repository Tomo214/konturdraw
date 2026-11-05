// Ansicht-Zustand: Sichtbares, Fangen, Farbproof, offenes Andockfenster – nicht im Dokument, kein Rückgängig-Schritt.
import type { Command, DockerId, Shown, SnapMode } from './shortcuts';

export class ViewState {
  show = $state<Record<Shown, boolean>>({ rulers: true, grid: false, guides: true, wire: false });
  snap = $state<Record<SnapMode, boolean>>({ objects: true, grid: false, guides: true, off: false });
  /** Soft-Proof: nur Anzeige */
  proof = $state(false);
  docker = $state<DockerId | null>('properties');

  /** Häkchen im Menü. */
  checked = (c: Command): boolean => (c.name === 'proof' && this.proof) || (c.name === 'show' && this.show[c.what]) || (c.name === 'snap' && this.snap[c.what]);

  /** Ansicht-Befehl ausführen; false = kein Ansicht-Befehl. */
  run(cmd: Command): boolean {
    if (cmd.name === 'docker') this.docker = cmd.id;
    else if (cmd.name === 'proof') this.proof = !this.proof;
    else if (cmd.name === 'show') this.show[cmd.what] = !this.show[cmd.what];
    else if (cmd.name === 'snap') this.snap[cmd.what] = !this.snap[cmd.what];
    else return false;
    return true;
  }
}
