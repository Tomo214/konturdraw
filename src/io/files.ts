// Datei-Abläufe der Oberfläche: Brücke (Dialoge, kw-core) + Bildablage + Dokumentprüfung. null = abgebrochen.
import { DEFAULT_COLOR_SETTINGS } from '../model/color';
import { multiply } from '../model/geometry';
import type { ColorSettings, Doc, Node, Page } from '../model/types';
import * as bridge from './bridge';
import { images } from './images';
import { fromIr, placeImport, toIr, type IrItem, type IrScene } from './ir';
import { parseDocument, serialize, usedImages } from './kwk';

export async function openFile(): Promise<{ doc: Doc; path: string } | null> {
  const r = await bridge.openKwk();
  if (!r) return null;
  const doc = parseDocument(r.document, new Set(Object.keys(r.images)));
  images.add(r.images);
  return { doc, path: r.path };
}

/** path = null → „Speichern unter“. */
export const saveFile = (doc: Doc, path: string | null): Promise<string | null> =>
  bridge.saveKwk(path, serialize(doc), images.pick(usedImages(doc)));

/** Neue Knoten für die Seite (noch nicht eingefügt) + Hinweise des Imports. */
export async function importInto(page: Page): Promise<{ nodes: Node[]; warnings: string[] } | null> {
  const r = await bridge.importFile();
  if (!r) return null;
  images.add(r.images);
  const place = placeImport(page, r.scene, r.raster);
  const nodes = fromIr(r.scene.items).map((n) => ({ ...n, transform: multiply(place, n.transform) }));
  return { nodes, warnings: r.warnings };
}

/** Gleiche Werte wie ExportOptions::default() in files.rs: 3 mm Beschnitt, HPGL 40 Einheiten/mm. */
export const DEFAULT_EXPORT_OPTIONS: bridge.ExportOptions = {
  dpi: 300,
  bleed: 3,
  marks: true,
  title: 'Unbenannt',
  plot: { unitsPerMm: 40, origin: 'lowerleft' },
};

/** color = Doc.color; ids: nur diese obersten Objekte, Fläche = ihre Box. */
export async function exportPage(
  page: Page,
  color: ColorSettings | undefined,
  format: bridge.ExportFormat,
  options: bridge.ExportOptions,
  ids?: ReadonlySet<string>,
): Promise<string | null> {
  const scene = toIr(page, ids);
  if (ids && !scene.items.length) throw new Error('Nichts gewählt.');
  return bridge.exportFile(format, scene, images.pick(hashes(scene)), options, color ?? DEFAULT_COLOR_SETTINGS);
}

const hashes = (s: IrScene) => s.items.flatMap((it) => (it.kind === 'image' ? [it.image] : []));

/** Ganze Seite in die Druckansicht des Systems; gespiegelt = links ↔ rechts um die Seitenmitte (Transferpapier). */
export async function printPage(page: Page, color: ColorSettings | undefined, mirror: boolean): Promise<string> {
  const scene = toIr(page);
  const items: IrItem[] = mirror ? [{ kind: 'group', matrix: [-1, 0, 0, 1, scene.width, 0], children: scene.items }] : scene.items;
  return bridge.printFile({ ...scene, items }, images.pick(hashes(scene)), color ?? DEFAULT_COLOR_SETTINGS);
}
