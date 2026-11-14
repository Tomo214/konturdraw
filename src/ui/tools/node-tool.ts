import { deleteNodes as deleteObjects, findNode, updateNodes, worldOf } from '../../model/document';
import { apply, invert, multiply, type Box, type Mat } from '../../model/geometry';
import type { AlignEdge, AlignTo } from '../../model/arrange';
import {
  alignNodes,
  bendSegment,
  breakAt,
  deleteNodes,
  insertNode,
  joinEnds,
  moveHandle,
  moveNodes,
  reverseSubpath,
  setClosed,
  setNodeType,
  toCurve,
  toLine,
  transformPathNodes,
  type NodeRef,
} from '../../model/path-edit';
import type { Doc, NodeType, PathNode, Point, Subpath } from '../../model/types';
import { pointInPolygon } from '../../model/lasso';
import { reduceNodes } from '../../model/reduce';
import { extractSubpath } from '../../model/shaping';
import { DEFAULT_NUDGE } from '../../model/units';
import { worldScale } from '../../render/scene';
import { screenToPage } from '../../render/viewport';
import { hitPath, nodeKey, nodesWhere } from '../node-hit';
import { handleAt, handleCursor, handleNear, rotateFromDrag, scaleFromHandle, skewFromHandle, type Handle } from '../handles';
import { drawLasso, drawMarquee, drawNodes, drawSelectionBox } from '../overlay';
import type { Editor, Pointer, Tool } from './tool';
import { tr } from '../../i18n/i18n.svelte';

type Subs = readonly Subpath[];
type Act = { label: string; run(): void; on(): boolean; checked?(): boolean };

