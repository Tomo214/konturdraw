<script lang="ts">
  // Objekt-Manager (wie Vorbild): alle Seiten, darin Ebenen mit Schaltern sichtbar, druckbar, gesperrt;
  // darunter Gruppen und Objekte, vorderstes oben. Klick wählt (andere Seite: wechselt hin), Doppelklick benennt um,
  // Ziehen sortiert um (am Rand rollt die Liste), Pfeiltasten wandern durch den Baum.
  // Nur sichtbare Zeilen werden gebaut, damit auch 10 000 Objekte flüssig bleiben.
  import { untrack } from 'svelte';
  import { activeLayer, addLayer, moveLayer, moveNodes, removeLayer, renameNode, updateLayer } from '../model/document';
  import type { History } from '../model/history';
  import { pageLabel } from '../model/pages';
  import type { Doc, Layer } from '../model/types';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import Icon from './Icon.svelte';
  import { docRows, dragIds, dropFor, dropMark, edgeScroll, freshLayerName, idsIn, layerMove, reveal, rowIcon, treeKey, type Drop, type Part, type Row } from './object-tree';
  import { choose } from './selection';
  import type { PageState } from './page-state.svelte';

  let {
    doc,
    history,
    pages,
    selected,
    onselect,
    onpage,
    ondone,
    onnotice,
  }: {
    /** Stand fürs Anzeigen; Änderungen gehen über history. */
    doc: Doc;
    history: History<Doc>;
    pages: PageState;
    selected: ReadonlySet<string>;
    onselect: (ids: Set<string>) => void;
    /** Zu Seite i wechseln (Auswahl wird leer). */
    onpage: (i: number) => void;
    ondone: () => void;
    onnotice: (msg: string) => void;
  } = $props();

  const ROW = 24;
  const pi = $derived(pages.index(doc));
  const page = $derived(doc.pages[pi]);
  const now = () => history.current.pages[pages.index(history.current)];
  let flip = $state.raw<ReadonlySet<string>>(new Set());
  const rows = $derived(docRows(doc, pi, flip));
  const active = $derived(activeLayer(page, pages.layer));

  let list = $state<HTMLElement>();
  let scrollTop = $state(0);
  let height = $state(0);
  const first = $derived(Math.max(0, Math.floor(scrollTop / ROW) - 2));
  const shown = $derived(rows.slice(first, first + Math.ceil(height / ROW) + 4));

  // Auswahl von der Fläche (auch Strg-Klick in Gruppen) im Baum zeigen: aufklappen, hinscrollen.
  $effect(() => {
    const sel = selected;
    untrack(() => {
      flip = reveal(page, flip, sel);
      const i = rows.findIndex((r) => r.node && sel.has(r.id));
      if (list && i >= 0 && (i * ROW < list.scrollTop || (i + 1) * ROW > list.scrollTop + height)) list.scrollTop = i * ROW - height / 2;
    });
  });

  /** Zeile für die Pfeiltasten (zuletzt angeklickt oder angesteuert). */
  let cursor = $state<string | null>(null);
  let editing = $state<string | null>(null);
  let menuAt = $state<{ x: number; y: number } | null>(null);
  let menuRow = $state<Row | null>(null);
  type Drag = { row: Row; ids: string[]; y0: number; moving: boolean; keep: boolean; over: { i: number; part: Part } | null };
  let drag = $state.raw<Drag | null>(null);

  /** Ein Rückgängig-Schritt; false = nichts geändert. */
  function commit(next: Doc | null): boolean {
    if (!next) return false;
    history.push(next);
    ondone();
    return true;
  }

  const blocked = (r: Row) => r.node !== null && (r.layer.locked || !r.layer.visible);

  // Andere Seite: hinwechseln, die bisherige bleibt im Baum aufgeklappt.
  function goPage(i: number) {
    if (i === pages.index(history.current)) return;
    const cur = now().id;
    if (!flip.has(cur)) flip = new Set([...flip, cur]);
    onpage(i);
  }

  function pick(r: Row, additive: boolean) {
    goPage(r.page);
    pages.layer = r.layer.id;
    if (!r.node) return ondone();
    if (blocked(r)) return onnotice(`Ebene „${r.layer.name}“ ist ${r.layer.locked ? 'gesperrt' : 'verborgen'}.`);
    // Jede Zeile wählt sich selbst – auch Kinder in Gruppen, wie im Vorbild.
    onselect(choose(history.current, selected, r.id, additive));
  }

  // Wahl schon beim Drücken; eine bereits gewählte Zeile verkleinert die Auswahl erst beim Loslassen ohne Ziehen.
  function down(e: PointerEvent, r: Row) {
    if (e.button !== 0 || editing === r.id) return;
    cursor = r.id;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const keep = !additive && r.node !== null && selected.has(r.id);
    if (!keep) pick(r, additive);
    if (blocked(r)) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { row: r, ids: dragIds(r, selected), y0: e.clientY, moving: false, keep, over: null };
  }

  let lastY = 0;
  function move(e: PointerEvent) {
    if (!drag || (!drag.moving && Math.abs(e.clientY - drag.y0) < 4)) return;
    lastY = e.clientY;
    if (!drag.moving) requestAnimationFrame(roll);
    over(e.clientY);
  }

  // Am oberen/unteren Rand rollt die Liste, solange gezogen wird; die Ablagemarke wandert mit.
  function roll() {
    if (!drag?.moving || !list) return;
    const b = list.getBoundingClientRect();
    const dy = edgeScroll(lastY, b.top, b.bottom);
    if (dy) {
      list.scrollTop += dy;
      over(lastY);
    }
    requestAnimationFrame(roll);
  }

  function over(clientY: number) {
    if (!drag) return;
    const y = clientY - list!.getBoundingClientRect().top + list!.scrollTop;
    const i = Math.min(rows.length - 1, Math.max(0, Math.floor(y / ROW)));
    const f = Math.min(Math.max((y - i * ROW) / ROW, 0), 0.999);
    const r = rows[i];
    const thirds = drag.row.node !== null && (r.node === null || r.node.type === 'group');
    drag = { ...drag, moving: true, over: { i, part: thirds ? (f < 1 / 3 ? 'top' : f < 2 / 3 ? 'mid' : 'bottom') : f < 0.5 ? 'top' : 'bottom' } };
  }

  const target = (d: Drag): Drop | null => (d.over ? dropFor(rows, d.over.i, d.over.part, d.row.node ? 'node' : 'layer', d.row.page) : null);

  function up() {
    const d = drag;
    drag = null;
    if (!d?.moving) return d?.keep && pick(d.row, false);
    const t = target(d);
    if (!t) return onnotice('Gesperrte Ebenen nehmen keine Objekte an.');
    if ('layerAbove' in t) {
      const to = layerMove(now(), d.row.id, t.layerAbove);
      return to !== null && commit(moveLayer(history.current, d.row.id, to));
    }
    const to = rows.find((r) => r.id === t.container)?.page ?? d.row.page;
    if (!commit(moveNodes(history.current, d.ids, t.container, t.above))) return;
    goPage(to);
    onselect(new Set(d.ids));
  }

  function onlistkey(e: KeyboardEvent) {
    if (editing) return;
    const k = treeKey(rows, rows.findIndex((r) => r.id === cursor), e.key);
    if (!k) return;
    e.preventDefault();
    e.stopPropagation(); // sonst verschieben die Pfeile die Auswahl auf der Fläche
    const r = rows[k.i];
    cursor = r.id;
    if (k.toggle) flipRow(k.toggle);
    else if (r.layer) pick(r, false);
    if (list && (k.i * ROW < list.scrollTop || (k.i + 1) * ROW > list.scrollTop + height)) list.scrollTop = k.i * ROW - height / 2;
  }

  // Ablagemarke: Linie zwischen Zeilen oder Rahmen um den Container (zu oder leer).
  const hint = $derived.by(() => {
    const t = drag?.moving ? target(drag) : null;
    return t && drag?.over ? dropMark(rows, t, drag.over.i, drag.row.page) : null;
  });

  function toggle(l: Layer, key: 'visible' | 'printable' | 'locked') {
    // Verbergen oder Sperren nimmt die Objekte der Ebene aus der Auswahl.
    const leaves = key === 'visible' ? l.visible : key === 'locked' && !l.locked;
    if (!commit(updateLayer(history.current, l.id, { [key]: !l[key] })) || !leaves) return;
    const gone = idsIn(l.children);
    if ([...selected].some((id) => gone.has(id))) onselect(new Set([...selected].filter((id) => !gone.has(id))));
  }

  function newLayer() {
    const next = addLayer(history.current, pages.index(history.current), freshLayerName(now()));
    commit(next);
    pages.layer = now().layers.at(-1)!.id;
  }

  function deleteLayer(l: Layer | undefined) {
    if (!l) return;
    const gone = idsIn(l.children);
    if (!commit(removeLayer(history.current, l.id))) return onnotice('Die letzte Ebene einer Seite bleibt.');
    onselect(new Set([...selected].filter((id) => !gone.has(id))));
  }

  function rename(r: Row, value: string) {
    editing = null;
    const name = value.trim();
    if (r.node) commit(renameNode(history.current, r.id, name));
    else if (name && name !== r.layer.name) commit(updateLayer(history.current, r.id, { name }));
  }

  function onkey(e: KeyboardEvent, r: Row) {
    if (e.key === 'Enter') rename(r, (e.target as HTMLInputElement).value);
    if (e.key === 'Escape') editing = null;
  }

  function openMenu(e: MouseEvent, r: Row) {
    e.preventDefault();
    if (!r.node || !selected.has(r.id)) pick(r, false);
    [menuRow, menuAt] = [r, { x: e.clientX, y: e.clientY }];
  }

  const menuItems = $derived.by<MenuItem[]>(() => {
    const r = menuRow;
    if (!r) return [];
    const edit = { label: 'Umbenennen', run: () => (editing = r.id) };
    if (r.node) return [edit];
    const l = r.layer;
    return [
      edit,
      { label: 'Neue Ebene', run: newLayer },
      { label: 'Ebene löschen', run: () => deleteLayer(l), disabled: page.layers.length < 2 },
      null,
      { label: 'Sichtbar', checked: l.visible, run: () => toggle(l, 'visible') },
      { label: 'Druckbar', checked: l.printable, run: () => toggle(l, 'printable') },
      { label: 'Gesperrt', checked: l.locked, run: () => toggle(l, 'locked') },
    ];
  });

  const flipRow = (id: string) => (flip = new Set(flip.has(id) ? [...flip].filter((f) => f !== id) : [...flip, id]));
  const select = (el: HTMLInputElement) => {
    el.focus();
    el.select();
  };
  const stop = (e: Event) => e.stopPropagation();
