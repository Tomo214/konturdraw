// Objekte in Gruppen (5b): Befehle rechnen in Seitenkoordinaten, auch wenn die Gruppe verschoben/skaliert ist.
import { describe, expect, test } from 'vitest';
import { align, measure, mirror, setField } from '../../src/model/arrange';
import { subpathBounds } from '../../src/model/bezier';
import { addNodes, createDocument, duplicateNodes, findNode, transformNodes, translateNodes, worldOf } from '../../src/model/document';
import { about, multiply, rotate, scale, translate, type Box } from '../../src/model/geometry';
import type { Doc, GroupNode } from '../../src/model/types';
import { buildScene } from '../../src/render/scene';
import { editCommand } from '../../src/ui/commands';
import { square } from './fixtures';

// Gruppe g (verschoben um 100/50, doppelt groß) mit a (lokal 0–10) und b (lokal 20–30).
function sample(): Doc {
  const doc = createDocument();
  const g: GroupNode = { type: 'group', id: 'g', transform: multiply(translate(100, 50), scale(2, 2)), children: [square('a'), square('b', 20, 0)] };
  return addNodes(doc, doc.pages[0].layers[0].id, [g]);
}

const box = (doc: Doc, id: string): Box => {
  const it = buildScene(doc.pages[0]).find((i) => i.id === id)!;
  return subpathBounds(it.subpaths, it.world)!;
};
const near = (b: Box, minX: number, minY: number, maxX: number, maxY: number) => {
  for (const [v, w] of [[b.minX, minX], [b.minY, minY], [b.maxX, maxX], [b.maxY, maxY]]) expect(v).toBeCloseTo(w, 6);
};
const kids = (doc: Doc) => (findNode(doc, 'g') as GroupNode).children.map((n) => n.id);

describe('Transformieren in Seitenkoordinaten', () => {
  test('Kind verschieben: 5 mm auf der Seite, nicht 10; bleibt in der Gruppe', () => {
    for (const doc of [translateNodes(sample(), ['a'], 5, 0), transformNodes(sample(), ['a'], translate(5, 0))]) {
      near(box(doc, 'a'), 105, 50, 125, 70);
      near(box(doc, 'b'), 140, 50, 160, 70);
      expect(kids(doc)).toEqual(['a', 'b']);
      expect(findNode(doc, 'g')!.transform).toEqual(findNode(sample(), 'g')!.transform);
    }
  });

  test('Gruppe und Kind zugleich gewählt: Kind bewegt sich nur einmal mit', () => {
    near(box(translateNodes(sample(), ['g', 'a'], 5, 0), 'a'), 105, 50, 125, 70);
  });

  test('worldOf: Lage des Objekts auf der Seite', () => {
    expect(worldOf(sample(), 'b')).toEqual(multiply(multiply(translate(100, 50), scale(2, 2)), translate(20, 0)));
    expect(worldOf(sample(), 'fehlt')).toBeNull();
  });
});

describe('Eigenschaftsleiste, Ausrichten, Spiegeln', () => {
  test('Maße eines Kindes: Box und Skalierung auf der Seite', () => {
    const ms = measure(sample(), ['a'])!;
    near(ms.box, 100, 50, 120, 70);
    expect(ms.scale).toEqual([200, 200]);
    expect(ms.angle).toBe(0);
  });

  test('X-Feld setzt die Mitte des Kindes auf der Seite', () => {
    near(box(setField(sample(), ['a'], 'x', 200, false)!, 'a'), 190, 50, 210, 70);
  });

  // Gedrehte Gruppe: Seiten-x ist dort nicht Gruppen-x – hier fällt Rechnen im falschen System auf.
  const turned = () => transformNodes(sample(), ['g'], rotate(Math.PI / 6));

  test('Kinder links ausrichten am zuletzt gewählten (auch in gedrehter Gruppe)', () => {
    const doc = align(sample(), ['b', 'a'], 'left')!;
    near(box(doc, 'b'), 100, 50, 120, 70);
    near(box(doc, 'a'), 100, 50, 120, 70);
    const before = turned();
    const [a, b] = [box(before, 'a'), box(align(before, ['b', 'a'], 'left')!, 'b')];
    near(b, a.minX, box(before, 'b').minY, a.maxX, box(before, 'b').maxY);
  });

  test('Spiegeln waagerecht auf der Seite, auch in gedrehter Gruppe', () => {
    near(box(mirror(sample(), ['a'], 'h')!, 'a'), 100, 50, 120, 70);
    const before = turned();
    const b = box(before, 'a');
    const flip = about(scale(-1, 1), (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
    const got = worldOf(mirror(before, ['a'], 'h')!, 'a')!;
    multiply(flip, worldOf(before, 'a')!).forEach((v, i) => expect(got[i]).toBeCloseTo(v, 9));
  });
});

describe('Duplizieren, Löschen, Kopieren', () => {
  test('Duplikat bleibt in der Gruppe, Versatz auf der Seite', () => {
    const { doc, ids } = duplicateNodes(sample(), ['a'], 5, 5);
    expect(kids(doc)).toEqual(['a', ids[0], 'b']);
    near(box(doc, ids[0]), 105, 55, 125, 75);
  });

  test('Löschen des letzten Kindes nimmt die leere Gruppe mit', () => {
    const one = editCommand(sample(), ['a'], { name: 'delete' }, [])!.doc!;
    expect(kids(one)).toEqual(['b']);
    const none = editCommand(sample(), ['a', 'b'], { name: 'delete' }, [])!.doc!;
    expect(none.pages[0].layers[0].children).toEqual([]);
  });

  test('Ausschneiden + Einfügen: Kind landet an derselben Stelle auf der Ebene', () => {
    const cut = editCommand(sample(), ['a'], { name: 'cut' }, [])!;
    expect(kids(cut.doc!)).toEqual(['b']);
    const pasted = editCommand(cut.doc!, [], { name: 'paste' }, cut.clipboard!)!;
    near(box(pasted.doc!, [...pasted.selected!][0]), 100, 50, 120, 70);
  });
});
