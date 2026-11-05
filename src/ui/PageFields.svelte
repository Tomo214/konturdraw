<script lang="ts">
  // Eigenschaftsleiste ohne Auswahl (wie Vorbild): Seitenformat, Größe, Hoch/Quer, Zeichnungseinheit, Verschiebe-Schritt.
  import { PAGE_FORMATS, UNITS, formatLength, pageFormat, parseLength, type Unit } from '../model/units';
  import Icon from './Icon.svelte';
  import NumField from './NumField.svelte';
  import type { Command } from './shortcuts';

  let {
    page,
    units,
    nudge,
    oncommand,
  }: { page: { width: number; height: number }; units: Unit; nudge: number; oncommand: (c: Command) => void } = $props();

  const u = $derived(UNITS[units].label);
  const portrait = $derived(page.width <= page.height);
  const len = (mm: number) => formatLength(mm, units);
  const parseLen = (s: string) => parseLength(s, units);
  const size = (width: number, height: number) => oncommand({ name: 'pageSize', width, height });
  const keep = (e: PointerEvent) => e.preventDefault();

  // Neues Format behält die Ausrichtung.
  function pick(name: string) {
    const f = PAGE_FORMATS.find((x) => x.name === name);
    if (f) size(portrait ? f.width : f.height, portrait ? f.height : f.width);
  }
  const orient = (p: boolean) => p !== portrait && size(page.height, page.width);
</script>

<select class="format" aria-label="Seitenformat" value={pageFormat(page.width, page.height) ?? ''} onchange={(e) => pick(e.currentTarget.value)}>
  {#each PAGE_FORMATS as f (f.name)}<option value={f.name}>{f.name}</option>{/each}
  <option value="" disabled>Benutzerdefiniert</option>
</select>
<div class="pair">
  <NumField label="B" tip="Seitenbreite" text={len(page.width)} suffix={u} parse={parseLen} onset={(w) => size(w, page.height)} />
  <NumField label="H" tip="Seitenhöhe" text={len(page.height)} suffix={u} parse={parseLen} onset={(h) => size(page.width, h)} />
</div>
<button class="icon" aria-pressed={portrait} aria-label="Hochformat" data-tip="Hochformat" data-tip-side="below" onpointerdown={keep} onclick={() => orient(true)}
  ><Icon name="portrait" size={16} /></button
>
<button class="icon" aria-pressed={!portrait} aria-label="Querformat" data-tip="Querformat" data-tip-side="below" onpointerdown={keep} onclick={() => orient(false)}
  ><Icon name="landscape" size={16} /></button
>
<span class="sep"></span>
<label class="field" data-tip="Zeichnungseinheit" data-tip-side="below">
  Einheit
  <select value={units} onchange={(e) => oncommand({ name: 'settings', units: e.currentTarget.value as Unit })}>
    {#each Object.entries(UNITS) as [id, x] (id)}<option value={id}>{x.name}</option>{/each}
  </select>
</label>
<NumField icon="nudge" tip="Verschiebe-Schritt der Pfeiltasten" text={len(nudge)} suffix={u} parse={parseLen} onset={(n) => oncommand({ name: 'settings', nudge: n })} />

<style>
  .format {
    width: 132px;
  }
</style>
