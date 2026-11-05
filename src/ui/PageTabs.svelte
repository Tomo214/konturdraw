<script lang="ts">
  // Seitenleiste unter der Zeichenfläche (wie Vorbild): Blättern links, Reiter je Seite. Reiter hängen an der
  // Arbeitsfläche; Klick wechselt, Doppelklick benennt um, Ziehen sortiert, Rechtsklick öffnet das Seitenmenü.
  import type { Doc } from '../model/types';
  import type { History } from '../model/history';
  import { movePage, pageLabel, renamePage } from '../model/pages';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import Icon from './Icon.svelte';
  import { pageCommand } from './commands';
  import type { PageState } from './page-state.svelte';
  import type { PageOp } from './shortcuts';

  let {
    doc,
    history,
    pages,
    onleave,
    ondone,
    onnotice,
  }: {
    /** Stand fürs Anzeigen; Änderungen gehen über history. */
    doc: Doc;
    history: History<Doc>;
    pages: PageState;
    /** Vor dem Seitenwechsel: Werkzeug abschließen, Auswahl leeren. */
    onleave: () => void;
    ondone: () => void;
    onnotice: (msg: string) => void;
  } = $props();

  const cur = $derived(pages.index(doc));
  let editing = $state<string | null>(null);
  let menuAt = $state<{ x: number; y: number } | null>(null);
  let strip = $state<HTMLElement>();
  let drag = $state<{ from: number; x0: number; gap: number | null } | null>(null);

  /** Seitenbefehl aus Menü, Kürzel oder Leiste. */
  export function run(op: PageOp) {
    if (op === 'rename') return rename();
    const p = pageCommand(history.current, pages.index(history.current), { name: 'page', op });
    if (!p) return op === 'delete' && onnotice('Die letzte Seite bleibt.');
    onleave();
    if (p.doc) history.push(p.doc);
    pages.go(history.current, p.page);
    ondone();
  }

  export function rename() {
    editing = history.current.pages[pages.index(history.current)].id;
  }

  function go(i: number) {
    if (i === pages.index(history.current)) return;
    onleave();
    pages.go(history.current, i);
    ondone();
  }

  function commit(i: number, value: string) {
    editing = null;
    const next = renamePage(history.current, i, value);
    if (next) history.push(next);
    ondone();
  }

  function onkey(e: KeyboardEvent, i: number) {
    if (e.key === 'Enter') commit(i, (e.target as HTMLInputElement).value);
    if (e.key === 'Escape') editing = null;
  }

  // Wechsel schon beim Drücken; Ziehen erst nach 4 px, dann zeigt eine Marke die Lücke.
  function down(e: PointerEvent, i: number) {
    go(i);
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { from: i, x0: e.clientX, gap: null };
  }

  function move(e: PointerEvent) {
    if (!drag || (drag.gap === null && Math.abs(e.clientX - drag.x0) < 4)) return;
    const tabs = [...strip!.querySelectorAll<HTMLElement>('.tab')];
    drag.gap = tabs.filter((t) => {
      const r = t.getBoundingClientRect();
      return r.left + r.width / 2 < e.clientX;
    }).length;
  }

  function up() {
    if (drag?.gap != null) {
      const to = drag.gap > drag.from ? drag.gap - 1 : drag.gap;
      const next = movePage(history.current, drag.from, to);
      if (next) history.push(next);
      ondone();
    }
    drag = null;
  }

  const menuItems = $derived<MenuItem[]>([
    { label: 'Seite davor einfügen', run: () => run('insertBefore') },
    { label: 'Seite danach einfügen', run: () => run('insertAfter') },
    { label: 'Seite duplizieren', run: () => run('duplicate') },
    { label: 'Nur Ebenen duplizieren', run: () => run('duplicateLayers') },
    { label: 'Seite umbenennen', run: rename },
    null,
    { label: 'Seite löschen', run: () => run('delete'), disabled: doc.pages.length < 2 },
  ]);

  const select = (el: HTMLInputElement) => {
    el.focus();
    el.select();
  };
</script>

