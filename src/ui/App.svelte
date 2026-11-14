<script lang="ts">
  // Hauptfenster, Aufbau wie Vorbild: Menü, Standard- und Eigenschaftsleiste oben, Werkzeugkasten links,
  // Zeichenfläche, Andockfenster und Palette rechts, Statusleiste unten. Optik eigen (theme.css).
  import { onMount } from 'svelte';
  import { measure, type Measure } from '../model/arrange';
  import { activeLayer, addNodes, createDocument } from '../model/document';
  import { guidesOf, originOf, toUser } from '../model/guides';
  import { History } from '../model/history';
  import { selectionOpacity, setOpacity, toCurves, updateLeaves, type FillSpec } from '../model/style';
  import type { Doc, LeafNode, Node, Palette } from '../model/types';
  import { DEFAULT_NUDGE, DEFAULT_UNIT } from '../model/units';
  import { Renderer } from '../render/renderer';
  import { styled } from '../render/scene';
  import { MM_TO_PX, zoomTo } from '../render/viewport';
  import { display } from '../io/colors';
  import { images } from '../io/images';
  import { addTrace } from '../io/trace';
  import AlignPanel from './AlignPanel.svelte';
  import Canvas from './Canvas.svelte';
  import ColorSettingsBar from './ColorSettingsBar.svelte';
  import DockPanel from './DockPanel.svelte';
  import DocOptions from './DocOptions.svelte';
  import FileDialogs from './FileDialogs.svelte';
  import MenuBar from './MenuBar.svelte';
  import ObjectManager from './ObjectManager.svelte';
  import PageTabs from './PageTabs.svelte';
  import PaletteBar from './PaletteBar.svelte';
  import PropertyBar from './PropertyBar.svelte';
  import ShapingBar from './ShapingBar.svelte';
  import StandardBar from './StandardBar.svelte';
  import StatusBar from './StatusBar.svelte';
  import StylePanel from './StylePanel.svelte';
  import TextPanel from './TextPanel.svelte';
  import Toolbox from './Toolbox.svelte';
  import TracePanel from './TracePanel.svelte';
  import TransformPanel from './TransformPanel.svelte';
  import { editCommand, pickToggle, viewCommand } from './commands';
  import { enabledFor } from './menu-enabled';
  import { PageState } from './page-state.svelte';
  import { browserKey, keyCommand, nativeMenu, type Command, type Tool as ToolName } from './shortcuts';
  import { describeSelection } from './status';
  import { StyleState } from './style-state.svelte';
  import { TextState } from './text-state.svelte';
  import { isPick, toolCursor } from './toolbox';
  import { createTools } from './tools';
  import { ViewState } from './view-state.svelte';
  import type { CutParams } from './tools/cut-tools';
  import type { Editor, Knot } from './tools/tool';
  // ?n=10000 lädt ein Zufallsdokument (Lasttest); ohne Parameter leere A4-Seite.
  import { randomDoc } from '../../tests/perf/random-doc';
  import { tr } from '../i18n/i18n.svelte';

  const n = Number(new URLSearchParams(location.search).get('n') ?? 0);
  const history = new History<Doc>(n ? randomDoc(n) : createDocument());
  const renderer = new Renderer(images);
  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

  let surface: Canvas;
  let selected = new Set<string>();
  let clipboard: Node[] = [];
  let toolName = $state<ToolName>('select');
  let prevTool: ToolName | null = null;
  let smoothing = $state(4);
  let cut = $state<CutParams>({ knife: 'line', width: 2, nib: 'round', pick: { fill: true, stroke: true } });
  let notice = $state('');
  // Leisten: einmal pro Bild aus Dokument und Ansicht.
  let zoom = $state(100);
  let info = $state('');
  let count = $state(0);
  let cursor = $state<readonly [number, number] | null>(null);
  // Eigenschaftsleiste: Maße nur neu, wenn Dokument oder Auswahl wechseln.
  let doc = $state.raw<Doc>(history.current);
  let measured = $state.raw<ReadonlySet<string>>(selected);
  let ms = $state.raw<Measure | null>(null);
  let knot = $state.raw<Knot | null>(null); // gewählter Verlaufsknoten; neu nur bei Änderung (Feld mitten im Tippen)
  /** gewähltes Bild fürs Nachzeichnen; wechselt mit Dokument oder Auswahl */
  let picked = $state.raw<ReturnType<typeof selectedImage>>();
  let guide = $state<string | null>(null); // gewählte Hilfslinie; zählt nur ohne Objekt-Auswahl
  const view = new ViewState();
  const typo = new TextState(history, () => selected, () => redraw(), (m) => onnotice(m));
  // Paletten des Dokuments für die Leiste.
  const NONE: readonly Palette[] = [];
  let palettes = $state.raw<readonly Palette[]>(NONE);
  let tracePanel: TracePanel;
  let tabs: PageTabs;
  let files: FileDialogs;
  let shapingBar: ShapingBar;
  let options: DocOptions;

  const pages = new PageState(history.current); // aktuelle Seite: Ansicht, kein Rückgängig-Schritt
  const pi = () => pages.index(history.current);
  const page = () => history.current.pages[pi()];
  const redraw = () => surface?.redraw();
  const style = new StyleState((fn: (n: LeafNode) => LeafNode) =>
    guarded(() => {
      if (selected.size) history.push(updateLeaves(history.current, selected, fn));
    }),
  );

  const ed: Editor = {
    history,
    renderer,
    page,
    layer: () => pages.layer,
    view: (v) => surface.view(v),
    get vp() { return surface.viewport(); },
    get viewSize() { return surface.size(); },
    get selected() { return selected; },
    set selected(s) { selected = s; },
    get guide() { return selected.size ? null : guide; }, set guide(g) { guide = g; },
    guides: () => (view.show.guides ? guidesOf(history.current, pi()) : []),
    get notice() { return notice; },
    set notice(s) { notice = s; },
    get fill() { return style.fill; },
    get stroke() { return style.stroke; },
  };
  const tools = createTools(ed, { smoothing: () => smoothing, shape: () => style.shape, cut: () => cut, redraw, textDefaults: typo.defaults });
  const cursorClass = $derived(toolCursor(toolName));

  // Vor jedem Bild: Dokument an Renderer, Bedienfelder und Leisten.
  function frame() {
    display.use(history.current.color, view.proof);
    palettes = history.current.palettes ?? NONE;
    renderer.setPage(page());
    const leaf = renderer.leavesOf(selected).find(styled)?.node;
    typo.show(leaf ?? null);
    if (leaf) style.show(leaf);
    const img = selectedImage();
    alpha = selectionOpacity(history.current, selected);
    zoom = Math.round((surface.viewport().zoom / MM_TO_PX) * 100);
    count = selected.size;
    const k = tools[toolName].knot?.get() ?? null;
    if (JSON.stringify(k) !== JSON.stringify(knot)) knot = k;
    info = describeSelection(history.current, [...selected]);
    if (doc !== history.current || measured !== selected) [doc, measured, ms, picked] = [history.current, selected, measure(history.current, [...selected]), img];
  }

  function setTool(name: ToolName) {
    if (name === toolName) return;
    tools[toolName].finish?.();
    toolName = name;
  }

  function run(cmd: Command) {
    const r = editCommand(history.current, [...selected], cmd, clipboard, { page: pi(), layer: pages.layer });
    if (r) {
      if (r.doc) history.push(r.doc);
      if (r.selected) selected = r.selected;
      if (r.clipboard) clipboard = r.clipboard;
      return;
    }
    const v = viewCommand(surface.viewport(), surface.size(), cmd, renderer.bounds(selected), page());
    if (v) return surface.setView(v);
    if (files.command(cmd) || view.run(cmd)) return;
    switch (cmd.name) {
      case 'undo': history.undo(); break;
      case 'redo': history.redo(); break;
      case 'deselect': [selected, guide] = [new Set(), null]; break;
      // alle wählbaren Objekte der Seite (gesperrte Ebenen nicht); Knoten-Werkzeug fängt den Befehl vorher ab
      case 'selectAll': selected = new Set(renderer.inside({ minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity })); break;
      case 'toCurves':
        if (renderer.leavesOf(selected).some((it) => it.node.type === 'shape' || it.node.type === 'text')) history.push(updateLeaves(history.current, selected, toCurves));
        break;
      case 'tool': setTool(cmd.tool); break;
      case 'pickToggle': {
        const t = pickToggle(toolName, prevTool);
        setTool(t.tool);
        prevTool = t.prev;
        break;
      }
      case 'trace': tracePanel.run(); break;
      case 'shaping': shapingBar.run(cmd.op); break;
      case 'outline': shapingBar.outline(); break;
      case 'docOptions': options.open(); break;
      case 'page': tabs.run(cmd.op); break;
    }
  }

  // Menü: ausgegraut, was gerade nichts bewirken kann.
  const enabled = (c: Command) =>
    enabledFor(c, { doc: history.current, page: pi(), selected: [...selected], clipboard: clipboard.length, canUndo: history.canUndo, canRedo: history.canRedo, guide: ed.guide !== null });
  // Tasten, Menü und Leisten: erst das Werkzeug fragen (Knoten löschen, Text bestätigen), dann allgemein.
  const exec = (cmd: Command) => guarded(() => tools[toolName].key?.(cmd) || run(cmd));
  // Palette-Linksklick: erst das Werkzeug (gewählter Verlaufsknoten), sonst Füllung der Auswahl.
  const paletteFill = (f: FillSpec) =>
    guarded(() => {
      if (!(f.kind === 'solid' && tools[toolName].paint?.(f.a))) style.handlers.onfill(f);
    });

  function onzoom(v: string) {
    if (v === 'fit' || v === 'selection') return exec({ name: v === 'fit' ? 'zoomFit' : 'zoomSelection' });
    const [w, h] = surface.size();
    surface.setView(zoomTo(surface.viewport(), (MM_TO_PX * Number(v)) / 100, w / 2, h / 2));
  }

  // Seitenwechsel: Werkzeug abschließen, Auswahl leeren.
  const leavePage = () => (tools[toolName].finish?.(), ([selected, guide] = [new Set(), null]));

  // Anderes Dokument: kein Rückgängig über Dateigrenzen, erste Seite, neu einpassen.
  function onopen(doc: Doc) {
    leavePage();
    history.reset(doc);
    pages.go(doc, 0);
    surface.fit();
  }

  // Import wie Einfügen: auf die aktive Ebene, danach gewählt.
  function onimport(nodes: Node[]) {
    guarded(() => {
      const layer = activeLayer(page(), pages.layer);
      if (!layer) throw new Error(tr('Keine sichtbare, entsperrte Ebene'));
      history.push(addNodes(history.current, layer.id, nodes));
      selected = new Set(nodes.map((n) => n.id));
    }, true);
  }

  // Nachzeichnung auf eigener Ebene, danach gewählt; das Bild bleibt.
  const selectedImage = () => {
    const it = renderer.leavesOf(selected).find((l) => l.node.type === 'image');
    return it && it.node.type === 'image' ? { node: it.node, world: it.world } : undefined;
  };
  let alpha = $state<number | null>(null);
  function onalpha(opacity: number, done: boolean) {
    guarded(() => history.preview(setOpacity(history.current, selected, opacity)));
    if (done) history.commit();
    redraw();
  }
  // Nachzeichnung oder Formen-Befehl: ein Rückgängig-Schritt, Ergebnis gewählt.
  function adopt(next: Doc, ids: Iterable<string>) {
    history.push(next);
    selected = new Set(ids);
    redraw();
  }

  const onnotice = (m: string) => ((notice = m), redraw());

  // keep: Hinweis vom Drücken bleibt beim Loslassen stehen.
  function guarded(fn: () => void, keep = false) {
    try {
      if (!keep) notice = '';
      fn();
    } catch (err) {
      notice = (err as Error).message;
    }
    redraw();
  }

  const onKey = (e: KeyboardEvent) => {
    const cmd = keyCommand(e, isMac, !!document.querySelector(':popover-open'));
    if (cmd) (e.preventDefault(), exec(cmd));
    else if (browserKey(e, isMac)) e.preventDefault();
  };

  $effect(() => {
    void toolName;
    redraw();
  });

  onMount(() => {
    images.onReady = redraw;
    display.onChange = redraw;
    typo.loadFonts();
  });
