import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };

/**
 * public/firebase-messaging-sw.js, Firebase Messaging'in `importScripts`
 * (compat) API'si gereği firebase-applet-config.json'daki değerleri KENDİ
 * İÇİNDE ayrıca hardcode etmek zorunda (service worker'lar Vite'ın normal
 * build/define pipeline'ından geçmez, public/ dosyaları olduğu gibi
 * kopyalanır). Bu script, iki kaynağın sessizce birbirinden sapmadığını
 * (ör. proje taşındığında yalnızca biri güncellenirse) CI'da doğrular.
 *
 * Ayrıca SW'in `importScripts` ile yüklediği compat SDK sürümünün, kurulu
 * `firebase` paketiyle AYNI olmasını zorlar: uygulama 12.18.0 üzerinde
 * çalışırken SW'in 12.12.0 yüklemesi sessiz bir sürüm kaymasıdır — FCM
 * davranış farkları en çok "bildirim hiç gelmiyor" olarak, testlerin
 * yakalamadığı cihazlarda ortaya çıkar (bkz. 2026-10-08 genel sağlık
 * analizi, R2). Sürüm `node_modules/firebase/package.json`'dan okunur;
 * CI `npm ci` ile kilitli sürümü kurduğundan bu karşılaştırma
 * deterministiktir.
 */
const swSource = readFileSync('public/firebase-messaging-sw.js', 'utf8');

function extract(key: string): string {
  const match = swSource.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
  if (!match) throw new Error(`public/firebase-messaging-sw.js içinde "${key}" bulunamadı`);
  return match[1];
}

const fieldsToCheck: Array<keyof typeof firebaseConfig> = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
];

for (const field of fieldsToCheck) {
  assert.equal(
    extract(field),
    firebaseConfig[field],
    `firebase-applet-config.json.${field} ile public/firebase-messaging-sw.js içindeki değer birbirinden sapmış — service worker'ı elle güncelleyin.`
  );
}

// --- SDK sürüm kayması denetimi ---
const kuruluFirebaseSurumu = (JSON.parse(readFileSync('node_modules/firebase/package.json', 'utf8')) as { version: string }).version;
const swSdkSurumleri = [...swSource.matchAll(/firebasejs\/([\d.]+)\/firebase-[a-z-]+-compat\.js/g)].map((m) => m[1]);

assert.ok(swSdkSurumleri.length > 0, 'public/firebase-messaging-sw.js içinde hiç firebasejs compat importScripts bulunamadı.');
assert.ok(
  new Set(swSdkSurumleri).size === 1,
  `public/firebase-messaging-sw.js farklı SDK sürümleri yüklüyor: ${swSdkSurumleri.join(', ')} — tüm importScripts aynı sürümü kullanmalı.`
);
assert.equal(
  swSdkSurumleri[0],
  kuruluFirebaseSurumu,
  `SW'in yüklediği compat SDK sürümü (${swSdkSurumleri[0]}) kurulu firebase paketi (${kuruluFirebaseSurumu}) ile eşleşmiyor — public/firebase-messaging-sw.js içindeki importScripts URL'lerini güncelleyin.`
);

console.log('public/firebase-messaging-sw.js, firebase-applet-config.json ve kurulu firebase SDK sürümüyle tutarlı.');
