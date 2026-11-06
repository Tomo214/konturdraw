import { describe, expect, test } from 'vitest';
import { subpathBounds } from '../../src/model/bezier';
import { addNodes, createDocument, findNode } from '../../src/model/document';
import { apply, multiply, scale, translate, type Mat } from '../../src/model/geometry';
import { PATTERNS, makePattern, patternAngle, patternFromSelection, patternSize, resizePattern } from '../../src/model/pattern';
import { fillSpec, isGradient, isPattern, setFill, type FillSpec } from '../../src/model/style';
import type { Color, Doc, Node, PathNode, Pattern } from '../../src/model/types';
import { group, square } from './fixtures';

const RED: Color = { model: 'rgb', values: [1, 0, 0] };
const WHITE: Color = { model: 'rgb', values: [1, 1, 1] };
const near = (a: Mat, b: Mat) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
const docWith = (...nodes: Node[]): Doc => {
  const doc = createDocument();
  return addNodes(doc, doc.pages[0].layers[0].id, nodes);
};
const fillOf = (doc: Doc, id: string) => (findNode(doc, id) as PathNode).style.fill as Pattern;

describe('Zweifarb-Vorlagen', () => {
  test('eigene Vorlagen: Hintergrund füllt die Zelle, Vordergrund bleibt in ihr', () => {
    expect(PATTERNS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(PATTERNS.map((p) => p.name)).size).toBe(PATTERNS.length);
    for (const preset of PATTERNS) {
      const p = makePattern(preset.name, RED, WHITE, 5, 0, { x: 0, y: 0 });
      expect([p.width, p.height]).toEqual([1, 1]);
      const [bg, fg] = p.tile as PathNode[];
      expect(bg.style.fill).toEqual(WHITE);
      expect(subpathBounds(bg.subpaths)).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
      expect(fg.style.fill).toEqual(RED);
      const b = subpathBounds(fg.subpaths)!;
      expect(b.minX >= -1e-9 && b.minY >= -1e-9 && b.maxX <= 1 + 1e-9 && b.maxY <= 1 + 1e-9).toBe(true);
      expect(p.twoColor).toEqual({ name: preset.name, fg: RED, bg: WHITE });
    }
  });

  test('Größe und Winkel stecken in der Matrix (Kachel → Objekt), Ursprung bleibt beim Ändern', () => {
    const p = makePattern(PATTERNS[0].name, RED, WHITE, 5, 30, { x: 2, y: 3 });
    expect(patternSize(p)).toBeCloseTo(5, 9);
    expect(patternAngle(p)).toBeCloseTo(30, 9);
    const [ex, ey] = apply(p.matrix, 1, 0);
    expect(ex).toBeCloseTo(2 + 5 * Math.cos(Math.PI / 6), 9);
    expect(ey).toBeCloseTo(3 + 5 * Math.sin(Math.PI / 6), 9);
    const q = resizePattern(p, 8, -45);
    expect(patternSize(q)).toBeCloseTo(8, 9);
    expect(patternAngle(q)).toBeCloseTo(-45, 9);
    expect([q.matrix[4], q.matrix[5]]).toEqual([2, 3]);
    expect(q.tile).toBe(p.tile);
  });
});

