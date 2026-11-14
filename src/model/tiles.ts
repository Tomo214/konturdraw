// Druck in Kacheln: Seite größer als das Papier → Blätter mit Überlappung, Passkreuzen und Blattnamen.
import type { Point } from './types';

export type Paper = { width: number; height: number };
/** Papierformate in mm, hochkant. */
export const PAPERS = {
  A5: { width: 148, height: 210 },
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
} as const satisfies Record<string, Paper>;

/** margin = Rand, den der Drucker nicht bedruckt; overlap = Streifen, den zwei Nachbarblätter gemeinsam haben (mm). */
export type TileOptions = { paper: Paper; margin: number; overlap: number };
/** Blatt: linke obere Ecke auf der Seite, Name (Spalte + Reihe), Passkreuze in Seitenkoordinaten. */
export type Tile = { x: number; y: number; label: string; marks: Point[] };
/** width/height = bedruckbare Fläche je Blatt, mark = halbe Kreuzgröße (mm). */
export type TileLayout = { cols: number; rows: number; width: number; height: number; mark: number; tiles: Tile[] };

/** Halbe Größe eines Passkreuzes und Abstand der Kreuze vom Ende einer Naht, mm. */
const MARK = 2.5;
const INSET = 10;
const EPS = 1e-9;

const count = (page: number, area: number, overlap: number) =>
  page <= area ? 1 : Math.ceil((page - overlap) / (area - overlap) - EPS);
const column = (c: number): string => (c >= 26 ? column(Math.floor(c / 26) - 1) : '') + String.fromCharCode(65 + (c % 26));
/** Kreuze auf einem Nahtstück von a bis b: zwei mit Abstand zu den Enden, bei kurzen Stücken eins in der Mitte. */
const along = (a: number, b: number) => (b - a > 2 * INSET ? [a + INSET, b - INSET] : [(a + b) / 2]);

/** Aufteilung einer Seite (mm) auf Blätter, zeilenweise von links oben; null bei unmöglichen Werten. */
export function tileLayout(pageW: number, pageH: number, { paper, margin, overlap }: TileOptions): TileLayout | null {
  const width = paper.width - 2 * margin, height = paper.height - 2 * margin;
  if (!(pageW > 0 && pageH > 0 && margin >= 0 && overlap >= 0 && width > overlap && height > overlap)) return null;
  const cols = count(pageW, width, overlap), rows = count(pageH, height, overlap);
  const sx = width - overlap, sy = height - overlap;
  const mark = Math.min(MARK, overlap / 2);
  // Passkreuze mitten im gemeinsamen Streifen jeder Naht, je Blattreihe bzw. -spalte und nur innerhalb der Seite.
  const seams: Point[] = [];
  if (mark > 0) {
    for (let r = 0; r < rows; r++)
      for (let c = 0; c + 1 < cols; c++)
        for (const y of along(r * sy, Math.min(r * sy + height, pageH))) seams.push({ x: (c + 1) * sx + overlap / 2, y });
    for (let r = 0; r + 1 < rows; r++)
      for (let c = 0; c < cols; c++)
        for (const x of along(c * sx, Math.min(c * sx + width, pageW))) seams.push({ x, y: (r + 1) * sy + overlap / 2 });
  }
  const tiles: Tile[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = c * sx, y = r * sy;
      const inside = (p: Point) =>
        p.x - mark >= x - EPS && p.x + mark <= x + width + EPS && p.y - mark >= y - EPS && p.y + mark <= y + height + EPS;
      tiles.push({ x, y, label: column(c) + (r + 1), marks: seams.filter(inside) });
    }
  return { cols, rows, width, height, mark, tiles };
}

/** Auftrag an den Druck (Rust: pdf_export::Sheets); ohne Kachelmarken weder Kreuze noch Blattnamen. */
export type Sheets = { paper: [number, number]; margin: number; area: [number, number]; mark: number; tiles: Tile[] };
export const toSheets = (l: TileLayout, o: TileOptions, marks: boolean): Sheets => ({
  paper: [o.paper.width, o.paper.height],
  margin: o.margin,
  area: [l.width, l.height],
  mark: l.mark,
  tiles: marks ? l.tiles : l.tiles.map((t) => ({ ...t, label: '', marks: [] })),
});
