import { expect, test } from 'vitest';
import { emptyPen, penDown, penDrag, penFinish, type Pen } from '../../src/ui/pen';

const click = (pen: Pen, x: number, y: number) => penDown(pen, { x, y }, 1);

test('Klicks setzen Eckpunkte, Beenden liefert offenen Pfad', () => {
  let pen = click(emptyPen, 0, 0).pen;
  pen = click(pen, 10, 0).pen;
  pen = click(pen, 10, 10).pen;
  const sp = penFinish(pen)!;
  expect(sp.closed).toBe(false);
  expect(sp.nodes.map((n) => [n.x, n.y, n.type])).toEqual([
    [0, 0, 'corner'],
    [10, 0, 'corner'],
    [10, 10, 'corner'],
  ]);
});

test('Ziehen macht den letzten Punkt symmetrisch', () => {
  const pen = penDrag(click(emptyPen, 0, 0).pen, { x: 3, y: 4 });
  expect(pen.nodes[0]).toEqual({ x: 0, y: 0, type: 'symmetric', handleIn: { x: -3, y: -4 }, handleOut: { x: 3, y: 4 } });
});

test('Klick auf den Start schließt ab zwei Punkten', () => {
  let pen = click(emptyPen, 0, 0).pen;
  pen = click(pen, 10, 0).pen;
  const r = click(pen, 0.5, 0.5);
  expect(r.done).not.toBeNull();
  expect(r.done!.closed).toBe(true);
  expect(r.done!.nodes).toHaveLength(2);
  expect(r.pen).toEqual(emptyPen);
});

test('unter zwei Punkten gibt es keinen Pfad', () => {
  expect(penFinish(click(emptyPen, 0, 0).pen)).toBeNull();
});
