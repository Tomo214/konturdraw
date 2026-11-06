import { afterEach, expect, it, vi } from 'vitest';
import { cmyk } from '../../src/model/color';
import { addNodes, createDocument } from '../../src/model/document';
import { Renderer } from '../../src/render/renderer';
import { IDENTITY } from '../../src/model/geometry';
import { createText } from '../../src/model/text';
import { group, pt, square, sub } from '../model/fixtures';

afterEach(() => vi.unstubAllGlobals());

it('Rahmenauswahl liefert von oben nach unten: das unterste Objekt kommt zuletzt und wird Ziel der Formen-Befehle', () => {
  // Renderer legt beim Erzeugen eine Treffer-Fläche an; ohne DOM genügt eine leere.
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
  const doc = createDocument(200, 200);
  const nodes = [square('a', 0, 0), group('g', [square('x', 2, 2), square('y', 4, 4)]), square('c', 8, 8)];
  const r = new Renderer();
  r.setPage(addNodes(doc, doc.pages[0].layers[0].id, nodes).pages[0]);
  expect(r.inside({ minX: -1, minY: -1, maxX: 30, maxY: 30 })).toEqual(['c', 'g', 'a']);
});

it('Berührte Objekte: Box schneidet den Rahmen, je oberstes Objekt einmal (Messer/Radierer ohne Auswahl)', () => {
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
  const doc = createDocument(200, 200);
  const nodes = [square('a', 0, 0), group('g', [square('x', 20, 0), square('y', 24, 0)]), square('c', 50, 50)];
  const r = new Renderer();
  r.setPage(addNodes(doc, doc.pages[0].layers[0].id, nodes).pages[0]);
  expect(r.touching({ minX: 8, minY: 5, maxX: 26, maxY: 6 }).sort()).toEqual(['a', 'g']);
  expect(r.touching({ minX: 100, minY: 100, maxX: 110, maxY: 110 })).toEqual([]);
});

it('Text trifft man auch zwischen den Buchstaben', () => {
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
  const doc = createDocument(200, 200);
  const t = { ...createText('t', IDENTITY), outline: [sub(true, pt(0, 0), pt(2, 0), pt(2, -5)), sub(true, pt(6, 0), pt(8, 0), pt(8, -5))] };
  const r = new Renderer();
  r.setPage(addNodes(doc, doc.pages[0].layers[0].id, [t]).pages[0]);
  const vp = { x: 0, y: 0, zoom: 1 };
  expect(r.hitTest(vp, 4, -1)?.id).toBe('t');
  expect(r.hitTest(vp, 20, -1)).toBeNull();
});

it('CMYK-Füllung kommt über die Anzeigefarben (Profil), nicht als RGB gelesen', () => {
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
  vi.stubGlobal('Path2D', class { moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} });
  const fills: unknown[] = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: () => () => {},
    set: (_, k, v) => (k === 'fillStyle' && fills.push(v), true),
  });
  const doc = createDocument(50, 50);
  const magenta = { ...square('a'), style: { fill: cmyk(0, 1, 0, 0), stroke: null } };
  const r = new Renderer();
  r.setPage(addNodes(doc, doc.pages[0].layers[0].id, [magenta]).pages[0]);
  r.draw(ctx, { x: 0, y: 0, zoom: 1 }, 100, 100, 1);
  expect(fills).toContain('rgb(255 0 255)');
});

it('Drahtmodell: keine Füllung und kein Bildinhalt, nur haarfeine Umrisse – per Differenz schwarz auf der Seite, hell auf der Arbeitsfläche', () => {
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
  vi.stubGlobal('Path2D', class { moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} addPath() {} });
  const calls: string[] = [];
  const set: Record<string, unknown> = {};
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_, k) => (k === 'fill' || k === 'drawImage' ? () => calls.push(k) : k === 'stroke' ? () => calls.push(`stroke:${set.globalCompositeOperation}`) : () => {}),
    set: (_, k, v) => ((set[k as string] = v), true),
  });
  const doc = createDocument(50, 50);
  const img = { type: 'image' as const, id: 'i', transform: IDENTITY, image: 'abc', width: 20, height: 10 };
  const nodes = [square('a'), img];
  const r = new Renderer({ bitmap: () => ({}) as CanvasImageSource });
  r.setPage(addNodes(doc, doc.pages[0].layers[0].id, nodes).pages[0]);
  r.draw(ctx, { x: 0, y: 0, zoom: 4 }, 100, 100, 1);
  expect(calls).toEqual(['fill', 'drawImage']);
  calls.length = 0;
  r.draw(ctx, { x: 0, y: 0, zoom: 4 }, 100, 100, 1, undefined, true);
  expect(calls).toEqual(['stroke:difference', 'stroke:difference']);
  expect(set.lineWidth).toBe(0.25);
  expect(set.strokeStyle).toBe('#fff');
  expect(set.globalCompositeOperation).toBe('source-over');
});

it('Transparenz: Füllung, Kontur und Bild mit der Deckkraft der Kette, danach wieder deckend', () => {
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
  vi.stubGlobal('Path2D', class { moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} addPath() {} });
  const calls: string[] = [];
  const set: Record<string, unknown> = { globalAlpha: 1 };
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_, k) => (k === 'fill' || k === 'stroke' || k === 'drawImage' ? () => calls.push(`${k}@${set.globalAlpha}`) : () => {}),
    set: (_, k, v) => ((set[k as string] = v), true),
  });
  const doc = createDocument(50, 50);
  const black = { model: 'rgb' as const, values: [0, 0, 0] as const };
  const framed = { ...square('a'), style: { fill: black, stroke: { color: black, width: 1, cap: 'butt' as const, join: 'miter' as const } } };
  const img = { type: 'image' as const, id: 'i', transform: IDENTITY, image: 'abc', width: 20, height: 10, opacity: 0.5 };
  const nodes = [{ ...group('g', [framed, img]), opacity: 0.5 }, square('z')];
  const r = new Renderer({ bitmap: () => ({}) as CanvasImageSource });
  r.setPage(addNodes(doc, doc.pages[0].layers[0].id, nodes).pages[0]);
  r.draw(ctx, { x: 0, y: 0, zoom: 4 }, 100, 100, 1);
  expect(calls).toEqual(['fill@0.5', 'stroke@0.5', 'drawImage@0.25', 'fill@1']);
});

it('Kind einer Gruppe gewählt: Box nur um das Kind; nested erkennt die Kind-Auswahl (runde Griffe)', () => {
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
  const doc = createDocument(200, 200);
  const r = new Renderer();
  r.setPage(addNodes(doc, doc.pages[0].layers[0].id, [group('g', [square('x', 20, 0), square('y', 40, 0)])]).pages[0]);
  expect(r.bounds(new Set(['x']))).toEqual({ minX: 20, minY: 0, maxX: 30, maxY: 10 });
  expect(r.bounds(new Set(['g']))).toEqual({ minX: 20, minY: 0, maxX: 50, maxY: 10 });
  expect(r.nested(new Set(['x']))).toBe(true);
  expect(r.nested(new Set(['g']))).toBe(false);
});
