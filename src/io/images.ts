/**
 * Bildablage: Hash → PNG (Base64, so wie es über die Brücke kommt und geht) + geladenes Bild zum Zeichnen.
 * Inhaltsadressiert und außerhalb des Dokuments: Rückgängig bleibt billig, gleiche Bilder liegen nur einmal hier.
 */
export class ImageStore {
  private data = new Map<string, string>();
  private els = new Map<string, HTMLImageElement>();
  /** Wird gerufen, sobald ein Bild fertig dekodiert ist (→ neu zeichnen). */
  onReady = (): void => {};

  add(images: Record<string, string>): void {
    for (const [hash, b64] of Object.entries(images)) this.data.set(hash, b64);
  }

  /** Base64-PNGs genau dieser Hashes – für Speichern und Export. */
  pick(hashes: Iterable<string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const h of hashes) {
      const b64 = this.data.get(h);
      if (b64 === undefined) throw new Error(`Bild ${h} fehlt in der Ablage.`);
      out[h] = b64;
    }
    return out;
  }

  /** Zeichenbares Bild; null, solange es noch lädt oder unbekannt ist. */
  bitmap(hash: string): CanvasImageSource | null {
    let el = this.els.get(hash);
    if (!el) {
      const b64 = this.data.get(hash);
      if (b64 === undefined) return null;
      el = new Image();
      el.onload = () => this.onReady();
      el.src = `data:image/png;base64,${b64}`;
      this.els.set(hash, el);
    }
    return el.complete && el.naturalWidth ? el : null;
  }
}

/** Eine Ablage für die ganze Sitzung. */
export const images = new ImageStore();
