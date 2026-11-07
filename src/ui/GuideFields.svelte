<script lang="ts">
  // Eigenschaftsleiste mit gewählter Hilfslinie (wie Vorbild): Lage ab Nullpunkt (y nach oben) und Sperren.
  import type { Guide, Point } from '../model/types';
  import { UNITS, formatLength, parseLength, type Unit } from '../model/units';
  import Icon from './Icon.svelte';
  import NumField from './NumField.svelte';
  import type { Command } from './shortcuts';
  import { tr } from '../i18n/i18n.svelte';

  let { guide, origin, units, oncommand }: { guide: Guide; origin: Point; units: Unit; oncommand: (c: Command) => void } = $props();

  const h = $derived(guide.axis === 'h');
  const shown = $derived(h ? origin.y - guide.pos : guide.pos - origin.x);
  const set = (v: number) => oncommand({ name: 'guide', id: guide.id, pos: h ? origin.y - v : v + origin.x });
</script>

<span class="kind">{h ? tr('Waagerechte Hilfslinie') : tr('Senkrechte Hilfslinie')}</span>
<NumField
  label={h ? 'Y' : 'X'}
  tip={h ? tr('Lage senkrecht') : tr('Lage waagerecht')}
  text={formatLength(shown, units)}
  suffix={UNITS[units].label}
  parse={(s) => parseLength(s, units)}
  onset={set}
/>
<button
  class="icon"
  aria-pressed={!!guide.locked}
  aria-label={tr('Hilfslinie sperren')}
  data-tip={tr('Hilfslinie sperren')}
  data-tip-side="below"
  onpointerdown={(e) => e.preventDefault()}
  onclick={() => oncommand({ name: 'guide', id: guide.id, locked: !guide.locked })}><Icon name="lock" size={16} /></button
>

<style>
  .kind {
    color: var(--text-dim);
  }
</style>
