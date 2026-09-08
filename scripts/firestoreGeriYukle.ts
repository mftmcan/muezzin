import { readFileSync } from 'node:fs';
import { db } from './lib/firebaseAdminInit.ts';
import { parcaliBatchUygula, type BatchIslemi } from './lib/firestoreBatch.ts';
import { serilestirmeyiCoz, type SerilestirilmisDeger } from './lib/firestoreSerilestir.ts';
import firebaseConfig from '../firebase-applet-config.json' assert { type: 'json' };

type YedekSatiri = { koleksiyon: string; id: string; data: SerilestirilmisDeger };

type GeriYuklemeSonucu = {
  koleksiyonBazindaSayilar: Record<string, number>;
  toplamBelge: number;
  kuruCalistirma: boolean;
};

/**
 * `scripts/firestoreYedekle.ts`'in ürettiği NDJSON'u Firestore'a geri yazar.
 *
 * GÜVENLİK: bu fonksiyon `kuruCalistirma: false` ile çağrıldığında GERÇEK,
 * GERİ ALINAMAZ bir toplu yazımdır — mevcut belgeleri tamamen ÜZERİNE YAZAR
 * (`set`, `merge` DEĞİL). CLI girişi (aşağıda) bu yüzden varsayılan olarak
 * dry-run'dır ve gerçek yazım için hem `--onayla` hem doğru proje ID'sini
 * teyit etmeyi zorunlu kılar.
 *
 * `koleksiyonFiltresi` verilirse yalnızca o koleksiyonun kayıtları işlenir
 * — tam felaket nadirdir, tipik senaryo tek bir koleksiyonun bozulmasıdır.
 */
export async function firestoreGeriYukleCalistir(
  ndjsonIcerik: string,
  opts: { kuruCalistirma: boolean; koleksiyonFiltresi?: string }
): Promise<GeriYuklemeSonucu> {
  const satirlar = ndjsonIcerik
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => JSON.parse(s) as YedekSatiri)
    .filter((satir) => !opts.koleksiyonFiltresi || satir.koleksiyon === opts.koleksiyonFiltresi);

  const koleksiyonBazindaSayilar: Record<string, number> = {};
  satirlar.forEach((satir) => {
    koleksiyonBazindaSayilar[satir.koleksiyon] = (koleksiyonBazindaSayilar[satir.koleksiyon] ?? 0) + 1;
  });

  console.log(
    `Geri yükleme ${opts.kuruCalistirma ? '(DRY-RUN — hiçbir şey yazılmayacak)' : '(GERÇEK YAZIM)'}: ` +
      `${Object.entries(koleksiyonBazindaSayilar)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')} (toplam ${satirlar.length}).`
  );

  if (opts.kuruCalistirma) {
    return { koleksiyonBazindaSayilar, toplamBelge: satirlar.length, kuruCalistirma: true };
  }

  await parcaliBatchUygula(
    satirlar.map<BatchIslemi>((satir) => (batch) => {
      const ref = db.collection(satir.koleksiyon).doc(satir.id);
      batch.set(ref, serilestirmeyiCoz(satir.data, db) as FirebaseFirestore.DocumentData);
    })
  );

  console.log(`Tamamlandı. ${satirlar.length} belge geri yüklendi.`);
  return { koleksiyonBazindaSayilar, toplamBelge: satirlar.length, kuruCalistirma: false };
}

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  // CI'da GERÇEK (--onayla'lı) çalıştırma KASITLI OLARAK reddedilir — bu
  // script'in tek meşru çağrı yeri elle, yerel bir makineden yapılan acil
  // DR müdahalesidir (bkz. docs/RUNBOOK.md). test.yml'deki deploy adımının
  // TERSİ desen: orada yerel çalıştırma reddediliyordu, burada CI çalıştırma
  // reddediliyor.
  const ciOrtami = process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true';
  const dosyaArg = process.argv.find((a) => a.startsWith('--in='));
  const onayVarMi = process.argv.includes('--onayla');
  const projeArg = process.argv.find((a) => a.startsWith('--proje='));
  const koleksiyonArg = process.argv.find((a) => a.startsWith('--koleksiyon='));

  if (!dosyaArg) {
    console.error('Kullanım: tsx scripts/firestoreGeriYukle.ts --in=<yol.ndjson> [--onayla --proje=<proje-id>] [--koleksiyon=<ad>]');
    process.exit(1);
  }

  const kuruCalistirma = !onayVarMi;

  if (onayVarMi) {
    if (ciOrtami) {
      console.error('REDDEDİLDİ: bu script CI ortamında --onayla ile çalıştırılamaz — yalnızca elle, yerel bir makineden.');
      process.exit(1);
    }
    if (!projeArg || projeArg.slice('--proje='.length) !== firebaseConfig.projectId) {
      console.error(
        `REDDEDİLDİ: --onayla için --proje=${firebaseConfig.projectId} ile hedef projeyi doğru teyit etmelisiniz ` +
          `(verilen: ${projeArg ? projeArg.slice('--proje='.length) : '(hiç)'}).`
      );
      process.exit(1);
    }
  }

  const ndjsonIcerik = readFileSync(dosyaArg.slice('--in='.length), 'utf8');
  firestoreGeriYukleCalistir(ndjsonIcerik, {
    kuruCalistirma,
    koleksiyonFiltresi: koleksiyonArg ? koleksiyonArg.slice('--koleksiyon='.length) : undefined,
  }).catch((err) => {
    console.error('Firestore geri yükleme başarısız:', err);
    process.exit(1);
  });
}
