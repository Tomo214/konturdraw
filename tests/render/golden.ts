// Golden-Render (architecture.md §10, 3c): feste Szene → Pixel-Proben an rechnerisch bekannten Stellen
// + Vergleich mit Referenzbild je Engine. Aufruf über tests/render/run-golden.cjs.
import { ImageStore } from '../../src/io/images';
import { addNodes, createDocument } from '../../src/model/document';
import { translate } from '../../src/model/geometry';
import type { Node } from '../../src/model/types';
import { Renderer } from '../../src/render/renderer';
import { goldenPage, PROBES } from './golden-scene';

const MM = 4; // Pixel je mm
const canvas = document.getElementById('c') as HTMLCanvasElement;
const [w, h] = [canvas.clientWidth, canvas.clientHeight];
canvas.width = w;
canvas.height = h;
const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;

const renderer = new Renderer();
renderer.setPage(goldenPage());
renderer.draw(ctx, { x: 0, y: 0, zoom: MM }, w, h, 1);

const probes = PROBES.map(([name, x, y, want, tol]) => {
  const got = [...ctx.getImageData(Math.floor(x * MM), Math.floor(y * MM), 1, 1).data.slice(0, 3)];
  return { name, ok: got.every((v, i) => Math.abs(v - want[i]) <= tol), got, want };
});

// Bild wie im kw-core-Export-Test (export.rs image_scene): 8×1 px links rot/rechts blau auf 20 × 10 mm, um 5 mm verschoben.
async function imageProbes() {
  const src = document.createElement('canvas');
  [src.width, src.height] = [8, 1];
  const sctx = src.getContext('2d') as CanvasRenderingContext2D;
  sctx.fillStyle = '#f00';
  sctx.fillRect(0, 0, 4, 1);
  sctx.fillStyle = '#00f';
  sctx.fillRect(4, 0, 4, 1);
  const store = new ImageStore();
  store.add({ bild: src.toDataURL('image/png').split(',')[1] });
  await new Promise<void>((done) => {
    store.onReady = done;
    store.bitmap('bild');
  });
  const doc = createDocument(30, 10);
  const img: Node = { type: 'image', id: 'i', transform: translate(5, 0), image: 'bild', width: 20, height: 10 };
  const c = document.createElement('canvas');
  [c.width, c.height] = [300, 100];
  const ictx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  const r = new Renderer(store);
  r.setPage(addNodes(doc, doc.pages[0].layers[0].id, [img]).pages[0]);
  r.draw(ictx, { x: 0, y: 0, zoom: 10 }, 300, 100, 1);
  const want: [string, number, number, number[]][] = [['Bild: links frei', 2, 5, [255, 255, 255]], ['Bild: rot', 9, 5, [255, 0, 0]], ['Bild: blau', 21, 5, [0, 0, 255]]];
  return want.map(([name, x, y, rgb]) => {
    const got = [...ictx.getImageData(x * 10, y * 10, 1, 1).data.slice(0, 3)];
    return { name, ok: got.every((v, i) => Math.abs(v - rgb[i]) <= 2), got, want: rgb };
  });
}

/** Pixel mit Kanalabweichung > 16 gegenüber dem Referenzbild. */
async function compare(url: string) {
  const img = new Image();
  img.src = url;
  await img.decode();
  if (img.width !== w || img.height !== h) return { sizeOk: false, diffPixels: w * h, total: w * h, maxDelta: 255 };
  const ref = document.createElement('canvas');
  [ref.width, ref.height] = [w, h];
  const rctx = ref.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  rctx.drawImage(img, 0, 0);
  const a = ctx.getImageData(0, 0, w, h).data;
  const b = rctx.getImageData(0, 0, w, h).data;
  let diffPixels = 0;
  let maxDelta = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    if (d > 16) diffPixels++;
    maxDelta = Math.max(maxDelta, d);
  }
  return { sizeOk: true, diffPixels, total: w * h, maxDelta };
}

const png = canvas.toDataURL('image/png');
Object.assign(window, { golden: { probes: [...probes, ...(await imageProbes())], png }, compare });
