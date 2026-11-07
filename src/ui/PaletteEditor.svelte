<script lang="ts">
  // Paletten-Editor (3f): Name, Einträge umbenennen, umfärben, als Sonderfarbe markieren, löschen.
  import { removeEntry, renameEntry, setEntryColor, setSpot } from '../model/palette';
  import type { Palette } from '../model/types';
  import ColorPicker from './ColorPicker.svelte';
  import Icon from './Icon.svelte';
  import { tr } from '../i18n/i18n.svelte';

  interface Props {
    palette: Palette;
    /** Änderung als Funktion: der Aufrufer wendet sie auf den aktuellen Stand an. */
    onchange(fn: (p: Palette) => Palette): void;
    onclose(): void;
  }
  let { palette, onchange, onclose }: Props = $props();
  const value = (e: Event) => (e.currentTarget as HTMLInputElement).value;
  const checked = (e: Event) => (e.currentTarget as HTMLInputElement).checked;
</script>

<aside>
  <header>
    <input title={tr('Palettenname')} value={palette.name} onchange={(e) => value(e).trim() && onchange((p) => ({ ...p, name: value(e).trim() }))} />
    <button onclick={onclose}>{tr('Schließen')}</button>
  </header>
  {#each palette.colors as e, i (e.name)}
    <div class="row">
      <ColorPicker color={e.color} title={tr(e.name)} onchange={(c) => onchange((p) => setEntryColor(p, i, c))} />
      <input title={tr('Farbname')} value={tr(e.name)} onchange={(ev) => value(ev).trim() && onchange((p) => renameEntry(p, i, value(ev).trim()))} />
      <label title={tr('Volltonfarbe: eigener Farbauszug im PDF')}><input type="checkbox" checked={!!e.color.spot} onchange={(ev) => onchange((p) => setSpot(p, i, checked(ev)))} /> {tr('Sonderfarbe')}</label>
      <button class="icon" aria-label={tr('Farbe löschen')} title={tr('Farbe löschen')} onclick={() => onchange((p) => removeEntry(p, i))}><Icon name="close" size={14} /></button>
    </div>
  {:else}
    <p class="hint">{tr('Noch keine Farben – „Farbe hinzufügen“ nimmt die aktuelle Füllfarbe.')}</p>
  {/each}
</aside>

<style>
  aside {
    position: absolute;
    top: 8px;
    right: calc(100% + 4px);
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: calc(100% - 16px);
    overflow-y: auto;
    padding: 8px;
    background: var(--panel);
    border: 1px solid var(--line-strong);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.45);
  }
  header,
  .row,
  label {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  header {
    padding-bottom: 6px;
    border-bottom: 1px solid var(--line);
  }
  p {
    margin: 4px 0;
    max-width: 220px;
  }
  input:not([type]) {
    width: 120px;
    padding: 0 4px;
    user-select: text;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 24px;
    padding: 0;
  }
</style>
