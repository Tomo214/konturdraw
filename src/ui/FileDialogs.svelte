<script lang="ts">
  import type { ExportFormat, ExportOptions } from '../io/bridge';
  import { DEFAULT_EXPORT_OPTIONS, exportPage, importInto, openFile, printPage, saveFile } from '../io/files';
  import { createDocument } from '../model/document';
  import type { Doc, Node, Page } from '../model/types';
  import Icon from './Icon.svelte';
  import type { Command } from './shortcuts';

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
  let busy = $state(false);
  let exportDialog: HTMLDialogElement;
  let printDialog: HTMLDialogElement;

  const fileName = (p: string) => p.split(/[\\/]/).pop();

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
      return `Geöffnet: ${fileName(r.path)}`;
    });

  export const save = (as: boolean) =>
    run(async () => {
      const p = await saveFile(doc(), as ? null : path);
      if (!p) return;
      path = p;
      return `Gespeichert: ${fileName(p)}`;
    });

  export const importIt = () =>
    run(async () => {
      const r = await importInto(page());
      if (!r) return;
      onimport(r.nodes);
      return ['Importiert', ...r.warnings].join(' – ');
    });

  // Fokus auf den Hauptknopf: Eingabetaste bestätigt wie in Desktop-Dialogen üblich.
  function show(d: HTMLDialogElement) {
    d.showModal();
    d.querySelector<HTMLButtonElement>('.primary')?.focus();
  }
  export const showExport = () => show(exportDialog);
  export const showPrint = () => show(printDialog);

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
      const o: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, title: path ? fileName(path)!.replace(/\.kwk$/i, '') : 'Unbenannt' };
      if (format === 'png') {
        if (!(dpi >= 1 && dpi <= 2400)) throw new Error('Auflösung: 1 bis 2400 dpi');
        o.dpi = dpi;
      }
      if (format === 'pdfx') {
        if (!(bleed >= 0 && bleed <= 25)) throw new Error('Beschnittzugabe: 0 bis 25 mm.');
        Object.assign(o, { bleed, marks });
      }
      if (format === 'plt') {
        if (!(unitsPerMm >= 1 && unitsPerMm <= 1000)) throw new Error('Plottereinheiten je mm: 1 bis 1000 (Standard 40).');
        o.plot = { unitsPerMm, origin };
      }
      exportDialog.close();
      const p = await exportPage(page(), doc().color, format, o, onlySelection ? selected() : undefined);
      return p && `Exportiert: ${fileName(p)}`;
    });

  // Druckansicht des Systems: dort mit 100 % drucken, nicht „an Seite anpassen“.
  const print = () =>
    run(async () => {
      printDialog.close();
      await printPage(page(), doc().color, mirror);
      return 'Druckansicht geöffnet – dort mit 100 % drucken';
    });
</script>

{#snippet head(title: string, d: () => HTMLDialogElement)}
  <header>
    <h2>{title}</h2>
    <button class="close" aria-label="Schließen" onclick={() => d().close()}><Icon name="close" size={16} /></button>
  </header>
{/snippet}

<dialog bind:this={exportDialog} aria-label="Exportieren">
  {@render head('Exportieren', () => exportDialog)}
  <div class="fields">
    <label for="kw-format">Format</label>
    <select id="kw-format" bind:value={format}>
      <option value="pdf">PDF</option>
      <option value="pdfx">PDF druckfertig (PDF/X-4)</option>
      <option value="svg">SVG</option>
      <option value="png">PNG</option>
      <option value="dxf">DXF (Plotter/Laser)</option>
      <option value="plt">HPGL (.plt)</option>
    </select>
    {#if format === 'png'}
      <label for="kw-dpi">Auflösung</label>
      <span><input id="kw-dpi" type="number" min="1" max="2400" step="1" bind:value={dpi} /> dpi</span>
    {:else if format === 'pdfx'}
      <label for="kw-bleed" title="Zugabe rund um die Seite, wird beim Schneiden entfernt">Beschnitt</label>
      <span><input id="kw-bleed" type="number" min="0" max="25" step="0.5" bind:value={bleed} /> mm</span>
      <span></span>
      <label class="check"><input type="checkbox" bind:checked={marks} /> Schnittmarken</label>
    {:else if format === 'plt'}
      <label for="kw-units" title="HPGL-Standard: 40 Einheiten je mm">Einheiten</label>
      <span><input id="kw-units" type="number" min="1" max="1000" step="1" bind:value={unitsPerMm} /> je mm</span>
      <label for="kw-origin">Ursprung</label>
      <select id="kw-origin" bind:value={origin}>
        <option value="lowerleft">unten links</option>
        <option value="center">Mitte</option>
      </select>
    {/if}
    <span></span>
    <label class="check"><input type="checkbox" bind:checked={onlySelection} /> nur Auswahl</label>
  </div>
  <footer>
    <button class="primary" disabled={busy} onclick={exportIt}>Exportieren …</button>
    <button onclick={() => exportDialog.close()}>Abbrechen</button>
  </footer>
</dialog>

<dialog bind:this={printDialog} aria-label="Drucken">
  {@render head('Drucken', () => printDialog)}
  <div class="fields">
    <span></span>
    <label class="check" title="Für Transferpapier: links und rechts vertauscht"><input type="checkbox" bind:checked={mirror} /> gespiegelt (Transferpapier)</label>
  </div>
  <p>In der Druckansicht 100 % wählen, nicht „an Seite anpassen“ – sonst stimmen die Maße nicht.</p>
  <footer>
    <button class="primary" disabled={busy} onclick={print}>Drucken …</button>
    <button onclick={() => printDialog.close()}>Abbrechen</button>
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
</style>
