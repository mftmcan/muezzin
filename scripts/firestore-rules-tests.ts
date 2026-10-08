// Firestore kural testlerinin orkestratoru. Testlerin kendisi konularina
// gore scripts/rules-tests/ altindaki grup dosyalarinda; bu dosya yalnizca
// test ortamini kurar, her testi temiz tohumla (clearFirestore +
// seedBaseData) calistirir ve sonuclari loglar.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { projectId, seedBaseData, type TestCase } from './rules-tests/ortak.ts';
import { tests as kimlikRollerTests } from './rules-tests/kimlik-roller.ts';
import { tests as muezzinsDavetlerTests } from './rules-tests/muezzins-davetler.ts';
import { tests as bildirimlerTests } from './rules-tests/bildirimler.ts';
import { tests as mazeretCumaTests } from './rules-tests/mazeret-cuma.ts';
import { tests as mazeretPencereTests } from './rules-tests/mazeret-pencere.ts';
import { tests as vekaletlerTests } from './rules-tests/vekaletler.ts';
import { tests as izinlerTests } from './rules-tests/izinler.ts';
import { tests as duyurularAyarlarDenetimTests } from './rules-tests/duyurular-ayarlar-denetim.ts';
import { tests as mazeretDetaylariTests } from './rules-tests/mazeret-detaylari.ts';

const tests: TestCase[] = [
  ...kimlikRollerTests,
  ...muezzinsDavetlerTests,
  ...bildirimlerTests,
  ...mazeretCumaTests,
  ...mazeretPencereTests,
  ...vekaletlerTests,
  ...izinlerTests,
  ...duyurularAyarlarDenetimTests,
  ...mazeretDetaylariTests,
];

async function main() {
  const env = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });

  try {
    for (const test of tests) {
      await env.clearFirestore();
      await seedBaseData(env);
      await test.run(env);
      console.log(`OK ${test.name}`);
    }

    assert.equal(tests.length > 0, true);
    console.log(`${tests.length} firestore rules test passed`);
  } finally {
    await env.cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
