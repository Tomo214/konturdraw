import { layoutText } from '../../io/bridge';
import { activeLayer, addNodes, findNode, newId, removeNodes, updateNodes } from '../../model/document';
import { apply, invert, multiply, translate, type Box, type Mat } from '../../model/geometry';
import { caretAt, createText, indexAt, textSpec, withLayout, type TextLayout } from '../../model/text';
import type { Point, TextNode } from '../../model/types';
import { toScreen } from '../../render/viewport';
import { dragBox } from '../handles';
import { ACCENT, drawMarquee } from '../overlay';
import type { Editor, Pointer, Tool } from './tool';
import { tr } from '../../i18n/i18n.svelte';

/** Satz-Vorgaben des Bedienfelds für neuen Text. */
export type TextFields = Pick<TextNode, 'font' | 'tracking' | 'lineSpacing' | 'align'>;

interface Session {
  id: string;
  world: Mat;
  created: boolean;
  /** Zählt Eingaben; nur die neueste wird gesetzt. */
  version: number;
}

/**
 * Text (Spec §10): Klick = Grafiktext, Ziehen = Fließtext-Rahmen, Klick auf Pfad/Form = Text auf Pfad, Klick auf Text = bearbeiten.
 * Getippt wird in ein verstecktes Textfeld. Der Satz kommt asynchron aus kw-core; alle Dokument-Schritte laufen
 * deshalb nacheinander (later), damit Abschließen nie vor dem letzten Umriss geschieht. Eine Sitzung = ein Rückgängig-Schritt.
 */
