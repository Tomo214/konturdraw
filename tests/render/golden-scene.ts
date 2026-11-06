// Feste Golden-Szene + Pixel-Proben (architecture.md §10, 3c). Ohne DOM: genutzt vom Browser-Golden (golden.ts),
// von vitest (Vorlage tests/fixtures/golden-scene.json) und darüber von den Export-Tests in kw-core (3g-1).
import { addNodes, createDocument } from '../../src/model/document';
import { IDENTITY, apply, multiply, scale, translate, type Mat } from '../../src/model/geometry';
import { makePattern } from '../../src/model/pattern';
import type { Color, Fill, Node, Page, Shape, ShapeNode, Stroke, Style } from '../../src/model/types';

const rgb = (r: number, g: number, b: number): Color => ({ model: 'rgb', values: [r, g, b] });
const [RED, BLUE, GREEN, PURPLE, BLACK, WHITE] = [rgb(1, 0, 0), rgb(0, 0, 1), rgb(0, 1, 0), rgb(0.5, 0, 0.5), rgb(0, 0, 0), rgb(1, 1, 1)];
const stroke = (width: number, extra: Partial<Stroke> = {}): Stroke => ({ color: BLACK, width, cap: 'butt', join: 'miter', ...extra });
// Muster (8c): Streifen rot oben / blau unten je Zelle, 6 mm, um 30° gedreht, Ursprung an der Objektecke.
const STRIPES = makePattern('Streifen', RED, BLUE, 6, 30, { x: 56, y: 74 });
const cell = (u: number, v: number) => apply(STRIPES.matrix, u, v);

