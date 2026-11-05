import { expect, test } from 'vitest';
import { isNotch, pinchSteps, wheelAction, wheelHandler, type WheelInput } from '../../src/ui/wheel';

const wheel = (e: Partial<WheelInput>): WheelInput => ({
  deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...e,
});
const zoomOf = (e: Partial<WheelInput>) => {
  const a = wheelAction(wheel(e));
  if (!('zoom' in a)) throw new Error('kein Zoom');
  return a.zoom;
};

test('Rad ohne Taste zoomt wie Vorbild: runter = kleiner, hoch = größer, gleich weit zurück', () => {
  const out = zoomOf({ deltaY: 100 });
  const into = zoomOf({ deltaY: -100 });
  expect(out).toBeLessThan(1);
  expect(into).toBeGreaterThan(1);
  expect(out * into).toBeCloseTo(1, 9);
});

test('Strg/⌘ + Rad und Trackpad-Pinch (kommt mit ctrlKey) zoomen ebenfalls, feine Schritte bleiben fein', () => {
  expect(zoomOf({ deltaY: 2, ctrlKey: true })).toBeCloseTo(Math.exp(-0.02), 9);
  expect(zoomOf({ deltaY: -2, metaKey: true })).toBeCloseTo(Math.exp(0.02), 9);
});

test('ein Rastschritt zoomt höchstens um Faktor e^0,5; Zeilen-Modus wird in Pixel umgerechnet', () => {
  expect(zoomOf({ deltaY: 300 })).toBeCloseTo(Math.exp(-0.5), 9);
  expect(zoomOf({ deltaY: 3, deltaMode: 1 })).toBeCloseTo(Math.exp(-0.48), 9);
});

test('Alt + Rad rollt senkrecht, Umschalt + Rad waagerecht (auch wenn das System schon quer meldet)', () => {
  expect(wheelAction(wheel({ deltaY: 100, altKey: true }))).toEqual({ dx: 0, dy: 100 });
  expect(wheelAction(wheel({ deltaY: 100, shiftKey: true }))).toEqual({ dx: 100, dy: 0 });
  expect(wheelAction(wheel({ deltaX: -40, shiftKey: true }))).toEqual({ dx: -40, dy: 0 });
});

test('seitwärts (Kipprad, Trackpad quer) rollt waagerecht statt zu zoomen', () => {
  expect(wheelAction(wheel({ deltaX: 30, deltaY: 5 }))).toEqual({ dx: 30, dy: 0 });
});

test('Raste erkannt: WebKit-Mausrad (Vielfache von 4,000244…), Chromium-Rad (wheelDelta 120), Firefox-Zeilen', () => {
  expect(isNotch(wheel({ deltaY: 4.000244140625, wheelDeltaY: -12 }))).toBe(true);
  expect(isNotch(wheel({ deltaY: -12.000732421875, wheelDeltaY: 36 }))).toBe(true);
  expect(isNotch(wheel({ deltaY: 100, wheelDeltaY: -120 }))).toBe(true);
  expect(isNotch(wheel({ deltaY: 3, deltaMode: 1 }))).toBe(true);
});

test('Trackpad ist keine Raste: kleine/glatte Werte, quer, ohne Bewegung', () => {
  expect(isNotch(wheel({ deltaY: 3, wheelDeltaY: -9 }))).toBe(false);
  expect(isNotch(wheel({ deltaY: 0.5, wheelDeltaY: -1 }))).toBe(false);
  expect(isNotch(wheel({ deltaX: 5, deltaY: 0, wheelDeltaY: 0 }))).toBe(false);
});

test('Trackpad-Wischen verschiebt in beide Richtungen; Kneifen (ctrlKey) zoomt weiter', () => {
  expect(wheelAction(wheel({ deltaX: -3, deltaY: 7 }), false)).toEqual({ dx: -3, dy: 7 });
  expect(wheelAction(wheel({ deltaY: 2, ctrlKey: true }), false)).toEqual({ zoom: Math.exp(-0.02) });
});

test('ein Zug bleibt beim Gerät seines ersten Ereignisses; nach Pause wird neu erkannt', () => {
  const on = wheelHandler();
  expect(on(wheel({ deltaY: 2, wheelDeltaY: -6 }), 0)).toEqual({ dx: 0, dy: 2 });
  expect(on(wheel({ deltaY: 40, wheelDeltaY: -120 }), 16)).toEqual({ dx: 0, dy: 40 });
  expect(on(wheel({ deltaY: 4.000244140625, wheelDeltaY: -12 }), 600)).toHaveProperty('zoom');
});

test('Kneifen in WebKit (gesture*): Gesamt-Skalierung wird zu Schritt-Faktoren, neu ab jedem Start', () => {
  const p = pinchSteps();
  p.start();
  expect(p.step(1.2)).toBeCloseTo(1.2, 9);
  expect(p.step(1.5)).toBeCloseTo(1.25, 9);
  p.start();
  expect(p.step(0.5)).toBeCloseTo(0.5, 9);
});
