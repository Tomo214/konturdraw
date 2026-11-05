// Mausrad wie Vorbild: Rad = Zoom zum Zeiger, Strg/⌘ + Rad bzw. Kneifen ebenfalls,
// Alt = senkrecht, Umschalt = waagerecht rollen. Trackpad (Timon 05.11.): Wischen verschiebt.
export interface WheelInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** Alt-Wert aus WebKit/Chromium (Rasten zu 120); fehlt in Firefox. */
  wheelDeltaY?: number;
}

export type WheelAction = { zoom: number } | { dx: number; dy: number };

const LINE = 16;
/** Pro Ereignis höchstens so viel Pixel-Delta wirken lassen (eine Mausrad-Raste). */
const MAX_STEP = 50;
/** WebKit/Mac: Raste = 0,1 Zeile in 16.16-Festkomma × 40 px; nur das Rad liefert genaue Vielfache davon. */
const WEBKIT_NOTCH = 4.000244140625;
/** Ereignisse mit kürzerem Abstand (ms) gehören zu einem Zug. */
const GAP = 300;

/** true = Raste eines Mausrads; false = glatte Eingabe (Trackpad, Magic Mouse). */
export function isNotch(e: WheelInput): boolean {
  if (e.deltaMode !== 0) return true;
  if (e.deltaY === 0) return false;
  if (e.deltaY % WEBKIT_NOTCH === 0) return true;
  return !!e.wheelDeltaY && e.wheelDeltaY % 120 === 0;
}

export function wheelAction(e: WheelInput, notch = true): WheelAction {
  const k = e.deltaMode === 1 ? LINE : 1;
  const dx = e.deltaX * k;
  const dy = e.deltaY * k;
  if (e.altKey) return { dx: 0, dy };
  if (e.shiftKey) return { dx: dx || dy, dy: 0 };
  if (!e.ctrlKey && !e.metaKey) {
    if (!notch) return { dx, dy };
    if (Math.abs(dx) > Math.abs(dy)) return { dx, dy: 0 };
  }
  return { zoom: Math.exp(-Math.max(-MAX_STEP, Math.min(MAX_STEP, dy)) * 0.01) };
}

/** Gerät wird je Zug am ersten Ereignis erkannt – sonst springt ein Wischen bei einem zufällig rastgleichen Wert in den Zoom. */
export function wheelHandler(): (e: WheelInput, now: number) => WheelAction {
  let last = -Infinity;
  let notch = true;
  return (e, now) => {
    if (now - last > GAP) notch = isNotch(e);
    last = now;
    return wheelAction(e, notch);
  };
}

/** WebKit meldet Kneifen als gesture*-Ereignisse mit Gesamt-Skalierung seit Beginn; step liefert den Faktor seit dem letzten Ereignis. */
export function pinchSteps() {
  let prev = 1;
  return {
    start() {
      prev = 1;
    },
    step(scale: number) {
      const f = scale / prev;
      prev = scale;
      return f;
    },
  };
}
