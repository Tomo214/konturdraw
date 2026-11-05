import { IDENTITY, translate } from '../../src/model/geometry';
import { addLayer, addNodes, createDocument } from '../../src/model/document';
import type { Color, Doc, Node, PathNode, PathPoint, Style } from '../../src/model/types';

// Reproduzierbarer Zufall (mulberry32).
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Geschlossene Kurvenform: k Punkte auf einem verbeulten Kreis, glatt verbunden (Catmull-Rom → Bézier).
function blob(rand: () => number, r: number): PathNode['subpaths'] {
  const k = 4 + Math.floor(rand() * 5);
  const pts = Array.from({ length: k }, (_, i) => {
    const a = (i / k) * Math.PI * 2;
    const rr = r * (0.6 + rand() * 0.4);
    return [Math.cos(a) * rr, Math.sin(a) * rr] as const;
  });
  const nodes: PathPoint[] = pts.map(([x, y], i) => {
    const [prev, next] = [pts[(i - 1 + k) % k], pts[(i + 1) % k]];
    const dx = (next[0] - prev[0]) / 6;
    const dy = (next[1] - prev[1]) / 6;
    return { x, y, type: 'symmetric', handleIn: { x: x - dx, y: y - dy }, handleOut: { x: x + dx, y: y + dy } };
  });
  return [{ closed: true, nodes }];
}

const color = (rand: () => number): Color => ({ model: 'rgb', values: [rand(), rand(), rand()] });

function style(rand: () => number): Style {
  const kind = Math.floor(rand() * 3); // 0 Füllung, 1 Kontur, 2 beides
  return {
    fill: kind === 1 ? null : color(rand),
    stroke: kind === 0 ? null : { color: color(rand), width: 0.2 + rand(), cap: 'round', join: 'round' },
  };
}

/** n Objekte auf zwei Ebenen, jedes zehnte Fünferpaket gruppiert. Seite 600 × 600 mm. */
export function randomDoc(n: number, seed = 1): Doc {
  const rand = rng(seed);
  const size = 600;
  const shape = (i: number): PathNode => ({
    type: 'path',
    id: `o${i}`,
    transform: translate(rand() * size, rand() * size),
    style: style(rand),
    subpaths: blob(rand, 1 + rand() * 15),
  });
  const nodes: Node[] = [];
  for (let i = 0; i < n; ) {
    if (nodes.length % 10 === 9 && n - i >= 5) {
      const children = Array.from({ length: 5 }, (_, j) => shape(i + j));
      nodes.push({ type: 'group', id: `g${i}`, transform: IDENTITY, children });
      i += 5;
    } else nodes.push(shape(i++));
  }
  let doc = createDocument(size, size);
  doc = addLayer(doc, 0, 'Ebene 2');
  const [l1, l2] = doc.pages[0].layers;
  const half = Math.ceil(nodes.length / 2);
  doc = addNodes(doc, l1.id, nodes.slice(0, half));
  return addNodes(doc, l2.id, nodes.slice(half));
}
