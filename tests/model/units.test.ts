import { describe, expect, it, test } from 'vitest';
import { formatLength, formatNumber, pageFormat, parseLength, parseNumber } from '../../src/model/units';

test('Anzeige in der Zeichnungseinheit: Komma, höchstens 3 Nachkommastellen, ohne Nullen am Ende', () => {
  expect(formatLength(105, 'mm')).toBe('105');
  expect(formatLength(12.5, 'mm')).toBe('12,5');
  expect(formatLength(1 / 3, 'mm')).toBe('0,333');
  expect(formatLength(25.4, 'in')).toBe('1');
  expect(formatLength(15, 'cm')).toBe('1,5');
  expect(formatLength(25.4, 'pt')).toBe('72');
  expect(formatLength(-0.0001, 'mm')).toBe('0');
});

test('Eingabe: Komma oder Punkt, optional mit Einheit (rechnet in mm um)', () => {
  expect(parseLength('12,5', 'mm')).toBe(12.5);
  expect(parseLength(' 12.5 ', 'mm')).toBe(12.5);
  expect(parseLength('1,5', 'in')).toBeCloseTo(38.1, 12);
  expect(parseLength('2cm', 'mm')).toBe(20);
  expect(parseLength('1 in', 'mm')).toBeCloseTo(25.4, 12);
  expect(parseLength('1"', 'mm')).toBeCloseTo(25.4, 12);
  expect(parseLength('72 pt', 'mm')).toBeCloseTo(25.4, 12);
  expect(parseLength('-3', 'mm')).toBe(-3);
});

test('ungültige Eingabe → null', () => {
  for (const s of ['', 'abc', '1,2,3', '5 km', 'Infinity', '1e400']) expect(parseLength(s, 'mm')).toBeNull();
});

test('Seitenformat erkennt Hoch- und Querformat, sonst Benutzerdefiniert', () => {
  expect(pageFormat(210, 297)).toBe('A4');
  expect(pageFormat(297, 210)).toBe('A4');
  expect(pageFormat(148, 210)).toBe('A5');
  expect(pageFormat(100, 100)).toBeNull();
});

describe('Zahlen ohne Einheit (Prozent, Grad, Seiten)', () => {
  it('formatNumber: Komma, höchstens 3 Nachkommastellen', () => {
    expect(formatNumber(100)).toBe('100');
    expect(formatNumber(33.33333)).toBe('33,333');
    expect(formatNumber(-0.0001)).toBe('0');
  });

  it('parseNumber: Komma oder Punkt, Zeichen %/° erlaubt, sonst null', () => {
    expect(parseNumber('50')).toBe(50);
    expect(parseNumber(' 12,5 % ')).toBe(12.5);
    expect(parseNumber('-90°')).toBe(-90);
    for (const s of ['', 'abc', '5 mm', '1,2,3', '1e400']) expect(parseNumber(s), s).toBeNull();
  });
});
