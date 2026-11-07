<script lang="ts">
  // Werkzeug-Optionen Rechteck und Vieleck in der Eigenschaftsleiste (wie Vorbild).
  // Gilt wie im Bedienfeld für gewählte Formen und als Vorgabe für neue.
  import { UNITS, formatLength, formatNumber, parseLength, parseNumber, type Unit } from '../model/units';
  import NumField from './NumField.svelte';
  import type { Tool } from './shortcuts';
  import type { ShapeParams } from './tools/shape-tool';
  import { tr } from '../i18n/i18n.svelte';

  let {
    tool,
    shape,
    units,
    onradius,
    onpolygon,
  }: {
    tool: Tool;
    shape: ShapeParams;
    units: Unit;
    onradius: (r: number) => void;
    onpolygon: (sides: number, inner: number | null) => void;
  } = $props();

  const STAR = 0.5;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
</script>

{#if tool === 'rect'}
  <NumField
    label={tr('Ecken')}
    tip={tr('Eckenradius')}
    text={formatLength(shape.radius, units)}
    suffix={UNITS[units].label}
    parse={(s) => parseLength(s, units)}
    onset={(r) => onradius(clamp(r, 0, 1000))}
  />
{:else if tool === 'polygon'}
  <NumField label={tr('Seiten')} tip={tr('Anzahl der Seiten')} text={String(shape.sides)} width={40} parse={parseNumber} onset={(n) => onpolygon(Math.round(clamp(n, 3, 100)), shape.inner)} />
  <button aria-pressed={shape.inner !== null} onpointerdown={(e) => e.preventDefault()} onclick={() => onpolygon(shape.sides, shape.inner === null ? STAR : null)}>{tr('Stern')}</button>
  {#if shape.inner !== null}
    <NumField
      label={tr('Innen')}
      tip={tr('Innenradius')}
      text={formatNumber(shape.inner * 100)}
      suffix="%"
      width={40}
      parse={parseNumber}
      onset={(v) => onpolygon(shape.sides, clamp(v, 5, 95) / 100)}
    />
  {/if}
{/if}
