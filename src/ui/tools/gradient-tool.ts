import { naiveSrgb } from '../../model/color';
import { updateNodes } from '../../model/document';
import { apply, invert, type Mat } from '../../model/geometry';
import { addStop, along, moveStop, removeStop, setStopColor } from '../../model/gradient';
import { isGradient, setGradientLine } from '../../model/style';
import type { Color, Doc, Gradient, LeafNode, Point } from '../../model/types';
import { styled, type StyledItem } from '../../render/scene';
import { drawGradientLine } from '../overlay';
import type { Editor, Pointer, Tool } from './tool';

const GRAB_PX = 6;

const at = (m: Mat, p: Point): Point => {
  const [x, y] = apply(m, p.x, p.y);
  return { x, y };
};
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const css = (c: Color) => `rgb(${naiveSrgb(c).map((v) => Math.round(v * 255)).join(' ')})`;
const withGradient = (doc: Doc, id: string, g: Gradient) =>
  updateNodes(doc, [id], (n) => ({ ...(n as LeafNode), style: { ...(n as LeafNode).style, fill: g } }));
const moved = (a: Pointer, b: Pointer) => Math.hypot(b.sx - a.sx, b.sy - a.sy) > 2;

/** Verlauf in Objekt- (g) und Seitenkoordinaten (from, to). */
type Line = { it: StyledItem; g: Gradient; from: Point; to: Point };

/**
 * Verlauf über die Auswahl ziehen; Anfasser des ersten gewählten Verlaufs einzeln verschieben (Spec §5).
 * Farbknoten wie im Vorbild: Doppelklick auf die Linie = neuer Knoten, auf einen Knoten = weg; ziehen = Lage;
 * Klick wählt Knoten oder Ende, dann färbt die Palette ihn und Entf löscht ihn.
 */
export function gradientTool(ed: Editor): Tool {
  let drag: { start: Pointer; doc: Doc; items: StyledItem[]; end: 'from' | 'to' | null; moved: boolean } | null = null;
  let knotDrag: { line: Line; i: number; doc: Doc; start: Pointer; moved: boolean } | null = null;
  let sel: { id: string; i: number } | null = null;

  // Erster Verlauf der Auswahl – nur er bekommt Anfasser und Knoten.
  function line(): Line | null {
    for (const it of ed.renderer.leavesOf(ed.selected).filter(styled)) {
      const g = it.node.style.fill;
      if (g && isGradient(g)) return { it, g, from: at(it.world, g.from), to: at(it.world, g.to) };
    }
    return null;
  }

  const near = (q: Point, p: Pointer) => Math.hypot(q.x - p.x, q.y - p.y) * ed.vp.zoom <= GRAB_PX;
  const knotAt = (l: Line, i: number) => at(l.it.world, lerp(l.g.from, l.g.to, l.g.stops[i].offset));
  const inner = (l: Line, i: number) => i > 0 && i < l.g.stops.length - 1;
  // Zwischenknoten zuerst: sie können dicht an den Enden liegen. -1 = keiner.
  function hitKnot(l: Line, p: Pointer): number {
    const last = l.g.stops.length - 1;
    for (let i = 1; i < last; i++) if (near(knotAt(l, i), p)) return i;
    return near(l.to, p) ? last : near(l.from, p) ? 0 : -1;
  }
  function onLine(l: Line, p: Pointer): boolean {
    const dx = l.to.x - l.from.x;
    const dy = l.to.y - l.from.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? ((p.x - l.from.x) * dx + (p.y - l.from.y) * dy) / len2 : 0;
    return near(lerp(l.from, l.to, Math.max(0, Math.min(1, t))), p);
  }
  // Gewählter Knoten, solange er zum angezeigten Verlauf gehört.
  const current = (l: Line | null) => (l && sel && sel.id === l.it.id && sel.i < l.g.stops.length ? sel.i : null);
  const put = (l: Line, g: Gradient) => ed.history.push(withGradient(ed.history.current, l.it.id, g));

  return {
    down(p) {
      const items = ed.renderer.leavesOf(ed.selected).filter(styled);
      if (!items.length) {
        ed.notice = 'Verlauf: erst Objekt wählen';
        return;
      }
      const l = line();
      const k = l ? hitKnot(l, p) : -1;
      sel = l && k >= 0 ? { id: l.it.id, i: k } : null;
      if (l && inner(l, k)) {
        knotDrag = { line: l, i: k, doc: ed.history.current, start: p, moved: false };
        return;
      }
      const end = l && k >= 0 ? (k === 0 ? 'from' : 'to') : null;
      drag = { start: p, doc: ed.history.current, items: l && end ? [l.it] : items, end, moved: false };
    },
    move(p) {
      if (knotDrag) {
        const kd = knotDrag;
        kd.moved ||= moved(kd.start, p);
        if (!kd.moved) return false;
        const t = along(kd.line.g, at(invert(kd.line.it.world), p));
        ed.history.preview(withGradient(kd.doc, kd.line.it.id, moveStop(kd.line.g, kd.i, t)));
        return true;
      }
      if (!drag) return false;
      drag.moved ||= moved(drag.start, p);
      if (!drag.moved) return false;
      let doc = drag.doc;
      for (const it of drag.items) {
        // Verlauf liegt in Objekt-Koordinaten: Zeigerpunkte durch die Weltmatrix zurückrechnen.
        const inv = invert(it.world);
        const old = it.node.style.fill;
        let [from, to] = [at(inv, drag.start), at(inv, p)];
        if (drag.end && old && isGradient(old)) [from, to] = drag.end === 'from' ? [to, old.to] : [old.from, to];
        doc = updateNodes(doc, [it.id], (n) => setGradientLine(n as LeafNode, from, to, ed.fill));
      }
      ed.history.preview(doc);
      return true;
    },
    up() {
      if (drag?.moved || knotDrag?.moved) ed.history.commit();
      drag = knotDrag = null;
    },
    dblclick(p) {
      const l = line();
      if (!l) return;
      const k = hitKnot(l, p);
      if (inner(l, k)) {
        put(l, removeStop(l.g, k)!);
        sel = null;
        return;
      }
      if (k >= 0 || !onLine(l, p)) return;
      const r = addStop(l.g, along(l.g, at(invert(l.it.world), p)));
      if (!r) return;
      put(l, r.gradient);
      sel = { id: l.it.id, i: r.index };
    },
    key(cmd) {
      const l = line();
      const i = current(l);
      if (cmd.name !== 'delete' || !l || i === null) return false;
      const g = removeStop(l.g, i);
      if (g) {
        put(l, g);
        sel = null;
      } else ed.notice = 'Anfang und Ende des Verlaufs bleiben';
      return true;
    },
    paint(c) {
      const l = line();
      const i = current(l);
      if (!l || i === null) return false;
      put(l, setStopColor(l.g, i, c));
      return true;
    },
    overlay(ctx, dpr) {
      const l = line();
      if (!l) return;
      const knots = l.g.stops.map((s, i) => ({ at: knotAt(l, i), color: css(s.color) }));
      drawGradientLine(ctx, ed.vp, dpr, l.from, l.to, knots, current(l) ?? -1);
    },
  };
}
