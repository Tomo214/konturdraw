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

test('Mauszeiger: Größenpfeil über dem Griff (auch während des Ziehens), Kreuzpfeil über der Auswahl, sonst Standard', () => {
  const base = createDocument();
  const doc = addNodes(base, base.pages[0].layers[0].id, [square('x')]);
  const ed = editor(doc);
  const box = { minX: 0, minY: 0, maxX: 10, maxY: 10 }; // 0…20 px
  (ed as { renderer: unknown }).renderer = { bounds: () => box, inside: () => [], hitTest: () => ({ id: 'x', topId: 'x', chain: ['x'] }) };
  const tool = selectTool(ed as unknown as Editor);
  expect(tool.cursor?.(at(0, 0))).toBe('nwse-resize'); // genau auf der Objektecke
  expect(tool.cursor?.(at(26, 10))).toBe('ew-resize');
  expect(tool.cursor?.(at(10, 10))).toBe('move');
  expect(tool.cursor?.(at(100, 100))).toBe('');
  tool.down(at(-6, -6));
  tool.move(at(-30, -30)); // weit weg vom Griff, Zeiger bleibt
  expect(tool.cursor?.(at(-30, -30))).toBe('nwse-resize');
  tool.up(at(-30, -30));
});

test('Alt beim Rahmenziehen wählt berührte statt nur umschlossene Objekte (wie Vorbild)', () => {
  const ed = editor(createDocument());
  ed.selected = new Set();
  const asked: string[] = [];
  (ed as { renderer: unknown }).renderer = {
    bounds: () => null,
    hitTest: () => null,
    inside: () => (asked.push('inside'), ['a']),
    touching: () => (asked.push('touching'), ['a', 'b']),
  };
  const tool = selectTool(ed as unknown as Editor);
  drag(tool, { ...at(0, 0), alt: true }, { ...at(40, 40), alt: true });
  expect(asked).toEqual(['touching']);
  expect([...ed.selected].sort()).toEqual(['a', 'b']);
});

test('Freihand-Auswahl: Spur auf leerer Fläche wählt, was ganz darin liegt; Shift fügt hinzu, zu kurze Spur wählt nichts', () => {
  const ed = editor(createDocument());
  ed.selected = new Set(['old']);
  let poly: { x: number; y: number }[] = [];
  (ed as { renderer: unknown }).renderer = {
    bounds: () => null,
    hitTest: () => null,
    inside: () => ['falsch'],
    inPolygon: (p: { x: number; y: number }[]) => ((poly = p), ['a']),
  };
  const tool = selectTool(ed as unknown as Editor, { freehand: true });
  tool.down(at(0, 0));
  for (const [sx, sy] of [[40, 0], [40, 40], [0, 40]]) tool.move(at(sx, sy));
  tool.up(at(0, 40));
  expect([...ed.selected]).toEqual(['a']);
  expect(poly.map((p) => [p.x, p.y])).toEqual([[0, 0], [20, 0], [20, 20], [0, 20]]); // Seiten-mm (zoom 2)

  tool.down({ ...at(0, 0), shift: true });
  for (const [sx, sy] of [[40, 0], [40, 40]]) tool.move({ ...at(sx, sy), shift: true });
  tool.up({ ...at(40, 40), shift: true });
  expect([...ed.selected].sort()).toEqual(['a']); // fügt a erneut hinzu, behält a

  ed.selected = new Set(['b']);
  drag(tool, { ...at(0, 0), shift: true }, { ...at(30, 0), shift: true }); // nur zwei Punkte: keine Fläche
  expect([...ed.selected]).toEqual(['b']);
});

/** Ein gewähltes 10-mm-Quadrat x (0…20 px bei Zoom 2); Griffe außen mit 6 px Abstand. */
function boxed() {
  const base = createDocument();
  const ed = editor(addNodes(base, base.pages[0].layers[0].id, [square('x')]));
  const box = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  (ed as { renderer: unknown }).renderer = { bounds: () => box, inside: () => [], hitTest: () => ({ id: 'x', topId: 'x', chain: ['x'] }) };
  return { ed, tool: selectTool(ed as unknown as Editor) };
}
const round = (m: readonly number[] | null | undefined) => m?.map((v) => Math.round(v * 1e9) / 1e9 + 0);