describe('Füllart Muster im Bedienfeld', () => {
  const prev: FillSpec = { kind: 'solid', a: RED, b: WHITE };

  test('Muster ist kein Verlauf; Bedienfeld liest Vorlage, Farben, Größe, Winkel', () => {
    const p = makePattern(PATTERNS[1].name, RED, WHITE, 4, 15, { x: 0, y: 0 });
    expect(isGradient(p)).toBe(false);
    expect(isPattern(p)).toBe(true);
    expect(isPattern(RED)).toBe(false);
    const s = fillSpec(p, prev);
    expect(s.kind).toBe('pattern');
    expect([s.a, s.b]).toEqual([RED, WHITE]);
    expect(s.pattern?.preset).toBe(PATTERNS[1].name);
    expect(s.pattern?.size).toBeCloseTo(4, 9);
    expect(s.pattern?.angle).toBeCloseTo(15, 9);
  });

  test('neues Muster beginnt an der Objekt-Box oben links', () => {
    const n = setFill(square('a', 50, 50, 10), { kind: 'pattern', a: RED, b: WHITE, pattern: { preset: PATTERNS[2].name, size: 3, angle: 0 } });
    const f = n.style.fill as Pattern;
    expect(f.twoColor?.name).toBe(PATTERNS[2].name);
    near(f.matrix, multiply(translate(0, 0), scale(3, 3)));
  });

  test('Zweifarb-Muster: neue Farben erzeugen die Kachel neu, Ursprung bleibt', () => {
    const start = setFill(square('a'), { kind: 'pattern', a: RED, b: WHITE, pattern: { preset: PATTERNS[0].name, size: 5, angle: 0 } });
    const moved = { ...start, style: { ...start.style, fill: { ...(start.style.fill as Pattern), matrix: [5, 0, 0, 5, 1, 2] as Mat } } };
    const blue: Color = { model: 'rgb', values: [0, 0, 1] };
    const f = setFill(moved, { kind: 'pattern', a: blue, b: RED, pattern: { preset: PATTERNS[0].name, size: 2, angle: 90 } }).style.fill as Pattern;
    expect(f.twoColor).toEqual({ name: PATTERNS[0].name, fg: blue, bg: RED });
    expect((f.tile[1] as PathNode).style.fill).toEqual(blue);
    expect([f.matrix[4], f.matrix[5]]).toEqual([1, 2]);
    expect(patternSize(f)).toBeCloseTo(2, 9);
    expect(patternAngle(f)).toBeCloseTo(90, 9);
  });

  test('eigene Kachel bleibt, nur Größe und Winkel ändern sich; Vorlagenwahl macht ein Zweifarb-Muster', () => {
    const own: Pattern = { kind: 'pattern', width: 10, height: 4, matrix: [1, 0, 0, 1, 0, 0], tile: [square('t', 0, 0, 4)] };
    const n = { ...square('a'), style: { fill: own, stroke: null } };
    const s = fillSpec(own, prev);
    expect(s.pattern?.preset).toBe('');
    const f = setFill(n, { ...s, pattern: { preset: '', size: 20, angle: 0 } }).style.fill as Pattern;
    expect(f.tile).toBe(own.tile);
    expect(f.twoColor).toBeUndefined();
    expect(patternSize(f)).toBeCloseTo(20, 9);
    const g = setFill(n, { ...s, pattern: { preset: PATTERNS[3].name, size: 20, angle: 0 } }).style.fill as Pattern;
    expect(g.twoColor?.name).toBe(PATTERNS[3].name);
  });
});

describe('Muster aus Auswahl', () => {
  // Ziel 25 mm, um 2 skaliert und verschoben: Kachel-Matrix muss in dessen Objektsystem umgerechnet werden
  const target = (): PathNode => ({ ...square('z', 0, 0, 25), transform: multiply(translate(100, 100), scale(2, 2)) });

  test('Kachel = Kopien der übrigen Auswahl relativ zu ihrer Box, liegt auf der Seite wie vorher; Originale bleiben', () => {
    const doc = docWith(target(), square('a', 10, 20, 5), square('b', 30, 22, 4));
    const r = patternFromSelection(doc, ['a', 'b', 'z']);
    expect(r.selected).toEqual(['z']);
    expect(findNode(r.doc, 'a')).toBeDefined();
    expect(findNode(r.doc, 'b')).toBeDefined();
    const f = fillOf(r.doc, 'z');
    expect([f.width, f.height]).toEqual([24, 6]);
    expect(f.tile.map((n) => n.id)).not.toContain('a');
    near(f.tile[0].transform, translate(0, 0));
    near(f.tile[1].transform, translate(20, 2));
    near(multiply(multiply(translate(100, 100), scale(2, 2)), f.matrix), translate(10, 20));
    expect(f.twoColor).toBeUndefined();
  });

  test('Fehler: Ziel ohne Füllung, keine Quelle, Muster im Muster', () => {
    expect(() => patternFromSelection(docWith(square('a'), group('g', [square('b')])), ['a', 'g'])).toThrow(/Ziel/);
    expect(() => patternFromSelection(docWith(target()), ['z'])).toThrow(/mindestens/);
    const filled = setFill(square('p'), { kind: 'pattern', a: RED, b: WHITE, pattern: { preset: PATTERNS[0].name, size: 5, angle: 0 } });
    expect(() => patternFromSelection(docWith(target(), group('g', [filled])), ['g', 'z'])).toThrow(/Muster/);
  });
});
