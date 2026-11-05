// Leistungs-Gate (architecture.md §6) in sichtbaren Fenstern: System-Chrome + Playwright-WebKit (Näherung für WKWebView).
// Voraussetzung: `npm run dev` läuft, Playwright ist erreichbar, z. B.
//   NODE_PATH=~/.claude/skills/playwright-skill/node_modules node tests/perf/run-bench.cjs
const { chromium, webkit } = require('playwright');

const base = process.env.BENCH_URL ?? 'http://localhost:5173/tests/perf/bench.html';
const nativeChrome =
  process.platform === 'darwin' && process.arch === 'x64' ? { executablePath: `${__dirname}/chrome-arm64.sh` } : { channel: 'chrome' };
const engines = [
  ['chrome', () => chromium.launch({ ...nativeChrome, headless: false })],
  ['pw-webkit', () => webkit.launch({ headless: false })],
];

const only = process.env.BENCH_ONLY?.split(',');

(async () => {
  for (const [tag, launch] of engines.filter(([t]) => !only || only.includes(t))) {
    const browser = await launch();
    const page = await browser.newPage({ viewport: { width: 1300, height: 1100 }, deviceScaleFactor: 2 });
    await page.goto(`${base}?tag=${tag}`);
    await page.waitForFunction(() => !document.getElementById('out').textContent.startsWith('läuft'), null, { timeout: 120000 });
    const r = JSON.parse(await page.textContent('#out'));
    console.log(tag, JSON.stringify({ openMs: r.openMs, open: r.open, gesture: r.gesture, full: r.full, click: r.clickMs, gate: r.gate }));
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
