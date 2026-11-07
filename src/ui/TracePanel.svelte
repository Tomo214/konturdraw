<script lang="ts">
  // Nachzeichnen (Panel, Spec §8): Vorschau rechnet nach jeder Regleränderung neu (entprellt, nur bei offenem Panel);
  // Übernehmen nimmt das Vorschau-Ergebnis ohne zweite Rechnung, wenn Bild und Regler gleich geblieben sind.
  import type { TracePiece } from '../io/bridge';
  import { images } from '../io/images';
  import { recolor, tracedNode, tracePieces, TRACE_DEFAULTS, type TraceParams } from '../io/trace';
  import type { Mat } from '../model/geometry';
  import type { ImageNode, Node } from '../model/types';
  import TraceColors from './TraceColors.svelte';
  import { pathData, previewKey, resultColors, traceStats } from './trace-preview';
  import { N_, locale, tm, tr } from '../i18n/i18n.svelte';

  let {
    image,
    active,
    ondone,
    onnotice,
  }: {
    /** gewähltes Bild mit Seitenlage (reaktiv: wechselt mit Auswahl und Dokument) */
    image: { node: ImageNode; world: Mat } | undefined;
    /** Panel sichtbar → Vorschau rechnen */
    active: boolean;
    /** drop = id des Originalbilds, wenn es mit dem Übernehmen weg soll */
    ondone: (node: Node, drop?: string) => void;
    onnotice: (msg: string) => void;
  } = $props();

  type View = 'split' | 'result' | 'wire';
  const VIEWS: [View, string, string][] = [
    ['split', N_('Vorher/Nachher'), N_('Bild und Ergebnis untereinander')],
    ['result', N_('Ergebnis'), N_('Nur das Ergebnis, groß')],
    ['wire', N_('Drahtmodell'), N_('Kurven über dem Bild')],
  ];
  interface Preview {
    key: string;
    img: ImageNode;
    mode: TraceParams['mode'];
    pieces: TracePiece[];
    ms: number;
  }

  let p = $state<TraceParams>({ ...TRACE_DEFAULTS });
  let view = $state<View>('split');
  let drop = $state(false);
  let busy = $state(false);
  let working = $state(false);
  let failed = $state('');
  let preview = $state.raw<Preview | null>(null);

  /** Regler bereinigt: leere oder krumme Zahlenfelder ergeben gültige Werte. */
  const job = $derived<TraceParams>({
    ...p,
    speckle: Math.max(0, Math.round(p.speckle || 0)),
    colors: Math.min(256, Math.max(2, Math.round(p.colors || 2))),
  });
  const current = $derived(active ? image : undefined);
  // Palettenänderungen (7d) gehören zum Bild: ein anderes Bild fängt frisch an.
  const imageId = $derived(image?.node.image);
  $effect(() => {
    void imageId;
    p.recolor = [];
  });
  const key = $derived(current ? previewKey(current.node.image, job) : '');
  const stale = $derived(!!preview && preview.key !== key);
  const src = $derived(preview ? `data:image/png;base64,${images.pick([preview.img.image])[preview.img.image]}` : '');
  const drawn = $derived(
    preview?.pieces.map((pc) => ({
      d: pathData(pc.subpaths),
      fill: pc.rgb ? `rgb(${pc.rgb.map((v) => Math.round(v * 255)).join(' ')})` : '#000',
    })) ?? [],
  );
  const stats = $derived(preview ? traceStats(preview.pieces) : null);

  let tried = '';
  let running = false;
  let again = false;
  $effect(() => {
    if (!key || key === tried) return;
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  });

  // Eine Rechnung zur Zeit; wer währenddessen ändert, bekommt danach eine mit dem neuesten Stand.
  async function refresh() {
    if (running) return void (again = true);
    running = working = true;
    try {
      do {
        again = false;
        const img = image;
        if (!img) break;
        const params = job;
        const k = previewKey(img.node.image, params);
        tried = k;
        const t = performance.now();
        try {
          preview = { key: k, img: img.node, mode: params.mode, pieces: await tracePieces(img.node, params), ms: performance.now() - t };
          failed = '';
        } catch (err) {
          [preview, failed] = [null, (err as Error).message];
        }
      } while (again);
    } finally {
      running = working = false;
    }
  }

  export async function run() {
    if (busy) return;
    const img = image;
    if (!img) return onnotice(tr('Erst ein Bild wählen.'));
    if (p.mode === 'centerline' && !(p.lineWidth > 0)) return onnotice(tr('Linienstärke muss größer als 0 mm sein.'));
    busy = true;
    try {
      const params = job;
      const cached = preview?.key === previewKey(img.node.image, params) ? preview.pieces : null;
      const t = performance.now();
      ondone(tracedNode(cached ?? (await tracePieces(img.node, params)), img.world, params), drop ? img.node.id : undefined);
      onnotice(cached ? tr('Nachzeichnung übernommen') : tr('Nachgezeichnet in {secs} s', { secs: secs(performance.now() - t) }));
    } catch (err) {
      onnotice((err as Error).message);
    } finally {
      busy = false;
    }
  }

  const secs = (ms: number) => (ms / 1000).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const count = (n: number, one: string, many: string) => (n === 1 ? tr(one) : tr(many, { n: n.toLocaleString(locale()) }));
  const keepFocus = (e: PointerEvent) => e.preventDefault();
  const checked = (e: Event) => (e.currentTarget as HTMLInputElement).checked;
