import { afterEach, expect, it, vi } from 'vitest';
import { addNodes, createDocument } from '../../src/model/document';
import { IDENTITY, multiply, rotate, scale, type Mat } from '../../src/model/geometry';
import { makePattern } from '../../src/model/pattern';
import type { Color, Node } from '../../src/model/types';
import { patternTransform, tilePixels } from '../../src/render/pattern';
import { Renderer } from '../../src/render/renderer';
import { square } from '../model/fixtures';

afterEach(() => vi.unstubAllGlobals());

const RED: Color = { model: 'rgb', values: [1, 0, 0] };
const WHITE: Color = { model: 'rgb', values: [1, 1, 1] };
const near = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));

it('Kachelgröße in Gerätepixeln folgt Zoom, nicht Drehung; gedeckelt und mindestens 1 px', () => {
  const p = makePattern('Punkte', RED, WHITE, 5, 0, { x: 0, y: 0 });
  const device = (m: Mat) => multiply(m, p.matrix);
  expect(tilePixels(p, device(scale(4, 4)))).toEqual([20, 20]);
  expect(tilePixels(p, device(multiply(rotate(0.7), scale(4, 4))))).toEqual([20, 20]);
  expect(tilePixels(p, device(scale(1000, 1000)))).toEqual([2048, 2048]);
  expect(tilePixels(p, device(scale(0.01, 0.01)))).toEqual([1, 1]);
  expect(tilePixels({ ...p, width: 2 }, device(scale(4, 4)))).toEqual([40, 20]);
});

it('Mustermatrix bildet Kachelpixel ins Objektsystem ab', () => {
  const p = makePattern('Punkte', RED, WHITE, 5, 30, { x: 2, y: 3 });
  near(patternTransform(p, 20, 10), multiply(p.matrix, scale(1 / 20, 1 / 10)));
});

// Canvas-Attrappe: Haupt- und Kachel-Kontext merken sich Füllfarben, createPattern und Mustermatrix.
function fakeCanvas() {
  const log = { tileFills: [] as unknown[], patterns: [] as { w: number; h: number }[], fills: [] as unknown[], transforms: [] as unknown[] };
  const ctx = (onFill: unknown[]) =>
    new Proxy({} as CanvasRenderingContext2D, {
      get: (_, k) =>
        k === 'createPattern'
          ? (c: { width: number; height: number }) => (log.patterns.push({ w: c.width, h: c.height }), { setTransform: (m: unknown) => log.transforms.push(m) })
          : () => {},
      set: (_, k, v) => (k === 'fillStyle' && onFill.push(v), true),
    });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx(log.tileFills) }) });
  vi.stubGlobal('Path2D', class { moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} addPath() {} });
  return { log, main: ctx(log.fills) };
}

it('Musterfüllung: Kachel in Gerätegröße gezeichnet, wiederholt mit Matrix; gleiche Größe aus dem Speicher', () => {
  const { log, main } = fakeCanvas();
  const p = makePattern('Karo', RED, WHITE, 5, 0, { x: 0, y: 0 });
  const doc = createDocument(50, 50);
  const r = new Renderer();
  r.setPage(addNodes(doc, doc.pages[0].layers[0].id, [{ ...square('a', 0, 0, 20), style: { fill: p, stroke: null } }]).pages[0]);
  r.draw(main, { x: 0, y: 0, zoom: 4 }, 100, 100, 1);
  expect(log.patterns).toEqual([{ w: 20, h: 20 }]);
  expect(log.tileFills).toEqual(expect.arrayContaining(['rgb(255 0 0)', 'rgb(255 255 255)']));
  const [a, b, c, d, e, f] = patternTransform(p, 20, 20);
  expect(log.transforms.at(-1)).toEqual({ a, b, c, d, e, f });
  r.draw(main, { x: 0, y: 0, zoom: 4 }, 100, 100, 1);
  expect(log.patterns).toHaveLength(1);
  r.draw(main, { x: 0, y: 0, zoom: 8 }, 100, 100, 1);
  expect(log.patterns.at(-1)).toEqual({ w: 40, h: 40 });
});

it('Kachel mit noch fehlendem Bild wird nicht gemerkt', () => {
  const { log, main } = fakeCanvas();
  const img: Node = { type: 'image', id: 'i', transform: IDENTITY, image: 'abc', width: 1, height: 1 };
  const fill = { kind: 'pattern' as const, width: 1, height: 1, matrix: [5, 0, 0, 5, 0, 0] as Mat, tile: [img] };
  const doc = createDocument(50, 50);
  const r = new Renderer({ bitmap: () => null });
  r.setPage(addNodes(doc, doc.pages[0].layers[0].id, [{ ...square('a', 0, 0, 20), style: { fill, stroke: null } }]).pages[0]);
  r.draw(main, { x: 0, y: 0, zoom: 4 }, 100, 100, 1);
  r.draw(main, { x: 0, y: 0, zoom: 4 }, 100, 100, 1);
  expect(log.patterns).toHaveLength(2);
});
