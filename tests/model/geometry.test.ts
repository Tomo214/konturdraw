import { expect, test } from 'vitest';
import { about, apply, invert, multiply, rotate, scale, skew, transformBox, translate, type Mat } from '../../src/model/geometry';

const ROT90: Mat = [0, 1, -1, 0, 0, 0];

test('multiply wendet die rechte Matrix zuerst an', () => {
  const m = multiply(translate(10, 0), scale(2, 2));
  expect(apply(m, 1, 1)).toEqual([12, 2]);
});

test('invert hebt eine Transformation auf', () => {
  const m = multiply(translate(5, -3), multiply(ROT90, scale(2, 3)));
  const [x, y] = apply(multiply(invert(m), m), 4, 7);
  expect(x).toBeCloseTo(4);
  expect(y).toBeCloseTo(7);
});

test('transformBox umschließt ein gedrehtes Rechteck', () => {
  const b = transformBox(ROT90, { minX: 0, minY: 0, maxX: 10, maxY: 2 });
  expect(b.minX).toBeCloseTo(-2);
  expect(b.maxX).toBeCloseTo(0);
  expect(b.minY).toBeCloseTo(0);
  expect(b.maxY).toBeCloseTo(10);
});

test('rotate dreht im Uhrzeigersinn (y nach unten), about um einen Punkt', () => {
  const [x, y] = apply(rotate(Math.PI / 2), 10, 0);
  expect(x).toBeCloseTo(0, 12);
  expect(y).toBeCloseTo(10, 12);
  const [ax, ay] = apply(about(rotate(Math.PI), 5, 5), 10, 5);
  expect(ax).toBeCloseTo(0, 12);
  expect(ay).toBeCloseTo(5, 12);
});

test('skew neigt x mit y und y mit x', () => {
  expect(apply(skew(0.5, 0), 0, 10)).toEqual([5, 10]);
  expect(apply(skew(0, 0.5), 10, 0)).toEqual([10, 5]);
});
