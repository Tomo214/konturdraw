<script lang="ts">
  // Optionen des Kontur-Werkzeugs in der Eigenschaftsleiste (Abläufe wie Vorbild, Texte eigen).
  import { MAX_CONTOUR_STEPS, type ContourParams } from '../model/contour';
  import { UNITS, formatLength, parseLength, parseNumber, type Unit } from '../model/units';
  import NumField from './NumField.svelte';
  import { contourParams as c } from './contour-params.svelte';
  import { N_, tr } from '../i18n/i18n.svelte';

  let { units }: { units: Unit } = $props();

  const keep = (e: PointerEvent) => e.preventDefault();
  const DIRS: [ContourParams['direction'], string, string][] = [
    ['outside', N_('Außen'), N_('Kontur nach außen')],
    ['inside', N_('Innen'), N_('Kontur nach innen')],
    ['center', N_('Zur Mitte'), N_('Kontur bis zur Mitte füllen')],
  ];
</script>

{#each DIRS as [d, label, tip] (d)}
  <button aria-pressed={c.direction === d} data-tip={tr(tip)} data-tip-side="below" onpointerdown={keep} onclick={() => (c.direction = d)}>{tr(label)}</button>
{/each}
<NumField
  label={tr('Schritte')}
  tip={tr('Anzahl der Schritte')}
  text={String(c.steps)}
  width={40}
  parse={parseNumber}
  onset={(n) => (c.steps = Math.round(Math.min(MAX_CONTOUR_STEPS, Math.max(1, n))))}
/>
<NumField
  label={tr('Abstand')}
  tip={tr('Abstand zwischen den Schritten')}
  text={formatLength(c.offset, units)}
  suffix={UNITS[units].label}
  parse={(s) => parseLength(s, units)}
  onset={(v) => (c.offset = Math.min(100, Math.max(0.01, v)))}
/>
<label class="field">
  {tr('Ecken')}
  <select value={c.join} onchange={(e) => (c.join = e.currentTarget.value as ContourParams['join'])}>
    <option value="miter">{tr('spitz')}</option>
    <option value="round">{tr('rund')}</option>
    <option value="bevel">{tr('abgeschrägt')}</option>
  </select>
</label>

<style>
  button {
    white-space: nowrap;
  }
</style>
