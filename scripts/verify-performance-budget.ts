/**
 * Production giriş rotasının ağ bütçesini doğrular. Vite'ın ürettiği
 * index.html içindeki modulepreload/script/css varlıklarını ölçer; lazy admin
 * chunk'ları bu bütçeye yalnızca gerçekten preload edilirlerse girer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = path.resolve(process.cwd(), 'dist');
const INDEX = path.join(DIST, 'index.html');

const BUDGETS = {
  initialJsGzipBytes: 470 * 1024,
  initialCssGzipBytes: 40 * 1024,
  initialTotalGzipBytes: 510 * 1024,
} as const;

if (!fs.existsSync(INDEX)) {
  throw new Error('dist/index.html bulunamadı. Önce `npm run build` çalıştırılmalıdır.');
}

const html = fs.readFileSync(INDEX, 'utf8');
const urls = new Set<string>();
for (const match of html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)="([^"]+)"[^>]*>/g)) {
  const url = match[1];
  if (url.startsWith('/assets/') && (url.endsWith('.js') || url.endsWith('.css'))) urls.add(url);
}

type AssetSize = { url: string; raw: number; gzip: number };
const assets: AssetSize[] = [...urls].map((url) => {
  const absolute = path.join(DIST, url.replace(/^\//, ''));
  const content = fs.readFileSync(absolute);
  return { url, raw: content.byteLength, gzip: gzipSync(content).byteLength };
});

const js = assets.filter((asset) => asset.url.endsWith('.js'));
const css = assets.filter((asset) => asset.url.endsWith('.css'));
const sum = (items: AssetSize[]) => items.reduce((total, item) => total + item.gzip, 0);
const jsGzip = sum(js);
const cssGzip = sum(css);
const totalGzip = jsGzip + cssGzip;

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`;
console.log(`İlk rota: JS ${kb(jsGzip)}, CSS ${kb(cssGzip)}, toplam ${kb(totalGzip)} (${assets.length} asset)`);

const violations: string[] = [];
if (jsGzip > BUDGETS.initialJsGzipBytes) violations.push(`JS ${kb(jsGzip)} > ${kb(BUDGETS.initialJsGzipBytes)}`);
if (cssGzip > BUDGETS.initialCssGzipBytes) violations.push(`CSS ${kb(cssGzip)} > ${kb(BUDGETS.initialCssGzipBytes)}`);
if (totalGzip > BUDGETS.initialTotalGzipBytes) violations.push(`toplam ${kb(totalGzip)} > ${kb(BUDGETS.initialTotalGzipBytes)}`);

if (violations.length > 0) {
  throw new Error(`Performance bütçesi aşıldı:\n- ${violations.join('\n- ')}`);
}
