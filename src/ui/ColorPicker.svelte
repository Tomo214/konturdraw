<script lang="ts">
  // Farbwähler (3f): Modell RGB/CMYK/Graustufen, Werte als Zahlen. Das Feld zeigt die Farbe wie die Zeichenfläche (Profil, Proof).
  import { convertColor, display } from '../io/colors';
  import { fromHex, toHex } from '../model/style';
  import type { Color } from '../model/types';
  import { N_, tr } from '../i18n/i18n.svelte';

  interface Props {
    color: Color;
    title: string;
    onchange(c: Color): void;
  }
  let { color, title, onchange }: Props = $props();
  const id = $props.id();
  let swatch: HTMLButtonElement;
  const POP_WIDTH = 200;

  const MODELS: [Color['model'], string][] = [
    ['cmyk', 'CMYK'],
    ['rgb', 'RGB'],
    ['gray', N_('Graustufen')],
  ];
  const CHANNELS: Record<Color['model'], string[]> = { rgb: ['R', 'G', 'B'], cmyk: ['C', 'M', 'Y', 'K'], gray: [N_('Grau')] };
  // CMYK in Prozent, RGB und Graustufen in Stufen 0–255.
  const SCALE: Record<Color['model'], number> = { rgb: 255, cmyk: 100, gray: 255 };
  const value = (e: Event) => (e.currentTarget as HTMLInputElement | HTMLSelectElement).value;

  async function setModel(m: Color['model']) {
    onchange(await convertColor(color, m, display.settings));
  }

  function setChannel(i: number, raw: string) {
    const scale = SCALE[color.model];
    const values = [...color.values];
    values[i] = Math.min(scale, Math.max(0, Number(raw) || 0)) / scale;
    onchange({ ...color, values } as unknown as Color); // Länge bleibt die des Modells
  }

  // Oberste Ebene (popover): rollende Bedienfelder schneiden nichts ab, Klick daneben und Esc schließen.
  // Unter dem Farbfeld; reicht der Platz nicht, darüber bzw. nach links gerückt.
  function place(e: ToggleEvent) {
    if (e.newState !== 'open') return;
    const r = swatch.getBoundingClientRect();
    const pop = e.currentTarget as HTMLElement;
    pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - POP_WIDTH - 8))}px`;
    const below = r.bottom + 200 < innerHeight;
    pop.style.top = below ? `${r.bottom + 4}px` : 'auto';
    pop.style.bottom = below ? 'auto' : `${innerHeight - r.top + 4}px`;
  }

  function setHex(raw: string) {
    const hex = raw.trim().replace(/^#?/, '#');
    if (/^#[0-9a-f]{6}$/i.test(hex)) onchange(color.spot ? { ...fromHex(hex), spot: color.spot } : fromHex(hex));
  }
</script>

<button
  bind:this={swatch}
  class="swatch"
  popovertarget={id}
  title={color.spot ? `${title}: ${tr('Sonderfarbe {name}', { name: color.spot })}` : title}
  style:background={display.css(color)}>{color.spot ? 'S' : ''}</button
>
<div {id} popover="auto" class="pop" style:width="{POP_WIDTH}px" onbeforetoggle={place}>
  <select class="full" title={tr('Farbmodell')} value={color.model} onchange={(e) => setModel(value(e) as Color['model'])}>
    {#each MODELS as [m, label] (m)}
      <option value={m}>{tr(label)}</option>
    {/each}
  </select>
  {#each color.values as v, i (i)}
    <label>
      <span>{tr(CHANNELS[color.model][i])}</span>
      <input type="number" min="0" max={SCALE[color.model]} step="1" value={Math.round(v * SCALE[color.model])} onchange={(e) => setChannel(i, value(e))} />
    </label>
  {/each}
  {#if color.model === 'rgb'}
    <label class="full"><span>Hex</span><input class="hex" value={toHex(color)} onchange={(e) => setHex(value(e))} /></label>
  {/if}
  {#if color.spot}<span class="full hint">{tr('Sonderfarbe {name}', { name: color.spot })}</span>{/if}
  <button class="full" popovertarget={id} popovertargetaction="hide">OK</button>
</div>

<style>
  .swatch {
    width: 32px;
    height: 22px;
    min-height: 0;
    padding: 0;
    font-size: 10px;
    font-weight: 600;
    color: #fff;
    text-shadow: 0 0 2px #000;
    border-color: var(--line-strong);
  }
  /* Kanäle paarweise: C M / Y K bzw. R G / B. */
  .pop {
    inset: auto;
    margin: 0;
    padding: 8px;
    grid-template-columns: auto minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 6px;
    color: var(--text);
    background: var(--bar);
    border: 1px solid var(--line-strong);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.45);
  }
  .pop:popover-open {
    display: grid;
  }
  label {
    display: contents;
  }
  .full {
    grid-column: 1 / -1;
  }
  label.full {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  input[type='number'] {
    width: 100%;
  }
  .hex {
    flex: 1;
    text-align: left;
  }
</style>
