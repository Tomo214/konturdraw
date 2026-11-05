<script lang="ts">
  // Farben des Ergebnisses im Nachzeichnen-Panel (7d): anklicken wählt (mehrere möglich); Zusammenführen gibt allen die
  // zuerst gewählte Farbe, bei einer gewählten öffnet das Farbfeld das Umfärben. Jede Änderung rechnet die Vorschau neu.
  import { convertColor, display } from '../io/colors';
  import { colorKey, type Rgb } from '../io/trace';
  import type { Color } from '../model/types';
  import ColorPicker from './ColorPicker.svelte';

  let {
    colors,
    edited,
    onset,
    onreset,
  }: { colors: readonly Rgb[]; edited: boolean; onset: (shown: Rgb[], to: Rgb) => void; onreset: () => void } = $props();

  let picks = $state<Rgb[]>([]);
  // Farbe im Umfärben: bleibt offen, bis die neu gerechnete Vorschau die neue Farbe zeigt.
  let editing = $state<Rgb | null>(null);
  const has = (list: readonly Rgb[], c: Rgb) => list.some((x) => colorKey(x) === colorKey(c));
  const chosen = $derived(picks.filter((c) => has(colors, c)));
  const css = (c: Rgb) => `rgb(${c.map((v) => Math.round(v * 255)).join(' ')})`;

  function toggle(c: Rgb) {
    editing = null;
    picks = has(chosen, c) ? chosen.filter((x) => colorKey(x) !== colorKey(c)) : [...chosen, c];
  }
  function merge() {
    onset(chosen, chosen[0]);
    picks = [chosen[0]];
  }
  async function recolor(c: Color) {
    const from = editing ?? chosen[0];
    const to = (await convertColor(c, 'rgb', display.settings)).values as Rgb;
    onset([from], to);
    [editing, picks] = [to, [to]];
  }
</script>

<div class="colors">
  <span class="head">Ergebnisfarben <output>{colors.length}</output></span>
  <div class="list" role="group" aria-label="Farben des Ergebnisses">
    {#each colors as c (colorKey(c))}
      <button class="swatch" style:background={css(c)} aria-pressed={has(chosen, c)} aria-label="Farbe {css(c)}" title="Anklicken wählt, mehrere zum Zusammenführen" onclick={() => toggle(c)}></button>
    {/each}
  </div>
  <div class="acts">
    <button disabled={chosen.length < 2} onclick={merge}>Zusammenführen</button>
    {#if chosen.length === 1 || editing}
      <ColorPicker color={{ model: 'rgb', values: editing ?? chosen[0] }} title="Farbe ändern" onchange={recolor} />
    {/if}
    <button disabled={!edited} onclick={() => ((picks = []), (editing = null), onreset())}>Zurücksetzen</button>
  </div>
</div>

<style>
  .colors {
    display: grid;
    gap: 6px;
  }
  .head {
    display: flex;
    justify-content: space-between;
  }
  .list {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .swatch {
    width: 20px;
    height: 16px;
    min-height: 0;
    padding: 0;
    border-color: rgb(0 0 0 / 0.35);
    border-radius: 2px;
  }
  .swatch[aria-pressed='true'] {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .acts {
    display: flex;
    align-items: center;
    gap: 6px;
  }
</style>
