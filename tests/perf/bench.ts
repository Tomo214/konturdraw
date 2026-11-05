// Leistungs-Gate, architecture.md §6: 10 000 Objekte → Pan/Zoom p95-Frame < 18 ms, Klick < 50 ms, Öffnen < 2 s.
// Aufruf: Vite-Dev-Server, /tests/perf/bench.html[?n=10000]. Ergebnis → tests/perf/results/ (bench-sink).
import { translate } from '../../src/model/geometry';
import { addNodes } from '../../src/model/document';
import type { Doc, PathNode } from '../../src/model/types';
import { Renderer } from '../../src/render/renderer';
import { fitPage, zoomAt, type Viewport } from '../../src/render/viewport';
import { drawSelectionBox } from '../../src/ui/overlay';
import { randomDoc } from './random-doc';

const params = new URLSearchParams(location.search);
const N = Number(params.get('n') ?? 10000);
const out = document.getElementById('out') as HTMLElement;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
const dpr = devicePixelRatio;
const [w, h] = [canvas.clientWidth, canvas.clientHeight];
canvas.width = Math.round(w * dpr);
canvas.height = Math.round(h * dpr);

const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
const round = (v: number) => Math.round(v * 100) / 100;
function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number) => round(s[Math.min(s.length - 1, Math.floor(p * s.length))]);
  return { p50: at(0.5), p95: at(0.95), max: round(s[s.length - 1]) };
}

// Bekanntes Objekt ganz oben: 20-mm-Quadrat um die Seitenmitte (Treffer-Gegenprobe).
const probe: PathNode = {
  type: 'path',
  id: 'probe',
  transform: translate(290, 290),
  style: { fill: { model: 'rgb', values: [0, 0, 0] }, stroke: null },
  subpaths: [{ closed: true, nodes: [[0, 0], [20, 0], [20, 20], [0, 20]].map(([x, y]) => ({ x, y, type: 'corner' as const })) }],
};

async function run() {
  let doc = randomDoc(N);
  doc = addNodes(doc, doc.pages[0].layers[1].id, [probe]);
  const file = JSON.stringify(doc);
  const selected = new Set(['probe']);

  // 1. Öffnen: Datei parsen → Szene + Index → erstes Bild auf dem Schirm.
  const renderer = new Renderer();
  const t0 = performance.now();
  const page = (JSON.parse(file) as Doc).pages[0];
  const tParse = performance.now();
  renderer.setPage(page);
  const tScene = performance.now();
  const fit: Viewport = fitPage(page.width, page.height, w, h);
  // Wie die App: Bild + Auswahlrahmen als Überlagerung.
  const draw = (vp: Viewport) => {
    renderer.draw(ctx, vp, w, h, dpr);
    drawSelectionBox(ctx, vp, dpr, renderer.bounds(selected)!, 'scale');
  };
  draw(fit);
  const tDraw = performance.now();
  await frame();
  await frame();
  const openMs = round(performance.now() - t0);
  const open = { parse: round(tParse - t0), scene: round(tScene - tParse), draw: round(tDraw - tScene), toFrame: round(openMs - (tDraw - t0)) };

  // 2. Pan bei Gesamtansicht (alle Objekte sichtbar = schlimmster Fall), dann Zoom 1× → 8× → 1×.
  const path = (i: number): Viewport =>
    i < 120
      ? { ...fit, x: fit.x + Math.sin(i / 10) * 80, y: fit.y + Math.cos(i / 10) * 40 }
      : zoomAt(fit, w / 2, h / 2, 1 + 3.5 * (1 - Math.cos(((i - 120) / 120) * 2 * Math.PI)));
  async function frames(step: (i: number) => void) {
    const drawMs: number[] = [];
    const frameMs: number[] = [];
    let last = await frame();
    for (let i = 0; i < 240; i++) {
      const a = performance.now();
      step(i);
      drawMs.push(performance.now() - a);
      const t = await frame();
      frameMs.push(t - last);
      last = t;
    }
    // Verpasst = Abstand > 25 ms (1,5 Bildtakte bei 60 Hz). Robust, auch wo der Timer nur ms-genau ist (WebKit).
    const dropped = round((frameMs.filter((t) => t > 25).length / frameMs.length) * 100);
    return { drawMs: stats(drawMs), frameMs: stats(frameMs), droppedPct: dropped };
  }
  // 2a. So arbeitet die App während der Geste: Schnappschuss verschieben/skalieren.
  renderer.snapshot(canvas);
  const gesture = await frames((i) => renderer.drawGesture(ctx, path(i), w, h, dpr));
  // 2b. Zum Vergleich jedes Bild voll neu zeichnen (Gestenende, Objekte ziehen).
  const full = await frames((i) => draw(path(i)));

  // 3. Klick-Auswahl: 200 feste Pseudo-Zufallspunkte, abwechselnd Gesamtansicht und 8×.
  const clickMs: number[] = [];
  const zoomed = zoomAt(fit, w / 2, h / 2, 8);
  let seed = 7;
  const next = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 200; i++) {
    const a = performance.now();
    renderer.hitTest(i % 2 ? fit : zoomed, next() * w, next() * h);
    clickMs.push(performance.now() - a);
  }

  // 4. Gegenprobe: Mitte trifft das Quadrat, weit daneben trifft nichts.
  const probeHit = renderer.hitTest(fit, fit.x + 300 * fit.zoom, fit.y + 300 * fit.zoom)?.topId === 'probe';
  const emptyHit = renderer.hitTest(fit, -500, -500) === null;

  const ua = navigator.userAgent;
  const click = stats(clickMs);
  const result = {
    engine: params.get('tag') ?? (/Chrome\//.test(ua) ? 'chromium' : /AppleWebKit/.test(ua) ? 'webkit' : 'other'),
    ua,
    visibility: document.visibilityState,
    dpr,
    view: [w, h],
    objects: renderer.count,
    openMs,
    open,
    gesture,
    full,
    clickMs: click,
    probeHit,
    emptyHit,
    gate: { frame: gesture.frameMs.p95 < 18 || gesture.droppedPct <= 5, click: click.max < 50, open: openMs < 2000, hits: probeHit && emptyHit },
  };
  out.textContent = JSON.stringify(result, null, 2);
  await fetch('/__bench', { method: 'POST', body: JSON.stringify(result) });
}

run().catch((e) => (out.textContent = `Fehler: ${(e as Error).stack}`));
