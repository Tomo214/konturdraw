import { expect, test } from 'vitest';
import { addNodes, createDocument, worldOf } from '../../src/model/document';
import { group, square } from '../model/fixtures';
import { addGuide, guidesOf, lockGuides } from '../../src/model/guides';
import { History } from '../../src/model/history';
import type { Doc } from '../../src/model/types';
import { screenToPage, type Viewport } from '../../src/render/viewport';
import type { Editor, Pointer } from '../../src/ui/tools/tool';
import { selectTool } from '../../src/ui/tools/select-tool';

// Leere Fläche ohne Objekte: Renderer findet nichts, Hilfslinien kommen aus dem Dokument.
function editor(doc: Doc) {
  const vp: Viewport = { x: 0, y: 0, zoom: 2 };
  return {
    history: new History<Doc>(doc),
    renderer: { bounds: () => null, hitTest: () => null, inside: () => [] },
    vp,
    viewSize: [800, 600] as const,
    selected: new Set(['x']),
    guide: null as string | null,
    notice: '',
    guides(): Doc['pages'][0]['guides'] {
      return guidesOf(this.history.current);
    },
  };
}

const at = (sx: number, sy: number): Pointer => {
  const [x, y] = screenToPage({ x: 0, y: 0, zoom: 2 }, sx, sy);
  return { sx, sy, x, y, shift: false, alt: false };
};

function drag(tool: ReturnType<typeof selectTool>, from: Pointer, to: Pointer) {
  tool.down(from);
  tool.move(to);
  tool.up(to);
}

const withGuide = (locked = false) => {
  const doc = addGuide(createDocument(), 'h', 50, 'g');
  return locked ? lockGuides(doc, ['g'], true)! : doc;
};

test('Klick auf Hilfslinie wählt sie statt Objekte, Ziehen verschiebt sie in einem Schritt', () => {
  const ed = editor(withGuide());
  const tool = selectTool(ed as unknown as Editor);
  drag(tool, at(300, 101), at(300, 141)); // 1 px neben der Linie (y = 50 mm = 100 px), 40 px = 20 mm tiefer
  expect(ed.guide).toBe('g');
  expect(ed.selected.size).toBe(0);
  expect(guidesOf(ed.history.current)[0].pos).toBe(70);
  ed.history.undo();
  expect(guidesOf(ed.history.current)[0].pos).toBe(50);
});

test('aus der Zeichenfläche gezogen = gelöscht; Klick daneben hebt die Wahl auf', () => {
  const ed = editor(withGuide());
  const tool = selectTool(ed as unknown as Editor);
  drag(tool, at(300, 100), at(300, -20));
  expect(guidesOf(ed.history.current)).toEqual([]);
  expect(ed.guide).toBeNull();
  const ed2 = editor(withGuide());
  const tool2 = selectTool(ed2 as unknown as Editor);
  drag(tool2, at(300, 100), at(300, 100));
  drag(tool2, at(300, 300), at(300, 300));
  expect(ed2.guide).toBeNull();
});

test('Entf löscht die gewählte Hilfslinie; gesperrte bleibt stehen und meldet das', () => {
  const ed = editor(withGuide());
  const tool = selectTool(ed as unknown as Editor);
  drag(tool, at(300, 100), at(300, 100));
  expect(tool.key?.({ name: 'delete' })).toBe(true);
  expect(guidesOf(ed.history.current)).toEqual([]);
  expect(tool.key?.({ name: 'delete' })).toBe(false);

  const fixed = editor(withGuide(true));
  const t2 = selectTool(fixed as unknown as Editor);
  drag(t2, at(300, 100), at(300, 160));
  expect(guidesOf(fixed.history.current)[0].pos).toBe(50);
  expect(fixed.notice).toMatch(/gesperrt/);
  expect(t2.key?.({ name: 'delete' })).toBe(true);
  expect(guidesOf(fixed.history.current)).toHaveLength(1);
});

