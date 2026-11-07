import { deleteNodes as deleteObjects, findNode, updateNodes, worldOf } from '../../model/document';
import { apply, invert, type Mat } from '../../model/geometry';
import {
  breakAt,
  deleteNodes,
  insertNode,
  joinEnds,
  moveHandle,
  moveNodes,
  setClosed,
  setNodeType,
  toCurve,
  toLine,
  type NodeRef,
} from '../../model/path-edit';
import type { Doc, NodeType, PathNode, Point, Subpath } from '../../model/types';
import { reduceNodes } from '../../model/reduce';
import { DEFAULT_NUDGE } from '../../model/units';
import { worldScale } from '../../render/scene';
import { hitPath, nodeKey } from '../node-hit';
import { drawNodes } from '../overlay';
import type { Editor, Pointer, Tool } from './tool';
import { tr } from '../../i18n/i18n.svelte';

type Subs = readonly Subpath[];

/** Knoten-Werkzeug: bearbeitet genau einen gewählten Pfad (oberste Ebene). */
export function nodeTool(ed: Editor): Tool {
  let sel = new Set<string>();
  let seg: { sub: number; seg: number; t: number } | null = null;
  let known: Subs | null = null; // Auswahl gilt nur für diese Geometrie; Undo & Co. setzen sie zurück.
  let drag: { kind: 'nodes' | 'in' | 'out'; ref: NodeRef; start: Pointer; doc: Doc; subs: Subs; moved: boolean } | null = null;

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

  const actions = [
    { label: tr('Ecke'), run: () => setType('corner') },
    { label: tr('Glatt'), run: () => setType('smooth') },
    { label: tr('Symmetrisch'), run: () => setType('symmetric') },
    { label: tr('Gerade'), run: () => needSeg((t, s) => toLine(t.subpaths, s.sub, s.seg)) },
    { label: tr('Kurve'), run: () => needSeg((t, s) => toCurve(t.subpaths, s.sub, s.seg)) },
    { label: tr('Knoten +'), run: () => needSeg((t, s) => insertNode(t.subpaths, s.sub, s.seg, s.t)) },
    { label: tr('Löschen'), run: () => edit((t) => (sel.size ? deleteNodes(t.subpaths, refs()) : null)) },
    { label: tr('Knoten reduzieren'), run: () => reduce(level, true) },
    { label: tr('Trennen'), run: () => edit((t) => (sel.size === 1 ? breakAt(t.subpaths, refs()[0]) : ((ed.notice = tr('Einen Knoten wählen')), null))) },
    {
      label: tr('Verbinden'),
      run: () =>
        edit((t) => {
          const r = refs();
          return r.length === 2 ? joinEnds(t.subpaths, r[0], r[1]) : ((ed.notice = tr('Zwei Endknoten wählen')), null);
        }),
    },
    {
      label: tr('Schließen/Öffnen'),
      run: () =>
        edit((t) => {
          const s = seg?.sub ?? refs()[0]?.sub;
          return s === undefined ? null : setClosed(t.subpaths, s, !t.subpaths[s].closed);
        }),
    },
  ];

  return {
    actions,
    slider: { label: tr('Glätte'), value: () => level, set: reduce },
    down(p) {
      const t = sync();
      const hit = t && hitPath(t.subpaths, world(t), ed.vp, p.sx, p.sy, sel);
      if (t && hit) {
        const doc = ed.history.current;
        if (hit.kind === 'seg') {
          if (!p.shift) sel = new Set();
          seg = hit;
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
      ed.selected = other ? new Set([other.id]) : new Set();
      sync();
      shapeHint();
    },
    move(p) {
      const t = target();
      if (!drag || !t) return false;
      drag.moved ||= Math.hypot(p.sx - drag.start.sx, p.sy - drag.start.sy) > 2;
      if (!drag.moved) return false;
      const q = local(t, p);
      if (drag.kind === 'nodes') {
        const s = local(t, drag.start);
        commit(t, moveNodes(drag.subs, refs(), q.x - s.x, q.y - s.y), true, drag.doc);
      } else commit(t, moveHandle(drag.subs, drag.ref, drag.kind, q), true, drag.doc);
      return true;
    },
    up() {
      if (drag?.moved) ed.history.commit();
      drag = null;
    },
    dblclick(p) {
      const t = sync();
      const hit = t && hitPath(t.subpaths, world(t), ed.vp, p.sx, p.sy, sel);
      if (t && hit?.kind === 'seg') edit(() => insertNode(t.subpaths, hit.sub, hit.seg, hit.t));
    },
    key(cmd) {
      const t = sync();
      if (!t || !sel.size) return false;
      if (cmd.name === 'delete') edit(() => deleteNodes(t.subpaths, refs()));
      else if (cmd.name === 'deselect') sel = new Set();
      else if (cmd.name === 'nudge') {
        const step = ed.history.current.nudge ?? DEFAULT_NUDGE;
        const [a, b] = [local(t, { x: 0, y: 0 }), local(t, { x: cmd.dx * step, y: cmd.dy * step })];
        commit(t, moveNodes(t.subpaths, refs(), b.x - a.x, b.y - a.y));
      } else return false;
      return true;
    },
    overlay(ctx, dpr) {
      const t = sync();
      if (t) drawNodes(ctx, ed.vp, dpr, world(t), t.subpaths, sel, seg);
    },
  };
}
