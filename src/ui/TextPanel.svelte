<script lang="ts">
  // Text (Andockfenster): Satz-Felder der gewählten Texte bzw. Vorgaben für neuen Text (Spec §10).
  // Zustand geteilt mit der Eigenschaftsleiste (text-state.svelte.ts); hier zusätzlich Laufweite, Zeilenabstand, Text auf Pfad.
  import { mmField } from '../model/style';
  import type { TextState } from './text-state.svelte';
  import type { TextFields } from './tools/text-tool';
  import { tr } from '../i18n/i18n.svelte';

  let {
    text,
    active,
  }: {
    text: TextState;
    /** Text-Werkzeug aktiv → Felder zeigen, auch ohne gewählten Text. */
    active: boolean;
  } = $props();

  const value = (e: Event) => (e.currentTarget as HTMLInputElement | HTMLSelectElement).value;
  const checked = (e: Event) => (e.currentTarget as HTMLInputElement).checked;
  const num = (e: Event, min: number, max: number) => Math.min(max, Math.max(min, Number(value(e)) || 0));
</script>

{#if active || text.shown}
  <div class="form">
    <label class="row">
      <span>{tr('Schrift')}</span>
      <select value={text.fields.font.family} onchange={(e) => text.font({ family: value(e) })}>
        {#each text.list as f (f)}
          <option>{f}</option>
        {/each}
      </select>
    </label>
    <label class="row">
      <span>{tr('Größe')}</span>
      <span class="unit"><input type="number" min="1" max="1000" step="1" value={text.fields.font.size} onchange={(e) => text.font({ size: num(e, 1, 1000) })} /> pt</span>
    </label>
    <span>{tr('Stil')}</span>
    <span class="unit">
      <label class="check"><input type="checkbox" checked={text.fields.font.weight >= 600} onchange={(e) => text.font({ weight: checked(e) ? 700 : 400 })} /> {tr('Fett')}</label>
      <label class="check"><input type="checkbox" checked={text.fields.font.italic} onchange={(e) => text.font({ italic: checked(e) })} /> {tr('Kursiv')}</label>
    </span>
    <label class="row">
      <span>{tr('Ausrichtung')}</span>
      <select value={text.fields.align} onchange={(e) => text.set({ align: value(e) as TextFields['align'] })}>
        <option value="left">{tr('Links')}</option>
        <option value="center">{tr('Mitte')}</option>
        <option value="right">{tr('Rechts')}</option>
      </select>
    </label>
    <label class="row">
      <span>{tr('Laufweite')}</span>
      <span class="unit"><input type="number" min="-100" max="1000" step="5" value={text.fields.tracking} onchange={(e) => text.set({ tracking: num(e, -100, 1000) })} /> %</span>
    </label>
    <label class="row">
      <span>{tr('Zeilenabstand')}</span>
      <span class="unit"><input type="number" min="10" max="1000" step="5" value={text.fields.lineSpacing} onchange={(e) => text.set({ lineSpacing: num(e, 10, 1000) })} /> %</span>
    </label>
    {#if text.path}
      <hr />
      <h3>{tr('Text auf Pfad')}</h3>
      <label class="row">
        <span>{tr('Versatz')}</span>
        <span class="unit"><input type="number" min="-1000" max="1000" step="0.5" value={mmField(text.path.offset)} onchange={(e) => text.along({ offset: num(e, -1000, 1000) })} /> mm</span>
      </label>
      <label class="row">
        <span>{tr('Abstand')}</span>
        <span class="unit"><input type="number" min="-1000" max="1000" step="0.5" value={mmField(text.path.distance)} onchange={(e) => text.along({ distance: num(e, -1000, 1000) })} /> mm</span>
      </label>
      <label class="check wide"><input type="checkbox" checked={text.path.side === 'below'} onchange={(e) => text.along({ side: checked(e) ? 'below' : 'above' })} /> {tr('Andere Seite')}</label>
    {/if}
  </div>
{:else}
  <p class="hint">{tr('Textobjekt wählen oder Text-Werkzeug (F8) nehmen.')}</p>
{/if}