export function goldenPage(): Page {
  let n = 0;
  const shape = (s: Shape, style: Style, transform: Mat = IDENTITY): ShapeNode => ({ type: 'shape', id: `s${n++}`, transform, style, shape: s });
  const fill = (f: Fill): Style => ({ fill: f, stroke: null });
  const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const line = (y: number, cap: Stroke['cap']): Node => ({
    type: 'path',
    id: `l${n++}`,
    transform: IDENTITY,
    style: { fill: null, stroke: stroke(4, { cap }) },
    subpaths: [{ closed: false, nodes: [{ x: 20, y, type: 'corner' }, { x: 60, y, type: 'corner' }] }],
  });
  const stops = (a: Color, b: Color) => [{ offset: 0, color: a }, { offset: 1, color: b }];
  const square = (x: number, y: number) => ({
    closed: true,
    nodes: [[x, y], [x + 20, y], [x + 20, y + 20], [x, y + 20]].map(([x, y]) => ({ x, y, type: 'corner' as const })),
  });

  const nodes: Node[] = [
    shape({ kind: 'rect', ...box(10, 10, 40, 30), radius: 0 }, fill(RED)),
    shape({ kind: 'rect', ...box(60, 10, 40, 30), radius: 10 }, fill(BLUE)),
    shape({ kind: 'ellipse', ...box(110, 10, 60, 30) }, fill(GREEN)),
    shape({ kind: 'polygon', ...box(10, 50, 40, 40), sides: 5, inner: 0.4 }, fill(PURPLE)),
    shape({ kind: 'rect', ...box(60, 50, 100, 20), radius: 0 }, fill({ kind: 'linear', from: { x: 60, y: 60 }, to: { x: 160, y: 60 }, stops: stops(BLACK, WHITE) })),
    shape({ kind: 'ellipse', ...box(165, 45, 30, 30) }, fill({ kind: 'radial', from: { x: 180, y: 60 }, to: { x: 195, y: 60 }, stops: stops(RED, BLUE) })),
    line(110, 'butt'),
    line(125, 'round'),
    // Gestaucht 4:1, Kontur fest 2 mm → muss überall 2 mm breit bleiben.
    shape({ kind: 'rect', ...box(0, 0, 10, 10), radius: 0 }, { fill: null, stroke: stroke(2) }, multiply(translate(80, 100), scale(4, 1))),
    // Doppelt groß, Kontur 1 mm mitskalierend → 2 mm.
    shape({ kind: 'rect', ...box(0, 0, 10, 10), radius: 0 }, { fill: null, stroke: stroke(1, { scaleWithObject: true }) }, multiply(translate(140, 95), scale(2, 2))),
    // Kombiniert: zwei gleichsinnige Quadrate, gerade/ungerade → Überlappung frei (nonzero würde sie füllen).
    {
      type: 'path',
      id: `k${n++}`,
      transform: IDENTITY,
      style: fill(BLUE),
      fillRule: 'evenodd',
      subpaths: [square(166, 85), square(176, 95)],
    },
    // Drei Farbknoten (5c): Grün sitzt bei 25 %, nicht in der Mitte.
    shape({ kind: 'rect', ...box(70, 128, 100, 8), radius: 0 }, fill({ kind: 'linear', from: { x: 70, y: 132 }, to: { x: 170, y: 132 }, stops: [{ offset: 0, color: RED }, { offset: 0.25, color: GREEN }, { offset: 1, color: BLUE }] })),
    // Gestrichelt, Muster × Breite: 2 mm breit → 4 mm Strich, 2 mm Lücke ab x = 20.
    {
      type: 'path',
      id: `d${n++}`,
      transform: IDENTITY,
      style: { fill: null, stroke: stroke(2, { dash: [2, 1] }) },
      subpaths: [{ closed: false, nodes: [{ x: 20, y: 135, type: 'corner' }, { x: 60, y: 135, type: 'corner' }] }],
    },
    // Transparenz (8a): Füllung und Kontur je 50 % → Kontur außen grau, innen dunkler über der Füllung.
    { ...shape({ kind: 'rect', ...box(176, 10, 18, 14), radius: 0 }, { fill: RED, stroke: stroke(2) }), opacity: 0.5 },
    // Gruppe 50 % × Kind 50 % = 25 %.
    { type: 'group', id: `g${n++}`, transform: IDENTITY, opacity: 0.5, children: [{ ...shape({ kind: 'rect', ...box(176, 28, 18, 10), radius: 0 }, fill(BLUE)), opacity: 0.5 }] },
    // Rahmen (8b): Füllung unter, Kontur über dem Inhalt; Inhalt in Rahmen-Koordinaten, am Umriss beschnitten.
    {
      ...shape({ kind: 'rect', ...box(0, 0, 24, 16), radius: 0 }, { fill: GREEN, stroke: stroke(1) }, translate(104, 78)),
      contents: [shape({ kind: 'rect', ...box(-10, 4, 20, 8), radius: 0 }, fill(RED)), shape({ kind: 'ellipse', ...box(16, -6, 16, 16) }, fill(BLUE))],
    },
    shape({ kind: 'rect', ...box(56, 74, 22, 22), radius: 0 }, fill(STRIPES)),
    // Eigene Kachel 10 × 10 (halb so groß aufs Objekt): Ellipse mit Kontur 2 Kachel-Einheiten = 1 mm, Rest frei.
    shape(
      { kind: 'rect', ...box(0, 0, 20, 22), radius: 0 },
      fill({ kind: 'pattern', width: 10, height: 10, matrix: scale(0.5, 0.5), tile: [shape({ kind: 'ellipse', ...box(2, 2, 6, 6) }, { fill: GREEN, stroke: stroke(2) })] }),
      translate(80, 74),
    ),
  ];

  const doc = createDocument(200, 140);
  return addNodes(doc, doc.pages[0].layers[0].id, nodes).pages[0];
}

