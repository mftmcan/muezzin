import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { db, Timestamp } from './lib/firebaseAdminInit.ts';
import { YEDEKLENECEK_KOLEKSIYONLAR, HARIC_TUTULAN_KOLEKSIYONLAR } from './lib/yedekKapsam.ts';
import { serilestir } from './lib/firestoreSerilestir.ts';

/**
 * Firestore'un iş verisi koleksiyonlarını NDJSON'a export eder — proje
 * bilerek Spark planında kaldığından (bkz. kotaKontrol.ts) native Managed
 * Export/scheduled backup KAPALI (Blaze gerektirir); bu, Admin SDK ile
 * yazılmış özel bir alternatiftir.
 *
 * FAIL-CLOSED KEŞİF: `db.listCollections()` ile canlı veritabanındaki
 * GERÇEK koleksiyon listesi, `scripts/lib/yedekKapsam.ts`'teki beyaz∪kara
 * listeyle karşılaştırılır. Bilinmeyen (her iki listede de olmayan) bir
 * koleksiyon varsa script FIRLATIR — gelecekte eklenen bir koleksiyon
 * sessizce yedeksiz kalamaz (bkz. `verify-firestore-indexes.ts`nin
 * felsefesinin runtime karşılığı).
 *
 * Çıktı: tek bir NDJSON dosyası, her satır `{koleksiyon, id, data}` — `data`
 * `serilestir()`den geçmiş, Timestamp/GeoPoint/DocumentReference güvenle
 * JSON'a yazılabilir hâlde.
 */

/**
 * Tek bir yedek koşusunun yazabileceği azami belge sayısı.
 *
 * Her belge okuma Firestore'un günlük 50K okuma kotasının (Spark) bir
 * birimidir — bu tavan, tek bir koşunun günlük kotanın büyük bir kısmını
 * (30000/50000 ≈ %60) tüketebilecek anormal bir veri artışına karşı
 * bir güvenlik payı, NORMAL kullanımın (bkz. kotaKontrol.ts'teki "ekip
 * birkaç on kişilik" tahmini) çok üzerinde. Kadans HAFTALIK olduğundan
 * ortalama günlük maliyet bunun çok altında kalır; tavan yalnızca
 * beklenmeyen bir patlamada (ör. bir döngünün yanlışlıkla milyonlarca
 * belge üretmesi) yedeklemenin KENDİSİNİN kota krizine katkıda
 * bulunmasını engeller.
 */
const MAKSIMUM_TOPLAM_BELGE = 30000;

/** Sabit doc ID — `raporlaBasarisizlik`'in slugify(tip)+slugify(isAdi)
 * desteğiyle AYNI mantık, ama bu uyarı bir workflow ARIZASI değil bir "veri
 * ölçeği" olayı olduğundan reportWorkflowFailure.ts'in ürettiği ID'den
 * BİLEREK farklı — `hataPatlamasi`/`kotaUyarisi` gibi kendi kendini
 * çözen bir tip olsaydı ayrı bir UI kategorisi gerektirirdi; mevcut
 * `otomasyonHatasi` altyapısını yeniden kullanmak için sabit bir ID yeterli. */
const YEDEK_IPTAL_UYARI_DOC_ID = 'otomasyon_yedek-iptal_firestore-yedekle';

type YedekSonucu = {
  koleksiyonSayisi: number;
  toplamBelge: number;
  dosyaYolu: string | null;
  iptalEdildi: boolean;
};

/** @param maksimumBelge Yalnızca testler için enjekte edilebilir — varsayılan
 * MAKSIMUM_TOPLAM_BELGE gerçek eşiktir, testte binlerce belge oluşturmadan
 * "tavan aşıldı" dalını tetiklemek için küçük bir değer geçirilebilir. */
