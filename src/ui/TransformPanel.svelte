<script lang="ts">
  // Andockfenster Transformationen (Ablauf wie Vorbild, Alt+F7 … Alt+F10): Werte eintragen, Bezugspunkt wählen, Anwenden
  // oder Enter. Kopien > 0 lässt die Auswahl stehen, jede Kopie geht einen Schritt weiter (Drehen 15° × 23 = Kranz).
  // Felder in Dokument-Einheiten ab Lineal-Nullpunkt, y nach oben; Lage, Mitte und Größe folgen der Auswahl.
  import type { Measure } from '../model/arrange';
  import { MAX_COPIES, anchorPoint, type Anchor, type Transformation, type TransformKind } from '../model/transform';
  import type { Point } from '../model/types';
  import { UNITS, type Unit } from '../model/units';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';
  import type { Command } from './shortcuts';
  import { N_, tr } from '../i18n/i18n.svelte';

  let {
    ms,
    origin,
    units,
    kind = $bindable(),
    oncommand,
  }: { ms: Measure | null; origin: Point; units: Unit; kind: TransformKind; oncommand: (c: Command) => void } = $props();

  const PARTS: readonly [TransformKind, IconName, string][] = [
    ['position', 'nudge', N_('Position')],
    ['rotate', 'rotate', N_('Drehen')],
    ['scale', 'scale', N_('Skalieren und Spiegeln')],
    ['size', 'size', N_('Größe')],
    ['skew', 'skewH', N_('Neigen')],
  ];
  const ANCHORS: readonly [Anchor, string][] = [
    ['tl', N_('Oben links')], ['t', N_('Oben Mitte')], ['tr', N_('Oben rechts')],
    ['l', N_('Mitte links')], ['c', N_('Mitte')], ['r', N_('Mitte rechts')],
    ['bl', N_('Unten links')], ['b', N_('Unten Mitte')], ['br', N_('Unten rechts')],
  ];

  let anchor = $state<Anchor>('c');
  let relPos = $state(false);
  let relCenter = $state(true);
  let angle = $state(0);
  let sx = $state(100);
  let sy = $state(100);
  let mirrorH = $state(false);
  let mirrorV = $state(false);
  let keepRatio = $state(true);
  let skewH = $state(0);
  let skewV = $state(0);
  let copies = $state(0);

  const b = $derived(ms?.box);
  const k = $derived(UNITS[units].mm);
  const u = $derived(UNITS[units].label);
  const at = $derived(b ? anchorPoint(b, anchor) : [0, 0]);
  // Seite (mm, y nach unten) → Feld; drei Nachkommastellen
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const ux = (mm: number) => r3((mm - origin.x) / k);
  const uy = (mm: number) => r3((origin.y - mm) / k);
  // unverändertes Feld = genauer Wert der Auswahl, sonst verschiebt das Runden um Bruchteile
  const px = (v: number, exact: number) => (v === ux(exact) ? exact : origin.x + v * k);
  const py = (v: number, exact: number) => (v === uy(exact) ? exact : origin.y - v * k);
  const len = (v: number, exact: number) => (v === r3(exact / k) ? exact : v * k);

  // folgen Auswahl und Bezugspunkt; eine Eingabe gilt bis zur nächsten Änderung dort
  let posX = $derived(relPos ? 0 : ux(at[0]));
  let posY = $derived(relPos ? 0 : uy(at[1]));
  let cenX = $derived(relCenter ? 0 : ux(at[0]));
  let cenY = $derived(relCenter ? 0 : uy(at[1]));
  let w = $derived(b ? r3((b.maxX - b.minX) / k) : 0);
  let h = $derived(b ? r3((b.maxY - b.minY) / k) : 0);

  const num = (e: Event) => (e.currentTarget as HTMLInputElement).valueAsNumber;
  const scaleTo = (v: number, x: boolean) => ([sx, sy] = keepRatio ? [v, v] : x ? [v, sy] : [sx, v]);
  function sizeTo(v: number, width: boolean) {
    const ratio = b && b.maxX - b.minX > 1e-9 ? (b.maxY - b.minY) / (b.maxX - b.minX) : 0;
    if (width) [w, h] = [v, keepRatio && ratio ? r3(v * ratio) : h];
    else [w, h] = [keepRatio && ratio ? r3(v / ratio) : w, v];
  }

  function step(box: NonNullable<typeof b>): Transformation {
    const [ax, ay] = at;
    switch (kind) {
      case 'position':
        return relPos ? { kind, x: posX * k, y: -posY * k, relative: true } : { kind, x: px(posX, ax), y: py(posY, ay), relative: false };
      case 'rotate':
        return relCenter ? { kind, angle, x: cenX * k, y: -cenY * k, relative: true } : { kind, angle, x: px(cenX, ax), y: py(cenY, ay), relative: false };
      case 'scale':
        return { kind, sx, sy, mirrorH, mirrorV };
      case 'size':
        return { kind, w: len(w, box.maxX - box.minX), h: len(h, box.maxY - box.minY) };
      case 'skew':
        return { kind, h: skewH, v: skewV };
    }
  }
  function apply(e: SubmitEvent) {
    e.preventDefault();
    if (b) oncommand({ name: 'transform', t: step(b), anchor, copies });
  }
  const keep = (e: PointerEvent) => e.preventDefault();
</script>

