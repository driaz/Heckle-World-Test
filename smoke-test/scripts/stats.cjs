// Usage: node scripts/stats.cjs [baseUrl] -> prints window.__stats (triangles, draw calls, per-batch counts)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 480, height: 270 } });
  p.on('pageerror', (e) => console.log('ERR', e.message));
  p.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 300)); });
  await p.goto((process.argv[2] || 'http://localhost:5173/') + '?still=1&post=0');
  await p.waitForFunction('window.__stats', null, { timeout: 180000 });
  console.log(JSON.stringify(await p.evaluate('window.__stats')));
  await b.close();
})();
