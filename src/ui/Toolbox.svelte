<script lang="ts">
  // Werkzeugkasten links (wie Vorbild): eine Taste je Gruppe, zuletzt benutztes Werkzeug vorn,
  // Ecke oder Rechtsklick klappt die Gruppe aus.
  import Icon from './Icon.svelte';
  import { toolIcon } from './icons';
  import { keyLabel } from './menus';
  import type { Tool } from './shortcuts';
  import { TOOLBOX, type ToolInfo } from './toolbox';
  import { tr } from '../i18n/i18n.svelte';

  let { tool, isMac, onpick }: { tool: Tool; isMac: boolean; onpick: (t: Tool) => void } = $props();

  let front = $state(TOOLBOX.map((g) => g[0]));
  let flyout = $state<number | null>(null);
  let box: HTMLElement;

  $effect(() => {
    const i = TOOLBOX.findIndex((g) => g.some((t) => t.tool === tool));
    if (i >= 0) front[i] = TOOLBOX[i].find((t) => t.tool === tool)!;
  });

  const keyOf = (t: ToolInfo) => (t.key ? keyLabel(t.key, isMac) : t.hint ? tr(t.hint) : '');
  const tip = (t: ToolInfo) => (keyOf(t) ? `${tr(t.label)} (${keyOf(t)})` : tr(t.label));

  function pick(t: Tool) {
    flyout = null;
    onpick(t);
  }
  function unfold(e: Event, i: number) {
    e.preventDefault();
    flyout = flyout === i ? null : i;
  }
</script>

<svelte:window onpointerdown={(e) => flyout !== null && !box.contains(e.target as Node) && (flyout = null)} />

<div class="toolbox" role="toolbar" aria-orientation="vertical" aria-label={tr('Werkzeuge')} bind:this={box}>
  {#each TOOLBOX as group, i (i)}
    {@const t = front[i]}
    <div class="slot">
      <button
        class="tool"
        class:on={group.some((g) => g.tool === tool)}
        aria-label={tr(t.label)}
        aria-pressed={t.tool === tool}
        data-tip={flyout === i ? undefined : tip(t)}
        data-tip-side="right"
        onpointerdown={(e) => e.preventDefault()}
        onclick={() => pick(t.tool)}
        oncontextmenu={(e) => group.length > 1 && unfold(e, i)}><Icon name={toolIcon(t.tool)} /></button
      >
      {#if group.length > 1}
        <button class="corner" aria-label={tr('{tool}: weitere Werkzeuge', { tool: tr(t.label) })} onpointerdown={(e) => unfold(e, i)}></button>
      {/if}
      {#if flyout === i}
        <div class="flyout" role="menu">
          {#each group as g (g.tool)}
            <button class="entry" class:on={g.tool === tool} role="menuitem" onpointerdown={(e) => e.preventDefault()} onclick={() => pick(g.tool)}>
              <Icon name={toolIcon(g.tool)} />
              <span>{tr(g.label)}</span>
              <kbd>{keyOf(g)}</kbd>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .toolbox {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 4px;
    background: var(--bar);
    border-right: 1px solid var(--line);
  }
  .slot {
    position: relative;
  }
  .tool {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    background: none;
    border-color: transparent;
  }
  .tool.on {
    color: var(--accent-ink);
    background: var(--accent);
  }
  /* Ecke unten rechts: kleines Dreieck zeigt „hier ist mehr“. */
  .corner {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 12px;
    height: 12px;
    min-height: 0;
    padding: 0;
    background: none;
    border: none;
  }
  .corner::before {
    content: '';
    position: absolute;
    right: 3px;
    bottom: 3px;
    border: 3px solid transparent;
    border-right-color: currentColor;
    border-bottom-color: currentColor;
    opacity: 0.7;
  }
  .tool.on + .corner {
    color: var(--accent-ink);
  }
  .flyout {
    position: absolute;
    top: -4px;
    left: calc(100% + 6px);
    z-index: 40;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 180px;
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
  .entry {
    display: grid;
    grid-template-columns: 20px 1fr auto;
    align-items: center;
    gap: 8px;
    min-height: 30px;
    padding: 0 8px 0 6px;
    text-align: left;
    background: none;
    border: none;
  }
  .entry.on {
    color: var(--accent);
  }
  kbd {
    font: inherit;
    color: var(--text-dim);
  }
</style>