/** Knoten-Werkzeug: bearbeitet genau einen gewählten Pfad (oberste Ebene). */
export function nodeTool(ed: Editor): Tool {
  let sel = new Set<string>();
  let seg: { sub: number; seg: number; t: number } | null = null;
  let known: Subs | null = null; // Auswahl gilt nur für diese Geometrie; Undo & Co. setzen sie zurück.
  // seg: ref.index = Segmentnummer, t = gegriffene Stelle
  let drag: { kind: 'nodes' | 'in' | 'out' | 'seg'; ref: NodeRef; t?: number; start: Pointer; doc: Doc; subs: Subs; moved: boolean } | null = null;
  // Rahmen auf leerer Fläche wählt Knoten (wie Vorbild); Alt = Freihand-Spur, Umschalt fügt hinzu. hit = Objekt unter dem Klick.
  let band: { start: Pointer; cur: Pointer; pts: Pointer[] | null; add: boolean; hit: string | null; moved: boolean } | null = null;
  // Knoten transformieren (wie Vorbild): Griffrahmen um ≥ 2 gewählte Knoten; Griffe wie beim Auswahlwerkzeug.
  let xf: 'scale' | 'rotate' | null = null;
  let grab: { handle: Handle; box: Box; start: Pointer; doc: Doc; subs: Subs; moved: boolean } | null = null;
  const raw = (p: Pointer): Pointer => {
    const [x, y] = screenToPage(ed.vp, p.sx, p.sy);
    return { ...p, x, y };
  };

  function target(): PathNode | null {
    if (ed.selected.size !== 1) return null;
    const n = findNode(ed.history.current, [...ed.selected][0]);
    return n?.type === 'path' ? n : null;
  }

  // Formen und Text haben keine eigenen Knoten; true = Hinweis gesetzt.
  function shapeHint(): boolean {
    const n = ed.selected.size === 1 ? findNode(ed.history.current, [...ed.selected][0]) : undefined;
    const what = n?.type === 'shape' ? tr('Form') : n?.type === 'text' ? 'Text' : null;
    if (what) ed.notice = tr('{what}: erst in Kurven umwandeln (Mod+Shift+O)', { what });
    return !!what;
  }

  function sync(): PathNode | null {
    const t = target();
    if (!t || t.subpaths !== known) {
      sel = new Set();
      seg = null;
      known = t?.subpaths ?? null;
    }
    return t;
  }

  const refs = (): NodeRef[] => [...sel].map((k) => k.split(':').map(Number)).map(([sub, index]) => ({ sub, index }));

  // Lage auf der Seite – auch für Kurven in verschobenen/gedrehten Gruppen.
  const world = (t: PathNode): Mat => worldOf(ed.history.current, t.id) ?? t.transform;

  function local(t: PathNode, p: Point): Point {
    const [x, y] = apply(invert(world(t)), p.x, p.y);
    return { x, y };
  }

  function commit(t: PathNode, subs: Subs, preview = false, base = ed.history.current) {
    const doc = subs.length ? updateNodes(base, [t.id], (n) => ({ ...(n as PathNode), subpaths: subs })) : deleteObjects(base, [t.id]);
    if (preview) ed.history.preview(doc);
    else ed.history.push(doc);
    known = subs;
    if (!subs.length) ed.selected = new Set();
  }

  // Strukturänderung: Knotennummern verschieben sich → Auswahl leeren.
  function edit(fn: (t: PathNode) => Subs | null) {
    const t = sync();
    if (!t) {
      if (!shapeHint()) ed.notice = tr('Knoten: genau einen Pfad wählen');
      return;
    }
    const subs = fn(t);
    if (!subs || subs === t.subpaths) return;
    commit(t, subs);
    sel = new Set();
    seg = null;
  }

  const needSeg = (fn: (t: PathNode, s: NonNullable<typeof seg>) => Subs) =>
    edit((t) => (seg ? fn(t, seg) : ((ed.notice = tr('Segment anklicken')), null)));

  function setType(type: NodeType) {
    const t = sync();
    if (!t || !sel.size) return void (ed.notice = tr('Knoten wählen'));
    commit(t, refs().reduce((s, r) => setNodeType(s, r, type), t.subpaths));
  }

  // Knoten reduzieren: Glätte 0–100 → erlaubte Abweichung 0–2 mm (Seite), live aus dem Stand vor dem Ziehen.
  let level = 25;
  let reducing: { t: PathNode; doc: Doc; refs: NodeRef[] | null } | null = null;
  const count = (subs: Subs) => subs.reduce((n, s) => n + s.nodes.length, 0);
  function reduce(v: number, done: boolean) {
    level = v;
    const t = reducing?.t ?? sync();
    if (!t) return void (shapeHint() || (ed.notice = tr('Knoten: genau einen Pfad wählen')));
    reducing ??= { t, doc: ed.history.current, refs: sel.size ? refs() : null };
    const subs = reduceNodes(t.subpaths, reducing.refs, ((level / 100) ** 2 * 2) / worldScale(world(t)));
    if (subs === t.subpaths) ed.history.preview(reducing.doc);
    else commit(t, subs, true, reducing.doc);
    known = subs;
    ed.notice = tr('Knoten: {from} → {to}', { from: count(t.subpaths), to: count(subs) });
    if (!done) return;
    ed.history.commit();
    reducing = null;
    sel = new Set();
    seg = null;
  }

  function extract() {
    const t = sync();
    if (!t) return void (shapeHint() || (ed.notice = tr('Knoten: genau einen Pfad wählen')));
    const s = seg?.sub ?? refs()[0]?.sub;
    if (s === undefined) return void (ed.notice = tr('Segment oder Knoten anklicken'));
    const r = extractSubpath(ed.history.current, t.id, s);
    if (!r) return void (ed.notice = tr('Pfad hat nur einen Teilpfad'));
    ed.history.push(r.doc);
    ed.selected = new Set([r.id]);
  }

  // Ausrichten (Taste, Menü, Andockfenster) mit gewählten Knoten wie Vorbild: Rahmen der Knoten, Seite oder Seitenmitte.
  function align(edge: AlignEdge, to?: AlignTo) {
    const t = sync();
    if (!t) return;
    const { width: w, height: h } = ed.page();
    const ref =
      edge === 'page' || to === 'page' ? { minX: 0, minY: 0, maxX: w, maxY: h } : to === 'pageCenter' ? { minX: w / 2, minY: h / 2, maxX: w / 2, maxY: h / 2 } : undefined;
    if (!ref && sel.size < 2) return void (ed.notice = tr('Mindestens zwei Knoten wählen'));
    const subs = alignNodes(t.subpaths, refs(), world(t), edge, ref);
    if (subs !== t.subpaths) commit(t, subs);
  }

  // Rahmen der gewählten Knoten auf der Seite; null = Modus aus oder zu wenig Knoten.
  function frame(t: PathNode): Box | null {
    if (!xf || sel.size < 2) return null;
    const at = refs().map((r) => apply(world(t), t.subpaths[r.sub].nodes[r.index].x, t.subpaths[r.sub].nodes[r.index].y));
    const [xs, ys] = [at.map((q) => q[0]), at.map((q) => q[1])];
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }

  // Wie Auswahlwerkzeug: gezogen wird der Griff (Versatz ausgeglichen); Strecken: Ecke proportional, Alt frei, Umschalt aus der Mitte.
  // Drehen/Neigen: Ecke dreht um die Mitte, Seite neigt. Ergebnis als Matrix in Pfad-Koordinaten.
  function xfMatrix(t: PathNode, g: NonNullable<typeof grab>, p: Pointer): Mat {
    const hp = handleAt(g.box, g.handle);
    const q = { x: hp.x + p.x - g.start.x, y: hp.y + p.y - g.start.y };
    const c = { x: (g.box.minX + g.box.maxX) / 2, y: (g.box.minY + g.box.maxY) / 2 };
    const m =
      xf === 'scale'
        ? scaleFromHandle(g.box, g.handle, q, { free: p.alt, center: p.shift, step: !!p.mod })
        : g.handle.length === 1
          ? skewFromHandle(g.box, g.handle, hp, q)
          : rotateFromDrag(c, hp, q, !!p.mod);
    const w = world(t);
    return multiply(invert(w), multiply(m, w));
  }
  const toggle = (m: 'scale' | 'rotate') => () => void (xf = xf === m ? null : m);

  const sub = () => seg?.sub ?? refs()[0]?.sub;
  const nodes = (n: number) => () => sel.size >= n;
  const onSeg = () => !!seg;
  // on = passt zur Auswahl; das Rechtsklick-Menü zeigt den Rest grau, die Leiste meldet beim Klick, was fehlt.
  const A = {
    corner: { label: tr('Ecke'), run: () => setType('corner'), on: nodes(1) },
    smooth: { label: tr('Glatt'), run: () => setType('smooth'), on: nodes(1) },
    symmetric: { label: tr('Symmetrisch'), run: () => setType('symmetric'), on: nodes(1) },
    line: { label: tr('Gerade'), run: () => needSeg((t, s) => toLine(t.subpaths, s.sub, s.seg)), on: onSeg },
    curve: { label: tr('Kurve'), run: () => needSeg((t, s) => toCurve(t.subpaths, s.sub, s.seg)), on: onSeg },
    add: { label: tr('Knoten +'), run: () => needSeg((t, s) => insertNode(t.subpaths, s.sub, s.seg, s.t)), on: onSeg },
    del: { label: tr('Löschen'), run: () => edit((t) => (sel.size ? deleteNodes(t.subpaths, refs()) : null)), on: nodes(1) },
    reduce: { label: tr('Knoten reduzieren'), run: () => reduce(level, true), on: () => true },
    split: {
      label: tr('Trennen'),
      run: () => edit((t) => (sel.size === 1 ? breakAt(t.subpaths, refs()[0]) : ((ed.notice = tr('Einen Knoten wählen')), null))),
      on: () => sel.size === 1,
    },
    join: {
      label: tr('Verbinden'),
      run: () =>
        edit((t) => {
          const r = refs();
          return r.length === 2 ? joinEnds(t.subpaths, r[0], r[1]) : ((ed.notice = tr('Zwei Endknoten wählen')), null);
        }),
      on: () => sel.size === 2,
    },
    close: {
      label: tr('Schließen/Öffnen'),
      run: () =>
        edit((t) => {
          const s = sub();
          return s === undefined ? null : setClosed(t.subpaths, s, !t.subpaths[s].closed);
        }),
      on: () => sub() !== undefined,
    },
    reverse: {
      label: tr('Richtung umkehren'),
      run: () =>
        edit((t) => {
          const s = sub();
          return s === undefined ? ((ed.notice = tr('Segment oder Knoten anklicken')), null) : reverseSubpath(t.subpaths, s);
        }),
      on: () => sub() !== undefined,
    },
    extract: { label: tr('Teilpfad herauslösen'), run: extract, on: () => sub() !== undefined && (target()?.subpaths.length ?? 0) > 1 },
    // Knoten auf eine waagerechte bzw. senkrechte Linie (Mittelachse ihres Rahmens)
    alignH: { label: tr('Waagerecht ausrichten'), run: () => align('centerY'), on: nodes(2) },
    alignV: { label: tr('Senkrecht ausrichten'), run: () => align('centerX'), on: nodes(2) },
    stretch: { label: tr('Knoten strecken/skalieren'), run: toggle('scale'), on: nodes(2), checked: () => xf === 'scale' },
    turn: { label: tr('Knoten drehen/neigen'), run: toggle('rotate'), on: nodes(2), checked: () => xf === 'rotate' },
  };
  const actions = [A.corner, A.smooth, A.symmetric, A.line, A.curve, A.add, A.del, A.reduce, A.split, A.join, A.close, A.reverse, A.extract];
  const MENU: (Act | null)[] = [A.add, A.del, A.join, A.split, null, A.line, A.curve, null, A.corner, A.smooth, A.symmetric, null, A.reverse, A.close, A.extract, null, A.alignH, A.alignV, null, A.stretch, A.turn];

  return {
    actions,
    slider: { label: tr('Glätte'), value: () => level, set: reduce },
    down(p) {
      const t = sync();
      const hit = t && hitPath(t.subpaths, world(t), ed.vp, p.sx, p.sy, sel);
      // Vorrang: Knoten und Anfasser, dann Transformationsgriff, dann Segment
      const box = t && (!hit || hit.kind === 'seg') && frame(t);
      const handle = box && handleNear(ed.vp, box, p.sx, p.sy);
      if (t && box && handle) return void (grab = { handle, box, start: p, doc: ed.history.current, subs: t.subpaths, moved: false });
      if (t && hit) {
        const doc = ed.history.current;
        if (hit.kind === 'seg') {
          if (!p.shift) sel = new Set();
          seg = hit;
          drag = { kind: 'seg', ref: { sub: hit.sub, index: hit.seg }, t: hit.t, start: p, doc, subs: t.subpaths, moved: false };
          return;
        }
        seg = null;
        const key = nodeKey(hit.ref);
        if (hit.kind === 'node') {
          if (p.shift) {
            sel = new Set(sel);
            if (!sel.delete(key)) sel.add(key);
          } else if (!sel.has(key)) sel = new Set([key]);
        }
        drag = { kind: hit.kind === 'node' ? 'nodes' : hit.kind, ref: hit.ref, start: p, doc, subs: t.subpaths, moved: false };
        return;
      }
      // Anderen Pfad anklicken wählt ihn zum Bearbeiten – auch in einer Gruppe.
      const other = ed.renderer.hitTest(ed.vp, p.sx, p.sy);
      if (t && (!other || other.id === t.id)) {
        const q = raw(p);
        band = { start: q, cur: q, pts: p.alt ? [q] : null, add: p.shift, hit: other?.id ?? null, moved: false };
        return;
      }
      ed.selected = other ? new Set([other.id]) : new Set();
      sync();
      shapeHint();
    },
    move(p) {
      if (band) {
        band.cur = raw(p);
        band.pts?.push(band.cur);
        band.moved ||= Math.hypot(p.sx - band.start.sx, p.sy - band.start.sy) > 2;
        return band.moved;
      }
      const t = target();
      if (grab && t) {
        grab.moved ||= Math.hypot(p.sx - grab.start.sx, p.sy - grab.start.sy) > 2;
        if (grab.moved) commit(t, transformPathNodes(grab.subs, refs(), xfMatrix(t, grab, p)), true, grab.doc);
        return grab.moved;
      }
      if (!drag || !t) return false;
      drag.moved ||= Math.hypot(p.sx - drag.start.sx, p.sy - drag.start.sy) > 2;
      if (!drag.moved) return false;
      const q = local(t, p);
      if (drag.kind === 'nodes') {
        const s = local(t, drag.start);
        commit(t, moveNodes(drag.subs, refs(), q.x - s.x, q.y - s.y), true, drag.doc);
      } else if (drag.kind === 'seg') {
        const s = local(t, drag.start);
        commit(t, bendSegment(drag.subs, drag.ref.sub, drag.ref.index, drag.t!, { x: q.x - s.x, y: q.y - s.y }), true, drag.doc);
      } else commit(t, moveHandle(drag.subs, drag.ref, drag.kind, q), true, drag.doc);
      return true;
    },
    up() {
      if (band) {
        const b = band;
        band = null;
        [sel, seg] = [b.add ? sel : new Set(), null];
        if (!b.moved) return void ((ed.selected = b.hit ? new Set([b.hit]) : new Set()), sync());
        const t = sync();
        const [x0, x1, y0, y1] = [Math.min(b.start.x, b.cur.x), Math.max(b.start.x, b.cur.x), Math.min(b.start.y, b.cur.y), Math.max(b.start.y, b.cur.y)];
        const inside = b.pts ? (q: Point) => pointInPolygon(q.x, q.y, b.pts!) : (q: Point) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1;
        if (t) sel = new Set([...sel, ...nodesWhere(t.subpaths, world(t), inside)]);
        return;
      }
      if (drag?.moved || grab?.moved) ed.history.commit();
      [drag, grab] = [null, null];
    },
    dblclick(p) {
      const t = sync();
      const hit = t && hitPath(t.subpaths, world(t), ed.vp, p.sx, p.sy, sel);
      if (t && hit?.kind === 'seg') edit(() => insertNode(t.subpaths, hit.sub, hit.seg, hit.t));
      else if (t && hit?.kind === 'node') edit(() => deleteNodes(t.subpaths, [hit.ref])); // wie Vorbild
    },
    key(cmd) {
      const t = sync();
      if (t && cmd.name === 'selectAll') return ([sel, seg] = [new Set(nodesWhere(t.subpaths, world(t), () => true)), null]), true;
      if (!t || !sel.size) return false;
      if (cmd.name === 'delete') edit(() => deleteNodes(t.subpaths, refs()));
      else if (cmd.name === 'align') align(cmd.edge, cmd.to);
      else if (cmd.name === 'deselect') sel = new Set();
      else if (cmd.name === 'nudge') {
        const step = ed.history.current.nudge ?? DEFAULT_NUDGE;
        const [a, b] = [local(t, { x: 0, y: 0 }), local(t, { x: cmd.dx * step, y: cmd.dy * step })];
        commit(t, moveNodes(t.subpaths, refs(), b.x - a.x, b.y - a.y));
      } else return false;
      return true;
    },
    // Rechtsklick auf Knoten oder Segment wählt dort (gewählte Knoten bleiben) und zeigt die Knotenbefehle.
    menu(p) {
      const t = sync();
      const hit = t && hitPath(t.subpaths, world(t), ed.vp, p.sx, p.sy, sel);
      if (!t || !hit) return null;
      if (hit.kind === 'seg') [sel, seg] = [new Set(), hit];
      else {
        if (!sel.has(nodeKey(hit.ref))) sel = new Set([nodeKey(hit.ref)]);
        seg = null;
      }
      return MENU.map((a) => a && { label: a.label, run: a.run, disabled: !a.on(), checked: a.checked?.() });
    },
    cursor(p) {
      if (grab) return handleCursor(grab.handle, xf ?? 'scale');
      const t = target();
      const hit = t && hitPath(t.subpaths, world(t), ed.vp, p.sx, p.sy, sel);
      const box = t && (!hit || hit.kind === 'seg') && frame(t);
      const h = box && handleNear(ed.vp, box, p.sx, p.sy);
      return h ? handleCursor(h, xf!) : '';
    },
    overlay(ctx, dpr) {
      const t = sync();
      if (t) drawNodes(ctx, ed.vp, dpr, world(t), t.subpaths, sel, seg);
      const box = t && frame(t);
      if (box) drawSelectionBox(ctx, ed.vp, dpr, box, xf!);
      if (band?.moved && band.pts) drawLasso(ctx, ed.vp, dpr, band.pts);
      else if (band?.moved) drawMarquee(ctx, dpr, band.start.sx, band.start.sy, band.cur.sx, band.cur.sy);
    },
  };
}
