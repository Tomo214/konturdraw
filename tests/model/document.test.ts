import { describe, expect, test } from 'vitest';
import { apply, multiply, scale, translate } from '../../src/model/geometry';
import {
  activeLayer,
  addLayer,
  addNodes,
  cloneWithNewIds,
  createDocument,
  duplicateNodes,
  findNode,
  groupNodes,
  moveLayer,
  moveNodes,
  removeLayer,
  removeNodes,
  renameNode,
  reorder,
  transformNodes,
  translateNodes,
  ungroupNodes,
  updateLayer,
} from '../../src/model/document';
import type { Doc, Node } from '../../src/model/types';
import { group, square } from './fixtures';

function layerIds(doc: Doc, layer = 0): string[] {
  return doc.pages[0].layers[layer].children.map((n) => n.id);
}

function docWith(...nodes: Node[]): Doc {
  const doc = createDocument();
  return addNodes(doc, doc.pages[0].layers[0].id, nodes);
}

function allIds(node: Node): string[] {
  return node.type === 'group' ? [node.id, ...node.children.flatMap(allIds)] : [node.id];
}

test('neues Dokument: A4, eine Ebene, sichtbar, entsperrt, druckbar', () => {
  const doc = createDocument();
  expect(doc.pages).toHaveLength(1);
  expect([doc.pages[0].width, doc.pages[0].height]).toEqual([210, 297]);
  expect(doc.pages[0].layers).toHaveLength(1);
  expect(doc.pages[0].layers[0]).toMatchObject({ visible: true, locked: false, printable: true });
});

test('addNodes legt Objekte in Reihenfolge oben auf die Ebene', () => {
  const doc = docWith(square('a'), square('b'));
  expect(layerIds(addNodes(doc, doc.pages[0].layers[0].id, [square('c')]))).toEqual(['a', 'b', 'c']);
});

test('addNodes auf unbekannte Ebene wirft einen Fehler', () => {
  expect(() => addNodes(createDocument(), 'gibt-es-nicht', [square('a')])).toThrow();
});

test('removeNodes entfernt auch Objekte in Gruppen', () => {
  const doc = removeNodes(docWith(group('g', [square('a'), square('b')]), square('c')), ['b', 'c']);
  const g = findNode(doc, 'g');
  expect(g?.type === 'group' && g.children.map((n) => n.id)).toEqual(['a']);
  expect(findNode(doc, 'c')).toBeUndefined();
});

test('unberührte Ebenen bleiben dasselbe Objekt (Undo spart Speicher)', () => {
  let doc = docWith(square('a'));
  doc = addLayer(doc, 0, 'Oben');
  const before = doc.pages[0].layers[1];
  const after = removeNodes(doc, ['a']);
  expect(after.pages[0].layers[1]).toBe(before);
});

test('translateNodes verschiebt nur die gewählten Objekte', () => {
  const doc = translateNodes(docWith(square('a', 0, 0), square('b', 0, 0)), ['a'], 5, -2);
  expect(apply(findNode(doc, 'a')!.transform, 0, 0)).toEqual([5, -2]);
  expect(apply(findNode(doc, 'b')!.transform, 0, 0)).toEqual([0, 0]);
});

test('reorder: eins nach vorn / zurück / ganz nach vorn / ganz nach hinten', () => {
  const doc = docWith(square('a'), square('b'), square('c'), square('d'));
  expect(layerIds(reorder(doc, ['b'], 'forward'))).toEqual(['a', 'c', 'b', 'd']);
  expect(layerIds(reorder(doc, ['c', 'd'], 'forward'))).toEqual(['a', 'b', 'c', 'd']);
  expect(layerIds(reorder(doc, ['c'], 'backward'))).toEqual(['a', 'c', 'b', 'd']);
  expect(layerIds(reorder(doc, ['a', 'c'], 'front'))).toEqual(['b', 'd', 'a', 'c']);
  expect(layerIds(reorder(doc, ['b', 'd'], 'back'))).toEqual(['b', 'd', 'a', 'c']);
});

test('groupNodes setzt die Gruppe an die Stelle des obersten Mitglieds', () => {
  const doc = groupNodes(docWith(square('a'), square('b'), square('c'), square('d')), ['b', 'd'], 'g');
  expect(layerIds(doc)).toEqual(['a', 'c', 'g']);
  const g = findNode(doc, 'g');
  expect(g?.type === 'group' && g.children.map((n) => n.id)).toEqual(['b', 'd']);
});

