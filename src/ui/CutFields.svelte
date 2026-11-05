<script lang="ts">
  // Optionen von Messer, Radierer und Pipette in der Eigenschaftsleiste (Abläufe wie Vorbild, Texte eigen).
  import { UNITS, formatLength, parseLength, type Unit } from '../model/units';
  import NumField from './NumField.svelte';
  import type { Tool } from './shortcuts';
  import type { CutParams } from './tools/cut-tools';

  let { tool, units, cut = $bindable() }: { tool: Tool; units: Unit; cut: CutParams } = $props();

  const keep = (e: PointerEvent) => e.preventDefault();
</script>

{#if tool === 'knife'}
  <button aria-pressed={cut.knife === 'line'} data-tip="Gerade von Punkt zu Punkt schneiden" data-tip-side="below" onpointerdown={keep} onclick={() => (cut = { ...cut, knife: 'line' })}>Gerade</button>
  <button aria-pressed={cut.knife === 'free'} data-tip="Freihand schneiden" data-tip-side="below" onpointerdown={keep} onclick={() => (cut = { ...cut, knife: 'free' })}>Freihand</button>
{:else if tool === 'eraser'}
  <NumField
    label="Dicke"
    tip="Radierer-Dicke"
    text={formatLength(cut.width, units)}
    suffix={UNITS[units].label}
    parse={(s) => parseLength(s, units)}
    onset={(w) => (cut = { ...cut, width: Math.min(100, Math.max(0.05, w)) })}
  />
  <button aria-pressed={cut.nib === 'round'} data-tip="Runde Spitze" data-tip-side="below" onpointerdown={keep} onclick={() => (cut = { ...cut, nib: 'round' })}>Rund</button>
  <button aria-pressed={cut.nib === 'square'} data-tip="Eckige Spitze" data-tip-side="below" onpointerdown={keep} onclick={() => (cut = { ...cut, nib: 'square' })}>Eckig</button>
{:else if tool === 'eyedropper'}
  <button aria-pressed={cut.pick.fill} data-tip="Füllung übertragen" data-tip-side="below" onpointerdown={keep} onclick={() => (cut = { ...cut, pick: { ...cut.pick, fill: !cut.pick.fill } })}>Füllung</button>
  <button aria-pressed={cut.pick.stroke} data-tip="Kontur übertragen" data-tip-side="below" onpointerdown={keep} onclick={() => (cut = { ...cut, pick: { ...cut.pick, stroke: !cut.pick.stroke } })}>Kontur</button>
{/if}