</script>

{#snippet picture(dim: boolean)}
  <image href={src} width={preview!.img.width} height={preview!.img.height} preserveAspectRatio="none" opacity={dim ? 0.35 : 1} />
{/snippet}

<div class="form">
  <label class="row">
    <span>{tr('Art')}</span>
    <select bind:value={p.mode}>
      <option value="centerline">{tr('Mittellinie')}</option>
      <option value="outline">{tr('Umriss schwarz-weiß')}</option>
      <option value="color">{tr('Umriss farbig')}</option>
    </select>
  </label>
  <div class="wide views" role="group" aria-label={tr('Vorschau')}>
    {#each VIEWS as [id, label, tip] (id)}
      <button aria-pressed={view === id} data-tip={tr(tip)} onpointerdown={keepFocus} onclick={() => (view = id)}>{tr(label)}</button>
    {/each}
  </div>
  <div class="wide stage" class:split={view === 'split'}>
    {#if !current}
      <p class="hint">{tr('Erst ein Bild wählen.')}</p>
    {:else if preview}
      {@const box = `0 0 ${preview.img.width} ${preview.img.height}`}
      {#if view === 'split'}
        <svg class="pane" viewBox={box} role="img" aria-label={tr('Vorher')}>{@render picture(false)}</svg>
      {/if}
      <svg class="pane result" class:stale viewBox={box} role="img" aria-label={view === 'wire' ? tr('Drahtmodell') : tr('Nachher')}>
        {#if view === 'wire'}{@render picture(true)}{/if}
        {#each drawn as d, i (i)}
          {#if view === 'wire'}
            <path d={d.d} class="wire" />
          {:else if preview.mode === 'centerline'}
            <path d={d.d} fill="none" stroke="#000" stroke-width={job.lineWidth} stroke-linecap="round" stroke-linejoin="round" />
          {:else}
            <path d={d.d} fill={d.fill} />
          {/if}
        {/each}
      </svg>
    {:else}
      <p class="hint" role="status">{failed ? tm(failed) : tr('Berechnet …')}</p>
    {/if}
  </div>
  {#if current && stats}
    <p class="wide hint stats" role="status">
      {working ? tr('Berechnet …') : `${count(stats.curves, N_('1 Kurve'), N_('{n} Kurven'))} · ${count(stats.nodes, N_('1 Knoten'), N_('{n} Knoten'))} · ${count(stats.colors, N_('1 Farbe'), N_('{n} Farben'))} · ${secs(preview!.ms)} s`}
    </p>
  {/if}

  {#if p.mode === 'color'}
    <label class="row" title={tr('Höchstens so viele Farben im Ergebnis')}>
      <span>{tr('Farben')}</span>
      <span class="unit"><input type="number" min="2" max="256" step="1" bind:value={p.colors} onchange={() => (p.colors = job.colors)} /></span>
    </label>
  {:else}
    <label class="row" title={tr('Dunkler als dieser Wert zählt als Linie')}>
      <span>{tr('Schwelle')}</span>
      <span class="unit"><input type="range" min="1" max="254" bind:value={p.threshold} /> <output>{p.threshold}</output></span>
    </label>
  {/if}
  <label class="row" title={tr('Flecken mit weniger Pixeln fallen weg')}>
    <span>{tr('Rauschen')}</span>
    <span class="unit"><input type="number" min="0" max="100000" step="1" bind:value={p.speckle} onchange={() => (p.speckle = job.speckle)} /> px</span>
  </label>
  <label class="row" title={tr('Wie stark Kurven geglättet werden')}>
    <span>{tr('Glättung')}</span>
    <span class="unit"><input type="range" min="0" max="1" step="0.1" bind:value={p.smooth} /> <output>{p.smooth}</output></span>
  </label>
  <label class="row" title={tr('Links bleiben Ecken spitz, rechts wird alles rund')}>
    <span>{tr('Ecken')}</span>
    <span class="unit"><input type="range" min="0" max="1" step="0.1" bind:value={p.corners} /> <output>{p.corners}</output></span>
  </label>
  {#if p.mode === 'centerline'}
    <label class="row">
      <span>{tr('Linienstärke')}</span>
      <span class="unit"><input type="number" min="0.05" max="10" step="0.05" bind:value={p.lineWidth} /> mm</span>
    </label>
  {/if}
  {#if p.mode === 'color'}
    <div class="wide options">
      <!-- Wahl gehört zum Bild wie p.recolor: anderes oder kein Bild → frische Liste -->
      {#key imageId}
        <TraceColors
          colors={current && preview?.mode === 'color' ? resultColors(preview.pieces) : []}
          edited={p.recolor.length > 0}
          onset={(shown, to) => (p.recolor = recolor(p.recolor, shown, to))}
          onreset={() => (p.recolor = [])}
        />
      {/key}
      <label class="check" title={tr('Die Fläche in der Randfarbe weglassen')}>
        <input type="checkbox" checked={p.background !== 'keep'} onchange={(e) => (p.background = checked(e) ? 'edge' : 'keep')} /> {tr('Hintergrund entfernen')}
      </label>
      <label class="check sub" title={tr('Auch eingeschlossene Flächen in der Hintergrundfarbe weglassen')}>
        <input type="checkbox" checked={p.background === 'all'} disabled={p.background === 'keep'} onchange={(e) => (p.background = checked(e) ? 'all' : 'edge')} /> {tr('Farbe im ganzen Bild')}
      </label>
      <label class="check" title={tr('Je Farbe ein Objekt statt je Fläche')}>
        <input type="checkbox" bind:checked={p.merge} /> {tr('Gleiche Farben zusammenführen')}
      </label>
      <label class="check" title={tr('Untere Flächen unter den oberen ausschneiden')}>
        <input type="checkbox" bind:checked={p.cutout} /> {tr('Überlappung entfernen')}
      </label>
    </div>
  {/if}
  <label class="check wide" title={tr('Das Bild verschwindet mit dem Übernehmen; Rückgängig holt es zurück')}>
    <input type="checkbox" bind:checked={drop} /> {tr('Originalbild löschen')}
  </label>
  <button class="wide" disabled={busy} onpointerdown={keepFocus} onclick={run}>{busy ? tr('Zeichnet …') : tr('Übernehmen')}</button>
  <p class="hint wide">{drop ? tr('Wirkt auf das gewählte Bild. Das Ergebnis liegt gruppiert auf eigener Ebene, das Bild wird gelöscht.') : tr('Wirkt auf das gewählte Bild. Das Ergebnis liegt gruppiert auf eigener Ebene, das Bild bleibt.')}</p>
</div>

<style>
  output {
    min-width: 3ch;
    text-align: right;
  }
  .views {
    display: flex;
    gap: 2px;
  }
  .views button {
    flex: 1;
    padding: 0 4px;
    white-space: nowrap;
  }
  .views button[aria-pressed='true'] {
    color: var(--accent);
    background: var(--accent-soft);
    border-color: transparent;
  }
  .stage {
    display: grid;
    gap: 4px;
    min-height: 120px;
    place-items: center;
  }
  /* Gleiche Gesamthöhe in allen Ansichten: Umschalten lässt die Regler nicht springen. */
  .pane {
    width: 100%;
    height: 224px;
    background: #fff;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .split .pane {
    height: 110px;
  }
  /* Schachbrett zeigt, was durchsichtig bleibt (entfernter Hintergrund). */
  .result {
    background: repeating-conic-gradient(#e4e4e8 0% 25%, #fff 0% 50%) 0 0 / 12px 12px;
    transition: opacity var(--fast) var(--ease-out);
  }
  .result.stale {
    opacity: 0.5;
  }
  .wire {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
  }
  .stats {
    font-variant-numeric: tabular-nums;
  }
  .options {
    display: grid;
    gap: 6px;
  }
  .sub {
    padding-left: 20px;
  }
</style>
