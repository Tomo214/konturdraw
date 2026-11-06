import type { Mat } from './geometry';
import type { Unit } from './units';

// Einheiten: mm. Arrays laufen von unten nach oben (Index 0 = ganz hinten).
// Alles ist unveränderlich: Änderungen erzeugen neue Objekte, Unberührtes wird geteilt.

/** Werte 0..1, Graustufen 0 = schwarz. spot = Name einer Volltonfarbe, values = ihr Ersatzwert für Anzeige und Prozessdruck. */
export type Color = (
  | { model: 'rgb'; values: readonly [number, number, number] }
  | { model: 'cmyk'; values: readonly [number, number, number, number] }
  | { model: 'gray'; values: readonly [number] }
) & { spot?: string };

export interface GradientStop {
  offset: number; // 0..1
  color: Color;
}

/** Verlauf in Objekt-Koordinaten. Linear: from → to. Radial: Mitte from, Radius |to − from|. */
export interface Gradient {
  kind: 'linear' | 'radial';
  from: Point;
  to: Point;
  stops: readonly GradientStop[];
}

export type Fill = Color | Gradient;

export interface Stroke {
  color: Color;
  width: number;
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
  /** Fehlt/false: Breite bleibt beim Skalieren gleich und wird nie verzerrt. */
  scaleWithObject?: boolean;
  /** Strichmuster: Strich, Lücke, … als Vielfache der Breite (gerade Anzahl); fehlt = durchgehend. */
  dash?: number[];
}

export interface Style {
  fill: Fill | null;
  stroke: Stroke | null;
}

export interface Point {
  x: number;
  y: number;
}

/** Ecke: Anfasser unabhängig · glatt: Anfasser auf einer Linie · symmetrisch: zusätzlich gleich lang. */
export type NodeType = 'corner' | 'smooth' | 'symmetric';

/** Knoten mit absoluten Anfassern im Pfad-Koordinatensystem. Fehlender Anfasser = liegt auf dem Knoten. */
export interface PathPoint extends Point {
  type: NodeType;
  handleIn?: Point;
  handleOut?: Point;
}

/**
 * Segment i läuft von nodes[i] nach nodes[i+1], geschlossen zusätzlich vom letzten zum ersten Knoten.
 * Gerade, wenn beide beteiligten Anfasser fehlen, sonst kubische Bézierkurve.
 */
export interface Subpath {
  closed: boolean;
  nodes: readonly PathPoint[];
}

interface NodeBase {
  id: string;
  name?: string;
  transform: Mat;
  /** Deckkraft 0–1 (Oberfläche: Transparenz in %); fehlt = deckend. Gruppe: wirkt auf jedes Kind (multipliziert). */
  opacity?: number;
}

export interface PathNode extends NodeBase {
  type: 'path';
  style: Style;
  subpaths: readonly Subpath[];
  /** Fehlt = nonzero. Kombinieren setzt gerade/ungerade: wo sich Teilpfade überlappen, entsteht ein Loch. */
  fillRule?: 'evenodd';
  contents?: readonly Node[];
}

/**
 * Formen behalten ihre Parameter (Box im Objekt-Koordinatensystem).
 * Eigenes Objekt statt Felder am Knoten: Verschieben teilt es → Geometrie-Caches bleiben gültig.
 */
export type Shape =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; radius: number }
  | { kind: 'ellipse'; x: number; y: number; width: number; height: number }
  /** inner: Stern-Innenradius als Anteil des Außenradius (0..1); null = Vieleck. */
  | { kind: 'polygon'; x: number; y: number; width: number; height: number; sides: number; inner: number | null };

export interface ShapeNode extends NodeBase {
  type: 'shape';
  style: Style;
  shape: Shape;
  /**
   * Inhalt eines Rahmens („In Rahmen einfügen“), auch bei PathNode: im Koordinatensystem des Rahmens
   * (wandert und skaliert mit), am Umriss beschnitten; Füllung des Rahmens liegt darunter, Kontur darüber.
   */
  contents?: readonly Node[];
}

/** Pixelbild auf (0,0)–(width,height) mm im Objektsystem; die Bytes liegen in der Bildablage (io/images.ts). */
export interface ImageNode extends NodeBase {
  type: 'image';
  /** Inhalts-Hash = Dateiname images/<hash>.png in der .kwk */
  image: string;
  width: number;
  height: number;
}

export interface GroupNode extends NodeBase {
  type: 'group';
  children: readonly Node[];
}

export interface TextFont {
  family: string;
  /** 100–900 */
  weight: number;
  italic: boolean;
  /** pt */
  size: number;
}

/**
 * Grafiktext (Ursprung = Grundlinie der ersten Zeile), Fließtext (frame, Ursprung = Rahmen oben links)
 * oder Text auf Pfad (onPath). Gesetzt wird in kw-core; outline ist das Ergebnis und dient zum Zeichnen.
 */
export interface TextNode extends NodeBase {
  type: 'text';
  style: Style;
  /** '\n' = neue Zeile */
  text: string;
  font: TextFont;
  /** Laufweite in % der Leerzeichenbreite */
  tracking: number;
  /** % der natürlichen Zeilenhöhe der Schrift */
  lineSpacing: number;
  align: 'left' | 'center' | 'right';
  frame?: { width: number; height: number };
  /** Kopie des Pfads in Textkoordinaten (keine Live-Verbindung zum Original). */
  onPath?: { path: Subpath; offset: number; distance: number; side: 'above' | 'below' };
  outline: readonly Subpath[];
}

/** Blätter mit Stil (Füllung/Kontur). */
export type LeafNode = PathNode | ShapeNode | TextNode;
export type Node = LeafNode | ImageNode | GroupNode;

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  printable: boolean;
  children: readonly Node[];
}

/** Hilfslinie der Seite: h = waagerecht bei y = pos, v = senkrecht bei x = pos (Seiten-mm). */
export interface Guide {
  id: string;
  axis: 'h' | 'v';
  pos: number;
  locked?: boolean;
}

export interface Page {
  id: string;
  /** Fehlt = „Seite n“. */
  name?: string;
  width: number;
  height: number;
  layers: readonly Layer[];
  guides?: readonly Guide[];
}

/** Fehlt im Dokument = RGB, Systemprofil, relativ farbmetrisch (DEFAULT_COLOR_SETTINGS). */
export interface ColorSettings {
  /** CMYK: PDF-Vektorfarben werden reines CMYK über das Profil. */
  mode: 'rgb' | 'cmyk';
  /** Pfad zum ICC-Profil; null = Systemprofil */
  cmykProfile: string | null;
  intent: 'perceptual' | 'relative' | 'saturation' | 'absolute';
}

export interface PaletteEntry {
  name: string;
  color: Color;
}

export interface Palette {
  id: string;
  name: string;
  colors: readonly PaletteEntry[];
}

export interface Doc {
  schemaVersion: 1;
  pages: readonly Page[];
  color?: ColorSettings;
  /** Eigene Paletten; die Standardpalette gehört zum Programm (model/palette.ts). */
  palettes?: readonly Palette[];
  /** Zeichnungseinheit für Anzeige und Eingabe; gerechnet wird immer in mm. */
  units?: Unit;
  /** Verschiebe-Schritt der Pfeiltasten in mm. */
  nudge?: number;
  /** Lineal-Nullpunkt in Seiten-mm; fehlt = unten links auf der Seite (wie Vorbild). */
  origin?: Point;
  /** Rasterabstand waagerecht/senkrecht in mm, ausgehend vom Nullpunkt. */
  grid?: { x: number; y: number };
}
