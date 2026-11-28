// N64 adaptativo: joga uma página no Chromium headless (WebGPU por software), clica em CLICK e guarda o console.
// usage: node probe.mjs <dir> <page> <seconds> <shot.png> [rom]
import http from 'http'; import fs from 'fs'; import path from 'path';
import { createRequire } from 'module';
const require = createRequire(process.env.PLAYWRIGHT_PKG || (process.cwd() + '/package.json'));
const { chromium } = require('playwright');
const [dir, page, secs, shot, rom] = process.argv.slice(2);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' };
const srv = http.createServer((q, r) => {
  const f = path.join(dir, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }); r.end(d); });
}).listen(8941);
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('console', (m) => console.log('[c]', m.text().slice(0, process.env.LONG ? 4000 : 300)));
p.on('pageerror', (e) => console.log('[err]', e.message));
if (rom) p.on('filechooser', (fc) => { console.log('[filechooser]'); fc.setFiles(rom); });
await p.goto('http://127.0.0.1:8941/' + page);
console.log('[gpu]', await p.evaluate(async () => { const a = await navigator.gpu?.requestAdapter(); return a ? JSON.stringify(a.info) : 'no adapter'; }));
const end = Date.now() + secs * 1000;
let i = 0;
while (Date.now() < end) { await p.waitForTimeout(5000); i++; const clicks = (process.env.CLICK === "1" ? "1165,581" : process.env.CLICK || "").split(";").filter(Boolean); if (i >= 3 && clicks[i - 3]) { const [x, y] = clicks[i - 3].split(",").map(Number); if (x >= 0) await p.mouse.click(x, y); } if (process.env.SHOTS || i % 4 === 0) await p.screenshot({ path: shot.replace(".png", "-" + i + ".png") }); }
await p.screenshot({ path: shot });
if (process.env.DUMPIDB) console.log('[idb]', await p.evaluate(async () => { const out = []; for (const d of await indexedDB.databases()) { const db = await new Promise((r, j) => { const q = indexedDB.open(d.name); q.onsuccess = () => r(q.result); q.onerror = j; }); for (const st of db.objectStoreNames) { const keys = await new Promise((r) => { const q = db.transaction(st).objectStore(st).getAllKeys(); q.onsuccess = () => r(q.result); }); out.push(d.name + ' :: ' + keys.join(' | ')); } } return out.join('\n'); }));
await b.close(); srv.close();
