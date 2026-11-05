<script lang="ts">
  // Verlaufsknoten in der Eigenschaftsleiste (7b): Farbe und Lage des auf der Linie gewählten Knotens.
  // Enden bleiben bei 0 und 100 % fest; ohne gewählten Knoten nur ein Hinweis.
  import type { Color } from '../model/types';
  import { formatNumber, parseNumber } from '../model/units';
  import ColorPicker from './ColorPicker.svelte';
  import NumField from './NumField.svelte';
  import type { Knot } from './tools/tool';

  let { knot, onknot }: { knot: Knot | null; onknot: (patch: { offset?: number; color?: Color }) => void } = $props();
  const end = $derived(!!knot && (knot.index === 0 || knot.index === knot.count - 1));
</script>

{#if knot}
  <span class="field">Knoten {knot.index + 1} von {knot.count}</span>
  <ColorPicker color={knot.color} title="Knotenfarbe" onchange={(color) => onknot({ color })} />
  {#if end}
    <span class="field" data-tip="Anfang und Ende liegen fest; Linie mit den Enden verschieben">Lage {knot.index ? 100 : 0} %</span>
  {:else}
    <NumField label="Lage" tip="Lage des Knotens auf der Linie" text={formatNumber(knot.offset * 100)} suffix="%" width={44} parse={parseNumber} onset={(v) => onknot({ offset: v / 100 })} />
  {/if}
{:else}
  <span class="hint">Knoten anklicken: Farbe und Lage · Doppelklick auf die Linie: neuer Knoten · Palettenfarbe auf die Linie ziehen</span>
{/if}

<style>
  .hint {
    color: var(--text-dim);
    white-space: nowrap;
  }
</style>
