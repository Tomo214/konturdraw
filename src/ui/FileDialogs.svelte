<script lang="ts">
  import type { ExportFormat, ExportOptions } from '../io/bridge';
  import { DEFAULT_EXPORT_OPTIONS, exportPage, importInto, openFile, printPage, saveFile } from '../io/files';
  import { createDocument } from '../model/document';
  import { PAPERS, tileLayout, toSheets, type TileOptions } from '../model/tiles';
  import type { Doc, Node, Page } from '../model/types';
  import Icon from './Icon.svelte';
  import TilePreview from './TilePreview.svelte';
  import type { Command } from './shortcuts';
  import { tm, tr } from '../i18n/i18n.svelte';

  // Datei-Befehle (3g-1, 3h). Dateiwahl stellt die Desktop-App; Export und Druck fragen vorher ihre Optionen ab.
  let {
    doc,
    page,
    selected,
    onopen,
    onimport,
    onnotice,
  }: {
    doc: () => Doc;
    /** Aktuelle Seite: Ziel von Import, Export und Druck. */
    page: () => Page;
    selected: () => ReadonlySet<string>;
    onopen: (doc: Doc) => void;
    onimport: (nodes: Node[]) => void;
    onnotice: (msg: string) => void;
  } = $props();

  let path = $state<string | null>(null);
  let format = $state<ExportFormat>('pdf');
  let dpi = $state(DEFAULT_EXPORT_OPTIONS.dpi);
  let bleed = $state(DEFAULT_EXPORT_OPTIONS.bleed);
  let marks = $state(DEFAULT_EXPORT_OPTIONS.marks);
  let unitsPerMm = $state(DEFAULT_EXPORT_OPTIONS.plot.unitsPerMm);
  let origin = $state(DEFAULT_EXPORT_OPTIONS.plot.origin);
  let onlySelection = $state(false);
  let mirror = $state(false);
  // Druck in Kacheln: Seite größer als das Papier auf mehrere Blätter, 1:1.
  let tiled = $state(false);
  let paper = $state<keyof typeof PAPERS>('A4');
  let landscape = $state(false);
  let overlap = $state(10);
  let margin = $state(5);
  let tileMarks = $state(true);
  // Leere Zahlenfelder liefern null → ungültig statt 0.
  const num = (v: number | null) => (typeof v === 'number' ? v : NaN);
  const tileOptions = $derived.by((): TileOptions => {
    const p = PAPERS[paper];
    return { paper: landscape ? { width: p.height, height: p.width } : p, margin: num(margin), overlap: num(overlap) };
  });
  // Seitengröße beim Öffnen des Dialogs (page() selbst meldet keine Änderungen).
  let size = $state<[number, number]>([0, 0]);
  const layout = $derived(tiled ? tileLayout(size[0], size[1], tileOptions) : null);
  let busy = $state(false);
  let exportDialog: HTMLDialogElement;
  let printDialog: HTMLDialogElement;

  const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

  // Ein Ablauf zur Zeit; Fehler landen in der Statuszeile.
  async function run(fn: () => Promise<string | null | undefined>) {
    if (busy) return;
    busy = true;
    try {
      const msg = await fn();
      if (msg) onnotice(msg);
    } catch (err) {
      onnotice((err as Error).message);
    } finally {
      busy = false;
    }
  }

  export function newDoc() {
    path = null;
    onopen(createDocument());
  }

  export const open = () =>
    run(async () => {
      const r = await openFile();
      if (!r) return;
      path = r.path;
      onopen(r.doc);
      return tr('Geöffnet: {name}', { name: fileName(r.path) });
    });

  export const save = (as: boolean) =>
    run(async () => {
      const p = await saveFile(doc(), as ? null : path);
      if (!p) return;
      path = p;
      return tr('Gespeichert: {name}', { name: fileName(p) });
    });

  export const importIt = () =>
    run(async () => {
      const r = await importInto(page());
      if (!r) return;
      onimport(r.nodes);
      return [tr('Importiert'), ...r.warnings.map(tm)].join(' – ');
    });

  // Fokus auf den Hauptknopf: Eingabetaste bestätigt wie in Desktop-Dialogen üblich.
  function show(d: HTMLDialogElement) {
    d.showModal();
    d.querySelector<HTMLButtonElement>('.primary')?.focus();
  }
  export const showExport = () => show(exportDialog);
  export function showPrint() {
    size = [page().width, page().height];
    show(printDialog);
  }

  /** Datei-Befehl ausführen; false = kein Datei-Befehl. */
  export function command(cmd: Command): boolean {
    switch (cmd.name) {
      case 'new': newDoc(); return true;
      case 'open': open(); return true;
      case 'save': case 'saveAs': save(cmd.name === 'saveAs'); return true;
      case 'import': importIt(); return true;
      case 'export': showExport(); return true;
      case 'print': showPrint(); return true;
    }
    return false;
  }

  const exportIt = () =>
    run(async () => {
      // Nur die Felder des gewählten Formats zählen; leere Zahlenfelder (null) hier abfangen.
      const o: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, title: path ? fileName(path)!.replace(/\.kwk$/i, '') : tr('Unbenannt') };
      if (format === 'png') {
        if (!(dpi >= 1 && dpi <= 2400)) throw new Error(tr('Auflösung: 1 bis 2400 dpi'));
        o.dpi = dpi;
      }
      if (format === 'pdfx') {
        if (!(bleed >= 0 && bleed <= 25)) throw new Error(tr('Beschnittzugabe: 0 bis 25 mm.'));
        Object.assign(o, { bleed, marks });
      }
      if (format === 'plt') {
        if (!(unitsPerMm >= 1 && unitsPerMm <= 1000)) throw new Error(tr('Plottereinheiten je mm: 1 bis 1000 (Standard 40).'));
        o.plot = { unitsPerMm, origin };
      }
      exportDialog.close();
      const p = await exportPage(page(), doc().color, format, o, onlySelection ? selected() : undefined);
      return p && tr('Exportiert: {name}', { name: fileName(p) });
    });

  // Druckansicht des Systems: dort mit 100 % drucken, nicht „an Seite anpassen“.
  const print = () =>
    run(async () => {
      if (tiled && !layout) throw new Error(tr('Rand und Überlappung passen nicht aufs Papier.'));
      printDialog.close();
      await printPage(page(), doc().color, mirror, layout ? toSheets(layout, tileOptions, tileMarks) : undefined);
      return tr('Druckansicht geöffnet – dort mit 100 % drucken');
    });