</script>

<div class="om">
  <div class="head">
    <span class="crumb">{pageLabel(doc, pi)}<Icon name="chevronRight" size={12} /><b>{active?.name ?? '–'}</b></span>
    <button class="icon" aria-label="Neue Ebene" title="Neue Ebene" onclick={newLayer}><Icon name="layerAdd" size={16} /></button>
    <button class="icon" aria-label="Ebene löschen" title="Ebene löschen" disabled={page.layers.length < 2} onclick={() => deleteLayer(active)}><Icon name="trash" size={16} /></button>
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="list" role="tree" tabindex="0" aria-label="Seiten, Ebenen und Objekte" bind:this={list} bind:clientHeight={height} onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)} onkeydown={onlistkey}>
    <div class="spacer" style:height="{rows.length * ROW}px">
      {#each shown as r, k (r.id)}
        {#if r.layer === null}
          <div
            class="row page"
            class:cur={r.id === cursor}
            class:active={r.open === null}
            style:top="{(first + k) * ROW}px"
            role="treeitem"
            tabindex="-1"
            aria-level={1}
            aria-selected={false}
            aria-expanded={r.open ?? true}
            onpointerdown={(e) => e.button === 0 && ((cursor = r.id), goPage(r.page))}
          >
            {#if r.open !== null}
              <button class="twisty" aria-label={r.open ? 'Zuklappen' : 'Aufklappen'} onpointerdown={stop} onclick={() => flipRow(r.id)}
                ><Icon name={r.open ? 'chevronDown' : 'chevronRight'} size={12} /></button
              >
            {:else}
              <span class="twisty"></span>
            {/if}
            <span class="kind"><Icon name="portrait" size={14} /></span>
            <span class="label">{r.label}</span>
          </div>
        {:else}
        <div
          class="row"
          class:cur={r.id === cursor}
          class:layer={!r.node}
          class:sel={r.node !== null && selected.has(r.id)}
          class:active={!r.node && r.id === active?.id}
          class:dim={!r.layer.visible}
          style:top="{(first + k) * ROW}px"
          style:padding-left="{4 + r.depth * 14}px"
          role="treeitem"
          tabindex="-1"
          aria-level={r.depth + 1}
          aria-selected={r.node !== null && selected.has(r.id)}
          aria-expanded={r.open ?? undefined}
          onpointerdown={(e) => down(e, r)}
          onpointermove={move}
          onpointerup={up}
          onpointercancel={() => (drag = null)}
          ondblclick={() => (editing = r.id)}
          oncontextmenu={(e) => openMenu(e, r)}
        >
          {#if r.open !== null}
            <button class="twisty" aria-label={r.open ? 'Zuklappen' : 'Aufklappen'} onpointerdown={stop} ondblclick={stop} onclick={() => flipRow(r.id)}
              ><Icon name={r.open ? 'chevronDown' : 'chevronRight'} size={12} /></button
            >
          {:else}
            <span class="twisty"></span>
          {/if}
          <span class="kind"><Icon name={rowIcon(r)} size={14} /></span>
          {#if editing === r.id}
            <input class="edit" type="text" aria-label="Name" value={r.node ? (r.node.name ?? '') : r.label} placeholder={r.label} use:select
              onpointerdown={stop} onkeydown={(e) => onkey(e, r)} onblur={(e) => editing === r.id && rename(r, e.currentTarget.value)} />
          {:else}
            <span class="label">{r.label}</span>
          {/if}
          {#if !r.node}
            {@const l = r.layer}
            <span class="toggles" role="group" aria-label="Ebenenschalter">
              <button class="tg" class:off={!l.visible} aria-label="Sichtbar" aria-pressed={l.visible} title="Sichtbar" onpointerdown={stop} ondblclick={stop} onclick={() => toggle(l, 'visible')}
                ><Icon name={l.visible ? 'eye' : 'eyeOff'} size={14} /></button
              >
              <button class="tg" class:off={!l.printable} aria-label="Druckbar" aria-pressed={l.printable} title="Druckbar" onpointerdown={stop} ondblclick={stop} onclick={() => toggle(l, 'printable')}
                ><Icon name={l.printable ? 'printer' : 'printerOff'} size={14} /></button
              >
              <button class="tg" class:off={!l.locked} aria-label="Gesperrt" aria-pressed={l.locked} title="Gesperrt" onpointerdown={stop} ondblclick={stop} onclick={() => toggle(l, 'locked')}
                ><Icon name={l.locked ? 'lock' : 'unlock'} size={14} /></button
              >
            </span>
          {/if}
        </div>
        {/if}
      {/each}
      {#if hint}<div class="drop" class:into={hint.into} style:top="{hint.i * ROW}px"></div>{/if}
    </div>
  </div>
</div>
<ContextMenu bind:at={menuAt} items={menuItems} />

<style>
  .om {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .head {
    display: flex;
    flex: none;
    align-items: center;
    gap: 2px;
    height: 32px;
    padding: 0 6px 0 12px;
    border-bottom: 1px solid var(--line);
  }
  .crumb {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 4px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    color: var(--text-dim);
  }
  .crumb b {
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 600;
    color: var(--accent);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 26px;
    padding: 0;
    background: none;
    border-color: transparent;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .spacer {
    position: relative;
    min-height: 100%;
  }
  .row {
    position: absolute;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding-right: 4px;
    white-space: nowrap;
  }
  .row:hover {
    background: rgb(255 255 255 / 0.04);
  }
  .row.sel {
    color: var(--text-strong);
    background: var(--accent-soft);
  }
  .row.layer {
    color: var(--text-strong);
  }
  .row.active .label {
    font-weight: 600;
    color: var(--accent);
  }
  .row.page {
    padding-left: 4px;
    color: var(--text-strong);
  }
  .row.page.active .label {
    font-weight: 600;
  }
  .list:focus-visible {
    outline: none;
  }
  .list:focus-within .row.cur {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
  .row.dim .label,
  .row.dim .kind {
    opacity: 0.5;
  }
  .twisty {
    display: grid;
    flex: none;
    place-items: center;
    width: 16px;
    height: 16px;
    min-height: 0;
    padding: 0;
    color: var(--text-dim);
    background: none;
    border: none;
  }
  .kind {
    display: grid;
    flex: none;
    color: var(--text-dim);
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .edit {
    flex: 1;
    width: auto;
    min-width: 0;
    height: 20px;
    min-height: 0;
    text-align: left;
    border-color: var(--accent);
  }
  .toggles {
    display: flex;
    flex: none;
  }
  .tg {
    display: grid;
    place-items: center;
    width: 22px;
    min-height: 22px;
    padding: 0;
    color: var(--text);
    background: none;
    border-color: transparent;
  }
  .tg.off {
    color: var(--text-dim);
  }
  .drop {
    position: absolute;
    left: 8px;
    right: 4px;
    height: 2px;
    margin-top: -1px;
    background: var(--accent);
    border-radius: 1px;
    pointer-events: none;
  }
  .drop.into {
    left: 2px;
    right: 2px;
    height: 24px;
    margin-top: 0;
    background: var(--accent-soft);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
  }
</style>
