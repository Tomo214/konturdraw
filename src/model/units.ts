// Zeichnungseinheit und Seitenformate. Das Modell rechnet immer in mm; Einheiten gibt es nur in Anzeige und Eingabe.

export type Unit = 'mm' | 'cm' | 'in' | 'pt';

export const UNITS: Record<Unit, { label: string; name: string; mm: number }> = {
  mm: { label: 'mm', name: 'Millimeter', mm: 1 },
  cm: { label: 'cm', name: 'Zentimeter', mm: 10 },
  in: { label: 'in', name: 'Zoll', mm: 25.4 },
  pt: { label: 'pt', name: 'Punkt', mm: 25.4 / 72 },
};

export const DEFAULT_UNIT: Unit = 'mm';
/** Verschiebe-Schritt der Pfeiltasten in mm; Shift = 10 Schritte, Mod = ein Zehntel. */
export const DEFAULT_NUDGE = 0.1;

const SUFFIX: Record<string, Unit> = { mm: 'mm', cm: 'cm', in: 'in', '"': 'in', zoll: 'in', pt: 'pt' };

/** Komma, höchstens 3 Nachkommastellen, ohne Nullen am Ende. */
export function formatNumber(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return String(r === 0 ? 0 : r).replace('.', ',');
}

/** mm → Text in der Einheit. */
export const formatLength = (mm: number, unit: Unit): string => formatNumber(mm / UNITS[unit].mm);

const NUMBER = /^\s*(-?\d*(?:[.,]\d+)?|-?\d+[.,]?)\s*/.source;

/** Zahl ohne Einheit (Prozent, Grad, Anzahl); % und ° dürfen dabeistehen. */
export function parseNumber(text: string): number | null {
  const m = new RegExp(`${NUMBER}[%°]?\\s*$`).exec(text);
  if (!m || !/\d/.test(m[1])) return null;
  const v = Number(m[1].replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

/** Eingabe → mm; Komma oder Punkt, optional mit eigener Einheit („2 cm“ im mm-Feld). null = keine Zahl. */
export function parseLength(text: string, unit: Unit): number | null {
  const m = new RegExp(`${NUMBER}([a-z"]*)\\s*$`, 'i').exec(text);
  if (!m || !/\d/.test(m[1])) return null;
  const u = m[2] ? SUFFIX[m[2].toLowerCase()] : unit;
  const v = Number(m[1].replace(',', '.')) * UNITS[u ?? unit].mm;
  return u && Number.isFinite(v) ? v : null;
}

/** Hochformat in mm; Querformat = vertauscht. */
export const PAGE_FORMATS: readonly { name: string; width: number; height: number }[] = [
  { name: 'A3', width: 297, height: 420 },
  { name: 'A4', width: 210, height: 297 },
  { name: 'A5', width: 148, height: 210 },
  { name: 'A6', width: 105, height: 148 },
  { name: 'Letter', width: 215.9, height: 279.4 },
  { name: 'Legal', width: 215.9, height: 355.6 },
];

/** Name des Formats in beiden Ausrichtungen; null = benutzerdefiniert. */
export function pageFormat(width: number, height: number): string | null {
  const [w, h] = width < height ? [width, height] : [height, width];
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  return PAGE_FORMATS.find((f) => near(f.width, w) && near(f.height, h))?.name ?? null;
}
