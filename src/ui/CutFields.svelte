<script lang="ts">
  // Optionen von Messer, Radierer und Pipette in der Eigenschaftsleiste (Abläufe wie Vorbild, Texte eigen).
  import { UNITS, formatLength, parseLength, type Unit } from '../model/units';
  import NumField from './NumField.svelte';
  import type { Tool } from './shortcuts';
  import type { CutParams } from './tools/cut-tools';
  import { tr } from '../i18n/i18n.svelte';

  let { tool, units, cut = $bindable() }: { tool: Tool; units: Unit; cut: CutParams } = $props();

  const keep = (e: PointerEvent) => e.preventDefault();
</script>

{#if tool === 'knife'}
  <button aria-pressed={cut.knife === 'line'} data-tip={tr('Gerade von Punkt zu Punkt schneiden')} data-tip-side="below" onpointerdown={keep} onclick={() => (cut = { ...cut, knife: 'line' })}>{tr('Gerade')}</button>
  <button aria-pressed={cut.knife === 'free'} data-tip={tr('Freihand schneiden')} data-tip-side="below" onpointerdown={keep} onclick={() => (cut = { ...cut, knife: 'free' })}>{tr('Freihand')}</button>
{:else if tool === 'eraser'}
  <NumField
    label={tr('Dicke')}
    tip={tr('Radierer-Dicke')}
    text={formatLength(cut.width, units)}
    suffix={UNITS[units].label}
    parse={(s) => parseLength(s, units)}
    onset={(w) => (cut = { ...cut, width: Math.min(100, Math.max(0.05, w)) })}
  />
  <button aria-pressed={cut.nib === 'round'} data-tip={tr('Runde Spitze')} data-tip-side="below" onpointerdown={keep} onclick={() => (cut = { ...cut, nib: 'round' })}>{tr('Rund')}</button>
  <button aria-pressed={cut.nib === 'square'} data-tip={tr('Eckige Spitze')} data-tip-side="below" onpointerdown={keep} onclick={() => (cut = { ...cut, nib: 'square' })}>{tr('Eckig')}</button>
{:else if tool === 'eyedropper'}
  <button aria-pressed={cut.pick.fill} data-tip={tr('Füllung übertragen')} data-tip-side="below" onpointerdown={keep} onclick={() => (cut = { ...cut, pick: { ...cut.pick, fill: !cut.pick.fill } })}>{tr('Füllung')}</button>
  <button aria-pressed={cut.pick.stroke} data-tip={tr('Kontur übertragen')} data-tip-side="below" onpointerdown={keep} onclick={() => (cut = { ...cut, pick: { ...cut.pick, stroke: !cut.pick.stroke } })}>{tr('Kontur')}</button>
{/if}
