<script lang="ts">
  // Menüleiste im Fenster (wie Vorbild unter Windows), auf beiden Plattformen gleich. Inhalt: menus.ts, Tastatur: menu-nav.ts.
  import Icon from './Icon.svelte';
  import { CLOSED, altMenu, navKey, openTop, type MenuNav } from './menu-nav';
  import { MENUS, keyLabel, keysFor, menuKey, type MenuEntry } from './menus';
  import type { Command } from './shortcuts';
  import { tr } from '../i18n/i18n.svelte';

  let {
    isMac,
    checked,
    enabled,
    oncommand,
  }: { isMac: boolean; checked: (c: Command) => boolean; enabled: (c: Command) => boolean; oncommand: (c: Command) => void } = $props();

  let bar: HTMLElement;
  let nav = $state<MenuNav>(CLOSED);
  /** Alt allein gedrückt (Windows-Art): Loslassen schaltet die Leiste an/aus; jede andere Eingabe bricht ab. */
  let armed = false;

  const keys = (e: Extract<MenuEntry, { cmd: Command }>) => {
    const k = keysFor(e, isMac);
    return k ? keyLabel(k, isMac) : '';
  };
  const close = () => (nav = CLOSED);
  // Mac: Option + Buchstabe in Textfeldern tippt Sonderzeichen – dort kein Menü.
  const typing = (t: EventTarget | null) =>
    t instanceof HTMLElement && (t.isContentEditable || t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button'].includes(t.type)));

  function pick(cmd: Command) {
    if (!enabled(cmd)) return;
    close();
    oncommand(cmd);
  }
  // Fokus bleibt auf der Zeichenfläche, damit Kürzel weiter greifen.
  function toggle(e: PointerEvent, i: number) {
    e.preventDefault();
    nav = nav.top === i && nav.path.length ? CLOSED : { top: i, path: [-1], keys: false };
  }
  /** Maus über Eintrag j auf Ebene depth: markieren; Untermenü öffnet ohne Markierung darin. */
  const hover = (depth: number, j: number, sub: boolean) => (nav = { ...nav, path: [...nav.path.slice(0, depth), j, ...(sub ? [-1] : [])] });

  // Capture-Phase: vor der Zeichenfläche, damit Pfeile, Escape und Buchstaben bei offenem Menü keine Kürzel auslösen.
  function onkey(e: KeyboardEvent) {
    const swallow = () => (e.preventDefault(), e.stopPropagation());
    if (e.key === 'Alt') {
      if (!e.repeat) armed = !isMac && !e.ctrlKey && !e.shiftKey && !e.metaKey;
      if (nav.top !== null) swallow();
      return;
    }
    armed = false;
    const t = isMac && typing(e.target) ? -1 : altMenu(e);
    if (t >= 0) {
      swallow();
      nav = openTop(t);
      return;
    }
    if (nav.top === null) return;
    swallow();
    const r = navKey(nav, e.key, enabled);
    nav = r.nav;
    if (r.run) oncommand(r.run);
  }
  function onkeyup(e: KeyboardEvent) {
    if (e.key !== 'Alt' || !armed) return;
    armed = false;
    e.preventDefault();
    nav = nav.top === null ? { top: 0, path: [], keys: true } : CLOSED;
  }
</script>

<svelte:window
  onkeydowncapture={onkey}
  onkeyupcapture={onkeyup}
  onwheel={() => (armed = false)}
  onpointerdown={(e) => {
    armed = false;
    if (nav.top !== null && !bar.contains(e.target as Node)) close();
  }}
  onblur={() => ((armed = false), close())}
/>

<nav class="menubar" class:keys={nav.keys} bind:this={bar} aria-label={tr('Menü')}>
  {#each MENUS as m, i (m.label)}
    <div class="top">
      <button
        class="title"
        class:open={nav.top === i}
        aria-haspopup="menu"
        aria-expanded={nav.top === i && nav.path.length > 0}
        onpointerdown={(e) => toggle(e, i)}
        onpointerenter={() => nav.top !== null && nav.top !== i && (nav = { ...nav, top: i, path: nav.path.length ? [-1] : [] })}
        >{@render mnemonic(tr(m.label), menuKey(m))}</button
      >
      {#if nav.top === i && nav.path.length}
        {@render list(m.items, 0)}
      {/if}
    </div>
  {/each}
</nav>

{#snippet mnemonic(label: string, key: string)}
  {@const at = Math.max(0, label.toUpperCase().indexOf(key))}
  {label.slice(0, at)}<u>{label[at]}</u>{label.slice(at + 1)}
{/snippet}

{#snippet list(items: readonly MenuEntry[], depth: number)}
  <div class="menu" class:nested={depth > 0} role="menu">
    {#each items as e, j (j)}
      {#if e === null}
        <div class="sep" role="separator"></div>
      {:else if 'items' in e}
        {@const on = nav.path[depth] === j}
        {@const expanded = on && nav.path.length > depth + 1}
        <div class="sub" role="none">
          <button
            class="item"
            class:on
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={expanded}
            onpointerdown={(ev) => ev.preventDefault()}
            onpointerenter={() => hover(depth, j, true)}
          >
            <span class="check"></span>
            <span class="label">{@render mnemonic(tr(e.label), tr(e.label)[0].toUpperCase())}</span>
            <Icon name="chevronRight" size={14} />
          </button>
          {#if expanded}
            {@render list(e.items, depth + 1)}
          {/if}
        </div>
      {:else}
        {@const off = !enabled(e.cmd)}
        <button
          class="item"
          class:on={nav.path[depth] === j}
          class:off
          role={e.toggle ? 'menuitemcheckbox' : 'menuitem'}
          aria-checked={e.toggle ? checked(e.cmd) : undefined}
          aria-disabled={off}
          onpointerdown={(ev) => ev.preventDefault()}
          onpointerenter={() => hover(depth, j, false)}
          onclick={() => pick(e.cmd)}
        >
          <span class="check">{#if e.toggle && checked(e.cmd)}<Icon name="check" size={14} />{/if}</span>
          <span class="label">{@render mnemonic(tr(e.label), tr(e.label)[0].toUpperCase())}</span>
          <kbd>{keys(e)}</kbd>
        </button>
      {/if}
    {/each}
  </div>
{/snippet}

<style>
  .menubar {
    display: flex;
    align-items: stretch;
    height: 28px;
    padding: 0 4px;
    background: var(--bar);
    border-bottom: 1px solid var(--line);
  }
  .top {
    position: relative;
    display: flex;
  }
  .title {
    min-height: 0;
    padding: 0 10px;
    background: none;
    border: none;
    border-radius: 0;
  }
  .title.open {
    color: var(--text-strong);
    background: var(--hover);
  }
  /* Merkbuchstaben nur, solange per Tastatur bedient wird (wie Windows). */
  u {
    text-decoration: none;
  }
  .keys u {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .menu {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 40;
    min-width: 240px;
    padding: 4px;
    background: var(--panel);
    border: 1px solid var(--line-strong);
    border-radius: 0 0 6px 6px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.45);
    transform-origin: top left;
    animation: grow var(--fast) var(--ease-out);
  }
  .menu.nested {
    top: -5px;
    left: calc(100% + 2px);
    border-radius: 6px;
  }
  @keyframes grow {
    from {
      opacity: 0;
      scale: 0.98;
    }
  }
  .sub {
    position: relative;
  }
  .item {
    display: grid;
    grid-template-columns: 18px 1fr auto;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-height: 26px;
    padding: 0 8px 0 4px;
    text-align: left;
    background: none;
    border: none;
  }
  .item.on {
    color: var(--text-strong);
    background: var(--hover);
  }
  .item.off {
    opacity: 0.45;
  }
  .check {
    display: flex;
    justify-content: center;
    color: var(--accent);
  }
  kbd {
    padding-left: 24px;
    font: inherit;
    color: var(--text-dim);
  }
  .sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--line);
  }
</style>
