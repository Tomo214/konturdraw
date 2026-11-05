// Bedienfeld Füllung/Kontur/Form: zeigt das erste gewählte Blatt, sonst Vorgaben für neue Objekte.
// raw: Werte landen unverändert im Dokument.
import { BLACK, DEFAULT_STROKE, fillSpec, setFill, setPolygon, setRadius, setStroke, type FillSpec } from '../model/style';
import type { LeafNode, Shape, Stroke, Style } from '../model/types';
import type { ShapeParams } from './tools/shape-tool';

export class StyleState {
  fill = $state.raw<FillSpec>({ kind: 'none', a: BLACK, b: { model: 'rgb', values: [1, 1, 1] } });
  stroke = $state.raw<Stroke | null>(DEFAULT_STROKE);
  shape = $state.raw<ShapeParams>({ radius: 0, sides: 5, inner: null });
  #shownStyle: Style | null = null;
  #shownShape: Shape | null = null;

  /** apply: Änderung auf alle gewählten Blätter, ein Rückgängig-Schritt. */
  constructor(private readonly apply: (fn: (n: LeafNode) => LeafNode) => void) {}

  /** Nur übernehmen, was sich am Objekt geändert hat; sonst bleiben Eingaben im Feld stehen. */
  show(n: LeafNode) {
    if (n.style !== this.#shownStyle) {
      this.#shownStyle = n.style;
      this.fill = fillSpec(n.style.fill, this.fill);
      this.stroke = n.style.stroke;
    }
    if (n.type === 'shape' && n.shape !== this.#shownShape) {
      const s = (this.#shownShape = n.shape);
      this.shape = {
        radius: s.kind === 'rect' ? s.radius : this.shape.radius,
        sides: s.kind === 'polygon' ? s.sides : this.shape.sides,
        inner: s.kind === 'polygon' ? s.inner : this.shape.inner,
      };
    }
  }

  /** Für StylePanel und PaletteBar: gilt für die Auswahl und als Vorgabe für neue Objekte. */
  readonly handlers = {
    onfill: (f: FillSpec) => {
      this.fill = f;
      this.apply((n) => setFill(n, f));
    },
    onstroke: (patch: Partial<Stroke> | null) => {
      this.stroke = patch && { ...(this.stroke ?? DEFAULT_STROKE), ...patch };
      this.apply((n) => setStroke(n, patch));
    },
    onradius: (r: number) => {
      this.shape = { ...this.shape, radius: r };
      this.apply(setRadius(r));
    },
    onpolygon: (sides: number, inner: number | null) => {
      this.shape = { ...this.shape, sides, inner };
      this.apply(setPolygon(sides, inner));
    },
  };
}
