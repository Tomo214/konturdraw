<script lang="ts">
  // Zeichenfläche: Größe, Ansicht, Zeiger an das aktive Werkzeug, ein Neuzeichnen pro Bild.
  // Ringsum wie Vorbild: Lineale oben und links, Ecke = Nullpunkt; aus einem Lineal ziehen = neue Hilfslinie.
  import { onMount } from 'svelte';
  import { gridOf, guidesOf, originOf } from '../model/guides';
  import type { Color, Doc, Point } from '../model/types';
  import type { Renderer } from '../render/renderer';
  import { fitPage, screenToPage, zoomAt, type Viewport } from '../render/viewport';
  import { RULER, drawCrosshair, drawGrid, drawGuides, drawRuler, drawSnap, type RulerLook } from './decor';
  import { canvasMenu, selectForMenu } from './canvas-menu';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import Icon from './Icon.svelte';
  import type { Command, Shown, SnapMode } from './shortcuts';
  import { Snapper } from './snapper';
  import type { Pointer, Tool } from './tools/tool';
  import { pinchSteps, wheelHandler } from './wheel';
  import { tr } from '../i18n/i18n.svelte';

  let {
    renderer,
    tool,
    cursor,
    doc,
    pi,
    show,
    snap,
    guide,
    onframe,
    oncursor,
    oncommand,
    guard,
    isMac,
    sel,
    enabled,
  }: {
    renderer: Renderer;
    tool: () => Tool;
    /** CSS-Klasse für den Mauszeiger: draw, hand, zoom oder leer. */
    cursor: string;
    doc: () => Doc;
    /** Index der aktuellen Seite. */
    pi: () => number;
    show: Record<Shown, boolean>;
    /** Fang-Schalter (Ansicht › Fangen an). */
    snap: Record<SnapMode, boolean>;
    /** Gewählte Hilfslinie. */
    guide: () => string | null;
    /** Vor jedem Bild: Dokument an Renderer und Bedienfelder geben. */
    onframe: () => void;
    oncursor: (p: readonly [number, number] | null) => void;
    oncommand: (c: Command) => void;
    guard: (fn: () => void, keep?: boolean) => void;
    /** Strg-Klick heißt auf dem Mac ⌘-Klick. */
    isMac: boolean;
    /** Auswahl, die ein Rechtsklick vor dem Kontextmenü setzt. */
    sel: { selected: Set<string> };
    /** Ausgegraut wie im Hauptmenü. */
    enabled: (c: Command) => boolean;
  } = $props();

  const page = () => doc().pages[pi()];
  let canvas: HTMLCanvasElement;
  let top: HTMLCanvasElement;
  let left: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let look: RulerLook;
  // Zeiger auf der Fläche (Bildschirm-px) für die Lineal-Marken; Ziehen aus Lineal oder Ecke.
  let mouse: Point | null = null;
  let rulerDrag: { from: 'h' | 'v' | 'origin'; at: Point | null } | null = null;
  let w = 0;
  let h = 0;
  let dpr = 1;
  let vp = $state.raw<Viewport>({ x: 0, y: 0, zoom: 1 });
  let fitted = false;
  let queued = false;
  let inGesture = false;
  let gestureTimer: ReturnType<typeof setTimeout> | undefined;
  let pan: { sx: number; sy: number; vp: Viewport } | null = null;
  let panning = $state(false);
  // Zeiger, den das Werkzeug an dieser Stelle will (z. B. Größenpfeil am Griff); '' = Klasse des Werkzeugs.
  let hover = $state('');
  // Hand, Zoom und Werkzeuge mit noSnap fangen nicht; die Seite kommt frisch an den Renderer (ein Bild kann noch ausstehen).
  const snapper = new Snapper(
    () => {
      renderer.setPage(page());
      return { items: renderer.scene, guides: show.guides ? guidesOf(doc(), pi()) : [], grid: gridOf(doc()), origin: originOf(doc()) };
    },
    () => (snap.off || cursor === 'hand' || cursor === 'zoom' || tool().noSnap ? null : snap),
  );

  export const viewport = () => vp;
  export const size = (): readonly [number, number] => [w, h];

  /** Ansicht scharf setzen (Menü, Tasten). */
  export function setView(v: Viewport) {
    vp = v;
    redraw();
  }

  /** Ansicht während einer Geste: altes Bild verschieben, nach 100 ms Ruhe scharf neu (architecture.md §6). */
  export function view(v: Viewport) {
    vp = v;
    if (!inGesture) {
      renderer.snapshot(canvas);
      inGesture = true;
    }
    clearTimeout(gestureTimer);
    gestureTimer = setTimeout(() => {
      inGesture = false;
      redraw();
    }, 100);
    redraw();
  }

  export const fit = () => setView(fitPage(page().width, page().height, w, h));

  export function redraw() {
    if (queued || !ctx) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      onframe();
      if (inGesture) renderer.drawGesture(ctx, vp, w, h, dpr);
      else {
        renderer.draw(ctx, vp, w, h, dpr, () => show.grid && drawGrid(ctx, vp, dpr, w, h, doc()), show.wire);
        if (show.guides) drawGuides(ctx, vp, dpr, w, h, guidesOf(doc(), pi()), guide());
        tool().overlay(ctx, dpr);
        if (snapper.hit) drawSnap(ctx, vp, dpr, snapper.hit, look.font);
        const d = rulerDrag;
        if (d?.at) {
          const [x, y] = pageAt(d.at);
          if (d.from === 'origin') drawCrosshair(ctx, dpr, w, h, d.at.x, d.at.y);
          else drawGuides(ctx, vp, dpr, w, h, [{ id: '', axis: d.from, pos: d.from === 'h' ? y : x }], '');
        }
      }
      drawRulers();
    });
  }

  let rulersQueued = false;
  function queueRulers() {
    if (rulersQueued || !show.rulers) return;
    rulersQueued = true;
    requestAnimationFrame(() => ((rulersQueued = false), drawRulers()));
  }

  function drawRulers() {
    if (!show.rulers || !look) return;
    drawRuler(top.getContext('2d')!, dpr, 'x', w, vp, doc(), mouse, look);
    drawRuler(left.getContext('2d')!, dpr, 'y', h, vp, doc(), mouse, look);
  }

  const pageAt = (p: Point) => screenToPage(vp, p.x, p.y);
  const inside = (p: Point) => p.x >= 0 && p.y >= 0 && p.x <= w && p.y <= h;

  // Lineal und Ecke fangen den Zeiger; gerechnet wird relativ zur Fläche.
  function rulerDown(e: PointerEvent, from: 'h' | 'v' | 'origin') {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    rulerDrag = { from, at: null };
  }

  /** Palettenfarbe losgelassen (7c), Fensterkoordinaten: true = über der Zeichenfläche und vom Werkzeug verbraucht. */
  export function drop(c: Color, cx: number, cy: number): boolean {
    const r = canvas.getBoundingClientRect();
    const [sx, sy] = [cx - r.left, cy - r.top];
    if (!inside({ x: sx, y: sy })) return false;
    const [x, y] = screenToPage(vp, sx, sy);
    let used = false;
    guard(() => (used = !!tool().drop?.({ sx, sy, x, y, shift: false, alt: false }, c)));
    redraw();
    return used;
  }

  function rulerMove(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (!rulerDrag) return;
    rulerDrag.at = inside(p) ? p : null;
    mouse = rulerDrag.at;
    oncursor(mouse && pageAt(mouse));
    redraw();
  }

  function rulerUp() {
    const d = rulerDrag;
    rulerDrag = null;
    redraw();
    if (!d?.at) return;
    const [x, y] = pageAt(d.at);
    if (d.from === 'origin') return oncommand({ name: 'origin', at: { x, y } });
    if (!show.guides) oncommand({ name: 'show', what: 'guides' });
    oncommand({ name: 'addGuide', axis: d.from, pos: d.from === 'h' ? y : x });
  }

  function resize() {
    dpr = devicePixelRatio;
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    [top.width, top.height, left.width, left.height] = [canvas.width, Math.round(RULER * dpr), Math.round(RULER * dpr), canvas.height];
    // Einpassen erst, wenn die Fläche eine Größe hat (verstecktes Fenster startet mit 0 px).
    if (!fitted && w && h) {
      vp = fitPage(page().width, page().height, w, h);
      fitted = true;
    }
    redraw();
  }

  /** Zeiger fürs Werkzeug, x/y gefangen (Doppelklick roh). */
  function pointer(e: MouseEvent, snapped = true): Pointer {
    const [x, y] = screenToPage(vp, e.offsetX, e.offsetY);
    const pen = (e as PointerEvent).pointerType === 'pen';
    const p = { sx: e.offsetX, sy: e.offsetY, x, y, shift: e.shiftKey, alt: e.altKey, mod: isMac ? e.metaKey : e.ctrlKey, pressure: pen ? (e as PointerEvent).pressure : undefined };
    return snapped ? snapper.at(p, vp.zoom) : p;
  }
  const hitKey = () => (snapper.hit ? `${snapper.hit.x},${snapper.hit.y},${snapper.hit.kind}` : '');

  let menuAt = $state<{ x: number; y: number } | null>(null);
  let menuItems = $state.raw<MenuItem[]>([]);
  let stamped = false; // dieser Rechtsklick hat eine Kopie abgelegt → kein Menü

  /** Rechtsklick beim Ziehen (wie Vorbild): Kopie ablegen statt verschieben. */
  function stamp() {
    guard(() => tool().stamp?.() && ((stamped = true), redraw()));
  }

  /** Rechtsklick (Mac auch Ctrl-Klick): Objekt darunter wählen, dann dessen Menü; nicht beim Ziehen mit links. */
  function onContext(e: MouseEvent) {
    e.preventDefault();
    const skip = stamped || (e.buttons & 1) !== 0 || pan !== null;
    stamped = false;
    if (skip) return;
    guard(() => {
      // eigenes Menü des Werkzeugs an dieser Stelle (Knoten-Werkzeug auf Knoten/Segment) vor dem Objektmenü
      const own = tool().menu?.(pointer(e, false));
      if (own) {
        menuItems = own.map((it) => it && { label: it.label, disabled: it.disabled, checked: it.checked, run: () => guard(it.run) });
        menuAt = { x: e.clientX, y: e.clientY };
        return;
      }
      const hit = renderer.hitTest(vp, e.offsetX, e.offsetY);
      const next = selectForMenu(sel.selected, hit);
      if (next !== sel.selected) (sel.selected = next), redraw();
      menuItems = canvasMenu(!!hit, enabled).map((it) => it && { label: tr(it.label), disabled: it.disabled, run: () => oncommand(it.cmd) });
      menuAt = { x: e.clientX, y: e.clientY };
    });
  }

  // Mittlere Taste schiebt die Ansicht mit jedem Werkzeug.
  function onDown(e: PointerEvent) {
    // Klick neben das offene Menü schließt nur das Menü.
    if (menuAt) return void (menuAt = null);
    if (isMac && e.ctrlKey && e.button === 0) return; // Ctrl-Klick = Rechtsklick, das Menü kommt per contextmenu
    if (e.button === 0) stamped = false;
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 1) {
      pan = { sx: e.offsetX, sy: e.offsetY, vp };
      panning = true;
      return;
    }
    if (e.button === 2) return stamp();
    if (e.button !== 0) return;
    const p = pointer(e);
    guard(() => {
      tool().down(p);
      snapper.freeze(tool().snapSkip?.());
    });
  }

  function onMove(e: PointerEvent) {
    const before = hitKey();
    const p = pointer(e);
    oncursor([p.x, p.y]);
    mouse = { x: p.sx, y: p.sy };
    queueRulers();
    if (pan) {
      view({ ...pan.vp, x: pan.vp.x + e.offsetX - pan.sx, y: pan.vp.y + e.offsetY - pan.sy });
      return;
    }
    if (tool().move(p) || hitKey() !== before) redraw();
    // Rechte Taste zur linken gedrückt meldet Pointer Events als pointermove (button 2).
    if (e.button === 2) stamp();
    hover = tool().cursor?.(p) ?? '';
  }

  function onUp(e: PointerEvent) {
    if (pan) {
      pan = null;
      panning = false;
    } else {
      const p = pointer(e);
      snapper.release();
      guard(() => tool().up(p), true);
    }
  }

  const wheel = wheelHandler();
  const pinch = pinchSteps();
  let pinching = false;

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (pinching && e.ctrlKey) return; // WebKit könnte Kneifen zusätzlich als Strg+Rad melden
    const a = wheel(e, e.timeStamp);
    if ('zoom' in a) view(zoomAt(vp, e.offsetX, e.offsetY, a.zoom));
    else view({ ...vp, x: vp.x - a.dx, y: vp.y - a.dy });
  }

  // Kneifen auf dem Mac-Trackpad: WebKit meldet gesture*-Ereignisse (nicht Strg+Rad wie Chromium).
  type Gesture = Event & { scale: number; clientX: number; clientY: number };
  function onGesture(e: Event) {
    e.preventDefault();
    const g = e as Gesture;
    if (e.type === 'gesturestart') ((pinching = true), pinch.start());
    else if (e.type === 'gestureend') pinching = false;
    else {
      const r = canvas.getBoundingClientRect();
      view(zoomAt(vp, g.clientX - r.left, g.clientY - r.top, pinch.step(g.scale)));
    }
  }

  onMount(() => {
    ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const css = getComputedStyle(canvas);
    const v = (name: string) => css.getPropertyValue(name).trim();
    look = { bg: v('--bar'), page: v('--control'), tick: v('--text-dim'), text: v('--text'), font: v('--font') };
    resize();
    canvas.addEventListener('wheel', onWheel, { passive: false });
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) canvas.addEventListener(t, onGesture);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  });
</script>

