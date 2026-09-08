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

console.log('public/firebase-messaging-sw.js, firebase-applet-config.json ile tutarlı.');