test('groupNodes über verschiedene Container wirft einen Fehler', () => {
  const doc = docWith(group('g', [square('a')]), square('b'));
  expect(() => groupNodes(doc, ['a', 'b'], 'neu')).toThrow();
});

test('ungroupNodes behält die Lage der Kinder auf der Seite', () => {
  const { doc, ids } = ungroupNodes(docWith(square('x'), group('g', [square('a', 5, 0)], 100, 0), square('y')), ['g']);
  expect(layerIds(doc)).toEqual(['x', 'a', 'y']);
  expect(ids).toEqual(['a']);
  expect(apply(findNode(doc, 'a')!.transform, 0, 0)).toEqual([105, 0]);
});

test('ungroupNodes: Transparenz der Gruppe geht in die Kinder über (Aussehen bleibt)', () => {
  const g = { ...group('g', [square('a'), { ...square('b'), opacity: 0.5 }]), opacity: 0.5 };
  const { doc } = ungroupNodes(docWith(g), ['g']);
  expect(findNode(doc, 'a')!.opacity).toBe(0.5);
  expect(findNode(doc, 'b')!.opacity).toBe(0.25);
  expect('opacity' in findNode(ungroupNodes(docWith(group('h', [square('c')])), ['h']).doc, 'c')!).toBe(false);
});

test('duplicateNodes legt versetzte Kopie mit neuen IDs direkt über das Original', () => {
  const { doc, ids } = duplicateNodes(docWith(group('g', [square('a')]), square('b')), ['g'], 3, 3);
  const ids0 = layerIds(doc);
  expect(ids0).toHaveLength(3);
  expect(ids0[0]).toBe('g');
  expect(ids0[1]).toBe(ids[0]);
  const copy = findNode(doc, ids[0])!;
  expect(allIds(copy).some((id) => id === 'g' || id === 'a')).toBe(false);
  expect(apply(copy.transform, 0, 0)).toEqual([3, 3]);
});

test('cloneWithNewIds vergibt überall neue IDs, Struktur bleibt gleich', () => {
  const original = group('g', [square('a'), group('h', [square('b')])]);
  const clone = cloneWithNewIds(original);
  const before = allIds(original);
  const after = allIds(clone);
  expect(after).toHaveLength(before.length);
  expect(after.filter((id) => before.includes(id))).toEqual([]);
});

test('Ebenen: anlegen oben, Flags setzen, umbenennen, verschieben', () => {
  let doc = addLayer(createDocument(), 0, 'Vorlage');
  const [bottom, top] = doc.pages[0].layers;
  expect(top.name).toBe('Vorlage');
  doc = updateLayer(doc, top.id, { name: 'Foto', locked: true, printable: false, visible: false });
  expect(doc.pages[0].layers[1]).toMatchObject({ name: 'Foto', locked: true, printable: false, visible: false });
  doc = moveLayer(doc, top.id, 0);
  expect(doc.pages[0].layers.map((l) => l.id)).toEqual([top.id, bottom.id]);
});

test('transformNodes multipliziert von links (Container-Koordinaten)', () => {
  const doc = transformNodes(docWith(square('a', 5, 0)), ['a'], scale(2, 2));
  expect(findNode(doc, 'a')!.transform).toEqual([2, 0, 0, 2, 10, 0]);
});

test('activeLayer = oberste sichtbare, nicht gesperrte Ebene', () => {
  let doc = addLayer(createDocument(), 0, 'Oben');
  const [bottom, top] = doc.pages[0].layers;
  expect(activeLayer(doc.pages[0])!.id).toBe(top.id);
  doc = updateLayer(doc, top.id, { locked: true });
  expect(activeLayer(doc.pages[0])!.id).toBe(bottom.id);
  doc = updateLayer(doc, bottom.id, { visible: false });
  expect(activeLayer(doc.pages[0])).toBeUndefined();
});

test('activeLayer nimmt die gewählte Ebene, solange sie sichtbar und entsperrt ist', () => {
  let doc = addLayer(createDocument(), 0, 'Oben');
  const [bottom, top] = doc.pages[0].layers;
  expect(activeLayer(doc.pages[0], bottom.id)!.id).toBe(bottom.id);
  doc = updateLayer(doc, bottom.id, { locked: true });
  expect(activeLayer(doc.pages[0], bottom.id)!.id).toBe(top.id);
  expect(activeLayer(doc.pages[0], 'fremd')!.id).toBe(top.id);
});

