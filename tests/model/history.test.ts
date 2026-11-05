import { expect, test } from 'vitest';
import { History } from '../../src/model/history';

test('undo und redo laufen durch die Zustände', () => {
  const h = new History('a');
  h.push('b');
  h.push('c');
  expect(h.undo()).toBe(true);
  expect(h.current).toBe('b');
  h.undo();
  expect(h.current).toBe('a');
  expect(h.undo()).toBe(false);
  h.redo();
  expect(h.current).toBe('b');
});

test('neue Änderung verwirft Redo', () => {
  const h = new History('a');
  h.push('b');
  h.undo();
  h.push('c');
  expect(h.redo()).toBe(false);
  expect(h.current).toBe('c');
});

test('unveränderter Zustand erzeugt keinen Schritt', () => {
  const h = new History('a');
  h.push('a');
  expect(h.canUndo).toBe(false);
});

test('Vorschau beim Ziehen ergibt genau einen Undo-Schritt', () => {
  const h = new History('a');
  h.preview('a1');
  h.preview('a2');
  h.commit();
  expect(h.current).toBe('a2');
  h.undo();
  expect(h.current).toBe('a');
  expect(h.canUndo).toBe(false);
});

test('abgebrochene Vorschau stellt den Ausgangszustand her', () => {
  const h = new History('a');
  h.preview('x');
  h.cancel();
  expect(h.current).toBe('a');
  expect(h.canUndo).toBe(false);
});

test('mindestens 200 Schritte sind rückgängig machbar (Spec §4)', () => {
  const h = new History(0);
  for (let i = 1; i <= 250; i++) h.push(i);
  let steps = 0;
  while (h.undo()) steps++;
  expect(steps).toBeGreaterThanOrEqual(200);
});

test('Limit verwirft die ältesten Schritte', () => {
  const h = new History(0, 3);
  for (let i = 1; i <= 5; i++) h.push(i);
  let steps = 0;
  while (h.undo()) steps++;
  expect(steps).toBe(3);
  expect(h.current).toBe(2);
});

test('reset: anderes Dokument ohne Rückgängig/Wiederholen, laufende Vorschau verworfen', () => {
  const h = new History(1);
  h.push(2);
  h.push(3);
  h.undo();
  h.preview(7);
  h.reset(9);
  expect([h.current, h.canUndo, h.canRedo]).toEqual([9, false, false]);
  h.commit();
  expect(h.canUndo).toBe(false);
});