{#snippet field(label: string, value: number, set: (v: number) => void, suffix: string, step = 'any')}
  <label class="row"><span>{label}</span><span class="unit"><input type="number" {step} {value} oninput={(e) => set(num(e))} /> {suffix}</span></label>
{/snippet}

<form class="form" onsubmit={apply}>
  <div class="wide parts">
    {#each PARTS as [id, icon, label] (id)}
      <button type="button" class="icon" aria-pressed={kind === id} aria-label={tr(label)} data-tip={tr(label)} data-tip-side="below" onpointerdown={keep} onclick={() => (kind = id)}
        ><Icon name={icon} size={18} /></button
      >
    {/each}
  </div>
  <h3>{tr(PARTS.find(([id]) => id === kind)![2])}</h3>
  {#if kind === 'position'}
    {@render field('X', posX, (v) => (posX = v), u)}
    {@render field('Y', posY, (v) => (posY = v), u)}
    <label class="wide check"><input type="checkbox" bind:checked={relPos} /> {tr('Relative Position')}</label>
  {:else if kind === 'rotate'}
    {@render field(tr('Winkel'), angle, (v) => (angle = v), '°')}
    {@render field(`${tr('Mitte')} X`, cenX, (v) => (cenX = v), u)}
    {@render field(`${tr('Mitte')} Y`, cenY, (v) => (cenY = v), u)}
    <label class="wide check"><input type="checkbox" bind:checked={relCenter} /> {tr('Relative Mitte')}</label>
  {:else if kind === 'scale'}
    {@render field(tr('Waagerecht'), sx, (v) => scaleTo(v, true), '%')}
    {@render field(tr('Senkrecht'), sy, (v) => scaleTo(v, false), '%')}
    <div class="wide mirror">
      <button type="button" class="icon" aria-pressed={mirrorH} aria-label={tr('Waagerecht spiegeln')} data-tip={tr('Waagerecht spiegeln')} onpointerdown={keep} onclick={() => (mirrorH = !mirrorH)}><Icon name="mirrorH" size={18} /></button>
      <button type="button" class="icon" aria-pressed={mirrorV} aria-label={tr('Senkrecht spiegeln')} data-tip={tr('Senkrecht spiegeln')} onpointerdown={keep} onclick={() => (mirrorV = !mirrorV)}><Icon name="mirrorV" size={18} /></button>
      <label class="check"><input type="checkbox" bind:checked={keepRatio} /> {tr('Proportional')}</label>
    </div>
  {:else if kind === 'size'}
    {@render field(tr('Breite'), w, (v) => sizeTo(v, true), u)}
    {@render field(tr('Höhe'), h, (v) => sizeTo(v, false), u)}
    <label class="wide check"><input type="checkbox" bind:checked={keepRatio} /> {tr('Proportional')}</label>
  {:else}
    {@render field(tr('Waagerecht'), skewH, (v) => (skewH = v), '°')}
    {@render field(tr('Senkrecht'), skewV, (v) => (skewV = v), '°')}
  {/if}
  <span>{tr('Bezugspunkt')}</span>
  <div class="anchors" role="radiogroup" aria-label={tr('Bezugspunkt')}>
    {#each ANCHORS as [id, label] (id)}
      <button type="button" role="radio" aria-checked={anchor === id} aria-label={tr(label)} disabled={kind === 'position' && relPos} onpointerdown={keep} onclick={() => (anchor = id)}></button>
    {/each}
  </div>
  {@render field(tr('Kopien'), copies, (v) => (copies = Math.min(MAX_COPIES, Math.max(0, Math.trunc(v) || 0))), '', '1')}
  {#if copies}<p class="wide hint">{tr('Die Auswahl bleibt; jede Kopie geht einen Schritt weiter.')}</p>{/if}
  <button type="submit" class="wide apply" disabled={!b}>{tr('Anwenden')}</button>
  {#if !b}<p class="wide hint">{tr('Nichts gewählt.')}</p>{/if}
</form>

<style>
  .parts,
  .mirror {
    display: flex;
    gap: 4px;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 36px;
    height: 30px;
    padding: 0;
  }
  .icon[aria-pressed='true'] {
    color: var(--accent);
    background: var(--accent-soft);
    border-color: transparent;
  }
  .mirror .check {
    margin-left: 8px;
  }
  .unit input {
    width: 96px;
  }
  /* Bezugspunkt: neun Punkte auf dem gestrichelten Auswahlrahmen */
  .anchors {
    position: relative;
    display: grid;
    grid-template-columns: repeat(3, 18px);
    grid-template-rows: repeat(3, 18px);
    gap: 4px;
    justify-self: start;
    padding: 2px;
  }
  .anchors::before {
    content: '';
    position: absolute;
    inset: 11px;
    border: 1px dashed var(--line-strong);
    pointer-events: none;
  }
  .anchors button {
    position: relative;
    width: 18px;
    height: 18px;
    min-height: 0;
    padding: 0;
    background: none;
    border-color: transparent;
    border-radius: 50%;
  }
  .anchors button::after {
    content: '';
    position: absolute;
    inset: 5px;
    background: var(--panel);
    border: 1.5px solid var(--text-dim);
    border-radius: 50%;
  }
  .anchors button[aria-checked='true']::after {
    inset: 4px;
    background: var(--accent);
    border-color: var(--accent);
  }
  .apply {
    min-height: 28px;
    color: var(--accent-ink);
    background: var(--accent);
    border-color: var(--accent);
  }
  .apply:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .hint {
    margin: 0;
  }
</style>