</script>

<svelte:window onkeydown={onKey} oncontextmenu={(e) => nativeMenu(e.target as HTMLInputElement | null) || e.preventDefault()} />

<main>
  <div style="grid-area: menu"><MenuBar {isMac} checked={view.checked} {enabled} oncommand={exec} /></div>
  <div style="grid-area: standard"><StandardBar {isMac} {zoom} oncommand={exec} {onzoom} /></div>
  <div style="grid-area: property; min-width: 0">
    <PropertyBar tool={toolName} {ms} text={typo} guide={ms ? null : (guidesOf(doc, pages.index(doc)).find((g) => g.id === guide) ?? null)} origin={originOf(doc)} page={doc.pages[0]} units={doc.units ?? DEFAULT_UNIT} nudge={doc.nudge ?? DEFAULT_NUDGE} shape={style.shape}
      bind:smoothing bind:cut {knot} onknot={(k) => guarded(() => (tools[toolName].knot?.set(k), redraw()))} onradius={style.handlers.onradius} onpolygon={style.handlers.onpolygon} oncommand={exec}>
      {#each tools[toolName].actions ?? [] as a (a.label)}
        <button onpointerdown={(e) => e.preventDefault()} onclick={() => guarded(a.run)}>{a.label}</button>
      {/each}
      {#if tools[toolName].slider}{@const s = tools[toolName].slider!}
        <label class="field">{s.label} <input type="range" min="0" max="100" value={s.value()} oninput={(e) => guarded(() => s.set(+e.currentTarget.value, false))} onchange={(e) => guarded(() => s.set(+e.currentTarget.value, true))} /></label>
      {/if}
      <div style:display={isPick(toolName) && count > 0 ? 'contents' : 'none'}>
        <ShapingBar bind:this={shapingBar} {history} selected={() => selected} ondone={(r) => adopt(r.doc, r.selected)} {onnotice} />
      </div>
    </PropertyBar>
  </div>
  <div class="cell" style="grid-area: tools"><Toolbox tool={toolName} {isMac} onpick={(t) => guarded(() => setTool(t))} /></div>
  <div style="grid-area: stage; min-width: 0; min-height: 0; overflow: hidden">
    <Canvas bind:this={surface} {isMac} {renderer} tool={() => tools[toolName]} cursor={cursorClass} doc={() => history.current} {pi} show={view.show} snap={view.snap} guide={() => ed.guide} onframe={frame} oncursor={(p) => (cursor = p && toUser(history.current, ...p))} oncommand={exec} guard={guarded} sel={ed} {enabled} />
  </div>
  <div style="grid-area: pages; min-width: 0"><PageTabs bind:this={tabs} {doc} {history} {pages} onleave={leavePage} ondone={redraw} {onnotice} /></div>
  <div class="cell" style="grid-area: dock">
    <DockPanel bind:open={view.docker}>
      {#snippet objects()}<ObjectManager {doc} {history} {pages} selected={measured} onselect={(s) => ((selected = s), redraw())} onpage={(i) => (leavePage(), pages.go(history.current, i), redraw())} ondone={redraw} {onnotice} />{/snippet}
      {#snippet properties()}<StylePanel fill={style.fill} stroke={style.stroke} shape={style.shape} {...style.handlers} {alpha} {onalpha} />{/snippet}
      {#snippet align()}<AlignPanel {count} oncommand={exec} />{/snippet}
      {#snippet transform()}<TransformPanel {ms} origin={originOf(doc)} units={doc.units ?? DEFAULT_UNIT} bind:kind={view.transform} oncommand={exec} />{/snippet}
      {#snippet text()}<TextPanel text={typo} active={toolName === 'text'} />{/snippet}
      {#snippet trace()}<TracePanel bind:this={tracePanel} image={picked} active={view.docker === 'trace'} ondone={(node, drop) => adopt(addTrace(history.current, node, pi(), drop), [node.id])} {onnotice} />{/snippet}
      {#snippet color()}<ColorSettingsBar {history} bind:proof={view.proof} ondone={redraw} {onnotice} />{/snippet}
    </DockPanel>
  </div>
  <div class="cell" style="grid-area: palette"><PaletteBar {history} {palettes} fill={style.fill} {...style.handlers} onfill={paletteFill} ondrop={(c, x, y) => surface.drop(c, x, y)} ondone={redraw} {onnotice} /></div>
  <div style="grid-area: status"><StatusBar {cursor} units={doc.units ?? DEFAULT_UNIT} {info} {notice} fill={style.fill} stroke={style.stroke} /></div>
  <DocOptions bind:this={options} doc={() => history.current} bind:grid={view.show.grid} oncommand={exec} />
  <FileDialogs bind:this={files} doc={() => history.current} {page} selected={() => selected} {onopen} {onimport} {onnotice} />
</main>
