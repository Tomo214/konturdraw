<script lang="ts" module>
  export type MenuItem = { label: string; run: () => void; checked?: boolean; disabled?: boolean } | null;
</script>

<script lang="ts">
  // Rechtsklick-Menü (Seitenreiter, Objekt-Manager), Optik wie die Menüleiste. Wächst aus dem Zeiger, bleibt im Fenster.
  import Icon from './Icon.svelte';

  let { at = $bindable(), items }: { at: { x: number; y: number } | null; items: readonly MenuItem[] } = $props();

  let el = $state<HTMLElement>();
  let pos = $state({ x: 0, y: 0 });

  // Erst messen, dann ins Fenster schieben.
  $effect(() => {
    if (!at || !el) return;
    const r = el.getBoundingClientRect();
    pos = { x: Math.min(at.x, innerWidth - r.width - 4), y: Math.min(at.y, innerHeight - r.height - 4) };
  });

  const close = () => (at = null);
  function pick(run: () => void) {
    close();
    run();
  }
  function onkey(e: KeyboardEvent) {
    if (!at || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  }
</script>

<svelte:window onkeydowncapture={onkey} onpointerdown={(e) => at && !el?.contains(e.target as Node) && close()} onblur={close} />

{#if at}
  <div class="menu" role="menu" bind:this={el} style:left="{pos.x || at.x}px" style:top="{pos.y || at.y}px">
    {#each items as it, j (j)}
      {#if it === null}
        <div class="sep" role="separator"></div>
      {:else}
        <button
          class="item"
          role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
          aria-checked={it.checked}
          disabled={it.disabled}
          onpointerdown={(e) => e.preventDefault()}
          onclick={() => pick(it.run)}
        >
          <span class="check">{#if it.checked}<Icon name="check" size={14} />{/if}</span>
          <span class="label">{it.label}</span>
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .menu {
    position: fixed;
    z-index: 50;
    min-width: 200px;
    padding: 4px;
    background: var(--panel);
    border: 1px solid var(--line-strong);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.45);
    transform-origin: top left;
    animation: grow var(--fast) var(--ease-out);
  }
  @keyframes grow {
    from {
      opacity: 0;
      scale: 0.98;
    }
  }
  .item {
    display: grid;
    grid-template-columns: 18px 1fr;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-height: 26px;
    padding: 0 8px 0 4px;
    text-align: left;
    background: none;
    border: none;
  }
  .item:hover:not(:disabled) {
    color: var(--text-strong);
    background: var(--hover);
  }
  .item:disabled {
    color: var(--text-dim);
  }
  .check {
    display: flex;
    justify-content: center;
    color: var(--accent);
  }
  .sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--line);
  }
</style>
