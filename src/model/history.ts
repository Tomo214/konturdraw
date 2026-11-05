// Undo über ganze Dokument-Zustände. Weil Dokumente unveränderlich sind und Unberührtes teilen,
// kostet ein Schritt nur die geänderten Knoten (architecture.md §5).
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private base: T | null = null;
  private previewing = false;

  constructor(
    private present: T,
    private readonly limit = 500,
  ) {}

  get current(): T {
    return this.present;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  push(next: T): void {
    this.commit();
    if (next === this.present) return;
    this.record(this.present);
    this.present = next;
  }

  /** Live-Änderung ohne Undo-Schritt, z. B. während Ziehen. */
  preview(next: T): void {
    if (!this.previewing) {
      this.base = this.present;
      this.previewing = true;
    }
    this.present = next;
  }

  /** Schließt die Vorschau als genau einen Undo-Schritt ab. */
  commit(): void {
    if (!this.previewing) return;
    this.previewing = false;
    if (this.base !== this.present) this.record(this.base as T);
  }

  cancel(): void {
    if (!this.previewing) return;
    this.previewing = false;
    this.present = this.base as T;
  }

  /** Anderes Dokument (Öffnen): Verlauf und Vorschau weg. */
  reset(state: T): void {
    this.past = [];
    this.future = [];
    this.previewing = false;
    this.base = null;
    this.present = state;
  }

  undo(): boolean {
    this.commit();
    if (!this.past.length) return false;
    this.future.push(this.present);
    this.present = this.past.pop() as T;
    return true;
  }

  redo(): boolean {
    this.commit();
    if (!this.future.length) return false;
    this.past.push(this.present);
    this.present = this.future.pop() as T;
    return true;
  }

  private record(state: T): void {
    this.past.push(state);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
}
