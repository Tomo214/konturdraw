import { describe, expect, it } from 'vitest';
import { align, distribute, measure, mirror, nodeBounds, setField } from '../../src/model/arrange';
import { addNodes, createDocument, findNode } from '../../src/model/document';
import { multiply, rotate, scale, translate, type Box } from '../../src/model/geometry';
import type { Doc, Node, PathNode } from '../../src/model/types';
import { group, pt, square, sub } from './fixtures';

// A4 hochkant, Ursprung oben links, y nach unten (wie das Modell).
function docWith(...nodes: Node[]): Doc {
  const doc = createDocument();
  return addNodes(doc, doc.pages[0].layers[0].id, nodes);
}

const rectAt = (id: string, x: number, y: number, w: number, h: number): PathNode => ({
  type: 'path',
  id,
  transform: translate(x, y),
  style: { fill: null, stroke: null },
  subpaths: [sub(true, pt(0, 0), pt(w, 0), pt(w, h), pt(0, h))],
});

const boxOf = (doc: Doc, id: string) => nodeBounds(findNode(doc, id)!)!;

function expectBox(b: Box, minX: number, minY: number, maxX: number, maxY: number) {
  expect(b.minX).toBeCloseTo(minX, 9);
  expect(b.minY).toBeCloseTo(minY, 9);
  expect(b.maxX).toBeCloseTo(maxX, 9);
  expect(b.maxY).toBeCloseTo(maxY, 9);
}

describe('Maße der Auswahl', () => {
  it('Box eines Objekts in Seitenkoordinaten, Gruppen samt Gruppenmatrix', () => {
    expectBox(nodeBounds(square('a', 5, 7))!, 5, 7, 15, 17);
    expectBox(nodeBounds(group('g', [square('a', 0, 0), square('b', 20, 5)], 100, 50))!, 100, 50, 130, 65);
  });

  it('ein Objekt: Box, Skalierung und Winkel aus seiner Matrix', () => {
    const turned = { ...square('a'), transform: multiply(translate(50, 50), multiply(rotate(-Math.PI / 2), scale(2, 3))) };
    const m = measure(docWith(turned), ['a'])!;
    expect(m.scale[0]).toBeCloseTo(200, 9);
    expect(m.scale[1]).toBeCloseTo(300, 9);
    // Gegen den Uhrzeigersinn positiv, wie im Vorbild.
    expect(m.angle).toBeCloseTo(90, 9);
  });

  it('mehrere Objekte: gemeinsame Box, Skalierung 100 %, Winkel 0', () => {
    const m = measure(docWith(square('a', 0, 0), square('b', 30, 20)), ['a', 'b'])!;
    expectBox(m.box, 0, 0, 40, 30);
    expect(m.scale).toEqual([100, 100]);
    expect(m.angle).toBe(0);
  });

  it('nichts gewählt → null', () => {
    expect(measure(docWith(square('a')), [])).toBeNull();
  });
});

describe('Maßfelder (X/Y = Mitte, B/H, %, Winkel)', () => {
  const doc = docWith(rectAt('a', 10, 20, 40, 10), rectAt('b', 100, 100, 20, 20));

  it('X und Y setzen die Mitte mm-genau', () => {
    const r = setField(doc, ['a'], 'x', 105, false)!;
    expectBox(boxOf(r, 'a'), 85, 20, 125, 30);
    expectBox(boxOf(setField(r, ['a'], 'y', 148.5, false)!, 'a'), 85, 143.5, 125, 153.5);
  });

  it('Breite um die Mitte, ohne Schloss bleibt die Höhe', () => {
    expectBox(boxOf(setField(doc, ['a'], 'w', 20, false)!, 'a'), 20, 20, 40, 30);
  });

  it('mit Schloss ändert sich die Höhe im gleichen Verhältnis', () => {
    expectBox(boxOf(setField(doc, ['a'], 'w', 20, true)!, 'a'), 20, 22.5, 40, 27.5);
    expectBox(boxOf(setField(doc, ['a'], 'h', 20, true)!, 'a'), -10, 15, 70, 35);
  });

  it('mehrere Objekte: Maße gelten für die gemeinsame Box', () => {
    const r = setField(doc, ['a', 'b'], 'w', 55, false)!;
    // Box 10…120 → Breite 110 auf 55 um Mitte 65: Faktor 0,5.
    expectBox(boxOf(r, 'a'), 37.5, 20, 57.5, 30);
    expectBox(boxOf(r, 'b'), 82.5, 100, 92.5, 120);
  });

  it('Linie ohne Höhe: Höhe setzen geht nicht', () => {
    const line: Node = { ...rectAt('l', 0, 50, 10, 0), subpaths: [sub(false, pt(0, 0), pt(10, 0))] };
    expect(setField(docWith(line), ['l'], 'h', 5, false)).toBeNull();
  });

  it('Skalierung eines Objekts ist kumulativ: 100 % stellt die Originalgröße her', () => {
    const big = { ...square('a'), transform: multiply(translate(10, 10), scale(2, 2)) };
    const r = setField(docWith(big), ['a'], 'sx', 100, false)!;
    expectBox(boxOf(r, 'a'), 15, 10, 25, 30);
    expect(measure(r, ['a'])!.scale[0]).toBeCloseTo(100, 9);
  });

  it('Skalierung mehrerer Objekte ist relativ zur Mitte, Schloss gilt für beide Achsen', () => {
    const r = setField(doc, ['a', 'b'], 'sx', 50, true)!;
    expectBox(boxOf(r, 'b'), 82.5, 85, 92.5, 95);
  });

  it('Winkel dreht um die Mitte, gegen den Uhrzeigersinn; gleicher Wert ändert nichts', () => {
    const r = setField(doc, ['a'], 'angle', 90, false)!;
    expectBox(boxOf(r, 'a'), 25, 5, 35, 45);
    expect(measure(r, ['a'])!.angle).toBeCloseTo(90, 9);
    // Eine Ecke zeigt, ob es gegen den Uhrzeigersinn ging: (0,0) lokal → links unten auf der Seite.
    const m = findNode(r, 'a')!.transform;
    expect(m[4]).toBeCloseTo(25, 9);
    expect(m[5]).toBeCloseTo(45, 9);
    // Kein leerer Rückgängig-Schritt.
    expect(setField(r, ['a'], 'angle', 90, false)).toBeNull();
    expect(setField(r, ['a'], 'x', 30, false)).toBeNull();
  });
});