export type RGB = [number, number, number];
const W: RGB = [255, 255, 255];
const K: RGB = [0, 0, 0];
/** [Name, x mm, y mm, Sollfarbe auf weißem Grund, Toleranz je Kanal] */
export const PROBES: [string, number, number, RGB, number][] = [
  ['Rechteck Vollton', 30, 25, [255, 0, 0], 1],
  ['Rechteck außen', 9, 25, W, 1],
  ['Eckenradius: Ecke frei', 61, 11, W, 1],
  ['Eckenradius: innen', 65, 15, [0, 0, 255], 1],
  ['Ellipse innen', 168, 25, [0, 255, 0], 1],
  ['Ellipse: Box-Ecke frei', 112, 12, W, 1],
  ['Stern Mitte', 30, 70, [128, 0, 128], 1],
  ['Sternspitze', 30, 54, [128, 0, 128], 1],
  ['Stern zwischen Spitzen frei', 37.05, 60.29, W, 1],
  ['Linear 25 %', 85, 60, [64, 64, 64], 5],
  ['Linear 75 %', 135, 60, [191, 191, 191], 5],
  ['Radial Mitte', 180, 60, [255, 0, 0], 3],
  ['Radial halber Radius', 187.5, 60, [128, 0, 127], 5],
  ['Drei Knoten: Grün bei 25 %', 95, 132, [0, 255, 0], 4],
  ['Drei Knoten: Rot→Grün halb', 82.5, 132, [128, 128, 0], 5],
  ['Drei Knoten: Grün→Blau halb', 132.5, 132, [0, 128, 128], 5],
  ['Linie stumpf: hinter Ende frei', 61, 110, W, 1],
  ['Linie rund: hinter Ende Kappe', 61, 125, K, 1],
  ['Linie: Kante innen', 30, 111.5, K, 1],
  ['Linie: Kante außen', 30, 112.5, W, 1],
  ['Gestaucht: linke Kontur', 80.5, 105, K, 1],
  ['Gestaucht: links nicht verbreitert', 81.5, 105, W, 1],
  ['Gestaucht: obere Kontur', 100, 100.5, K, 1],
  ['Gestaucht: oben nicht verbreitert', 100, 101.5, W, 1],
  ['Mitskalierend: Kontur 2 mm', 140.75, 105, K, 1],
  ['Mitskalierend: außerhalb', 141.5, 105, W, 1],
  ['Gerade/ungerade: Teil A', 170, 90, [0, 0, 255], 1],
  ['Gerade/ungerade: Teil B', 192, 111, [0, 0, 255], 1],
  ['Gerade/ungerade: Überlappung frei', 181, 100, W, 1],
  ['Gestrichelt: Strich', 22, 135, K, 1],
  ['Gestrichelt: Lücke', 25, 135, W, 1],
  ['Gestrichelt: nächster Strich', 28, 135, K, 1],
  ['Transparenz: Füllung 50 %', 185, 17, [255, 128, 128], 3],
  ['Transparenz: Kontur außen 50 %', 175.5, 17, [128, 128, 128], 3],
  ['Transparenz: Kontur innen über Füllung', 176.5, 17, [128, 64, 64], 4],
  ['Transparenz: Gruppe × Objekt = 25 %', 185, 33, [191, 191, 255], 3],
  ['Rahmen: Füllung unter Inhalt', 125, 92, [0, 255, 0], 1],
  ['Rahmen: Inhalt innen', 108, 86, [255, 0, 0], 1],
  ['Rahmen: Inhalt links beschnitten', 100, 86, W, 1],
  ['Rahmen: Kontur über Inhalt', 104, 86, K, 1],
  ['Rahmen: Ellipse innen', 126, 84, [0, 0, 255], 1],
  ['Rahmen: Ellipse oben beschnitten', 128, 75, W, 1],
  ['Rahmen: Ellipse rechts beschnitten', 132, 82, W, 1],
  ['Muster: Streifen oben', ...cell(1.5, 1.25), [255, 0, 0], 3],
  ['Muster: Streifen unten', ...cell(1.5, 1.75), [0, 0, 255], 3],
  ['Muster: Wiederholung gedreht', ...cell(2.5, 2.25), [255, 0, 0], 3],
  ['Muster: neben dem Objekt frei', 79, 80, W, 1],
  ['Eigene Kachel: Ellipse', 82.5, 76.5, [0, 255, 0], 3],
  ['Eigene Kachel: nächste Kachel', 87.5, 76.5, [0, 255, 0], 3],
  ['Eigene Kachel: Kontur in Kachel-Einheiten', 84, 76.5, K, 3],
  ['Eigene Kachel: Ecke frei', 85.25, 79.25, W, 1],
];
