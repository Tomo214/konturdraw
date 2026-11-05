// Text-Satzfelder für Eigenschaftsleiste und Andockfenster „Text“: Werte des gewählten Texts bzw. Vorgaben für neuen Text (Spec §10).
import { layoutText, listFonts } from '../io/bridge';
import type { History } from '../model/history';
import { updateLeaves } from '../model/style';
import { DEFAULT_FONT, textSpec, withLayout } from '../model/text';
import type { Doc, LeafNode, TextFont, TextNode } from '../model/types';
import type { TextFields } from './tools/text-tool';

type OnPath = NonNullable<TextNode['onPath']>;

export class TextState {
  fields = $state.raw<TextFields>({ font: DEFAULT_FONT, tracking: 0, lineSpacing: 100, align: 'left' });
  path = $state.raw<OnPath | null>(null);
  shown = $state.raw<TextNode | null>(null);
  families = $state.raw<string[]>([]);

  constructor(
    private history: History<Doc>,
    private selected: () => ReadonlySet<string>,
    private ondone: () => void,
    private onnotice: (msg: string) => void,
    private layout = layoutText,
  ) {}

  /** Schriftliste aus der Desktop-App; ohne sie steht nur die aktuelle Schrift zur Wahl. */
  loadFonts = () => void listFonts().then((f) => (this.families = f), () => {});

  /** Auswahlliste: aktuelle Schrift immer dabei. */
  get list(): string[] {
    return this.families.includes(this.fields.font.family) ? this.families : [this.fields.font.family, ...this.families];
  }

  /** Beim Zeichnen: erstes gewähltes Blatt; ist es Text, zeigen die Felder seine Werte. */
  show(n: LeafNode | null) {
    const t = n?.type === 'text' ? n : null;
    if (t === this.shown) return;
    this.shown = t;
    this.path = t?.onPath ?? null;
    if (t) this.fields = { font: t.font, tracking: t.tracking, lineSpacing: t.lineSpacing, align: t.align };
  }
  defaults = (): TextFields => this.fields;

  // Alle gewählten Texte neu setzen; ändert sich das Dokument währenddessen (Tippen), mit dem neuen Stand wiederholen.
  private async change(fn: (n: TextNode) => TextNode) {
    const ids = [...this.selected()];
    try {
      for (;;) {
        const doc = this.history.current;
        const targets: TextNode[] = [];
        updateLeaves(doc, ids, (n) => (n.type === 'text' && targets.push(fn(n)), n));
        if (!targets.length) return;
        const laid = await Promise.all(targets.map(async (n) => withLayout(n, await this.layout(textSpec(n)))));
        if (this.history.current !== doc) continue;
        const by = new Map(laid.map((n) => [n.id, n]));
        this.history.push(updateLeaves(doc, ids, (n) => by.get(n.id) ?? n));
        return this.ondone();
      }
    } catch (err) {
      this.onnotice((err as Error).message);
    }
  }
  font(patch: Partial<TextFont>) {
    this.fields = { ...this.fields, font: { ...this.fields.font, ...patch } };
    return this.change((n) => ({ ...n, font: { ...n.font, ...patch } }));
  }
  set(patch: Partial<Omit<TextFields, 'font'>>) {
    this.fields = { ...this.fields, ...patch };
    return this.change((n) => ({ ...n, ...patch }));
  }
  along(patch: Partial<OnPath>) {
    this.path = this.path && { ...this.path, ...patch };
    return this.change((n) => (n.onPath ? { ...n, onPath: { ...n.onPath, ...patch } } : n));
  }
}
