import RBush from 'rbush';
import { display } from '../io/colors';
import { segmentsOf, subpathBounds } from '../model/bezier';
import { multiply, type Box, type Mat } from '../model/geometry';
import { isGradient } from '../model/style';
import type { Color, Fill, Page, Subpath } from '../model/types';
import { buildScene, worldScale, type SceneItem } from './scene';
import { screenToPage, snapshotTransform, toScreen, visibleBox, type Viewport } from './viewport';

const PASTEBOARD = '#2b2b30';
const LOADING = '#d0d0d4'; // Bild noch nicht dekodiert
// Drahtmodell: Weiß per Differenz = schwarz auf der Seite, hell auf der dunklen Arbeitsfläche.
const WIRE = '#fff';

const paths = new WeakMap<readonly Subpath[], Path2D>();
// Je Farbobjekt der CSS-Text, gültig solange display.version gleich bleibt.
const colors = new WeakMap<Color, { v: number; s: string }>();

function pathOf(subpaths: readonly Subpath[]): Path2D {
  let p = paths.get(subpaths);
  if (p) return p;
  p = new Path2D();
  for (const sp of subpaths) {
    if (!sp.nodes.length) continue;
    p.moveTo(sp.nodes[0].x, sp.nodes[0].y);
    for (const { line, c } of segmentsOf(sp)) {
      if (line) p.lineTo(c[3].x, c[3].y);
      else p.bezierCurveTo(c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y);
    }
    if (sp.closed) p.closePath();
  }
  paths.set(subpaths, p);
  return p;
}

function css(c: Color): string {
  const hit = colors.get(c);
  if (hit?.v === display.version) return hit.s;
  const s = display.css(c);
  colors.set(c, { v: display.version, s });
  return s;
}

// Verlauf in Objekt-Koordinaten: gilt, weil beim Füllen die Objektmatrix gesetzt ist.
function paint(ctx: CanvasRenderingContext2D, f: Fill): string | CanvasGradient {
  if (!isGradient(f)) return css(f);
  const { from: a, to: b } = f;
  const g =
    f.kind === 'linear'
      ? ctx.createLinearGradient(a.x, a.y, b.x, b.y)
      : ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.hypot(b.x - a.x, b.y - a.y));
  for (const s of f.stops) g.addColorStop(s.offset, css(s.color));
  return g;
}

/** Nur Drehen, Spiegeln, gleichmäßig Skalieren, Verschieben → Kontur im Objektsystem bleibt unverzerrt. */
function similar(m: Mat): boolean {
  const eps = 1e-9 * (Math.abs(m[0]) + Math.abs(m[1]) + Math.abs(m[2]) + Math.abs(m[3]));
  return Math.abs(m[0] - m[3]) + Math.abs(m[1] + m[2]) <= eps || Math.abs(m[0] + m[3]) + Math.abs(m[1] - m[2]) <= eps;
}

// Für gestauchte/gescherte Objekte: Pfad in Seitenkoordinaten, damit die Kontur gleichmäßig breit bleibt.
const worldPaths = new WeakMap<SceneItem, Path2D>();
function worldPath(it: SceneItem): Path2D {
  let p = worldPaths.get(it);
  if (!p) {
    const m = it.world;
    p = new Path2D();
    p.addPath(pathOf(it.subpaths), { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] });
    worldPaths.set(it, p);
  }
  return p;
}

const setMat = (ctx: CanvasRenderingContext2D, dpr: number, m: Mat) =>
  ctx.setTransform(dpr * m[0], dpr * m[1], dpr * m[2], dpr * m[3], dpr * m[4], dpr * m[5]);

const rule = (n: SceneItem['node']): CanvasFillRule => (n.type === 'path' && n.fillRule) || 'nonzero';

/** Zeichnet eine Seite auf Canvas 2D; nur sichtbare Objekte (rbush), Path2D-Cache je Geometrie. */
export class Renderer {
  private page: Page | null = null;
  private items: SceneItem[] = [];
  private tree = new RBush<SceneItem>();
  private leaves = new Map<string, number>();
  /** Objekte in Gruppen (nicht direkt auf einer Ebene). */
  private inner = new Set<string>();
  private hitCtx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
  private lastVp: Viewport | null = null;
  private snap: { canvas: HTMLCanvasElement; vp: Viewport } | null = null;

  /** images: Bildablage; ohne sie erscheinen Bilder als Platzhalter. */
  constructor(private images?: { bitmap(hash: string): CanvasImageSource | null }) {}

