<script lang="ts">
  import type { TileLayout } from '../model/tiles';
  import { tr } from '../i18n/i18n.svelte';

  // Druck in Kacheln: Seite als Papier, Blätter darüber (Überlappungen werden dunkler), Blattnamen.
  let { width, height, layout }: { width: number; height: number; layout: TileLayout } = $props();
  const cap = $derived(Math.max(width, height) * 0.08);
</script>

<svg viewBox="0 0 {width} {height}" role="img" aria-label={tr('Vorschau der Blätter')}>
  <rect class="page" {width} {height} />
  {#each layout.tiles as t (t.label)}
    {@const w = Math.min(t.x + layout.width, width) - t.x}
    {@const h = Math.min(t.y + layout.height, height) - t.y}
    <rect class="tile" x={t.x} y={t.y} width={w} height={h} />
    <text x={t.x + w / 2} y={t.y + h / 2} font-size={Math.min(w * 0.5, h * 0.5, cap)}>{t.label}</text>
  {/each}
</svg>

<style>
  svg {
    display: block;
    width: 100%;
    max-height: 150px;
    overflow: visible;
  }
  rect {
    vector-effect: non-scaling-stroke;
  }
  .page {
    fill: #fff;
    stroke: var(--line-strong);
  }
  .tile {
    fill: var(--accent-soft);
    stroke: var(--accent);
  }
  text {
    fill: var(--accent-ink);
    font-weight: 600;
    text-anchor: middle;
    dominant-baseline: central;
  }
</style>
