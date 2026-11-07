<script lang="ts">
  // Layout › Dokumentoptionen (Vorbild: Raster in den Dokumentoptionen; Doppelklick aufs Lineal öffnet ihn auch).
  // Rasterabstand in der Zeichnungseinheit; unveränderte Felder behalten den genauen mm-Wert.
  import { gridOf } from '../model/guides';
  import type { Doc } from '../model/types';
  import { DEFAULT_UNIT, UNITS } from '../model/units';
  import Icon from './Icon.svelte';
  import type { Command } from './shortcuts';
  import { tr } from '../i18n/i18n.svelte';

  let { doc, grid = $bindable(), oncommand }: { doc: () => Doc; grid: boolean; oncommand: (c: Command) => void } = $props();

  let dialog: HTMLDialogElement;
  let unit = $state(UNITS[DEFAULT_UNIT]);
  let x = $state(0);
  let y = $state(0);
  let showGrid = $state(false);
  let error = $state('');
  let before = { x: 0, y: 0, mm: { x: 0, y: 0 } };

  const round = (v: number) => Math.round(v * 1000) / 1000;

  export function open() {
    const d = doc();
    const g = gridOf(d);
    unit = UNITS[d.units ?? DEFAULT_UNIT];
    [x, y, showGrid, error] = [round(g.x / unit.mm), round(g.y / unit.mm), grid, ''];
    before = { x, y, mm: g };
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>('input')?.select();
  }

  function apply(e: SubmitEvent) {
    e.preventDefault();
    if (!(x > 0 && y > 0)) return void (error = tr('Rasterabstand muss größer als 0 sein.'));
    const mm = (v: number, old: number, exact: number) => (v === old ? exact : v * unit.mm);
    oncommand({ name: 'grid', x: mm(x, before.x, before.mm.x), y: mm(y, before.y, before.mm.y) });
    grid = showGrid;
    dialog.close();
  }
</script>

<dialog bind:this={dialog} aria-label={tr('Dokumentoptionen')}>
  <header>
    <h2>{tr('Dokumentoptionen')}</h2>
    <button class="close" aria-label={tr('Schließen')} onclick={() => dialog.close()}><Icon name="close" size={16} /></button>
  </header>
  <form onsubmit={apply}>
    <div class="fields">
      <span class="section">{tr('Raster')}</span>
      <span></span>
      <label for="kw-grid-x">{tr('Waagerecht')}</label>
      <span><input id="kw-grid-x" type="number" min="0" step="any" bind:value={x} /> {unit.label}</span>
      <label for="kw-grid-y">{tr('Senkrecht')}</label>
      <span><input id="kw-grid-y" type="number" min="0" step="any" bind:value={y} /> {unit.label}</span>
      <span></span>
      <label class="check"><input type="checkbox" bind:checked={showGrid} /> {tr('Raster anzeigen')}</label>
    </div>
    {#if error}<p role="alert">{error}</p>{/if}
    <footer>
      <button class="primary" type="submit">OK</button>
      <button type="button" onclick={() => dialog.close()}>{tr('Abbrechen')}</button>
    </footer>
  </form>
</dialog>

<style>
  .section {
    font-weight: 600;
    color: var(--text-strong);
  }
  p {
    margin: 8px 14px 0;
    color: var(--accent);
  }
</style>
