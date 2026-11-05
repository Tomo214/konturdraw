// Teilung von Linealen und Raster: reine Rechnung, gezeichnet wird in ui/decor.ts.

const MIN_LABEL_PX = 36;
const MIN_TICK_PX = 5;
const MIN_GRID_PX = 8;
const clean = (v: number) => Number(v.toPrecision(12));

/** Beschriftungsabstand 1/2/5·10^n Einheiten mit mindestens 36 px, dazu die feinste Unterteilung mit Strichen ≥ 5 px. */
export function rulerStep(pxPerUnit: number): { step: number; sub: number } {
  let k = Math.floor(Math.log10(MIN_LABEL_PX / pxPerUnit));
  for (;;) {
    for (const base of [1, 2, 5]) {
      const step = clean(base * 10 ** k);
      if (step * pxPerUnit < MIN_LABEL_PX) continue;
      const subs = base === 1 ? [10, 5, 2] : base === 2 ? [4, 2] : [5];
      return { step, sub: subs.find((s) => (step / s) * pxPerUnit >= MIN_TICK_PX) ?? 1 };
    }
    k++;
  }
}

/** Striche von `from` bis `to` (Einheiten); major = beschriftet. Über ganze Zahlen gezählt, damit nichts driftet. */
export function rulerMarks(from: number, to: number, step: number, sub: number): { v: number; major: boolean }[] {
  const minor = step / sub;
  const out: { v: number; major: boolean }[] = [];
  for (let i = Math.ceil(from / minor - 1e-9); i <= Math.floor(to / minor + 1e-9); i++) {
    out.push({ v: clean(i * minor), major: ((i % sub) + sub) % sub === 0 });
  }
  return out;
}

/** Jede k-te Rasterlinie (k = 1, 2, 5, 10 …), damit Linien mindestens 8 px auseinanderliegen. */
export function gridStep(spacingPx: number): number {
  for (let k = 1; ; k *= 10) for (const m of [1, 2, 5]) if (spacingPx * k * m >= MIN_GRID_PX) return k * m;
}