</script>

{#snippet head(title: string, d: () => HTMLDialogElement)}
  <header>
    <h2>{title}</h2>
    <button class="close" aria-label={tr('Schließen')} onclick={() => d().close()}><Icon name="close" size={16} /></button>
  </header>
{/snippet}

<dialog bind:this={exportDialog} aria-label={tr('Exportieren')}>
  {@render head(tr('Exportieren'), () => exportDialog)}
  <div class="fields">
    <label for="kw-format">Format</label>
    <select id="kw-format" bind:value={format}>
      <option value="pdf">PDF</option>
      <option value="pdfx">{tr('PDF druckfertig (PDF/X-4)')}</option>
      <option value="svg">SVG</option>
      <option value="png">PNG</option>
      <option value="dxf">{tr('DXF (Plotter/Laser)')}</option>
      <option value="plt">HPGL (.plt)</option>
    </select>
    {#if format === 'png'}
      <label for="kw-dpi">{tr('Auflösung')}</label>
      <span><input id="kw-dpi" type="number" min="1" max="2400" step="1" bind:value={dpi} /> dpi</span>
    {:else if format === 'pdfx'}
      <label for="kw-bleed" title={tr('Zugabe rund um die Seite, wird beim Schneiden entfernt')}>{tr('Beschnitt')}</label>
      <span><input id="kw-bleed" type="number" min="0" max="25" step="0.5" bind:value={bleed} /> mm</span>
      <span></span>
      <label class="check"><input type="checkbox" bind:checked={marks} /> {tr('Schnittmarken')}</label>
    {:else if format === 'plt'}
      <label for="kw-units" title={tr('HPGL-Standard: 40 Einheiten je mm')}>{tr('Einheiten')}</label>
      <span><input id="kw-units" type="number" min="1" max="1000" step="1" bind:value={unitsPerMm} /> {tr('je mm')}</span>
      <label for="kw-origin">{tr('Ursprung')}</label>
      <select id="kw-origin" bind:value={origin}>
        <option value="lowerleft">{tr('unten links')}</option>
        <option value="center">{tr('Mitte')}</option>
      </select>
    {/if}
    <span></span>
    <label class="check"><input type="checkbox" bind:checked={onlySelection} /> {tr('nur Auswahl')}</label>
  </div>
  <footer>
    <button class="primary" disabled={busy} onclick={exportIt}>{tr('Exportieren …')}</button>
    <button onclick={() => exportDialog.close()}>{tr('Abbrechen')}</button>
  </footer>
</dialog>

<dialog bind:this={printDialog} aria-label={tr('Drucken')}>
  {@render head(tr('Drucken'), () => printDialog)}
  <div class="fields">
    <span></span>
    <label class="check" title={tr('Für Transferpapier: links und rechts vertauscht')}><input type="checkbox" bind:checked={mirror} /> {tr('gespiegelt (Transferpapier)')}</label>
    <span></span>
    <label class="check" title={tr('Seite größer als das Papier: auf mehrere Blätter verteilen')}><input type="checkbox" bind:checked={tiled} /> {tr('In Kacheln drucken')}</label>
    {#if tiled}
      <label for="kw-paper">{tr('Papier')}</label>
      <span>
        <select id="kw-paper" bind:value={paper}>
          {#each Object.keys(PAPERS) as k (k)}<option value={k}>{k}</option>{/each}
        </select>
        <select aria-label={tr('Papierausrichtung')} bind:value={landscape}>
          <option value={false}>{tr('Hochformat')}</option>
          <option value={true}>{tr('Querformat')}</option>
        </select>
      </span>
      <label for="kw-overlap" title={tr('Streifen, den zwei Nachbarblätter gemeinsam haben – zum Ausrichten und Kleben')}>{tr('Überlappung')}</label>
      <span><input id="kw-overlap" type="number" min="0" max="50" step="1" bind:value={overlap} /> mm</span>
      <label for="kw-margin" title={tr('Rand, den der Drucker nicht bedruckt')}>{tr('Rand')}</label>
      <span><input id="kw-margin" type="number" min="0" max="30" step="0.5" bind:value={margin} /> mm</span>
      <span></span>
      <label class="check" title={tr('Passkreuze in der Überlappung und Blattnamen – werden mitgedruckt')}><input type="checkbox" bind:checked={tileMarks} /> {tr('Kachelmarken')}</label>
      <div class="tiles">
        {#if layout}
          <TilePreview width={size[0]} height={size[1]} {layout} />
          <small>{layout.tiles.length === 1 ? tr('Passt auf ein Blatt.') : tr('{cols} × {rows} = {n} Blätter', { cols: layout.cols, rows: layout.rows, n: layout.tiles.length })}</small>
        {:else}
          <small class="error">{tr('Rand und Überlappung passen nicht aufs Papier.')}</small>
        {/if}
      </div>
    {/if}
  </div>
  <p>{tr('In der Druckansicht 100 % wählen, nicht „an Seite anpassen“ – sonst stimmen die Maße nicht.')}</p>
  <footer>
    <button class="primary" disabled={busy || (tiled && !layout)} onclick={print}>{tr('Drucken …')}</button>
    <button onclick={() => printDialog.close()}>{tr('Abbrechen')}</button>
  </footer>
</dialog>

<style>
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  p {
    margin: 8px 14px 0;
    color: var(--text-dim);
  }
  .tiles {
    grid-column: 1 / -1;
    display: grid;
    gap: 6px;
    justify-items: center;
    color: var(--text-dim);
  }
  .error {
    color: var(--accent);
  }
</style>