export async function firestoreYedekleCalistir(dosyaYolu: string, maksimumBelge: number = MAKSIMUM_TOPLAM_BELGE): Promise<YedekSonucu> {
  const beyazKara = new Set<string>([...YEDEKLENECEK_KOLEKSIYONLAR, ...HARIC_TUTULAN_KOLEKSIYONLAR]);
  const canliKoleksiyonlar = (await db.listCollections()).map((c) => c.id);
  const bilinmeyenler = canliKoleksiyonlar.filter((id) => !beyazKara.has(id));

  if (bilinmeyenler.length > 0) {
    throw new Error(
      `Fail-closed: canlı veritabanında scripts/lib/yedekKapsam.ts'te tanımsız koleksiyon(lar) bulundu: ` +
        `${bilinmeyenler.join(', ')}. Bu koleksiyonu bilinçli olarak YEDEKLENECEK_KOLEKSIYONLAR veya ` +
        `HARIC_TUTULAN_KOLEKSIYONLAR'a ekleyin (gerekçesiyle) — yedekleme GÜVENLİK NEDENİYLE durduruldu.`
    );
  }

  // Kota koruması: her koleksiyon için önce ucuz bir count() (belgeleri
  // ÇEKMEZ) — bkz. kotaKontrol.ts'teki count() ölçümünün AYNI gerekçesi.
  const sayimlar = await Promise.all(
    YEDEKLENECEK_KOLEKSIYONLAR.map(async (koleksiyon) => {
      const snap = await db.collection(koleksiyon).count().get();
      return { koleksiyon, adet: snap.data().count };
    })
  );
  const toplamBelge = sayimlar.reduce((acc, s) => acc + s.adet, 0);

  console.log(
    `Yedek kapsamı: ${sayimlar.map((s) => `${s.koleksiyon}=${s.adet}`).join(', ')} (toplam ${toplamBelge}, tavan ${maksimumBelge}).`
  );

  if (toplamBelge > maksimumBelge) {
    // BİLEREK mevcut 'otomasyonHatasi' tipi kullanılıyor (yeni bir tip
    // KrizAlarmlari.tsx/SistemUyarisiBanner.tsx/types.ts'e ek UI kablolaması
    // gerektirirdi) — bu, admin müdahalesi gerektiren nadir bir olay, tam
    // bir "otomasyon işi çöktü" senaryosuyla aynı önem derecesinde.
    await db
      .collection('adminUyarilari')
      .doc(YEDEK_IPTAL_UYARI_DOC_ID)
      .set({
        tip: 'otomasyonHatasi',
        mesaj:
          `Firestore yedeği İPTAL EDİLDİ: toplam belge sayısı (${toplamBelge}) güvenlik tavanını (${maksimumBelge}) ` +
          `aştı. Bu, beklenmeyen bir veri patlamasına işaret edebilir — kök nedeni araştırın (bkz. kotaKontrol.ts benzeri ` +
          `mantık). Tavanı bilinçli olarak yükseltmek gerekiyorsa scripts/firestoreYedekle.ts'teki maksimumBelge'yi güncelleyin.`,
        tarih: new Date().toISOString().slice(0, 10),
        vakit: null,
        cozuldu: false,
        olusturmaTarihi: Timestamp.now(),
      });
    console.warn('Tavan aşıldı — yedek İPTAL EDİLDİ, admin uyarısı bırakıldı.');
    return { koleksiyonSayisi: sayimlar.length, toplamBelge, dosyaYolu: null, iptalEdildi: true };
  }

  // Önceki bir koşuda tavan aşılıp yedek iptal edilmişse ve şimdi kapsam
  // içine dönülmüşse (bkz. yukarıdaki dal), o uyarı burada otomatik çözülür
  // — kotaKontrol.ts/hataEsigiKontrol.ts ile AYNI kendi-kendini-iyileştirme
  // deseni.
  const oncekiIptalUyarisi = await db.collection('adminUyarilari').doc(YEDEK_IPTAL_UYARI_DOC_ID).get();
  if (oncekiIptalUyarisi.exists && oncekiIptalUyarisi.data()?.cozuldu === false) {
    await oncekiIptalUyarisi.ref.update({ cozuldu: true, cozulmeTarihi: Timestamp.now() });
    console.log('Kapsam normale döndü — önceki yedek-iptal uyarısı otomatik çözüldü.');
  }

  const satirlar: string[] = [];
  for (const koleksiyon of YEDEKLENECEK_KOLEKSIYONLAR) {
    const snap = await db.collection(koleksiyon).get();
    snap.docs.forEach((docSnap) => {
      satirlar.push(JSON.stringify({ koleksiyon, id: docSnap.id, data: serilestir(docSnap.data()) }));
    });
  }

  mkdirSync(dirname(dosyaYolu), { recursive: true });
  writeFileSync(dosyaYolu, satirlar.join('\n') + (satirlar.length > 0 ? '\n' : ''), 'utf8');

  console.log(`Tamamlandı. ${sayimlar.length} koleksiyon, ${satirlar.length} belge → ${dosyaYolu}`);
  return { koleksiyonSayisi: sayimlar.length, toplamBelge: satirlar.length, dosyaYolu, iptalEdildi: false };
}

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  const dosyaArg = process.argv.find((a) => a.startsWith('--out='));
  const dosyaYolu = dosyaArg ? dosyaArg.slice('--out='.length) : 'yedek/firestore-yedek.ndjson';
  firestoreYedekleCalistir(dosyaYolu).catch((err) => {
    console.error('Firestore yedekleme başarısız:', err);
    process.exit(1);
  });
}
