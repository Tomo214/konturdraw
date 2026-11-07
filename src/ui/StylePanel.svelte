<script lang="ts">
  // Eigenschaften (Andockfenster): Füllung, Kontur, Formwerte der Auswahl bzw. Vorgaben für neue Objekte.
  import { PATTERNS } from '../model/pattern';
  import { DASHES, DEFAULT_PATTERN_SIZE, dashIndex, mmField, type FillSpec } from '../model/style';
  import ColorPicker from './ColorPicker.svelte';
  import type { Stroke } from '../model/types';
  import type { ShapeParams } from './tools/shape-tool';
  import { tr } from '../i18n/i18n.svelte';

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
  // Muster ohne gelesene Werte (noch keins am Objekt): erste Vorlage, Standardgröße, 0°.
  const pat = $derived(fill.pattern ?? { preset: PATTERNS[0].name, size: DEFAULT_PATTERN_SIZE, angle: 0 });
  const onpattern = (patch: Partial<typeof pat>) => onfill({ ...fill, pattern: { ...pat, ...patch } });
</script>

<div class="form">
  <h3>{tr('Füllung')}</h3>
  <label class="row">
    <span>{tr('Art')}</span>
    <select value={fill.kind} onchange={(e) => onfill({ ...fill, kind: value(e) as FillSpec['kind'] })}>
      <option value="none">{tr('keine')}</option>
      <option value="solid">{tr('Vollton')}</option>
      <option value="linear">{tr('Verlauf linear')}</option>
      <option value="radial">{tr('Verlauf radial')}</option>
      <option value="pattern">{tr('Muster')}</option>
    </select>
  </label>
  {#if fill.kind === 'pattern'}
    <label class="row">
      <span>{tr('Vorlage')}</span>
      <select value={pat.preset} onchange={(e) => onpattern({ preset: value(e) })}>
        {#each PATTERNS as p (p.name)}<option value={p.name}>{tr(p.name)}</option>{/each}
        {#if !pat.preset}<option value="" disabled>{tr('eigene Kachel')}</option>{/if}
      </select>
    </label>
    {#if pat.preset}
      <span>{tr('Vordergrund')}</span>
      <ColorPicker color={fill.a} title={tr('Vordergrund')} onchange={(c) => onfill({ ...fill, a: c, pattern: pat })} />
      <span>{tr('Hintergrund')}</span>
      <ColorPicker color={fill.b} title={tr('Hintergrund')} onchange={(c) => onfill({ ...fill, b: c, pattern: pat })} />
    {/if}
    <label class="row">
      <span>{tr('Größe')}</span>
      <span class="unit"><input type="number" min="0.1" max="1000" step="0.5" value={mmField(pat.size)} onchange={(e) => onpattern({ size: num(e, 0.1, 1000) })} /> mm</span>
    </label>
    <label class="row">
      <span>{tr('Winkel')}</span>
      <span class="unit"><input type="number" min="-360" max="360" step="5" value={mmField(pat.angle)} onchange={(e) => onpattern({ angle: Math.min(360, Math.max(-360, Number(value(e)) || 0)) })} /> °</span>
    </label>
  {:else if fill.kind !== 'none'}
    <span>{tr('Farbe')}</span>
    <ColorPicker color={fill.a} title={tr('Farbe')} onchange={(c) => onfill({ ...fill, a: c })} />
    {#if fill.kind === 'linear' || fill.kind === 'radial'}
      <span>{tr('Endfarbe')}</span>
      <ColorPicker color={fill.b} title={tr('Endfarbe')} onchange={(c) => onfill({ ...fill, b: c })} />
    {/if}
  {/if}

  <hr />
  <label class="check wide head"><input type="checkbox" checked={!!stroke} onchange={(e) => onstroke(checked(e) ? {} : null)} /> {tr('Kontur')}</label>
  {#if stroke}
    <label class="row">
      <span>{tr('Breite')}</span>
      <span class="unit"><input type="number" min="0.01" max="100" step="0.05" value={mmField(stroke.width)} onchange={(e) => onstroke({ width: num(e, 0.01, 100) })} /> mm</span>
    </label>
    <span>{tr('Farbe')}</span>
    <ColorPicker color={stroke.color} title={tr('Konturfarbe')} onchange={(c) => onstroke({ color: c })} />
    <label class="row">
      <span>{tr('Linienenden')}</span>
      <select value={stroke.cap} onchange={(e) => onstroke({ cap: value(e) as Stroke['cap'] })}>
        <option value="butt">{tr('stumpf')}</option>
        <option value="round">{tr('rund')}</option>
        <option value="square">{tr('eckig')}</option>
      </select>
    </label>
    <label class="row">
      <span>{tr('Ecken')}</span>
      <select value={stroke.join} onchange={(e) => onstroke({ join: value(e) as Stroke['join'] })}>
        <option value="miter">{tr('spitz')}</option>
        <option value="round">{tr('rund')}</option>
        <option value="bevel">{tr('abgeschrägt')}</option>
      </select>
    </label>
    <label class="row">
      <span>{tr('Linienart')}</span>
      <select value={String(dashIndex(stroke.dash))} onchange={(e) => onstroke({ dash: DASHES[Number(value(e))].dash?.slice() })}>
        {#each DASHES as d, i (d.name)}<option value={String(i)}>{tr(d.name)}</option>{/each}
        {#if dashIndex(stroke.dash) < 0}<option value="-1" disabled>{tr('eigenes Muster')}</option>{/if}
      </select>
    </label>
    <label class="check wide">
      <input type="checkbox" checked={!!stroke.scaleWithObject} onchange={(e) => onstroke({ scaleWithObject: checked(e) })} />
      {tr('Mit Objekt skalieren')}
    </label>
  {/if}

  {#if alpha !== null}
    <hr />
    <label class="row">
      <span>{tr('Transparenz')}</span>
      <span class="unit">
        <input type="range" min="0" max="100" step="1" aria-label={tr('Transparenz Regler')} value={Math.round((1 - alpha) * 100)} oninput={(e) => onalpha(transparency(e), false)} onchange={(e) => onalpha(transparency(e), true)} />
        <input class="pct" type="number" min="0" max="100" step="1" value={Math.round((1 - alpha) * 100)} onchange={(e) => onalpha(transparency(e), true)} /> %
      </span>
    </label>
  {/if}

  <hr />
  <h3>{tr('Form')}</h3>
  <label class="row">
    <span>{tr('Eckenradius')}</span>
    <span class="unit"><input type="number" min="0" max="1000" step="0.5" value={mmField(shape.radius)} onchange={(e) => onradius(num(e, 0, 1000))} /> mm</span>
  </label>
  <label class="row">
    <span>{tr('Seiten')}</span>
    <input type="number" min="3" max="100" step="1" value={shape.sides} onchange={(e) => onpolygon(Math.round(num(e, 3, 100)), shape.inner)} />
  </label>
  <label class="check wide"><input type="checkbox" checked={shape.inner !== null} onchange={(e) => onpolygon(shape.sides, checked(e) ? STAR : null)} /> {tr('Stern')}</label>
  {#if shape.inner !== null}
    <label class="row">
      <span>{tr('Innenradius')}</span>
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
