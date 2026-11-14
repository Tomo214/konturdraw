<script lang="ts">
  // Optionen des Glätten-Werkzeugs in der Eigenschaftsleiste (Abläufe wie Vorbild, Texte eigen).
  import { UNITS, formatLength, parseLength, parseNumber, type Unit } from '../model/units';
  import NumField from './NumField.svelte';
  import { smoothParams as s } from './smooth-params.svelte';
  import { RADIUS_RANGE } from './tools/smooth-tool';
  import { tr } from '../i18n/i18n.svelte';

  let { units }: { units: Unit } = $props();

  const keep = (e: PointerEvent) => e.preventDefault();
</script>

<NumField
  label={tr('Radius')}
  tip={tr('Pinselradius · Shift + Ziehen auf der Zeichenfläche')}
  text={formatLength(s.radius, units)}
  suffix={UNITS[units].label}
  parse={(v) => parseLength(v, units)}
  onset={(r) => (s.radius = Math.min(RADIUS_RANGE[1], Math.max(RADIUS_RANGE[0], r)))}
/>
<NumField
  label={tr('Tempo')}
  tip={tr('Wie stark ein Strich glättet · Alt + Ziehen auf der Zeichenfläche')}
  text={String(s.rate)}
  suffix="%"
  width={40}
  parse={parseNumber}
  onset={(n) => (s.rate = Math.round(Math.min(100, Math.max(1, n))))}
/>
<button aria-pressed={s.pressure} data-tip={tr('Stiftdruck steuert das Tempo')} data-tip-side="below" onpointerdown={keep} onclick={() => (s.pressure = !s.pressure)}>{tr('Stiftdruck')}</button>

<style>
  button {
    white-space: nowrap;
  }
</style>
