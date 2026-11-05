// Texte der Statusleiste: Objektinfo wie Vorbild („Rechteck auf Ebene 1“), Maße in mm.
import type { Doc, Layer, Node } from '../model/types';
import { findNode } from '../model/document';

// Läuft jedes Bild: ein Durchgang über den Baum, auch bei 10 000 gewählten Objekten.
const hasAny = (nodes: readonly Node[], ids: ReadonlySet<string>): boolean =>
  nodes.some((n) => ids.has(n.id) || (n.type === 'group' && hasAny(n.children, ids)));

export function kind(n: Node): string {
  switch (n.type) {
    case 'shape':
      if (n.shape.kind === 'rect') return 'Rechteck';
      if (n.shape.kind === 'ellipse') return 'Ellipse';
      return n.shape.inner === null ? 'Vieleck' : 'Stern';
    case 'path': return 'Kurve';
    case 'text': return 'Text';
    case 'image': return 'Bitmap';
    case 'group': return `Gruppe aus ${n.children.length} Objekt${n.children.length === 1 ? '' : 'en'}`;
  }
}

export function describeSelection(doc: Doc, ids: readonly string[]): string {
  if (!ids.length) return '';
  const set = new Set(ids);
  const layers = new Set<Layer>(doc.pages.flatMap((p) => p.layers.filter((l) => hasAny(l.children, set))));
  const where = layers.size === 1 ? `auf ${[...layers][0].name}` : `auf ${layers.size} Ebenen`;
  if (ids.length > 1) return `${ids.length} Objekte gewählt ${where}`;
  const n = findNode(doc, ids[0]);
  const top = doc.pages.some((p) => p.layers.some((l) => l.children.some((c) => c.id === ids[0])));
  return n ? `${kind(n)}${top ? '' : ' in Gruppe'} ${where}` : '';
}

const MM = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Zwei Nachkommastellen, deutsches Komma, typografisches Minus. */
export const mm = (v: number): string => MM.format(v).replace('-', '−');