export function textTool(ed: Editor, redraw: () => void, defaults: () => TextFields): Tool {
  let start: Pointer | null = null;
  let box: Box | null = null;
  let edit: Session | null = null;
  let layout: TextLayout | null = null;
  // Knoten, zu dem layout gehört; weicht er ab (Bedienfeld), wird die Schreibmarke neu gesetzt.
  let layoutOf: TextNode | null = null;
  let ta: HTMLTextAreaElement | null = null;
  let queue = Promise.resolve();

  const later = (step: () => void | Promise<void>) => {
    queue = queue
      .then(step)
      .catch((err: unknown) => void (ed.notice = err instanceof Error ? err.message : String(err)))
      .finally(redraw);
  };
  const textNode = (id: string): TextNode | null => {
    const n = findNode(ed.history.current, id);
    return n?.type === 'text' ? n : null;
  };

  function field(): HTMLTextAreaElement {
    if (ta) return ta;
    ta = document.createElement('textarea');
    ta.setAttribute('aria-label', 'Text');
    ta.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;resize:none';
    ta.addEventListener('input', typed);
    ta.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      finish();
    });
    document.addEventListener('selectionchange', () => edit && redraw());
    document.body.append(ta);
    return ta;
  }

  function caret(i: number) {
    field().setSelectionRange(i, i);
  }

  function begin(id: string, topId: string, world: Mat, text: string, click: Point | null, add?: () => void) {
    const [lx, ly] = click ? apply(invert(world), click.x, click.y) : [0, 0];
    if (edit?.id === id) {
      if (layout && click) caret(indexAt(layout, lx, ly));
      return;
    }
    finish();
    const e: Session = { id, world, created: !!add, version: 0 };
    edit = e;
    // Sofort füllen und fokussieren: Tippen vor dem ersten Satz landet schon im richtigen Text.
    const f = field();
    f.value = text;
    caret(text.length);
    f.focus();
    ed.selected = new Set([topId]);
    later(async () => {
      add?.();
      const n = textNode(id);
      if (!n) return;
      const l = await layoutText(textSpec(n));
      if (edit !== e) return;
      layout = l;
      layoutOf = textNode(id);
      if (click) caret(indexAt(l, lx, ly));
    });
  }

  function typed() {
    const e = edit;
    if (!e) return;
    const text = field().value;
    const mine = ++e.version;
    later(async () => {
      if (mine !== e.version) return; // neuere Eingabe folgt
      const n = textNode(e.id);
      if (!n || n.text === text) return;
      const l = await layoutText(textSpec({ ...n, text }));
      ed.history.preview(updateNodes(ed.history.current, [e.id], (m) => (m.type === 'text' ? withLayout({ ...m, text }, l) : m)));
      if (edit === e) (layout = l), (layoutOf = textNode(e.id));
    });
  }

  // Satz neu holen, wenn der Knoten von außen geändert wurde (Bedienfeld); nur für die Schreibmarke.
  function refresh(e: Session, n: TextNode) {
    layoutOf = n;
    later(async () => {
      const l = await layoutText(textSpec(n));
      if (edit === e && layoutOf === n) layout = l;
    });
  }

  // Leerer Text verschwindet (neu angelegt: als hätte es ihn nie gegeben).
  function finish() {
    const e = edit;
    if (!e) return;
    edit = layout = layoutOf = null;
    ta?.blur();
    later(() => {
      if (textNode(e.id)?.text === '') {
        if (e.created) ed.history.cancel();
        if (findNode(ed.history.current, e.id)) ed.history.preview(removeNodes(ed.history.current, [e.id]));
        ed.selected = new Set();
      }
      ed.history.commit();
    });
  }

  function create(transform: Mat, place: Pick<TextNode, 'frame' | 'onPath'>) {
    const layer = activeLayer(ed.page(), ed.layer?.());
    if (!layer) {
      ed.notice = tr('Keine sichtbare, entsperrte Ebene');
      return;
    }
    const n: TextNode = { ...createText(newId(), transform, place), ...defaults() };
    begin(n.id, n.id, transform, '', null, () => ed.history.preview(addNodes(ed.history.current, layer.id, [n])));
  }

  return {
    down(p) {
      start = p;
      box = null;
    },
    move(p) {
      if (!start) return false;
      box = Math.hypot(p.sx - start.sx, p.sy - start.sy) > 2 ? dragBox(start, p, { square: p.shift, center: p.alt }) : null;
      return true;
    },
    up(p) {
      const b = box;
      if (!start) return;
      start = box = null;
      if (b) return create(translate(b.minX, b.minY), { frame: { width: b.maxX - b.minX, height: b.maxY - b.minY } });
      const hit = ed.renderer.hitTest(ed.vp, p.sx, p.sy);
      if (hit?.node.type === 'text') return begin(hit.id, hit.topId, hit.world, hit.node.text, p);
      if (hit && hit.node.type !== 'image' && hit.subpaths.length) {
        return create(hit.world, { onPath: { path: hit.subpaths[0], offset: 0, distance: 0, side: 'above' } });
      }
      create(translate(p.x, p.y), {});
    },
    key(cmd) {
      if (!edit || cmd.name !== 'deselect') return false;
      finish();
      return true;
    },
    finish,
    overlay(ctx, dpr) {
      const vp = ed.vp;
      if (box) drawMarquee(ctx, dpr, box.minX * vp.zoom + vp.x, box.minY * vp.zoom + vp.y, box.maxX * vp.zoom + vp.x, box.maxY * vp.zoom + vp.y);
      const n = edit && textNode(edit.id);
      if (!edit || !n) return;
      if (n !== layoutOf) refresh(edit, n);
      const m = multiply(toScreen(vp), edit.world);
      const at = (x: number, y: number) => apply(m, x, y);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 1;
      ctx.strokeStyle = ACCENT;
      if (n.frame) {
        const { width: fw, height: fh } = n.frame;
        ctx.setLineDash([4, 3]);
        if (layout?.overflow) ctx.strokeStyle = '#e5484d'; // Text passt nicht in den Rahmen
        ctx.beginPath();
        for (const [x, y] of [at(0, 0), at(fw, 0), at(fw, fh), at(0, fh)]) ctx.lineTo(x, y);
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = ACCENT;
      }
      if (!layout) return;
      const { ascent, descent } = layout;
      // Punkt u entlang, v quer (negativ = nach oben) zur Laufrichtung angle ab (x, y).
      const off = (x: number, y: number, angle: number, u: number, v: number) =>
        at(x + u * Math.cos(angle) - v * Math.sin(angle), y + u * Math.sin(angle) + v * Math.cos(angle));
      const f = field();
      const [a, z] = [f.selectionStart, f.selectionEnd];
      ctx.fillStyle = 'rgb(255 106 61 / 0.3)';
      for (const g of layout.glyphs) {
        if (g.index < a || g.index >= z) continue;
        ctx.beginPath();
        const corners: [number, number][] = [[0, -ascent], [g.advance, -ascent], [g.advance, descent], [0, descent]];
        for (const [u, v] of corners) ctx.lineTo(...off(g.x, g.y, g.angle, u, v));
        ctx.fill();
      }
      if (a !== z) return;
      // Leerer Text auf Pfad: Schreibmarke am Pfadanfang.
      const first = n.onPath?.path.nodes[0];
      const c = !layout.glyphs.length && first ? { ...first, angle: 0 } : caretAt(layout, a);
      ctx.beginPath();
      ctx.moveTo(...off(c.x, c.y, c.angle, 0, -ascent));
      ctx.lineTo(...off(c.x, c.y, c.angle, 0, descent));
      ctx.stroke();
    },
  };
}