test('Hilfslinie wird über den rohen Zeiger getroffen, auch wenn der Zeiger an einem Knoten fängt', () => {
  const ed = editor(withGuide());
  const tool = selectTool(ed as unknown as Editor);
  // Roh 1 px über der Linie; gefangen an einem Knoten 3 mm darüber.
  tool.down({ ...at(300, 99), y: 47, snap: 'node' });
  expect(ed.guide).toBe('g');
  expect(tool.snapSkip?.()).toEqual(new Set(['g']));
});

test('gefangene Hilfslinie landet genau auf dem Fangpunkt, ungefangen zählt der Weg', () => {
  const ed = editor(withGuide());
  const tool = selectTool(ed as unknown as Editor);
  tool.down(at(300, 101));
  tool.move({ ...at(300, 121), y: 60.25, snap: 'node' });
  tool.up({ ...at(300, 121), y: 60.25, snap: 'node' });
  expect(guidesOf(ed.history.current)[0].pos).toBe(60.25);
});

test('Strg-Klick (Mac ⌘) wählt eine Stufe tiefer, mit Shift dazu/weg; Ziehen bewegt nur das gewählte Kind', () => {
  // g = Gruppe aus a und s; s = Gruppe aus x.
  const base = createDocument();
  const doc = addNodes(base, base.pages[0].layers[0].id, [group('g', [square('a'), group('s', [square('x', 20, 0)])])]);
  const chains: Record<string, string[]> = { a: ['g', 'a'], x: ['g', 's', 'x'] };
  let under = 'a';
  const ed = editor(doc);
  ed.selected = new Set();
  (ed as { renderer: unknown }).renderer = { bounds: () => null, inside: () => [], hitTest: () => ({ id: under, topId: 'g', chain: chains[under] }) };
  const tool = selectTool(ed as unknown as Editor);
  const click = (id: string, mods: Partial<Pointer> = {}) => {
    under = id;
    drag(tool, { ...at(10, 10), ...mods }, { ...at(10, 10), ...mods });
    return [...ed.selected].sort();
  };
  const mod = { mod: true };
  expect(click('a')).toEqual(['g']);
  expect(click('a', mod)).toEqual(['a']);
  expect(click('x', mod)).toEqual(['s']);
  expect(click('x', mod)).toEqual(['x']);
  expect(click('a', { ...mod, shift: true })).toEqual(['a', 'x']);
  expect(click('a', { ...mod, shift: true })).toEqual(['x']);
  // Shift ohne Strg nimmt die ganze Gruppe; ihre Kinder fallen aus der Auswahl.
  expect(click('a', { shift: true })).toEqual(['g']);

  click('a', mod);
  under = 'a';
  drag(tool, at(10, 10), at(30, 10)); // 20 px = 10 mm
  expect([...ed.selected]).toEqual(['a']);
  expect(worldOf(ed.history.current, 'a')![4]).toBeCloseTo(10, 9);
  expect(worldOf(ed.history.current, 'x')![4]).toBe(20);
});

test('Griffe sitzen knapp außerhalb der Ecken: nahe der Ecke innen greifen verschiebt, am Griff außen skaliert', () => {
  // x = Quadrat 10 mm bei (0, 0): auf dem Schirm (zoom 2) 0…20 px.
  const base = createDocument();
  const doc = addNodes(base, base.pages[0].layers[0].id, [square('x')]);
  const ed = editor(doc);
  const box = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  (ed as { renderer: unknown }).renderer = { bounds: () => box, inside: () => [], hitTest: () => ({ id: 'x', topId: 'x', chain: ['x'] }) };
  const tool = selectTool(ed as unknown as Editor);
  drag(tool, at(3, 3), at(23, 3)); // 3 px innen an der Ecke, 20 px = 10 mm nach rechts
  expect(worldOf(ed.history.current, 'x')).toEqual([1, 0, 0, 1, 10, 0]);
  ed.history.undo();
  drag(tool, at(-5, -5), at(-25, -25)); // Griff oben links außen, 20 px = 10 mm nach außen
  const m = worldOf(ed.history.current, 'x')!;
  expect([m[0], m[3], m[4], m[5]].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([2, 2, -10, -10]);
});
