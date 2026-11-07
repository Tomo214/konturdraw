// Golden-Render (3c): Pixel-Proben + Vergleich mit tests/render/golden/<engine>.png.
// Fehlt die Referenz (oder GOLDEN_UPDATE=1), wird sie angelegt – danach von Hand ansehen!
// Voraussetzung: `npm run dev` läuft, Playwright erreichbar, z. B.
//   NODE_PATH=/pfad/zu/playwright/node_modules node tests/render/run-golden.cjs
const { chromium, webkit } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const url = process.env.GOLDEN_URL ?? 'http://localhost:5173/tests/render/golden.html';
const nativeChrome =
  process.platform === 'darwin' && process.arch === 'x64'
    ? { executablePath: `${__dirname}/../perf/chrome-arm64.sh` }
    : { channel: 'chrome' };
const engines = [
  ['chrome', () => chromium.launch({ ...nativeChrome, headless: true })],
  ['pw-webkit', () => webkit.launch({ headless: true })],
];
const MAX_DIFF = 0.001; // Anteil abweichender Pixel

(async () => {
  let failed = false;
  for (const [tag, launch] of engines) {
    const browser = await launch();
    const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
    await page.goto(url);
    await page.waitForFunction(() => 'golden' in window, null, { timeout: 30000 });
    const { probes, png } = await page.evaluate(() => window.golden);
    const bad = probes.filter((p) => !p.ok);
    const file = path.join(__dirname, 'golden', `${tag}.png`);
    let cmp;
    if (!fs.existsSync(file) || process.env.GOLDEN_UPDATE) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
      cmp = 'Referenz neu angelegt';
    } else {
      const ref = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
      cmp = await page.evaluate((u) => window.compare(u), ref);
      if (!cmp.sizeOk || cmp.diffPixels / cmp.total > MAX_DIFF) failed = true;
    }
    if (bad.length) failed = true;
    console.log(tag, `Proben ${probes.length - bad.length}/${probes.length}`, JSON.stringify(cmp));
    for (const p of bad) console.log('  ✗', p.name, 'ist', p.got, 'soll', p.want);
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
