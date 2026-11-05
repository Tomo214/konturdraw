import { describe, expect, it } from 'vitest';
import { addNodes, createDocument, groupNodes } from '../../src/model/document';
import { IDENTITY } from '../../src/model/geometry';
import { insertPage } from '../../src/model/pages';
import type { Doc, Node } from '../../src/model/types';
import { describeSelection, mm } from '../../src/ui/status';

const shape = (id: string, kind: 'rect' | 'ellipse'): Node => ({
  type: 'shape',
  id,
  transform: IDENTITY,
  style: { fill: null, stroke: null },
  shape: kind === 'rect' ? { kind, x: 0, y: 0, width: 1, height: 1, radius: 0 } : { kind, x: 0, y: 0, width: 1, height: 1 },
});

function doc(...nodes: Node[]): Doc {
  const d = createDocument();
  return addNodes(d, d.pages[0].layers[0].id, nodes);
}

describe('describeSelection', () => {
  it('leer ohne Auswahl', () => {
    expect(describeSelection(doc(shape('a', 'rect')), [])).toBe('');
  });

  it('ein Objekt: Art und Ebene', () => {
    const d = doc(shape('a', 'rect'));
    expect(describeSelection(d, ['a'])).toBe(`Rechteck auf ${d.pages[0].layers[0].name}`);
  });

  it('Gruppe nennt ihre Größe', () => {
    const d = groupNodes(doc(shape('a', 'rect'), shape('b', 'ellipse')), ['a', 'b'], 'g');
    expect(describeSelection(d, ['g'])).toMatch(/^Gruppe aus 2 Objekten auf /);
    // Nach Löschen eines Kindes bleibt eine Gruppe aus einem Objekt.
    expect(describeSelection(groupNodes(doc(shape('a', 'rect')), ['a'], 'g'), ['g'])).toMatch(/^Gruppe aus 1 Objekt auf /);
  });

  it('Kind in einer Gruppe', () => {
    const d = groupNodes(doc(shape('a', 'rect'), shape('b', 'ellipse')), ['a', 'b'], 'g');
    expect(describeSelection(d, ['a'])).toBe(`Rechteck in Gruppe auf ${d.pages[0].layers[0].name}`);
  });

  it('mehrere Objekte: Anzahl', () => {
    expect(describeSelection(doc(shape('a', 'rect'), shape('b', 'ellipse')), ['a', 'b'])).toMatch(/^2 Objekte gewählt auf /);
  });
});

describe('describeSelection auf weiteren Seiten', () => {
  it('nennt die Ebene auch auf Seite 2', () => {
    let d = insertPage(createDocument(), 1, 0);
    d = addNodes(d, d.pages[1].layers[0].id, [shape('z', 'ellipse')]);
    expect(describeSelection(d, ['z'])).toBe(`Ellipse auf ${d.pages[1].layers[0].name}`);
  });
});

describe('mm', () => {
  it('zwei Nachkommastellen mit Komma, Minus als echtes Minus', () => {
    expect(mm(12.346)).toBe('12,35');
    expect(mm(-0.5)).toBe('−0,50');
  });
});
