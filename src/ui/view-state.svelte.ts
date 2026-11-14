// Ansicht-Zustand: Sichtbares, Fangen, Farbproof, offenes Andockfenster, Sprache – nicht im Dokument, kein Rückgängig-Schritt.
import type { TransformKind } from '../model/transform';
import type { Command, DockerId, Shown, SnapMode } from './shortcuts';
import { getLang, setLang } from '../i18n/i18n.svelte';

export class ViewState {
  show = $state<Record<Shown, boolean>>({ rulers: true, grid: false, guides: true, wire: false });
  snap = $state<Record<SnapMode, boolean>>({ objects: true, grid: false, guides: true, off: false });
  /** Soft-Proof: nur Anzeige */
  proof = $state(false);
  docker = $state<DockerId | null>('properties');
  /** gewählter Teil im Transformationen-Fenster */
  transform = $state<TransformKind>('position');

  /** Häkchen im Menü. */
  checked = (c: Command): boolean => (c.name === 'proof' && this.proof) || (c.name === 'show' && this.show[c.what]) || (c.name === 'snap' && this.snap[c.what]) || (c.name === 'lang' && getLang() === c.lang);

  /** Ansicht-Befehl ausführen; false = kein Ansicht-Befehl. */
  run(cmd: Command): boolean {
    if (cmd.name === 'docker') [this.docker, this.transform] = [cmd.id, cmd.part ?? this.transform];
    else if (cmd.name === 'proof') this.proof = !this.proof;
    else if (cmd.name === 'show') this.show[cmd.what] = !this.show[cmd.what];
    else if (cmd.name === 'snap') this.snap[cmd.what] = !this.snap[cmd.what];
    else if (cmd.name === 'lang') setLang(cmd.lang);
    else return false;
    return true;
  }
}
