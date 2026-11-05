<script lang="ts">
  // Eigenschaftsleiste mit Auswahl (wie Vorbild): Lage, Größe, Skalierung mit Schloss, Winkel, Spiegeln.
  // Lage = Mitte der Auswahl ab Lineal-Nullpunkt, y nach oben; jede Eingabe ist ein Rückgängig-Schritt.
  import type { Field, Measure } from '../model/arrange';
  import type { Point } from '../model/types';
  import { UNITS, formatLength, formatNumber, parseLength, parseNumber, type Unit } from '../model/units';
  import Icon from './Icon.svelte';
  import NumField from './NumField.svelte';
  import type { Command } from './shortcuts';

  let { ms, origin, units, oncommand }: { ms: Measure; origin: Point; units: Unit; oncommand: (c: Command) => void } = $props();

  let locked = $state(false);
  const b = $derived(ms.box);
  const u = $derived(UNITS[units].label);
  const len = (mm: number) => formatLength(mm, units);
  const parseLen = (s: string) => parseLength(s, units);
  const set = (field: Field) => (value: number) => oncommand({ name: 'field', field, value, locked });
  // Das Modell rechnet ab oben links mit y nach unten.
  const setX = (v: number) => set('x')(v + origin.x);
  const setY = (v: number) => set('y')(origin.y - v);
  const keep = (e: PointerEvent) => e.preventDefault();
</script>

<div class="pair">
  <NumField label="X" tip="Lage waagerecht (Mitte)" text={len((b.minX + b.maxX) / 2 - origin.x)} suffix={u} parse={parseLen} onset={setX} />
  <NumField label="Y" tip="Lage senkrecht (Mitte)" text={len(origin.y - (b.minY + b.maxY) / 2)} suffix={u} parse={parseLen} onset={setY} />
</div>
<div class="pair">
  <NumField label="B" tip="Breite" text={len(b.maxX - b.minX)} suffix={u} parse={parseLen} onset={set('w')} />
  <NumField label="H" tip="Höhe" text={len(b.maxY - b.minY)} suffix={u} parse={parseLen} onset={set('h')} />
</div>
<div class="pair">
  <NumField tip="Skalierung waagerecht" text={formatNumber(ms.scale[0])} suffix="%" width={44} parse={parseNumber} onset={set('sx')} />
  <NumField tip="Skalierung senkrecht" text={formatNumber(ms.scale[1])} suffix="%" width={44} parse={parseNumber} onset={set('sy')} />
</div>
<button
  class="icon"
  aria-pressed={locked}
  aria-label="Seitenverhältnis sperren"
  data-tip="Seitenverhältnis sperren"
  data-tip-side="below"
  onpointerdown={keep}
  onclick={() => (locked = !locked)}><Icon name="lock" size={16} /></button
>
<span class="sep"></span>
<NumField icon="rotate" tip="Drehwinkel (gegen den Uhrzeigersinn)" text={formatNumber(ms.angle)} suffix="°" width={44} parse={parseNumber} onset={set('angle')} />
<!-- Neigen wirkt relativ (wie das Transformieren-Andockfenster im Vorbild): Feld zeigt 0, Eingabe neigt um so viel. -->
<div class="pair">
  <NumField icon="skewH" tip="Waagerecht neigen um (Grad)" text="0" suffix="°" width={36} parse={parseNumber} onset={set('skewH')} />
  <NumField icon="skewV" tip="Senkrecht neigen um (Grad)" text="0" suffix="°" width={36} parse={parseNumber} onset={set('skewV')} />
</div>
<span class="sep"></span>
<button class="icon" aria-label="Waagerecht spiegeln" data-tip="Waagerecht spiegeln" data-tip-side="below" onpointerdown={keep} onclick={() => oncommand({ name: 'mirror', axis: 'h' })}
  ><Icon name="mirrorH" size={16} /></button
>
<button class="icon" aria-label="Senkrecht spiegeln" data-tip="Senkrecht spiegeln" data-tip-side="below" onpointerdown={keep} onclick={() => oncommand({ name: 'mirror', axis: 'v' })}
  ><Icon name="mirrorV" size={16} /></button
>
