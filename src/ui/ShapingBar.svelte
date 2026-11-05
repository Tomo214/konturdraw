<script lang="ts">
  // Formen-Befehle (Spec §7) in der Eigenschaftsleiste, sobald etwas gewählt ist; Icon-Knöpfe mit Kurzinfo.
  import { outlineObjects, shapeObjects } from '../io/bridge';
  import type { History } from '../model/history';
  import { planOutline } from '../model/outline';
  import { planShaping, type ShapingName, type ShapingResult } from '../model/shaping';
  import type { Doc, Subpath } from '../model/types';
  import Icon from './Icon.svelte';

  let {
    history,
    selected,
    ondone,
    onnotice,
  }: {
    history: History<Doc>;
    /** Reihenfolge zählt: das zuletzt gewählte Objekt ist das Ziel. */
    selected: () => ReadonlySet<string>;
    ondone: (r: ShapingResult) => void;
    onnotice: (msg: string) => void;
  } = $props();

  const LABELS: [ShapingName, string][] = [
    ['weld', 'Verschmelzen'],
    ['trim', 'Zuschneiden'],
    ['intersect', 'Schnittmenge'],
    ['simplify', 'Vereinfachen'],
    ['frontMinusBack', 'Vorne minus hinten'],
    ['backMinusFront', 'Hinten minus vorne'],
    ['boundary', 'Umrandung'],
    ['combine', 'Kombinieren'],
    ['breakApart', 'Aufbrechen'],
  ];
  let busy = $state(false);

  type Plan<J> = { jobs: J[]; notice?: string; finish(r: Subpath[][]): ShapingResult };

  export const run = (name: ShapingName) => go((doc) => planShaping(doc, [...selected()], name), shapeObjects);
  /** Kontur in Objekt (Objekt-Menü, Strg+Umschalt+Q) – gleicher Ablauf wie die Formen-Befehle. */
  export const outline = () => go((doc) => planOutline(doc, [...selected()]), outlineObjects);

  async function go<J>(make: (doc: Doc) => Plan<J>, call: (jobs: J[]) => Promise<Subpath[][]>) {
    if (busy) return;
    busy = true;
    try {
      const doc = history.current;
      const plan = make(doc);
      const res = plan.jobs.length ? await call(plan.jobs) : [];
      // Währenddessen bearbeitet → Ergebnis passt nicht mehr zum Dokument.
      if (history.current !== doc) return onnotice('Dokument wurde währenddessen geändert – Befehl verworfen.');
      ondone(plan.finish(res));
      onnotice(plan.notice ?? '');
    } catch (err) {
      onnotice((err as Error).message);
    } finally {
      busy = false;
    }
  }
</script>

<nav aria-label="Formen">
  <span class="sep"></span>
  {#each LABELS as [name, label], i (name)}
    {#if i === 7}<span class="sep"></span>{/if}
    <button class="icon" disabled={busy} aria-label={label} data-tip={label} data-tip-side="below" onpointerdown={(e) => e.preventDefault()} onclick={() => run(name)}
      ><Icon {name} size={18} /></button
    >
  {/each}
</nav>

<style>
  nav {
    display: flex;
    align-items: center;
    gap: 2px;
    align-self: stretch;
  }
  nav .sep {
    margin-inline: 6px;
  }
  button {
    background: none;
    border-color: transparent;
  }
</style>
