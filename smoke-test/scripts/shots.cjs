// Usage: node scripts/shots.cjs <iter-number> [baseUrl]
// Renders the scene headless (Chromium + SwiftShader) from 3 fixed cameras into shots/iter-N/.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const iter = process.argv[2] || '0';
  const base = process.argv[3] || 'http://localhost:5173/';
  const outDir = path.join(__dirname, '..', 'shots', `iter-${iter}`);
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const page = await browser.newPage({ viewport: { width: 1672, height: 941 }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.type(), m.text().slice(0, 300)); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  const extra = process.env.EXTRA || '';
  const cams = process.env.CAMS ? process.env.CAMS.split(',') : ['ref', 'wide', 'close'];
  for (const cam of cams) {
    const t0 = Date.now();
    await page.goto(`${base}?cam=${cam}&still=1${extra ? '&' + extra : ''}`);
    await page.waitForFunction('window.__ready === true', null, { timeout: 180000 });
    await page.waitForTimeout(800);
    await page.screenshot({ timeout: 180000, path: path.join(outDir, `${cam}${extra ? '-' + extra.replace(/[^a-z0-9]+/gi, '-') : ''}.png`) });
    const stats = await page.evaluate('window.__stats');
    console.log(cam, `${Date.now() - t0}ms`, JSON.stringify(stats));
  }
  await browser.close();
})();
