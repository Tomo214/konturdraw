// Rauchtest der fertigen Windows-App, Phase 6d: App startet, Oberfläche steht, Bildschirmfoto als Beleg;
// F5 und Strg+R laden die Seite nicht neu (das Dokument wäre sonst weg). Gegenprobe mit abgeschaltetem preventDefault
// zeigt, ob eingespielte Tasten die WebView2-Browsertasten überhaupt erreichen.
// Steuerung direkt über das DevTools-Protokoll der WebView2 (fester Debug-Port per Umgebungsvariable): msedgedriver
// sucht die Port-Datei im Standard-Datenordner und findet sie bei Tauri (eigener Datenordner) nicht.
// Nur Windows. Aufruf: node tests/e2e/windows-smoke.mjs <konturwerk.exe> <bild.png>
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [app, shot] = process.argv.slice(2);
const PORT = 9333;
const F5 = { key: 'F5', code: 'F5', windowsVirtualKeyCode: 116 };
const R = { key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82 };
const CTRL = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let done = false;
const child = spawn(resolve(app), [], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  stdio: ['ignore', 'inherit', 'inherit'],
});
child.on('exit', (code) => {
  if (done) return;
  console.error(`App hat sich vorzeitig beendet (Code ${code})`);
  process.exit(1);
});
setTimeout(() => {
  console.error('Zeitlimit 180 s überschritten');
  child.kill();
  process.exit(1);
}, 180_000).unref();

async function until(what, check, ms = 30_000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      // App oder Seite noch nicht bereit
    }
    if (Date.now() > end) throw new Error(`${what}: nach ${ms / 1000} s nicht erreicht`);
    await sleep(250);
  }
}

let target;
try {
  await until(
    'Debug-Port der WebView2',
    async () => {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      return !!target;
    },
    60_000,
  );
} catch (e) {
  const data = join(process.env.LOCALAPPDATA ?? '', 'de.ttbuilds.konturwerk', 'EBWebView');
  console.error(`${e.message}; WebView2-Datenordner ${existsSync(data) ? 'vorhanden' : 'fehlt'} (${data})`);
  child.kill();
  throw e;
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok, no) => {
  ws.onopen = ok;
  ws.onerror = () => no(new Error('DevTools-Verbindung fehlgeschlagen'));
});
let seq = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.error) p.no(new Error(msg.error.message));
  else p.ok(msg.result);
};
const cdp = (method, params = {}) =>
  new Promise((ok, no) => {
    const id = ++seq;
    pending.set(id, { ok, no });
    ws.send(JSON.stringify({ id, method, params }));
  });
const js = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};
const ready = () =>
  js("(() => { const c = document.querySelector('canvas.main'); return !!c && c.width > 0 && !!document.querySelector('nav.menubar'); })()");
async function press(k, modifiers = 0) {
  const ev = { modifiers, ...k, nativeVirtualKeyCode: k.windowsVirtualKeyCode };
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...ev });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...ev });
}

/** Marke setzen, Taste drücken: ist die Marke weg, wurde die Seite neu geladen. */
async function reloads(k, modifiers = 0) {
  await js('window.__kwMarke = 1');
  await press(k, modifiers);
  await sleep(1500);
  let kept = false;
  try {
    kept = await js('window.__kwMarke === 1');
  } catch {
    // Seite war gerade beim Neuladen
  }
  if (!kept) await until('Oberfläche nach Neu laden', ready);
  return !kept;
}

try {
  await until('Oberfläche (Zeichenfläche + Menüleiste)', ready);
  console.log('Seitentitel:', await js('document.title'));
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(shot, Buffer.from(data, 'base64'));
  console.log('Bildschirmfoto:', shot);

  for (const [name, k, mod] of [['F5', F5, 0], ['Strg+R', R, CTRL]]) {
    if (await reloads(k, mod)) throw new Error(`${name} hat die Seite neu geladen – das Dokument wäre verloren`);
    console.log(`${name}: kein Neu laden`);
  }
  await js('KeyboardEvent.prototype.preventDefault = function () {}');
  if (await reloads(F5)) console.log('Gegenprobe: ohne preventDefault lädt F5 neu → Prüfung ist scharf');
  else
    console.log(
      '::warning::Gegenprobe: F5 lädt auch ohne preventDefault nicht neu – eingespielte Tasten erreichen die Browsertasten nicht, F5/Strg+R nur von Hand prüfbar',
    );
} finally {
  done = true;
  ws.close();
  child.kill();
}
