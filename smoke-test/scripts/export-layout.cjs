// Usage: node scripts/export-layout.cjs [baseUrl]  -> writes blender/layout.json (island grids + transforms for the Blender build)
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
(async () => {
  const base = process.argv[2] || 'http://localhost:5173/';
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(base + '?still=1&layoutOnly=1');
  await page.waitForFunction('window.__layout', null, { timeout: 120000 });
  const layout = await page.evaluate('window.__layout');
  fs.writeFileSync(path.join(__dirname, '..', 'blender', 'layout.json'), JSON.stringify(layout));
  console.log('islands', layout.islands.map((i) => `${i.name}:${i.cells.length}`).join(' '));
  await browser.close();
})();