test('Zusatztasten am Eckgriff wie Vorbild: Shift vom Mittelpunkt, Alt frei, Strg (Mac ⌘) in 100-%-Schritten', () => {
  const { ed, tool } = boxed();
  const pull = (to: Pointer) => {
    drag(tool, { ...at(26, 26), shift: to.shift, alt: to.alt, mod: to.mod }, to);
    const m = round(worldOf(ed.history.current, 'x'));
    ed.history.undo();
    return m;
  };
  expect(pull(at(36, 36))).toEqual([1.5, 0, 0, 1.5, 0, 0]); // ohne Taste proportional vom Gegengriff
  expect(pull({ ...at(36, 36), shift: true })).toEqual([2, 0, 0, 2, -5, -5]);
  expect(pull({ ...at(46, 26), alt: true })).toEqual([2, 0, 0, 1, 0, 0]);
  expect(pull({ ...at(38, 38), mod: true })).toEqual([2, 0, 0, 2, 0, 0]); // 1,6 → 2
});

test('Strg über die Gegenseite gezogen spiegelt genau (Kantengriff rechts nach links)', () => {
  const { ed, tool } = boxed();
  drag(tool, { ...at(26, 10), mod: true }, { ...at(-10, 10), mod: true });
  expect(round(worldOf(ed.history.current, 'x'))).toEqual([-1, 0, 0, 1, 0, 0]);
});

test('Drehen: Strg (Mac ⌘) rastet auf 15°, ohne Taste frei', () => {
  const { ed, tool } = boxed();
  drag(tool, at(10, 10), at(10, 10)); // zweiter Klick auf die Auswahl → Drehen
  const turn = (mods: Partial<Pointer>) => {
    drag(tool, { ...at(-6, -6), ...mods }, { ...at(-6, 10), ...mods });
    const m = worldOf(ed.history.current, 'x')!;
    ed.history.undo();
    return (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  };
  const snapped = turn({ mod: true });
  expect(Math.abs(snapped / 15 - Math.round(snapped / 15))).toBeLessThan(1e-9);
  const free = turn({});
  expect(Math.abs(free / 15 - Math.round(free / 15))).toBeGreaterThan(0.01);
});

test('Bewegen mit Strg (Mac ⌘) nur waagerecht oder senkrecht', () => {
  const { ed, tool } = boxed();
  drag(tool, { ...at(10, 10), mod: true }, { ...at(30, 16), mod: true });
  expect(round(worldOf(ed.history.current, 'x'))).toEqual([1, 0, 0, 1, 10, 0]);
  ed.history.undo();
  drag(tool, { ...at(10, 10), mod: true }, { ...at(14, -20), mod: true });
  expect(round(worldOf(ed.history.current, 'x'))).toEqual([1, 0, 0, 1, 0, -15]);
});

test('Rechtsklick oder Leertaste beim Ziehen legt eine Kopie ab: Original bleibt, Kopie ist gewählt', () => {
  const { ed, tool } = boxed();
  const layer = () => ed.history.current.pages[0].layers[0].children;
  tool.down(at(10, 10));
  tool.move(at(30, 10));
  tool.stamp?.();
  tool.up(at(30, 10));
  expect(layer()).toHaveLength(2);
  expect(round(worldOf(ed.history.current, 'x'))).toEqual([1, 0, 0, 1, 0, 0]);
  const copy = [...ed.selected][0];
  expect(copy).not.toBe('x');
  expect(round(worldOf(ed.history.current, copy))).toEqual([1, 0, 0, 1, 10, 0]);
  ed.history.undo();
  expect(layer()).toHaveLength(1); // ein Rückgängig-Schritt

  ed.selected = new Set(['x']);
  expect(tool.key?.({ name: 'pickToggle' })).toBe(false); // ohne Ziehen: normale Leertaste
  tool.down(at(26, 26));
  tool.move(at(46, 46));
  expect(tool.key?.({ name: 'pickToggle' })).toBe(true);
  tool.up(at(46, 46));
  expect(layer()).toHaveLength(2);
  expect(round(worldOf(ed.history.current, 'x'))).toEqual([1, 0, 0, 1, 0, 0]);
  expect(round(worldOf(ed.history.current, [...ed.selected][0]))).toEqual([2, 0, 0, 2, 0, 0]);
});