<div class="stage" class:rulers={show.rulers}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="corner"
    data-tip={tr('Nullpunkt: ziehen setzt, Doppelklick setzt zurück')}
    data-tip-side="right"
    onpointerdown={(e) => rulerDown(e, 'origin')}
    onpointermove={rulerMove}
    onpointerup={rulerUp}
    ondblclick={() => oncommand({ name: 'origin', at: null })}
  >
    <Icon name="origin" size={14} />
  </div>
  <!-- Lineale: Ziehen = Hilfslinie, Doppelklick = Dokumentoptionen (Raster). -->
  <canvas
    class="top"
    bind:this={top}
    onpointerdown={(e) => rulerDown(e, 'h')}
    onpointermove={rulerMove}
    onpointerup={rulerUp}
    ondblclick={() => oncommand({ name: 'docOptions' })}
  ></canvas>
  <canvas
    class="left"
    bind:this={left}
    onpointerdown={(e) => rulerDown(e, 'v')}
    onpointermove={rulerMove}
    onpointerup={rulerUp}
    ondblclick={() => oncommand({ name: 'docOptions' })}
  ></canvas>
  <canvas
    bind:this={canvas}
    class="main {panning ? 'hand' : cursor}"
    style:cursor={panning ? null : hover || null}
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointerleave={() => ((mouse = null), (snapper.hit = null), oncursor(null), queueRulers(), redraw())}
    ondblclick={(e) => guard(() => tool().dblclick?.(pointer(e, false)))}
    oncontextmenu={onContext}
  ></canvas>
