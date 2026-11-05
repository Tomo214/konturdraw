<script lang="ts">
  // Palettenleiste (3f) am rechten Rand: Linksklick = Füllung, Rechtsklick = Kontur, erstes Feld = keine.
  // Farbe ziehen (7c): ab 4 px Weg wird aus dem Klick ein Ziehen; losgelassen über der Zeichenfläche entscheidet das Werkzeug.
  // Zeiger statt HTML-Ziehen: das fängt die Windows-WebView für Datei-Drops ab.
  // Standardpalette gehört zum Programm; eigene Paletten liegen im Dokument (ein Rückgängig-Schritt je Änderung).
  import * as bridge from '../io/bridge';
  import { display } from '../io/colors';
  import { newId } from '../model/document';
  import type { History } from '../model/history';
  import { addEntry, addPalette, paletteFile, parsePaletteFile, removePalette, STANDARD, updatePalette } from '../model/palette';
  import type { FillSpec } from '../model/style';
  import type { Color, Doc, Palette, Stroke } from '../model/types';
  import Icon from './Icon.svelte';
  import PaletteEditor from './PaletteEditor.svelte';

  interface Props {
    history: History<Doc>;
    palettes: readonly Palette[];
    fill: FillSpec;
    onfill(f: FillSpec): void;
    onstroke(patch: Partial<Stroke> | null): void;
    /** Farbe an Fensterpunkt x, y losgelassen; true = verbraucht. */
    ondrop(c: Color, x: number, y: number): boolean;
    ondone(): void;
    onnotice(msg: string): void;
  }
  let { history, palettes, fill, onfill, onstroke, ondrop, ondone, onnotice }: Props = $props();
  let active = $state(STANDARD.id);
  let menu = $state(false);
  let editing = $state(false);
  const shown = $derived(palettes.find((p) => p.id === active) ?? STANDARD);
  const own = $derived(shown !== STANDARD);

  function push(doc: Doc) {
    history.push(doc);
    ondone();
  }
  // Auf das aktuelle Dokument anwenden, nicht auf `shown` (zieht erst im nächsten Bild nach).
  const change = (fn: (p: Palette) => Palette) => push(updatePalette(history.current, shown.id, fn));

  async function act(fn: () => unknown) {
    menu = false;
    try {
      await fn();
    } catch (e) {
      onnotice((e as Error).message);
    }
  }

  function create(p: Palette) {
    push(addPalette(history.current, p));
    active = p.id;
  }
  const actions: [string, () => boolean, () => unknown][] = [
    ['Neue Palette', () => true, () => create({ id: newId(), name: `Palette ${palettes.length + 1}`, colors: [] })],
    ['Farbe hinzufügen', () => own, () => change((p) => addEntry(p, { name: 'Farbe', color: fill.a }))],
    ['Bearbeiten', () => own, () => (editing = true)],
    ['Laden …', () => true, async () => {
      const text = await bridge.openPalette();
      if (text) create(parsePaletteFile(text, newId()));
    }],
    ['Speichern …', () => true, async () => {
      const path = await bridge.savePalette(shown.name, paletteFile(shown));
      if (path) onnotice(`Palette gespeichert: ${path}`);
    }],
    ['Löschen', () => own, () => {
      push(removePalette(history.current, shown.id));
      active = STANDARD.id;
      editing = false;
    }],
  ];
  // Palettenklick ersetzt auch einen Verlauf durch Vollton.
  const left = (c: Color | null) => onfill(c ? { ...fill, kind: 'solid', a: c } : { ...fill, kind: 'none' });
  const right = (e: MouseEvent, c: Color | null) => (e.preventDefault(), onstroke(c && { color: c }));

  let press: { c: Color; x: number; y: number } | null = null;
  let ghost = $state<{ c: Color; x: number; y: number } | null>(null);
  let dragged = false; // der Klick nach dem Ziehen füllt nicht
  function grab(e: PointerEvent, c: Color) {
    if (e.button !== 0) return;
    press = { c, x: e.clientX, y: e.clientY };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function drag(e: PointerEvent) {
    if (press && (ghost || Math.hypot(e.clientX - press.x, e.clientY - press.y) >= 4)) ghost = { c: press.c, x: e.clientX, y: e.clientY };
  }
  function release(e: PointerEvent) {
    const g = ghost;
    press = ghost = null;
    if (!g) return;
    dragged = true;
    if (!ondrop(g.c, e.clientX, e.clientY)) onnotice('Farbe mit dem Verlaufswerkzeug auf die Verlaufslinie ziehen');
  }
  const click = (c: Color) => (dragged ? (dragged = false) : left(c));
</script>

<div class="bar">
  <button class="menu" class:on={menu} aria-label="Paletten" data-tip={menu ? null : 'Paletten'} data-tip-side="left" onclick={() => (menu = !menu)}><Icon name="menu" size={16} /></button>
  {#if menu}
    <div class="pop">
      <select title="Palette" value={active} onchange={(e) => ((active = (e.currentTarget as HTMLSelectElement).value), (menu = false))}>
        <option value={STANDARD.id}>{STANDARD.name}</option>
        {#each palettes as p (p.id)}
          <option value={p.id}>{p.name}</option>
        {/each}
      </select>
      {#each actions as [label, enabled, run] (label)}
        <button disabled={!enabled()} onclick={() => act(run)}>{label}</button>
      {/each}
    </div>
  {/if}
  <div class="list">
  <button class="swatch none" title="Keine Füllung / Rechtsklick: keine Kontur" aria-label="Keine Farbe" onclick={() => left(null)} oncontextmenu={(e) => right(e, null)}></button>
  {#each shown.colors as e (e.name)}
    <button
      class="swatch"
      class:spot={!!e.color.spot}
      title={e.color.spot ? `${e.name} (Sonderfarbe)` : e.name}
      style:background={display.css(e.color)}
      onclick={() => click(e.color)}
      oncontextmenu={(ev) => right(ev, e.color)}
      onpointerdown={(ev) => grab(ev, e.color)}
      onpointermove={drag}
      onpointerup={release}
      onpointercancel={() => (press = ghost = null)}
    ></button>
  {/each}
  </div>
  {#if ghost}
    <div class="ghost" style:background={display.css(ghost.c)} style:left="{ghost.x + 8}px" style:top="{ghost.y + 8}px"></div>
  {/if}
  {#if editing && own}
    <PaletteEditor palette={shown} onchange={change} onclose={() => (editing = false)} />
  {/if}
</div>

<style>
  .bar {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px;
    background: var(--bar);
    border-left: 1px solid var(--line);
  }
  /* Nur die Farben rollen; Menü und Editor ragen links aus der Leiste und dürfen nicht abgeschnitten werden. */
  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    overflow-y: auto;
  }
  .swatch {
    flex: none;
    width: 20px;
    height: 16px;
    min-height: 0;
    padding: 0;
    border-color: rgb(0 0 0 / 0.35);
    border-radius: 2px;
  }
  .swatch:hover {
    outline: 1px solid var(--text-strong);
    outline-offset: 0;
  }
  .ghost {
    position: fixed;
    z-index: 50;
    width: 20px;
    height: 16px;
    pointer-events: none;
    border: 1px solid rgb(0 0 0 / 0.35);
    border-radius: 2px;
    box-shadow: 0 2px 6px rgb(0 0 0 / 0.3);
  }
  .swatch.none {
    background: linear-gradient(to top right, #fff 45%, var(--accent) 45% 55%, #fff 55%);
  }
  .swatch.spot {
    border: 1px dashed var(--text);
  }
  .menu {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    min-height: 0;
    padding: 0;
    background: none;
    border-color: transparent;
  }
  .menu.on {
    background: var(--control);
    border-color: var(--line);
  }
  .pop {
    position: absolute;
    top: 4px;
    right: calc(100% + 4px);
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 180px;
    padding: 6px;
    background: var(--panel);
    border: 1px solid var(--line-strong);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.45);
    transform-origin: top right;
    animation: grow var(--fast) var(--ease-out);
  }
  .pop select {
    margin-bottom: 4px;
  }
  .pop button {
    text-align: left;
    background: none;
    border-color: transparent;
  }
  .pop button:hover:not(:disabled) {
    background: var(--hover);
  }
  @keyframes grow {
    from {
      opacity: 0;
      scale: 0.98;
    }
  }
</style>