test('removeLayer löscht Ebene samt Inhalt, die letzte Ebene einer Seite bleibt', () => {
  const one = docWith(square('a'));
  const doc = addLayer(one, 0, 'Oben');
  const [bottom, top] = doc.pages[0].layers;
  const next = removeLayer(doc, bottom.id)!;
  expect(next.pages[0].layers).toEqual([top]);
  expect(findNode(next, 'a')).toBeUndefined();
  expect(removeLayer(next, top.id)).toBeNull();
});

test('renameNode setzt den Namen gekürzt, leer löscht ihn, gleich oder unbekannt ändert nichts', () => {
  const doc = renameNode(docWith(square('a')), 'a', ' Rose ')!;
  expect(findNode(doc, 'a')!.name).toBe('Rose');
  expect(renameNode(doc, 'a', 'Rose')).toBeNull();
  expect(renameNode(doc, 'fehlt', 'X')).toBeNull();
  expect('name' in findNode(renameNode(doc, 'a', '  ')!, 'a')!).toBe(false);
});

describe('moveNodes (Ziehen im Objekt-Manager)', () => {
  const world = (doc: Doc, ...path: string[]) =>
    apply(path.map((id) => findNode(doc, id)!.transform).reduce((m, t) => multiply(m, t)), 0, 0);

  test('sortiert innerhalb der Ebene um: direkt über „above“, null = ganz unten', () => {
    const doc = docWith(square('a'), square('b'), square('c'));
    const layer = doc.pages[0].layers[0].id;
    expect(layerIds(moveNodes(doc, ['a'], layer, 'b')!)).toEqual(['b', 'a', 'c']);
    expect(layerIds(moveNodes(doc, ['c'], layer, null)!)).toEqual(['c', 'a', 'b']);
    expect(layerIds(moveNodes(doc, ['c', 'a'], layer, 'b')!)).toEqual(['b', 'a', 'c']);
  });

  test('nichts zu tun, wenn alles schon dort liegt', () => {
    const doc = docWith(square('a'), square('b'));
    const layer = doc.pages[0].layers[0].id;
    expect(moveNodes(doc, ['b'], layer, 'a')).toBeNull();
    expect(moveNodes(doc, ['a'], layer, null)).toBeNull();
  });

  test('in eine Gruppe hinein: Lage auf der Seite bleibt, auch bei skalierter Gruppe', () => {
    const g = { ...group('g', [square('b')]), transform: multiply(translate(10, 5), scale(2, 2)) };
    const doc = moveNodes(docWith(square('a', 4, 4), g), ['a'], 'g', 'b')!;
    expect(layerIds(doc)).toEqual(['g']);
    const inner = findNode(doc, 'g')!;
    expect(inner.type === 'group' && inner.children.map((n) => n.id)).toEqual(['b', 'a']);
    expect(world(doc, 'g', 'a')).toEqual([4, 4]);
  });

  test('aus einer Gruppe heraus auf eine andere Ebene; leer gewordene Gruppen verschwinden', () => {
    let doc = docWith(group('g', [group('h', [square('b', 1, 1)], 5, 0)], 10, 5));
    doc = addLayer(doc, 0, 'Oben');
    const top = doc.pages[0].layers[1].id;
    const next = moveNodes(doc, ['b'], top, null)!;
    expect(layerIds(next, 0)).toEqual([]);
    expect(layerIds(next, 1)).toEqual(['b']);
    expect(apply(findNode(next, 'b')!.transform, 0, 0)).toEqual([16, 6]);
  });

  test('Gruppe samt Kind gewählt: nur die Gruppe wandert', () => {
    let doc = docWith(group('g', [square('b')]), square('c'));
    const layer = doc.pages[0].layers[0].id;
    doc = moveNodes(doc, ['b', 'g'], layer, 'c')!;
    expect(layerIds(doc)).toEqual(['c', 'g']);
    const g = findNode(doc, 'g')!;
    expect(g.type === 'group' && g.children.map((n) => n.id)).toEqual(['b']);
  });

  test('verweigert Ziele in sich selbst und „above“ aus der Auswahl', () => {
    const doc = docWith(group('g', [group('h', [square('b')])]), square('c'));
    expect(moveNodes(doc, ['g'], 'g', null)).toBeNull();
    expect(moveNodes(doc, ['g'], 'h', 'b')).toBeNull();
    expect(moveNodes(doc, ['c', 'g'], doc.pages[0].layers[0].id, 'g')).toBeNull();
  });
});