describe('Neigen (relativ, Grad gegen den Uhrzeigersinn wie Drehen)', () => {
  const doc = docWith(rectAt('a', 10, 10, 20, 10)); // Mitte (20, 15)

  it('waagerecht: Oberkante nach links, Unterkante nach rechts, Mitte bleibt', () => {
    const r = setField(doc, ['a'], 'skewH', 45, false)!;
    expectBox(boxOf(r, 'a'), 5, 10, 35, 20);
    const m = findNode(r, 'a')!.transform; // lokal (0,0) = links oben
    expect([m[4], m[5]].map((v) => +v.toFixed(9))).toEqual([5, 10]);
  });

  it('senkrecht: rechte Kante nach oben, linke nach unten', () => {
    const r = setField(doc, ['a'], 'skewV', 45, false)!;
    expectBox(boxOf(r, 'a'), 10, 0, 30, 30);
    const m = findNode(r, 'a')!.transform;
    expect([m[4], m[5]].map((v) => +v.toFixed(9))).toEqual([10, 20]);
  });

  it('0° und ±90° oder mehr: kein Schritt', () => {
    for (const v of [0, 90, -90, 120]) {
      expect(setField(doc, ['a'], 'skewH', v, false)).toBeNull();
      expect(setField(doc, ['a'], 'skewV', v, false)).toBeNull();
    }
  });
});

describe('Spiegeln', () => {
  const tri: Node = { ...rectAt('t', 10, 10, 0, 0), subpaths: [sub(true, pt(0, 0), pt(20, 0), pt(0, 10))] };

  it('waagerecht: links ↔ rechts um die Mitte, Box bleibt', () => {
    const r = mirror(docWith(tri), ['t'], 'h')!;
    expectBox(boxOf(r, 't'), 10, 10, 30, 20);
    const m = findNode(r, 't')!.transform;
    // Lokaler Punkt (0,0) liegt jetzt rechts oben.
    expect(m[0] * 0 + m[2] * 0 + m[4]).toBeCloseTo(30, 9);
    expect(m[5]).toBeCloseTo(10, 9);
  });

  it('senkrecht: oben ↔ unten; zweimal spiegeln = Ausgang', () => {
    const once = mirror(docWith(tri), ['t'], 'v')!;
    expect(findNode(once, 't')!.transform[5]).toBeCloseTo(20, 9);
    const twice = mirror(once, ['t'], 'v')!;
    const m = findNode(twice, 't')!.transform;
    [1, 0, 0, 1, 10, 10].forEach((v, i) => expect(m[i]).toBeCloseTo(v, 9));
  });
});