</div>
<ContextMenu bind:at={menuAt} items={menuItems} />

<style>
  .stage {
    display: grid;
    grid-template: 'main' minmax(0, 1fr) / minmax(0, 1fr);
    width: 100%;
    height: 100%;
  }
  .stage.rulers {
    grid-template:
      'corner top' 20px
      'left main' minmax(0, 1fr)
      / 20px minmax(0, 1fr);
  }
  .stage:not(.rulers) > :not(.main) {
    display: none;
  }
  .corner {
    grid-area: corner;
    display: grid;
    place-items: center;
    color: var(--text-dim);
    background: var(--bar);
    border-right: 1px solid var(--text-dim);
    border-bottom: 1px solid var(--text-dim);
    box-sizing: border-box;
    cursor: crosshair;
  }
  .corner:hover {
    color: var(--text-strong);
  }
  .top {
    grid-area: top;
  }
  .left {
    grid-area: left;
  }
  canvas {
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
  }
  .main {
    grid-area: main;
  }
  .draw {
    cursor: crosshair;
  }
  /* Eigener Pipetten-Zeiger aus dem Werkzeug-Symbol, Spitze = Hotspot; weißer Rand für dunkle Flächen. */
  .pick {
    cursor:
      url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20' fill='none' stroke-linecap='round' stroke-linejoin='round'><g stroke='white' stroke-width='3'><path d='M4 16l1-3 6.5-6.5 2 2L7 15z M10.25 5.25l4.5 4.5 M12.5 7.5l2.25-2.25a1.6 1.6 0 0 0-2.25-2.25L10.25 5.25'/></g><g stroke='%23151515' stroke-width='1.3'><path d='M4 16l1-3 6.5-6.5 2 2L7 15z M10.25 5.25l4.5 4.5 M12.5 7.5l2.25-2.25a1.6 1.6 0 0 0-2.25-2.25L10.25 5.25'/></g></svg>")
        4 16,
      crosshair;
  }
  .hand {
    cursor: grab;
  }
  .hand:active {
    cursor: grabbing;
  }
  .zoom {
    cursor: zoom-in;
  }
</style>
