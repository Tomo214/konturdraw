import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bridge from '../../src/io/bridge';
import { DEFAULT_EXPORT_OPTIONS, exportPage, importInto, openFile, printPage, saveFile } from '../../src/io/files';
import { toIr } from '../../src/io/ir';
import { images } from '../../src/io/images';
import { serialize } from '../../src/io/kwk';
import { DEFAULT_COLOR_SETTINGS } from '../../src/model/color';
import { addNodes, createDocument } from '../../src/model/document';
import { translate } from '../../src/model/geometry';
import type { ColorSettings, Doc, Node } from '../../src/model/types';
import { square } from '../model/fixtures';

vi.mock('../../src/io/bridge', () => ({ openKwk: vi.fn(), saveKwk: vi.fn(), importFile: vi.fn(), exportFile: vi.fn(), printFile: vi.fn() }));

const img = (id: string, hash: string, x = 0): Node => ({ type: 'image', id, transform: translate(x, 0), image: hash, width: 4, height: 2 });

function doc(nodes: Node[]): Doc {
  const d = createDocument(100, 50);
  return addNodes(d, d.pages[0].layers[0].id, nodes);
}

beforeEach(() => {
  vi.clearAllMocks();
  images.add({ h1: 'AAAA', h2: 'BBBB', h3: 'CCCC' });
});

describe('Dateiabläufe', () => {
  it('Drucken: ganze Seite mit Bildern, gespiegelt um die Seitenmitte', async () => {
    const d = doc([img('a', 'h1', 10), square('s')]);
    const page = d.pages[0];
    vi.mocked(bridge.printFile).mockResolvedValue('/tmp/druck.pdf');
    expect(await printPage(page, undefined, false)).toBe('/tmp/druck.pdf');
    expect(bridge.printFile).toHaveBeenLastCalledWith(toIr(page), { h1: 'AAAA' }, DEFAULT_COLOR_SETTINGS);
    await printPage(page, undefined, true);
    const [scene] = vi.mocked(bridge.printFile).mock.lastCall!;
    expect(scene).toEqual({ width: 100, height: 50, items: [{ kind: 'group', matrix: [-1, 0, 0, 1, 100, 0], children: toIr(page).items }] });
  });

  it('Speichern schickt nur benutzte Bilder mit', async () => {
    const d = doc([img('a', 'h1'), img('b', 'h2')]);
    vi.mocked(bridge.saveKwk).mockResolvedValue('/x.kwk');
    expect(await saveFile(d, null)).toBe('/x.kwk');
    expect(bridge.saveKwk).toHaveBeenCalledWith(null, serialize(d), { h1: 'AAAA', h2: 'BBBB' });
  });

  it('Öffnen prüft das Dokument und legt Bilder ab', async () => {
    const d = doc([img('a', 'neu')]);
    vi.mocked(bridge.openKwk).mockResolvedValue({ path: '/y.kwk', document: serialize(d), images: { neu: 'DDDD' } });
    expect(await openFile()).toEqual({ doc: d, path: '/y.kwk' });
    expect(images.pick(['neu'])).toEqual({ neu: 'DDDD' });
    vi.mocked(bridge.openKwk).mockResolvedValue({ path: '/z.kwk', document: serialize(d), images: {} });
    await expect(openFile()).rejects.toThrow(/Bild neu fehlt/);
  });

  it('Import: Pixelbild eingepasst und mittig, Bild in der Ablage', async () => {
    const scene = { width: 200, height: 20, items: [{ kind: 'image' as const, matrix: translate(0, 0), width: 200, height: 20, image: 'px' }] };
    vi.mocked(bridge.importFile).mockResolvedValue({ scene, images: { px: 'EEEE' }, warnings: ['W'], raster: true });
    const r = await importInto(doc([]).pages[0]);
    expect(r?.warnings).toEqual(['W']);
    expect(r?.nodes[0]).toMatchObject({ type: 'image', image: 'px', transform: [0.5, 0, 0, 0.5, 0, 20] });
    expect(images.pick(['px'])).toEqual({ px: 'EEEE' });
  });

  it('Abbruch im Dialog → null, nichts passiert', async () => {
    vi.mocked(bridge.openKwk).mockResolvedValue(null);
    vi.mocked(bridge.importFile).mockResolvedValue(null);
    expect(await openFile()).toBeNull();
    expect(await importInto(doc([]).pages[0])).toBeNull();
  });

  it('Export nur Auswahl: Szene + nur deren Bilder; leere Auswahl → Fehler', async () => {
    const d = doc([img('a', 'h1'), img('b', 'h3', 10), square('s', 30)]);
    vi.mocked(bridge.exportFile).mockResolvedValue('/e.pdf');
    const cmyk: ColorSettings = { mode: 'cmyk', cmykProfile: '/p.icc', intent: 'perceptual' };
    // Gleiche Standardwerte wie ExportOptions::default() in files.rs
    expect(DEFAULT_EXPORT_OPTIONS).toEqual({ dpi: 300, bleed: 3, marks: true, title: 'Unbenannt', plot: { unitsPerMm: 40, origin: 'lowerleft' } });
    const opts = { ...DEFAULT_EXPORT_OPTIONS, bleed: 2, title: 'Logo' };
    await exportPage(d.pages[0], cmyk, 'pdfx', opts, new Set(['b']));
    const [format, scene, imgs, sent, color] = vi.mocked(bridge.exportFile).mock.calls[0];
    expect([format, scene.width, scene.items.length, imgs, sent, color]).toEqual(['pdfx', 4, 1, { h3: 'CCCC' }, opts, cmyk]);
    await expect(exportPage(d.pages[0], undefined, 'svg', opts, new Set())).rejects.toThrow(/Nichts gewählt/);
  });
});
