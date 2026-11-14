// Brücke zur Desktop-App (src/tauri/src/files.rs). Dialoge laufen dort; null = abgebrochen.
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { ContourJob } from '../model/contour';
import type { EraseJob, KnifeJob } from '../model/cutting';
import type { OutlineJob } from '../model/outline';
import type { ShapeJob } from '../model/shaping';
import type { Sheets } from '../model/tiles';
import type { TextLayout, textSpec } from '../model/text';
import type { Color, ColorSettings, Subpath } from '../model/types';
import type { IrScene } from './ir';
import { tr } from '../i18n/i18n.svelte';

/** Hash → PNG als Base64 */
export type Wire = Record<string, string>;

export interface Opened {
  path: string;
  document: string;
  images: Wire;
}

export interface Imported {
  scene: IrScene;
  images: Wire;
  warnings: string[];
  raster: boolean;
}

/** pdfx = druckfertig (PDF/X-4), dxf/plt = Plotter/Laser. */
export type ExportFormat = 'pdf' | 'pdfx' | 'svg' | 'png' | 'dxf' | 'plt';

/** Gegenstück zu ExportOptions in files.rs; jedes Format liest nur seine Felder. */
export interface ExportOptions {
  dpi: number;
  bleed: number;
  marks: boolean;
  title: string;
  plot: { unitsPerMm: number; origin: 'lowerleft' | 'center' };
}

function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) return Promise.reject(new Error(tr('Dateien gehen nur in der Desktop-App.')));
  // Rust-Fehler kommen als Text an.
  return invoke<T>(cmd, args).catch((e: unknown) => Promise.reject(e instanceof Error ? e : new Error(String(e))));
}

export const openKwk = () => call<Opened | null>('open_kwk');
export const saveKwk = (path: string | null, document: string, images: Wire) => call<string | null>('save_kwk', { path, document, images, name: `${tr('Unbenannt')}.kwk` });
export const importFile = () => call<Imported | null>('import_file');
export const exportFile = (format: ExportFormat, scene: IrScene, images: Wire, options: ExportOptions, color: ColorSettings) =>
  call<string | null>('export_file', { format, scene, images, options, color });

/** Seite als PDF in die Druckansicht des Systems, mit `tiles` ein Blatt je Seite; liefert den Pfad. */
export const printFile = (scene: IrScene, images: Wire, color: ColorSettings, tiles?: Sheets) =>
  call<string>('print_page', { scene, images, color, tiles: tiles ?? null });

/** Bildschirmfarben (sRGB-Bytes) über das Dokumentprofil; proof = wie im Druck. */
export const displayColors = (color: ColorSettings, colors: Color[], proof: boolean) =>
  call<{ profile: string | null; colors: [number, number, number][] }>('display_colors', { color, colors, proof });

export const convertColors = (color: ColorSettings, colors: Color[], model: Color['model']) =>
  call<Color[]>('convert_colors', { color, colors, model });

export interface CmykProfile {
  name: string;
  path: string;
}

/** CMYK-Druckprofile aus den Systemordnern, nach Name sortiert. */
export const listCmykProfiles = () => call<CmykProfile[]>('list_cmyk_profiles');
export const pickCmykProfile = () => call<CmykProfile | null>('pick_cmyk_profile');
/** .kwp-Text */
export const openPalette = () => call<string | null>('open_palette');
export const savePalette = (name: string, text: string) => call<string | null>('save_palette', { name, text });

/** Wie kw_core::trace::Params; Glättung und Ecken 0–1. */
export interface TraceCore {
  mode: 'outline' | 'centerline' | 'color';
  threshold: number;
  speckle: number;
  smooth: number;
  /** 0 = Ecken bleiben spitz … 1 = alles rund */
  corners: number;
  /** Umriss farbig: höchstens so viele Farben */
  colors: number;
  /** je Farbe ein Objekt statt je Fläche */
  merge: boolean;
  /** Hintergrund: behalten, nur die Fläche am Bildrand weg, die Farbe im ganzen Bild weg */
  background: 'keep' | 'edge' | 'all';
  /** untere Flächen unter den oberen ausschneiden */
  cutout: boolean;
  /** Palette bearbeitet (7d): Ergebnisfarbe → neue Farbe, 0–1; gleiche neue Farben werden eine */
  recolor: [Rgb, Rgb][];
}

type Rgb = [number, number, number];

/** Ein Ergebnis-Objekt; rgb 0–1 nur beim farbigen Umriss. */
export interface TracePiece {
  rgb: [number, number, number] | null;
  subpaths: Subpath[];
}

/** PNG (Base64) → Objekte in der Bildbox width × height mm, unterstes zuerst. */
export const traceImage = (png: string, params: TraceCore, width: number, height: number) =>
  call<TracePiece[]>('trace_image', { png, params, width, height });

/** Formen-Befehle: je Auftrag die Ergebnis-Teilpfade in Seitenkoordinaten. */
export const shapeObjects = (jobs: ShapeJob[]) => call<Subpath[][]>('shape_objects', { jobs });
/** Kontur in Objekt: je Auftrag der Umriss der Kontur in Seitenkoordinaten. */
export const outlineObjects = (jobs: OutlineJob[]) => call<Subpath[][]>('outline_objects', { jobs });
/** Kontur-Werkzeug: je Auftrag die Schritte vom Original weg, je Schritt Teilpfade in Seitenkoordinaten. */
export const contourObjects = (jobs: ContourJob[]) => call<Subpath[][][]>('contour_objects', { jobs });
/** Messer: je Auftrag die Teilpfade je Seite des Schnitts; null = nicht geteilt. */
export const knifeObjects = (jobs: KnifeJob[]) => call<(Subpath[][] | null)[]>('knife_objects', { jobs });
/** Radierer: je Auftrag die verbleibenden Teilpfade; null = nicht getroffen, leer = ganz weg. */
export const eraseObjects = (jobs: EraseJob[]) => call<(Subpath[] | null)[]>('erase_objects', { jobs });

/** Text setzen (kw-core): Umriss und Glyphenlage im Objektsystem. */
export const layoutText = (spec: ReturnType<typeof textSpec>) => call<TextLayout>('layout_text', { spec });

/** Schriftfamilien des Systems, sortiert. */
export const listFonts = () => call<string[]>('list_fonts');
