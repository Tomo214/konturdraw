<script lang="ts">
  // Andockfenster Ausrichten und Verteilen (wie Vorbild, Mod+Shift+A). Bezug für Objekte: das zuletzt gewählte;
  // ein einzelnes Objekt richtet sich an der Seite aus.
  import type { AlignEdge, AlignTo, DistributeMode, DistributeTo } from '../model/arrange';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';
  import type { Command } from './shortcuts';

  let { count, oncommand }: { count: number; oncommand: (c: Command) => void } = $props();

  let alignTo = $state<AlignTo>('objects');
  let distributeTo = $state<DistributeTo>('selection');

  const ALIGN: readonly [AlignEdge, IconName, string][] = [
    ['left', 'alignLeft', 'Links ausrichten (L)'],
    ['centerX', 'alignCenterX', 'Mitten senkrecht ausrichten (C)'],
    ['right', 'alignRight', 'Rechts ausrichten (R)'],
    ['top', 'alignTop', 'Oben ausrichten (T)'],
    ['centerY', 'alignCenterY', 'Mitten waagerecht ausrichten (E)'],
    ['bottom', 'alignBottom', 'Unten ausrichten (B)'],
  ];
  const DISTRIBUTE: readonly [DistributeMode, IconName, string][] = [
    ['left', 'distLeft', 'Linke Kanten verteilen (Umschalt+L)'],
    ['centerX', 'distCenterX', 'Mitten waagerecht verteilen (Umschalt+C)'],
    ['right', 'distRight', 'Rechte Kanten verteilen (Umschalt+R)'],
    ['spacingX', 'distSpacingX', 'Gleiche Abstände waagerecht'],
    ['top', 'distTop', 'Obere Kanten verteilen (Umschalt+T)'],
    ['centerY', 'distCenterY', 'Mitten senkrecht verteilen (Umschalt+E)'],
    ['bottom', 'distBottom', 'Untere Kanten verteilen (Umschalt+B)'],
    ['spacingY', 'distSpacingY', 'Gleiche Abstände senkrecht'],
  ];
  const keep = (e: PointerEvent) => e.preventDefault();
</script>

<div class="form">
  <h3>Ausrichten</h3>
  <div class="wide grid six">
    {#each ALIGN as [edge, icon, label] (edge)}
      <button class="icon" disabled={!count} aria-label={label} data-tip={label} data-tip-side="below" onpointerdown={keep} onclick={() => oncommand({ name: 'align', edge, to: alignTo })}
        ><Icon name={icon} size={18} /></button
      >
    {/each}
  </div>
  <label class="row">
    <span>Bezug</span>
    <select bind:value={alignTo}>
      <option value="objects">Letztes Objekt</option>
      <option value="page">Seitenrand</option>
      <option value="pageCenter">Seitenmitte</option>
    </select>
  </label>
  <button class="wide" disabled={!count} onpointerdown={keep} onclick={() => oncommand({ name: 'align', edge: 'page' })}>
    <Icon name="alignPage" size={16} /> Auf Seite zentrieren (P)
  </button>
  <hr />
  <h3>Verteilen</h3>
  <div class="wide grid four">
    {#each DISTRIBUTE as [mode, icon, label] (mode)}
      <button class="icon" disabled={count < 2} aria-label={label} data-tip={label} data-tip-side="below" onpointerdown={keep} onclick={() => oncommand({ name: 'distribute', mode, to: distributeTo })}
        ><Icon name={icon} size={18} /></button
      >
    {/each}
  </div>
  <label class="row">
    <span>Bereich</span>
    <select bind:value={distributeTo}>
      <option value="selection">Auswahlrahmen</option>
      <option value="page">Seite</option>
    </select>
  </label>
  {#if count < 2}<p class="wide hint">{count ? 'Verteilen braucht mindestens zwei Objekte.' : 'Nichts gewählt.'}</p>{/if}
</div>

<style>
  .grid {
    display: grid;
    gap: 4px;
  }
  .six {
    grid-template-columns: repeat(3, 32px) 8px repeat(3, 32px);
  }
  .six > :nth-child(4) {
    grid-column: 5;
  }
  .four {
    grid-template-columns: repeat(4, 32px);
  }
  .icon {
    display: grid;
    place-items: center;
    height: 30px;
    padding: 0;
  }
  button.wide {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .hint {
    margin: 0;
    color: var(--text-dim);
  }
</style>
