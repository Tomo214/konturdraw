<script lang="ts">
  // Statusleiste unten (wie Vorbild): Zeigerposition, Objektinfo, Meldung, Füllung und Kontur der Auswahl.
  import type { FillSpec } from '../model/style';
  import type { Stroke } from '../model/types';
  import { display } from '../io/colors';
  import { UNITS, formatLength, type Unit } from '../model/units';
  import { mm } from './status';

  let {
    cursor,
    units,
    info,
    notice,
    fill,
    stroke,
  }: { cursor: readonly [number, number] | null; units: Unit; info: string; notice: string; fill: FillSpec; stroke: Stroke | null } = $props();

  const FILL: Record<FillSpec['kind'], string> = { none: 'Keine Füllung', solid: 'Vollton', linear: 'Verlauf linear', radial: 'Verlauf radial' };
</script>

<footer>
  <span class="pos">{cursor ? `${formatLength(cursor[0], units)} ; ${formatLength(cursor[1], units)} ${UNITS[units].label}` : ''}</span>
  <span class="info">{info}</span>
  <span class="notice" role="status">{notice}</span>
  <span class="style">
    <span class="swatch" class:none={fill.kind === 'none'} style:background={fill.kind === 'none' ? null : display.css(fill.a)}></span>
    {FILL[fill.kind]}
    <span class="swatch line" class:none={!stroke} style:border-color={stroke ? display.css(stroke.color) : null}></span>
    {stroke ? `${mm(stroke.width)} mm` : 'Keine Kontur'}
  </span>
</footer>

<style>
  footer {
    display: grid;
    grid-template-columns: 180px minmax(0, auto) minmax(0, 1fr) auto;
    align-items: center;
    gap: 16px;
    height: 26px;
    padding: 0 10px;
    background: var(--bar);
    border-top: 1px solid var(--line);
  }
  span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .info {
    color: var(--text-strong);
  }
  .notice {
    color: var(--text-dim);
  }
  .style {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .swatch {
    flex: none;
    width: 14px;
    height: 14px;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
  }
  .swatch.line {
    margin-left: 8px;
    background: none;
    border-width: 3px;
  }
  /* Keine Farbe: weißes Feld mit diagonalem Strich. */
  .swatch.none {
    border: 1px solid var(--line-strong);
    background: linear-gradient(to top right, #fff 45%, var(--accent) 45% 55%, #fff 55%);
  }
</style>
