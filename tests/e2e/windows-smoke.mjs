// Rauchtest der fertigen Windows-App über Edge-WebDriver (wie tauri-driver, nur ohne Zwischenstück), Phase 6d: App startet, Oberfläche steht,
// Bildschirmfoto als Beleg; F5 und Strg+R laden die Seite nicht neu (das Dokument wäre sonst weg).
// Gegenprobe mit abgeschaltetem preventDefault zeigt, ob WebDriver-Tasten die WebView2-Browsertasten überhaupt erreichen.
// Nur Windows. Aufruf: node tests/e2e/windows-smoke.mjs <konturwerk.exe> <msedgedriver.exe> <bild.png> <treiber.log>
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [app, edgeDriver, shot, log] = process.argv.slice(2);
const base = 'http://127.0.0.1:4444';
const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';
const F5 = '';
const CONTROL = '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const driver = spawn(edgeDriver, ['--port=4444', '--verbose', `--log-path=${resolve(log)}`], { stdio: 'inherit' });
setTimeout(() => {
  console.error('Zeitlimit 180 s überschritten');
  driver.kill();
  process.exit(1);
}, 180_000).unref();

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${json.value?.message ?? res.status}`);
  return json.value;
}

async function until(what, check, ms = 30_000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      // Seite lädt noch oder Treiber noch nicht bereit
    }
    if (Date.now() > end) throw new Error(`${what}: nach ${ms / 1000} s nicht erreicht`);
    await sleep(250);
  }
}

let id = null;
const s = (method, path, body) => call(method, `/session/${id}${path}`, body);
const js = (script) => s('POST', '/execute/sync', { script, args: [] });
const ready = () =>
  js("const c = document.querySelector('canvas.main'); return !!c && c.width > 0 && !!document.querySelector('nav.menubar');");
const press = (keys) =>
  s('POST', '/actions', {
    actions: [
      {
        type: 'key',
        id: 'tastatur',
        actions: [
          ...keys.map((value) => ({ type: 'keyDown', value })),
          ...[...keys].reverse().map((value) => ({ type: 'keyUp', value })),
        ],
      },
    ],
  });

/** Marke setzen, Tasten drücken: ist die Marke weg, wurde die Seite neu geladen. */
async function reloads(keys) {
  await js('window.__kwMarke = 1;');
  await press(keys);
  await sleep(1500);
  let kept = false;
  try {
    kept = await js('return window.__kwMarke === 1;');
  } catch {
    // Seite war gerade beim Neuladen
  }
  if (!kept) await until('Oberfläche nach Neu laden', ready);
  return !kept;
}

try {
  await until('msedgedriver', () => fetch(`${base}/status`).then((r) => r.ok));
  ({ sessionId: id } = await call('POST', '/session', {
    // so übersetzt tauri-driver seine tauri:options unter Windows
    capabilities: { alwaysMatch: { browserName: 'webview2', 'ms:edgeChromium': true, 'ms:edgeOptions': { binary: resolve(app) } } },
  }));
  await until('Oberfläche (Zeichenfläche + Menüleiste)', ready);
  console.log('Fenstertitel:', await s('GET', '/title'));
  writeFileSync(shot, Buffer.from(await s('GET', '/screenshot'), 'base64'));
  console.log('Bildschirmfoto:', shot);

  // Fokus in die Seite: Klick in die leere Zeichenfläche (Auswahl-Werkzeug, ändert nichts)
  const canvas = await s('POST', '/element', { using: 'css selector', value: 'canvas.main' });
  await s('POST', `/element/${canvas[ELEMENT]}/click`, {});

  for (const [name, keys] of [['F5', [F5]], ['Strg+R', [CONTROL, 'r']]]) {
    if (await reloads(keys)) throw new Error(`${name} hat die Seite neu geladen – das Dokument wäre verloren`);
    console.log(`${name}: kein Neu laden`);
  }
  await js('KeyboardEvent.prototype.preventDefault = function () {};');
  if (await reloads([F5])) console.log('Gegenprobe: ohne preventDefault lädt F5 neu → Prüfung ist scharf');
  else
    console.log(
      '::warning::Gegenprobe: F5 lädt auch ohne preventDefault nicht neu – WebDriver-Tasten erreichen die Browsertasten nicht, F5/Strg+R nur von Hand prüfbar',
    );
} finally {
  if (id) await call('DELETE', `/session/${id}`).catch(() => {});
  driver.kill();
}
