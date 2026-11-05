<script lang="ts">
  // Text-Optionen in der Eigenschaftsleiste (wie Vorbild): Schrift, Größe, Fett/Kursiv, Ausrichtung.
  // Gleicher Zustand wie das Andockfenster „Text“ (text-state.svelte.ts): gewählte Texte bzw. Vorgaben für neuen Text.
  import { formatNumber, parseNumber } from '../model/units';
  import Icon from './Icon.svelte';
  import NumField from './NumField.svelte';
  import type { TextState } from './text-state.svelte';

  let { text }: { text: TextState } = $props();

  const ALIGN = [
    ['left', 'textLeft', 'Linksbündig'],
    ['center', 'textCenter', 'Zentriert'],
    ['right', 'textRight', 'Rechtsbündig'],
  ] as const;
  // Fokus bleibt auf der Zeichenfläche: Tippen geht weiter in den Text.
  const keep = (e: PointerEvent) => e.preventDefault();
  const bold = $derived(text.fields.font.weight >= 600);
</script>

<select class="font" aria-label="Schrift" data-tip="Schrift" data-tip-side="below" value={text.fields.font.family} onchange={(e) => text.font({ family: e.currentTarget.value })}>
  {#each text.list as f (f)}
    <option>{f}</option>
  {/each}
</select>
<NumField tip="Schriftgröße" text={formatNumber(text.fields.font.size)} suffix="pt" width={48} parse={parseNumber} onset={(v) => text.font({ size: Math.min(1000, Math.max(1, v)) })} />
<span class="sep"></span>
<button class="icon bold" aria-label="Fett" data-tip="Fett" data-tip-side="below" aria-pressed={bold} onpointerdown={keep} onclick={() => text.font({ weight: bold ? 400 : 700 })}>F</button>
<button class="icon italic" aria-label="Kursiv" data-tip="Kursiv" data-tip-side="below" aria-pressed={text.fields.font.italic} onpointerdown={keep} onclick={() => text.font({ italic: !text.fields.font.italic })}>K</button>
<span class="sep"></span>
{#each ALIGN as [a, icon, tip] (a)}
  <button class="icon" aria-label={tip} data-tip={tip} data-tip-side="below" aria-pressed={text.fields.align === a} onpointerdown={keep} onclick={() => text.set({ align: a })}><Icon name={icon} size={16} /></button>
{/each}

<style>
  .font {
    width: 170px;
  }
  .bold {
    font-weight: 700;
  }
  .italic {
    font-style: italic;
    font-family: Georgia, serif;
  }
</style>
