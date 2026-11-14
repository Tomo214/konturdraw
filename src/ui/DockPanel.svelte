<script lang="ts">
  // Andockfenster rechts (wie Vorbild): Inhalt links, senkrechte Reiter am Rand. Alle Bereiche bleiben geladen,
  // weil Kürzel (Nachzeichnen, Formen) und die Statuszeile auf sie zugreifen.
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import type { DockerId } from './shortcuts';
  import { N_, tr } from '../i18n/i18n.svelte';

  let {
    open = $bindable(),
    objects,
    properties,
    align,
    transform,
    text,
    trace,
    color,
  }: { open: DockerId | null; objects: Snippet; properties: Snippet; align: Snippet; transform: Snippet; text: Snippet; trace: Snippet; color: Snippet } = $props();

  const TABS: readonly [DockerId, string][] = [
    ['objects', N_('Objekte')],
    ['properties', N_('Eigenschaften')],
    ['align', N_('Ausrichten')],
    ['transform', N_('Transformationen')],
    ['text', 'Text'],
    ['trace', N_('Nachzeichnen')],
    ['color', N_('Farbverwaltung')],
  ];
  const body = $derived({ objects, properties, align, transform, text, trace, color });
  const title = $derived(open === 'align' ? tr('Ausrichten und Verteilen') : tr(TABS.find(([id]) => id === open)?.[1] ?? ''));
</script>

<aside class="dock" aria-label={tr('Andockfenster')}>
  <div class="body" hidden={!open}>
    <header>
      <h2>{title}</h2>
      <button class="close" aria-label={tr('Andockfenster schließen')} onpointerdown={(e) => e.preventDefault()} onclick={() => (open = null)}
        ><Icon name="close" size={16} /></button
      >
    </header>
    {#each TABS as [id] (id)}
      <section class:flush={id === 'objects'} hidden={open !== id}>{@render body[id]()}</section>
    {/each}
  </div>
  <div class="tabs" role="tablist" aria-orientation="vertical">
    {#each TABS as [id, label] (id)}
      <button
        role="tab"
        class:on={open === id}
        aria-selected={open === id}
        onpointerdown={(e) => e.preventDefault()}
        onclick={() => (open = open === id ? null : id)}>{tr(label)}</button
      >
    {/each}
  </div>
</aside>

<style>
  .dock {
    display: flex;
    min-height: 0;
    background: var(--bar);
    border-left: 1px solid var(--line);
  }
  .body {
    display: flex;
    flex-direction: column;
    width: 272px;
    min-height: 0;
    background: var(--panel);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 32px;
    padding: 0 4px 0 12px;
    border-bottom: 1px solid var(--line);
  }
  h2 {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-strong);
  }
  .close {
    display: grid;
    place-items: center;
    width: 24px;
    padding: 0;
    background: none;
    border-color: transparent;
  }
  section {
    flex: 1;
    min-height: 0;
    padding: 12px;
    overflow-y: auto;
  }
  /* Objekt-Manager rollt selbst (nur sichtbare Zeilen). */
  section.flush {
    padding: 0;
    overflow: hidden;
  }
  .tabs {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 2px;
    /* sieben Reiter passen in kleine Fenster nicht immer ganz */
    overflow-y: auto;
  }
  .tabs button {
    writing-mode: vertical-rl;
    min-height: 0;
    padding: 10px 3px;
    background: none;
    border-color: transparent;
  }
  .tabs button.on {
    color: var(--text-strong);
    background: var(--control);
    border-color: var(--line);
    box-shadow: inset -2px 0 0 var(--accent);
  }
</style>
