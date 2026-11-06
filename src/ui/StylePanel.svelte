<script lang="ts">
  // Eigenschaften (Andockfenster): Füllung, Kontur, Formwerte der Auswahl bzw. Vorgaben für neue Objekte.
  import { DASHES, dashIndex, mmField, type FillSpec } from '../model/style';
  import ColorPicker from './ColorPicker.svelte';
  import type { Stroke } from '../model/types';
  import type { ShapeParams } from './tools/shape-tool';

  interface Props {
    fill: FillSpec;
    stroke: Stroke | null;
    shape: ShapeParams;
    onfill(f: FillSpec): void;
    onstroke(patch: Partial<Stroke> | null): void;
    onradius(r: number): void;
    onpolygon(sides: number, inner: number | null): void;
    /** Deckkraft der Auswahl (erstes Objekt), null = nichts gewählt */
    alpha: number | null;
    /** done = false: Ziehen am Regler (Vorschau), true = ein Rückgängig-Schritt */
    onalpha(opacity: number, done: boolean): void;
  }
  let { fill, stroke, shape, onfill, onstroke, onradius, onpolygon, alpha, onalpha }: Props = $props();

  const STAR = 0.5;
  const value = (e: Event) => (e.currentTarget as HTMLInputElement | HTMLSelectElement).value;
  const checked = (e: Event) => (e.currentTarget as HTMLInputElement).checked;
  // Leeres oder unsinniges Feld → in den erlaubten Bereich.
  const num = (e: Event, min: number, max: number) => Math.min(max, Math.max(min, Number(value(e)) || min));
  // Wie im Vorbild: 0 % = deckend, 100 % = unsichtbar.
  const transparency = (e: Event) => 1 - num(e, 0, 100) / 100;
</script>

<div class="form">
  <h3>Füllung</h3>
  <label class="row">
    <span>Art</span>
    <select value={fill.kind} onchange={(e) => onfill({ ...fill, kind: value(e) as FillSpec['kind'] })}>
      <option value="none">keine</option>
      <option value="solid">Vollton</option>
      <option value="linear">Verlauf linear</option>
      <option value="radial">Verlauf radial</option>
    </select>
  </label>
  {#if fill.kind !== 'none'}
    <span>Farbe</span>
    <ColorPicker color={fill.a} title="Farbe" onchange={(c) => onfill({ ...fill, a: c })} />
  {/if}
  {#if fill.kind === 'linear' || fill.kind === 'radial'}
    <span>Endfarbe</span>
    <ColorPicker color={fill.b} title="Endfarbe" onchange={(c) => onfill({ ...fill, b: c })} />
  {/if}

  <hr />
  <label class="check wide head"><input type="checkbox" checked={!!stroke} onchange={(e) => onstroke(checked(e) ? {} : null)} /> Kontur</label>
  {#if stroke}
    <label class="row">
      <span>Breite</span>
      <span class="unit"><input type="number" min="0.01" max="100" step="0.05" value={mmField(stroke.width)} onchange={(e) => onstroke({ width: num(e, 0.01, 100) })} /> mm</span>
    </label>
    <span>Farbe</span>
    <ColorPicker color={stroke.color} title="Konturfarbe" onchange={(c) => onstroke({ color: c })} />
    <label class="row">
      <span>Linienenden</span>
      <select value={stroke.cap} onchange={(e) => onstroke({ cap: value(e) as Stroke['cap'] })}>
        <option value="butt">stumpf</option>
        <option value="round">rund</option>
        <option value="square">eckig</option>
      </select>
    </label>
    <label class="row">
      <span>Ecken</span>
      <select value={stroke.join} onchange={(e) => onstroke({ join: value(e) as Stroke['join'] })}>
        <option value="miter">spitz</option>
        <option value="round">rund</option>
        <option value="bevel">abgeschrägt</option>
      </select>
    </label>
    <label class="row">
      <span>Linienart</span>
      <select value={String(dashIndex(stroke.dash))} onchange={(e) => onstroke({ dash: DASHES[Number(value(e))].dash?.slice() })}>
        {#each DASHES as d, i (d.name)}<option value={String(i)}>{d.name}</option>{/each}
        {#if dashIndex(stroke.dash) < 0}<option value="-1" disabled>eigenes Muster</option>{/if}
      </select>
    </label>
    <label class="check wide">
      <input type="checkbox" checked={!!stroke.scaleWithObject} onchange={(e) => onstroke({ scaleWithObject: checked(e) })} />
      Mit Objekt skalieren
    </label>
  {/if}

  {#if alpha !== null}
    <hr />
    <label class="row">
      <span>Transparenz</span>
      <span class="unit">
        <input type="range" min="0" max="100" step="1" aria-label="Transparenz Regler" value={Math.round((1 - alpha) * 100)} oninput={(e) => onalpha(transparency(e), false)} onchange={(e) => onalpha(transparency(e), true)} />
        <input class="pct" type="number" min="0" max="100" step="1" value={Math.round((1 - alpha) * 100)} onchange={(e) => onalpha(transparency(e), true)} /> %
      </span>
    </label>
  {/if}

  <hr />
  <h3>Form</h3>
  <label class="row">
    <span>Eckenradius</span>
    <span class="unit"><input type="number" min="0" max="1000" step="0.5" value={mmField(shape.radius)} onchange={(e) => onradius(num(e, 0, 1000))} /> mm</span>
  </label>
  <label class="row">
    <span>Seiten</span>
    <input type="number" min="3" max="100" step="1" value={shape.sides} onchange={(e) => onpolygon(Math.round(num(e, 3, 100)), shape.inner)} />
  </label>
  <label class="check wide"><input type="checkbox" checked={shape.inner !== null} onchange={(e) => onpolygon(shape.sides, checked(e) ? STAR : null)} /> Stern</label>
  {#if shape.inner !== null}
    <label class="row">
      <span>Innenradius</span>
      <span class="unit"><input type="number" min="5" max="95" step="5" value={Math.round(shape.inner * 100)} onchange={(e) => onpolygon(shape.sides, num(e, 5, 95) / 100)} /> %</span>
    </label>
  {/if}
</div>

<style>
  .pct {
    width: 52px;
  }
  /* Der Kontur-Schalter ist zugleich die Überschrift des Abschnitts. */
  .head {
    margin-top: 2px;
    font-weight: 600;
    color: var(--text-strong);
  }
</style>
