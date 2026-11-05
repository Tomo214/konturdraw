import { addNodes, activeLayer, newId } from '../../model/document';
import { IDENTITY } from '../../model/geometry';
import type { History } from '../../model/history';
import { setFill, type FillSpec } from '../../model/style';
import type { Color, Doc, Guide, LeafNode, Page, Stroke, Subpath } from '../../model/types';
import type { Renderer } from '../../render/renderer';
import type { SnapKind } from '../../render/snap';
import type { Viewport } from '../../render/viewport';
import type { Command } from '../shortcuts';

/** Zeiger in Bildschirm- (sx, sy, immer roh) und Seitenkoordinaten (x, y, ggf. gefangen). */
export interface Pointer {
  sx: number;
  sy: number;
  x: number;
  y: number;
  shift: boolean;
  alt: boolean;
  /** Strg (Mac: ⌘): Klick wählt im Objekt eine Gruppenstufe tiefer. */
  mod?: boolean;
  /** Woran x, y gefangen wurden; fehlt = ungefangen. */
  snap?: SnapKind;
}

/** Was ein Werkzeug vom Editor sieht. */
export interface Editor {
  readonly history: History<Doc>;
  readonly renderer: Renderer;
  readonly vp: Viewport;
  /** Ansicht setzen (Hand, Zoom); zeichnet wie eine Geste neu. */
  view(vp: Viewport): void;
  /** Breite, Höhe der Zeichenfläche in CSS-Pixeln. */
  readonly viewSize: readonly [number, number];
  selected: Set<string>;
  /** Gewählte Hilfslinie; schließt eine Objekt-Auswahl aus. */
  guide: string | null;
  /** Sichtbare Hilfslinien der Seite (ausgeblendet = keine). */
  guides(): readonly Guide[];
  notice: string;
  page(): Page;
  /** Im Objekt-Manager gewählte Ebene der aktuellen Seite. */
  layer?(): string | undefined;
  /** Vorgaben des Bedienfelds für neue Objekte. */
  readonly fill: FillSpec;
  readonly stroke: Stroke | null;
}

/** Gewählter Verlaufsknoten (7b): Stelle index von count, Lage 0–1 auf der Linie. */
export interface Knot {
  index: number;
  count: number;
  offset: number;
  color: Color;
}

export interface Tool {
  down(p: Pointer): void;
  /** true = neu zeichnen (auch ohne gedrückte Taste, z. B. Gummiband des Stifts). */
  move(p: Pointer): boolean;
  up(p: Pointer): void;
  dblclick?(p: Pointer): void;
  /** true = Befehl verbraucht, Standardverhalten entfällt. */
  key?(cmd: Command): boolean;
  /** Palettenfarbe (Linksklick): true = vom Werkzeug verbraucht, z. B. für den gewählten Verlaufsknoten. */
  paint?(c: Color): boolean;
  /** Palettenfarbe auf die Zeichenfläche gezogen (7c): true = verbraucht. */
  drop?(p: Pointer, c: Color): boolean;
  /** Gewählter Verlaufsknoten für die Eigenschaftsleiste: get = null ohne Wahl; set = ein Rückgängig-Schritt. */
  readonly knot?: { get(): Knot | null; set(patch: { offset?: number; color?: Color }): void };
  /** Nach dem Drücken: Objekte/Hilfslinien, an denen beim Ziehen nicht gefangen wird (die bewegten). */
  snapSkip?(): ReadonlySet<string>;
  /** true = Zeiger wird nie gefangen (freie Spur, z. B. Radierer). */
  readonly noSnap?: boolean;
  /** Beim Werkzeugwechsel: Angefangenes abschließen. */
  finish?(): void;
  overlay(ctx: CanvasRenderingContext2D, dpr: number): void;
  readonly actions?: readonly { label: string; run(): void }[];
  /** Regler 0–100 in der Eigenschaftsleiste; done = losgelassen → ein Rückgängig-Schritt. */
  readonly slider?: { label: string; value(): number; set(v: number, done: boolean): void };
}

/** Neues Objekt mit den Vorgaben des Bedienfelds auf der aktiven Ebene, danach gewählt. Verlauf passt sich der Objekt-Box an. */
export function addLeaf(ed: Editor, leaf: LeafNode): void {
  const layer = activeLayer(ed.page(), ed.layer?.());
  if (!layer) {
    ed.notice = 'Keine sichtbare, entsperrte Ebene';
    return;
  }
  const node = setFill({ ...leaf, style: { fill: null, stroke: ed.stroke } }, ed.fill);
  ed.history.push(addNodes(ed.history.current, layer.id, [node]));
  ed.selected = new Set([node.id]);
}

export function addPath(ed: Editor, sp: Subpath): void {
  addLeaf(ed, { type: 'path', id: newId(), transform: IDENTITY, style: { fill: null, stroke: null }, subpaths: [sp] });
}