describe('Ausrichten (Tasten L/R/T/B/C/E/P)', () => {
  // b zuletzt gewählt → Bezug.
  const doc = docWith(rectAt('a', 10, 10, 20, 10), rectAt('b', 50, 40, 40, 30));

  it.each([
    ['left', 50, 10],
    ['right', 70, 10],
    ['centerX', 60, 10],
  ] as const)('%s: am zuletzt gewählten Objekt, Bezug bleibt stehen', (edge, x, y) => {
    const r = align(doc, ['a', 'b'], edge)!;
    expectBox(boxOf(r, 'a'), x, y, x + 20, y + 10);
    expectBox(boxOf(r, 'b'), 50, 40, 90, 70);
  });

  it.each([
    ['top', 40],
    ['bottom', 60],
    ['centerY', 50],
  ] as const)('%s: senkrecht am Bezug', (edge, y) => {
    expectBox(boxOf(align(doc, ['a', 'b'], edge)!, 'a'), 10, y, 30, y + 10);
  });

  it('ein Objekt richtet sich an der Seite aus', () => {
    expectBox(boxOf(align(doc, ['a'], 'right')!, 'a'), 190, 10, 210, 20);
    expectBox(boxOf(align(doc, ['a'], 'bottom')!, 'a'), 10, 287, 30, 297);
  });

  it('Bezug Seitenrand bzw. Seitenmitte gilt für alle Objekte', () => {
    const r = align(doc, ['a', 'b'], 'left', 'page')!;
    expect(boxOf(r, 'a').minX).toBeCloseTo(0, 9);
    expect(boxOf(r, 'b').minX).toBeCloseTo(0, 9);
    const c = align(doc, ['a', 'b'], 'left', 'pageCenter')!;
    expect(boxOf(c, 'a').minX).toBeCloseTo(105, 9);
  });

  it('P: jedes Objekt auf die Seitenmitte', () => {
    const r = align(doc, ['a', 'b'], 'page')!;
    expectBox(boxOf(r, 'a'), 95, 143.5, 115, 153.5);
    expectBox(boxOf(r, 'b'), 85, 133.5, 125, 163.5);
  });

  it('nichts gewählt → null', () => {
    expect(align(doc, [], 'left')).toBeNull();
  });
});

describe('Verteilen', () => {
  const doc = docWith(rectAt('a', 0, 0, 10, 10), rectAt('b', 10, 30, 20, 10), rectAt('c', 50, 60, 10, 10));
  const left = (r: Doc, id: string) => boxOf(r, id).minX;

  it('linke Kanten gleichmäßig zwischen äußerstem links und rechts', () => {
    const r = distribute(doc, ['a', 'b', 'c'], 'left')!;
    expect([left(r, 'a'), left(r, 'b'), left(r, 'c')].map((v) => +v.toFixed(9))).toEqual([0, 25, 50]);
  });

  it('Mitten und rechte Kanten', () => {
    const m = distribute(doc, ['a', 'b', 'c'], 'centerX')!;
    // Mitten 5, 20, 55 → 5, 30, 55.
    expect(left(m, 'b')).toBeCloseTo(20, 9);
    const r = distribute(doc, ['a', 'b', 'c'], 'right')!;
    // Rechte Kanten 10, 30, 60 → 10, 35, 60.
    expect(boxOf(r, 'b').maxX).toBeCloseTo(35, 9);
  });

  it('Abstände waagerecht gleich groß, äußere Objekte bleiben', () => {
    // Bereich 0…60, Breiten 40 → zwei Lücken je 10.
    const r = distribute(doc, ['c', 'a', 'b'], 'spacingX')!;
    expect([left(r, 'a'), left(r, 'b'), left(r, 'c')].map((v) => +v.toFixed(9))).toEqual([0, 20, 50]);
  });

  it('senkrecht: obere Kanten und Abstände', () => {
    // Obere Kanten 0, 30, 60 sind schon gleichmäßig → kein Schritt.
    expect(distribute(doc, ['a', 'b', 'c'], 'top')).toBeNull();
    const v = docWith(rectAt('a', 0, 0, 10, 10), rectAt('b', 0, 12, 10, 20), rectAt('c', 0, 60, 10, 10));
    expect(boxOf(distribute(v, ['a', 'b', 'c'], 'top')!, 'b').minY).toBeCloseTo(30, 9);
    // Bereich 0…70, Höhen 40 → Lücken je 15.
    expect(boxOf(distribute(v, ['a', 'b', 'c'], 'spacingY')!, 'b').minY).toBeCloseTo(25, 9);
  });

  it('auf die Seite: erstes an den Anfang, letztes an das Ende', () => {
    const r = distribute(doc, ['a', 'c'], 'left', 'page')!;
    expect(left(r, 'a')).toBeCloseTo(0, 9);
    expect(boxOf(r, 'c').maxX).toBeCloseTo(210, 9);
    const s = distribute(doc, ['a', 'b', 'c'], 'spacingX', 'page')!;
    // 210 − 40 = 170 → Lücken 85.
    expect(left(s, 'b')).toBeCloseTo(95, 9);
  });

  it('weniger als zwei Objekte → null', () => {
    expect(distribute(doc, ['a'], 'left')).toBeNull();
  });
});