  get count(): number {
    return this.items.length;
  }

  setPage(page: Page): void {
    if (page === this.page) return;
    this.page = page;
    this.items = buildScene(page);
    this.tree.clear();
    this.tree.load(this.items);
    this.leaves.clear();
    this.inner.clear();
    for (const it of this.items) {
      this.leaves.set(it.topId, (this.leaves.get(it.topId) ?? 0) + 1);
      for (const id of it.chain.slice(1)) this.inner.add(id);
    }
  }

  /** Sichtbare Blätter der gewählten Objekte (auch Kinder in Gruppen), mit Weltmatrix. */
  leavesOf(ids: ReadonlySet<string>): SceneItem[] {
    return this.items.filter((it) => it.chain.some((id) => ids.has(id)));
  }

  /** Ist ein gewähltes Objekt Kind einer Gruppe? Dann zeigt der Rahmen runde Griffe. */
  nested(ids: ReadonlySet<string>): boolean {
    for (const id of ids) if (this.inner.has(id)) return true;
    return false;
  }

  /** Enge Welt-Box der gewählten Objekte (Kurven, ohne Konturbreite) – Grundlage der Griffe. */
  bounds(ids: ReadonlySet<string>): Box | null {
    let box: Box | null = null;
    for (const it of this.leavesOf(ids)) {
      const b = subpathBounds(it.subpaths, it.world);
      if (!b) continue;
      box = box
        ? { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) }
        : b;
    }
    return box;
  }

  /**
   * Oberste Objekte, die vollständig im Rahmen liegen; gesperrte Ebenen ausgenommen.
   * Von oben nach unten: das unterste kommt zuletzt und ist damit Ziel der Formen-Befehle (wie im Vorbild).
   */
  inside(r: Box): string[] {
    const hits = new Map<string, { n: number; order: number }>();
    for (const it of this.tree.search(r)) {
      const b = subpathBounds(it.subpaths, it.world);
      if (it.locked || !b || b.minX < r.minX || b.minY < r.minY || b.maxX > r.maxX || b.maxY > r.maxY) continue;
      const h = hits.get(it.topId);
      hits.set(it.topId, { n: (h?.n ?? 0) + 1, order: Math.max(h?.order ?? -1, it.order) });
    }
    return [...hits]
      .filter(([id, h]) => h.n === this.leaves.get(id))
      .sort((a, b) => b[1].order - a[1].order)
      .map(([id]) => id);
  }

  /** Oberste Objekte, deren Box den Rahmen berührt; gesperrte ausgenommen (Messer/Radierer ohne Auswahl). */
  touching(r: Box): string[] {
    const ids = new Set<string>();
    for (const it of this.tree.search(r)) {
      const b = subpathBounds(it.subpaths, it.world);
      if (!it.locked && b && b.minX <= r.maxX && b.maxX >= r.minX && b.minY <= r.maxY && b.maxY >= r.minY) ids.add(it.topId);
    }
    return [...ids];
  }

  /** Alle Blätter der Seite (für das Fangen). */
  get scene(): readonly SceneItem[] {
    return this.items;
  }

  /** under: zeichnet zwischen Seitenfläche und Objekten (Raster). wire: Drahtmodell, nur 1-px-Umrisse wie im Vorbild. */
  draw(ctx: CanvasRenderingContext2D, vp: Viewport, w: number, h: number, dpr: number, under?: () => void, wire = false): void {
    const page = this.page;
    if (!page) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PASTEBOARD;
    ctx.fillRect(0, 0, w, h);

    const screen = toScreen(vp);
    setMat(ctx, dpr, screen);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, page.width, page.height);
    under?.();

    const visible = this.tree.search(visibleBox(vp, w, h));
    visible.sort((a, b) => a.order - b.order);
    if (wire) [ctx.strokeStyle, ctx.lineWidth, ctx.globalCompositeOperation] = [WIRE, 1 / vp.zoom, 'difference'];
    let dashed = false; // Strichmuster bleibt im Kontext → nur beim Wechsel setzen
    for (const it of visible) {
      if (wire) {
        setMat(ctx, dpr, screen);
        ctx.stroke(worldPath(it));
        continue;
      }
      setMat(ctx, dpr, multiply(screen, it.world));
      if (it.node.type === 'image') {
        const { image, width, height } = it.node;
        const src = this.images?.bitmap(image);
        // Standard-Glättung des Canvas ist bilinear wie im PNG-Export.
        ctx.globalAlpha = it.opacity;
        if (src) ctx.drawImage(src, 0, 0, width, height);
        else (ctx.fillStyle = LOADING), ctx.fillRect(0, 0, width, height);
        ctx.globalAlpha = 1;
        continue;
      }
      const { fill, stroke } = it.node.style;
      const p = pathOf(it.subpaths);
      // Füllung und Kontur je mit der Deckkraft (wie fill-/stroke-opacity im SVG-Export)
      if (it.opacity < 1) ctx.globalAlpha = it.opacity;
      if (fill) {
        ctx.fillStyle = paint(ctx, fill);
        ctx.fill(p, rule(it.node));
      }
      const s = worldScale(it.world);
      if (stroke && s > 0) {
        const width = stroke.scaleWithObject ? stroke.width * s : stroke.width; // in Seiten-mm
        ctx.strokeStyle = css(stroke.color);
        ctx.lineCap = stroke.cap;
        ctx.lineJoin = stroke.join;
        const local = similar(it.world);
        const lineWidth = local ? width / s : width;
        // Strichmuster × Breite, in denselben Einheiten wie lineWidth
        if (stroke.dash || dashed) ctx.setLineDash(stroke.dash?.map((d) => d * lineWidth) ?? []);
        dashed = !!stroke.dash;
        if (local) {
          ctx.lineWidth = lineWidth;
          ctx.stroke(p);
        } else {
          setMat(ctx, dpr, screen);
          ctx.lineWidth = lineWidth;
          ctx.stroke(worldPath(it));
        }
      }
      if (it.opacity < 1) ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
    if (dashed) ctx.setLineDash([]);
    this.lastVp = vp;
  }

  /** Merkt sich das zuletzt voll gezeichnete Bild als Grundlage einer Pan/Zoom-Geste (architecture.md §6). */
  snapshot(source: HTMLCanvasElement): void {
    // Seit dem letzten Schnappschuss nichts voll gezeichnet → alter Schnappschuss passt noch zu seiner Ansicht.
    if (!this.lastVp) return;
    const canvas = this.snap?.canvas ?? document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    (canvas.getContext('2d') as CanvasRenderingContext2D).drawImage(source, 0, 0);
    this.snap = { canvas, vp: this.lastVp };
    this.lastVp = null;
  }

  /** Während der Geste: Schnappschuss verschieben/skalieren statt alles neu zu zeichnen. */
  drawGesture(ctx: CanvasRenderingContext2D, vp: Viewport, w: number, h: number, dpr: number): void {
    if (!this.snap) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PASTEBOARD;
    ctx.fillRect(0, 0, w, h);
    setMat(ctx, dpr, snapshotTransform(this.snap.vp, vp));
    ctx.drawImage(this.snap.canvas, 0, 0, w, h);
  }

  /** Oberstes getroffenes Objekt unter dem Bildschirmpunkt; gesperrte Ebenen werden übersprungen. */
  hitTest(vp: Viewport, sx: number, sy: number, tolerancePx = 3): SceneItem | null {
    const [x, y] = screenToPage(vp, sx, sy);
    const tol = tolerancePx / vp.zoom;
    const hits = this.tree.search({ minX: x - tol, minY: y - tol, maxX: x + tol, maxY: y + tol });
    hits.sort((a, b) => b.order - a.order);
    const ctx = this.hitCtx;
    for (const it of hits) {
      if (it.locked) continue;
      // Text trifft man in seiner Box (auch zwischen den Buchstaben); Text auf Pfad nur auf den Glyphen.
      if (it.node.type === 'text' && !it.node.onPath) {
        if (x >= it.minX - tol && x <= it.maxX + tol && y >= it.minY - tol && y <= it.maxY + tol) return it;
        continue;
      }
      // Bild = gefülltes Rechteck ohne Kontur.
      const { fill, stroke } = it.node.type === 'image' ? { fill: true, stroke: null } : it.node.style;
      const p = pathOf(it.subpaths);
      const m = it.world;
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      if (fill && ctx.isPointInPath(p, x, y, rule(it.node))) return it;
      // Kontur in Objekt-Einheiten; bei gestauchten Objekten nur angenähert (reicht für Klicks).
      const scale = worldScale(m);
      const local = stroke ? (stroke.scaleWithObject ? stroke.width : stroke.width / scale) : 0;
      ctx.lineWidth = Math.max(local, (2 * tol) / scale);
      if (ctx.isPointInStroke(p, x, y)) return it;
    }
    return null;
  }
}
