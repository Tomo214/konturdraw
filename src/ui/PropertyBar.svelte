<script lang="ts">
  // Eigenschaftsleiste unter der Standardleiste (wie Vorbild): Auswahl-Werkzeug ohne Auswahl = Seite,
  // mit Auswahl = Maße; andere Werkzeuge zeigen ihre Optionen. children = Werkzeug-Aktionen und Formen-Befehle.
  import type { Snippet } from 'svelte';
  import type { Measure } from '../model/arrange';
  import type { Color, Guide, Point } from '../model/types';
  import type { Unit } from '../model/units';
  import CutFields from './CutFields.svelte';
  import GradientFields from './GradientFields.svelte';
  import GuideFields from './GuideFields.svelte';
  import Icon from './Icon.svelte';
  import ObjectFields from './ObjectFields.svelte';
  import PageFields from './PageFields.svelte';
  import ShapeFields from './ShapeFields.svelte';
  import TextBar from './TextBar.svelte';
  import type { TextState } from './text-state.svelte';
  import { toolIcon } from './icons';
  import type { Command, Tool } from './shortcuts';
  import { toolInfo } from './toolbox';
  import type { CutParams } from './tools/cut-tools';
  import type { Knot } from './tools/tool';
  import type { ShapeParams } from './tools/shape-tool';

  let {
    tool,
    ms,
    text,
    guide,
    origin,
    page,
    units,
    nudge,
    shape,
    smoothing = $bindable(),
    cut = $bindable(),
    knot,
    onknot,
    onradius,
    onpolygon,
    oncommand,
    children,
  }: {
    tool: Tool;
    ms: Measure | null;
    /** Satz-Felder: Text-Werkzeug oder gewählter Text. */
    text: TextState;
    /** Gewählte Hilfslinie (statt Objekten). */
    guide: Guide | null;
    /** Lineal-Nullpunkt in Seiten-mm. */
    origin: Point;
    page: { width: number; height: number };
    units: Unit;
    nudge: number;
    shape: ShapeParams;
    smoothing: number;
    cut: CutParams;
    /** Gewählter Verlaufsknoten (Verlaufswerkzeug). */
    knot: Knot | null;
    onknot: (patch: { offset?: number; color?: Color }) => void;
    onradius: (r: number) => void;
    onpolygon: (sides: number, inner: number | null) => void;
    oncommand: (c: Command) => void;
    children: Snippet;
  } = $props();

  const HINT: Partial<Record<Tool, string>> = {
    zoom: 'Klick vergrößert, Alt+Klick verkleinert, Rahmen ziehen zeigt den Bereich',
    hand: 'Ziehen verschiebt die Ansicht',
    knife: 'Quer durch das Objekt ziehen – ohne Auswahl wird alles Gekreuzte geteilt',
    eraser: 'Über das Objekt ziehen oder klicken – ohne Auswahl wirkt er auf alles Getroffene',
    eyedropper: 'Klick nimmt auf, weitere Klicks übertragen · Shift neu aufnehmen · Esc zurücksetzen',
  };
</script>

<div class="bar" role="toolbar" aria-label="Eigenschaften">
  <span class="tool"><Icon name={toolIcon(tool)} size={16} />{toolInfo(tool).label}</span>
  {#if tool === 'select' && guide}
    <GuideFields {guide} {origin} {units} {oncommand} />
  {:else if tool === 'select' && ms}
    <ObjectFields {ms} {origin} {units} {oncommand} />
    {#if text.shown}<span class="sep"></span><TextBar {text} />{/if}
  {:else if tool === 'select'}
    <PageFields {page} {units} {nudge} {oncommand} />
  {:else if tool === 'knife' || tool === 'eraser' || tool === 'eyedropper'}
    <CutFields {tool} {units} bind:cut />
  {:else if tool === 'text'}
    <TextBar {text} />
  {:else if tool === 'gradient'}
    <GradientFields {knot} {onknot} />
  {:else if tool === 'freehand'}
    <label class="field">Glättung <input type="range" min="1" max="20" bind:value={smoothing} /> {smoothing} px</label>
  {:else}
    <ShapeFields {tool} {shape} {units} {onradius} {onpolygon} />
  {/if}
  {@render children()}
  {#if HINT[tool]}<span class="hint">{HINT[tool]}</span>{/if}
</div>

<style>
  /* Kein overflow: Kurzinfos ragen nach unten über die Zeichenfläche. Paare stehen übereinander wie im Vorbild. */
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 50px;
    padding: 0 12px;
    background: var(--bar);
    border-bottom: 1px solid var(--line);
  }
  .tool {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 96px;
    padding-right: 12px;
    margin-right: 4px;
    font-weight: 600;
    color: var(--text-strong);
    border-right: 1px solid var(--line);
    align-self: stretch;
  }
  .hint {
    color: var(--text-dim);
    white-space: nowrap;
  }
  .bar :global(input),
  .bar :global(select),
  .bar :global(button) {
    min-height: 0;
    height: 22px;
  }
  .bar :global(.pair) {
    display: grid;
    gap: 2px;
  }
  .bar :global(.pair input) {
    height: 20px;
  }
  .bar :global(.sep) {
    align-self: stretch;
    width: 1px;
    margin: 10px 2px;
    background: var(--line);
  }
  .bar :global(button.icon) {
    display: grid;
    place-items: center;
    width: 26px;
    padding: 0;
  }
  .bar :global(button[aria-pressed='true']) {
    color: var(--accent);
    background: var(--accent-soft);
    border-color: transparent;
  }
  .bar :global(.field) {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
</style>