<div class="bar" role="toolbar" aria-label="Seiten">
  <nav class="nav">
    <button class="icon" aria-label="Seite davor einfügen" title="Seite davor einfügen" onclick={() => run('insertBefore')}><Icon name="plus" size={14} /></button>
    <button class="icon" aria-label="Erste Seite" title="Erste Seite" disabled={cur === 0} onclick={() => run('first')}><Icon name="first" size={14} /></button>
    <button class="icon" aria-label="Vorige Seite" title="Vorige Seite" disabled={cur === 0} onclick={() => run('prev')}><Icon name="chevronLeft" size={14} /></button>
    <span class="count">{cur + 1} von {doc.pages.length}</span>
    <button class="icon" aria-label="Nächste Seite" title="Nächste Seite" disabled={cur === doc.pages.length - 1} onclick={() => run('next')}><Icon name="chevronRight" size={14} /></button>
    <button class="icon" aria-label="Letzte Seite" title="Letzte Seite" disabled={cur === doc.pages.length - 1} onclick={() => run('last')}><Icon name="last" size={14} /></button>
    <button class="icon" aria-label="Seite danach einfügen" title="Seite danach einfügen" onclick={() => run('insertAfter')}><Icon name="plus" size={14} /></button>
  </nav>
  <div class="tabs" role="tablist" aria-label="Seitenreiter" bind:this={strip}>
    {#each doc.pages as p, i (p.id)}
      {#if editing === p.id}
        <input class="tab edit" type="text" aria-label="Seitenname" value={p.name ?? ''} placeholder={pageLabel(doc, i)} use:select
          onkeydown={(e) => onkey(e, i)} onblur={(e) => editing === p.id && commit(i, e.currentTarget.value)} />
      {:else}
        <button
          class="tab"
          class:on={i === cur}
          class:gap-before={drag?.gap === i}
          class:gap-after={drag?.gap === doc.pages.length && i === doc.pages.length - 1}
          role="tab"
          aria-selected={i === cur}
          title={pageLabel(doc, i)}
          onpointerdown={(e) => down(e, i)}
          onpointermove={move}
          onpointerup={up}
          onpointercancel={() => (drag = null)}
          onclick={(e) => e.detail === 0 && go(i)}
          ondblclick={rename}
          oncontextmenu={(e) => (e.preventDefault(), (menuAt = { x: e.clientX, y: e.clientY }))}>{pageLabel(doc, i)}</button
        >
      {/if}
    {/each}
  </div>
</div>
<ContextMenu bind:at={menuAt} items={menuItems} />

<style>
  .bar {
    display: flex;
    align-items: stretch;
    height: 28px;
    background: var(--bar);
    border-top: 1px solid var(--line);
  }
  .nav {
    display: flex;
    flex: none;
    align-items: center;
    gap: 2px;
    padding: 0 6px;
    border-right: 1px solid var(--line);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 22px;
    min-height: 22px;
    padding: 0;
    background: none;
    border-color: transparent;
  }
  .count {
    min-width: 58px;
    padding: 0 4px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    color: var(--text-dim);
  }
  /* Reiter hängen an der Arbeitsfläche: der aktive setzt ihre Farbe fort. */
  .tabs {
    display: flex;
    align-items: flex-start;
    min-width: 0;
    padding-left: 4px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tab {
    position: relative;
    flex: none;
    max-width: 160px;
    height: 23px;
    min-height: 0;
    margin-top: -1px;
    padding: 0 12px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--text-dim);
    background: none;
    border: 1px solid transparent;
    border-top: none;
    border-radius: 0 0 var(--radius) var(--radius);
  }
  .tab.on {
    color: var(--text-strong);
    background: var(--pasteboard);
    border-color: var(--line);
    box-shadow: inset 0 2px 0 var(--accent);
  }
  .tab.edit {
    width: 140px;
    text-align: left;
    color: var(--text-strong);
    background: var(--control);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    margin-top: 2px;
    height: 22px;
  }
  .gap-before::before,
  .gap-after::after {
    content: '';
    position: absolute;
    top: 3px;
    bottom: 3px;
    width: 2px;
    background: var(--accent);
    border-radius: 1px;
  }
  .gap-before::before {
    left: 0;
  }
  .gap-after::after {
    right: 0;
  }
</style>
