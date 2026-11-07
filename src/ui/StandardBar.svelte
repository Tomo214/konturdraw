<script lang="ts">
  // Standardleiste unter dem Menü (Aufbau wie Vorbild): Datei, Zwischenablage, Rückgängig, Import/Export, Zoomstufe.
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';
  import { keyLabel } from './menus';
  import type { Command } from './shortcuts';
  import { N_, tr } from '../i18n/i18n.svelte';

  type Name = Extract<Command, { name: string }>['name'];
  let { isMac, zoom, oncommand, onzoom }: { isMac: boolean; zoom: number; oncommand: (c: Command) => void; onzoom: (v: string) => void } = $props();

  const GROUPS: readonly (readonly [Name & IconName, string, string])[][] = [
    [['new', N_('Neu'), 'Mod+N'], ['open', N_('Öffnen'), 'Mod+O'], ['save', N_('Speichern'), 'Mod+S']],
    [['print', N_('Drucken'), 'Mod+P']],
    [['cut', N_('Ausschneiden'), 'Mod+X'], ['copy', N_('Kopieren'), 'Mod+C'], ['paste', N_('Einfügen'), 'Mod+V']],
    [['undo', N_('Rückgängig'), 'Mod+Z'], ['redo', N_('Wiederholen'), 'Mod+Shift+Z']],
    [['import', N_('Importieren'), 'Mod+I'], ['export', N_('Exportieren'), 'Mod+E']],
  ];
  const LEVELS = [25, 50, 75, 100, 200, 400, 800];

  function choose(e: Event & { currentTarget: HTMLSelectElement }) {
    const v = e.currentTarget.value;
    e.currentTarget.value = 'now';
    onzoom(v);
  }
</script>

<div class="bar" role="toolbar" aria-label="Standard">
  {#each GROUPS as group, i (i)}
    <div class="group">
      {#each group as [name, label, keys] (name)}
        <button
          class="icon"
          aria-label={tr(label)}
          data-tip="{tr(label)} ({keyLabel(keys, isMac)})"
          data-tip-side="below"
          onpointerdown={(e) => e.preventDefault()}
          onclick={() => oncommand({ name } as Command)}><Icon {name} /></button
        >
      {/each}
    </div>
  {/each}
  <div class="group">
    <select class="zoom" aria-label={tr('Zoomstufe')} value="now" onchange={choose}>
      <option value="now" hidden>{zoom} %</option>
      <option value="fit">{tr('Ganze Seite')}</option>
      <option value="selection">{tr('Auswahl')}</option>
      {#each LEVELS as l (l)}
        <option value={String(l)}>{l} %</option>
      {/each}
    </select>
  </div>
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    height: 36px;
    padding: 0 6px;
    background: var(--bar);
    border-bottom: 1px solid var(--line);
  }
  .group {
    display: flex;
    gap: 2px;
    padding: 0 6px;
  }
  .group + .group {
    border-left: 1px solid var(--line);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: none;
    border-color: transparent;
  }
  .zoom {
    width: 104px;
  }
</style>
