import { expect, test } from 'vitest';
import { addNodes, createDocument, findNode } from '../../src/model/document';
import { translate } from '../../src/model/geometry';
import { History } from '../../src/model/history';
import { createText } from '../../src/model/text';
import type { Doc, TextNode } from '../../src/model/types';
import { TextState } from '../../src/ui/text-state.svelte';

const layout = async () => ({ glyphs: [], lines: [], outline: [], ascent: 7, descent: 2, overflow: false });
const sizeOf = (d: Doc) => (findNode(d, 't') as TextNode).font.size;

test('Felder zeigen den gewählten Text; Größe ändern setzt ihn neu, ein Rückgängig-Schritt', async () => {
  const doc = createDocument();
  const t = { ...createText('t', translate(0, 0)), text: 'Ink' };
  const history = new History<Doc>(addNodes(doc, doc.pages[0].layers[0].id, [t]));
  let done = 0;
  const s = new TextState(history, () => new Set(['t']), () => done++, () => {}, layout);
  s.show(t);
  expect(s.shown).toBe(t);
  await s.font({ size: 40 });
  expect(sizeOf(history.current)).toBe(40);
  expect(s.fields.font.size).toBe(40);
  expect(done).toBe(1);
  history.undo();
  expect(sizeOf(history.current)).toBe(24);
});

test('ohne gewählten Text: Felder sind Vorgaben für neuen Text, Dokument bleibt', async () => {
  const history = new History<Doc>(createDocument());
  const before = history.current;
  const s = new TextState(history, () => new Set(), () => {}, () => {}, layout);
  await s.set({ align: 'center' });
  expect(s.defaults().align).toBe('center');
  expect(history.current).toBe(before);
});
