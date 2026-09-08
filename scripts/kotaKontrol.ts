import { db, Timestamp } from './lib/firebaseAdminInit.ts';
import { getTurkeyDateString } from '../src/lib/dateUtils.ts';

/**
 * Günlük Firestore yazma kotası "erken uyarı" kontrolü.
 *
 * ÖNEMLİ — BU BİR TAHMİNDİR, GERÇEK KULLANIM DEĞİLDİR:
 * Firestore'un "bugün kaç okuma/yazma yapıldı" sayacı Spark planda
 * programatik olarak OKUNAMAZ (yalnızca Firebase Console / GCP Billing
 * arayüzünde görünür; Cloud Monitoring API'si Blaze gerektirir ve bu proje
 * bilerek Spark'ta kalıyor). Bu yüzden burada gerçek kota tüketimi değil,
 * ona VEKİL (proxy) olan tek bir gösterge ölçülür: son 24 saatte
 * `error_logs` + `telemetry_logs` koleksiyonlarına düşen belge sayısı.
 *
 * Neden bu iki koleksiyon: uygulamanın diğer tüm yazımları (bildirimler,
 * haftaPlanlari, izinler, vekalet_talepleri...) insan eylemine bağlı ve
 * doğal olarak sınırlı — bir müezzin ekibi günde birkaç yüz yazımdan
 * fazlasını üretemez. Kotayı gerçekten patlatabilecek tek yol, KENDİ
 * KENDİNE tekrar eden bir makine yazımıdır; bu kod tabanında böyle bir
 * risk taşıyan tek yer telemetri/hata günlükleridir (bkz.
 * src/services/telemetryService.ts: logError önceden dedup/rate-limit'siz
 * yazıyordu ve tek bir render döngüsü 20K/gün yazma kotasını tek bir
 * sekmede tüketebiliyordu — premium denetim P0.4'te MAX_ERROR_WRITES_PER_
 * SIGNATURE / MAX_ERROR_WRITES_PER_MINUTE ile sınırlandı).
 *
 * Yani bu script'in amacı "kota %kaç doldu"yu doğru söylemek DEĞİL, o
 * rate-limit'in bir gün sessizce devre dışı kaldığı/bozulduğu bir
 * REGRESYONU, kota tükenip uygulama durmadan önce yakalamaktır. Rapor
 * edilen yüzde bu nedenle her yerde "TAHMİNİ" olarak etiketlenir ve diğer
 * koleksiyonlara yapılan yazımları İÇERMEZ.
 *
 * Tetikleyici: .github/workflows/kota-kontrol.yml (günlük).
 */

/** Spark planının günlük ücretsiz yazma kotası (belge yazımı/gün). */
const GUNLUK_YAZMA_KOTASI = 20000;

/**
 * Uyarı eşiği: son 24 saatte bu iki koleksiyona düşen toplam belge sayısı.
 *
 * 2000, kotanın %10'u — normal kullanımın ~4-10 katı, ama kota tükenmesine
 * hâlâ çok uzak bir nokta. Gerekçe: ekip birkaç on kişilik, telemetri
 * olayları 5'lik gruplar hâlinde (telemetryService BATCH_SIZE) yazılıyor ve
 * hata yazımları dizge genelinde dakikada 5 ile sınırlı. Sağlıklı bir günde
 * beklenen toplam birkaç yüz belgedir; 2000'i aşmak "bir şey döngüye
 * girmiş" demektir. Eşiği düşürmek gürültü (her gün uyarı), yükseltmek ise
 * erken uyarı penceresini kaybetmek anlamına gelir.
 */
const ESIK_BELGE_SAYISI = 2000;

const UYARI_TIPI = 'kotaUyarisi';

/** Son 24 saatte koleksiyona düşen belge sayısı — `count()` toplaması
 * belgeleri ÇEKMEZ, bu yüzden ölçümün kendisi kotayı kayda değer şekilde
 * tüketmez (bkz. src/services/veriSifirlamaServisi.ts'teki istemci
 * eşdeğeri, getCountFromServer). Her iki koleksiyon da `timestamp` alanını
 * yazar (bkz. firestore.rules isValidErrorLog / isValidTelemetryLog), tek
 * alanlı index otomatik mevcuttur — bileşik index gerekmez. */
async function son24SaatBelgeSayisi(koleksiyon: string, esik: Timestamp): Promise<number> {
  const snap = await db.collection(koleksiyon).where('timestamp', '>=', esik).count().get();
  return snap.data().count;
}

/** Zaten açık bir kota uyarısı varsa her gün yenisini üretmeyelim — admin
 * paneli aynı sorunun kopyalarıyla dolar ve gerçek uyarılar kaybolur (bkz.
 * scripts/mazeretDevirleriniIsle.ts'teki `alarmVarMi` ile aynı gerekçe).
 *
 * Önceden yalnızca "en son 50 açık uyarı" taranıp istemci tarafında
 * `tip === UYARI_TIPI` filtreleniyordu — başka bir kaynaktan (ör.
 * vakitVeriSagligiKontrol.ts, dedup'ı olmayan günlük uyarılar) gelen bir
 * sel bu 50'lik pencereyi doldurursa, kotaUyarisi kendi türünü artık
 * göremeyip her gün yenisini üretiyordu (düşük öncelikli bulgu — iki
 * bulgu birbirini besliyordu). Doğrudan `tip` eşitliğiyle sorgulamak
 * (yalnızca eşitlik filtreleri, orderBy yok — composite index gerekmez)
 * bu pencere sınırını tamamen ortadan kaldırır. */
async function acikKotaUyarilariniGetir() {
  return db.collection('adminUyarilari').where('cozuldu', '==', false).where('tip', '==', UYARI_TIPI).get();
}

async function main() {
  const esik = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);

  const [hataSayisi, telemetriSayisi] = await Promise.all([
    son24SaatBelgeSayisi('error_logs', esik),
    son24SaatBelgeSayisi('telemetry_logs', esik),
  ]);

  const toplam = hataSayisi + telemetriSayisi;
  const yuzde = Math.round((toplam / GUNLUK_YAZMA_KOTASI) * 1000) / 10;

  console.log(
    `Son 24 saat — error_logs: ${hataSayisi}, telemetry_logs: ${telemetriSayisi}, toplam: ${toplam} belge ` +
      `(günlük ${GUNLUK_YAZMA_KOTASI} yazma kotasının TAHMİNİ %${yuzde}'i; eşik: ${ESIK_BELGE_SAYISI}).`
  );

  if (toplam < ESIK_BELGE_SAYISI) {
    // "Bilinçli olarak dışarıda bırakılanlar" listesinden kapatılan bulgu:
    // eşik artık aşılmıyorsa, önceden açılmış kotaUyarisi'leri de otomatik
    // çözülür — bu, "sorun kendiliğinden geçti ama uyarı sonsuza dek açık
    // kaldı, admin manuel kapatmak zorunda" durumunu önler. Yalnızca BU
    // script yazdığı/tükettiği tip için (kotaUyarisi) — başka bir uyarı
    // türünün "koşulu temizlendi mi" sorusuna karışmaz.
    const acikUyarilar = await acikKotaUyarilariniGetir();
    if (!acikUyarilar.empty) {
      const batch = db.batch();
      // `cozulmeTarihi` — admin panelinin manuel "çöz" düğmesiyle AYNI alan
      // adı (bkz. useKrizAlarmlariStore.ts alarmCoz).
      acikUyarilar.docs.forEach((d) => batch.update(d.ref, { cozuldu: true, cozulmeTarihi: Timestamp.now() }));
      await batch.commit();
      console.log(`Kota kullanımı normal aralığa döndü — ${acikUyarilar.size} açık kotaUyarisi otomatik çözüldü.`);
    } else {
      console.log('Kota kullanımı normal aralıkta, uyarı üretilmedi.');
    }
    return;
  }

  const acikUyarilar = await acikKotaUyarilariniGetir();
  if (!acikUyarilar.empty) {
    console.log('Eşik aşıldı ancak çözülmemiş bir kota uyarısı zaten açık — yenisi üretilmedi.');
    return;
  }

  await db.collection('adminUyarilari').add({
    tip: UYARI_TIPI,
    mesaj:
      `Kota erken uyarısı (TAHMİNİ): son 24 saatte error_logs (${hataSayisi}) + telemetry_logs (${telemetriSayisi}) = ` +
      `${toplam} belge yazıldı; bu, günlük ${GUNLUK_YAZMA_KOTASI} yazma kotasının yaklaşık %${yuzde}'ine denk geliyor ve ` +
      `${ESIK_BELGE_SAYISI} eşiğini aştı. Bu bir TAHMİNDİR, gerçek toplam kullanım (diğer koleksiyonlara yazımlar dahil) ` +
      `daha yüksektir. Olası neden: telemetryService.ts'teki hata yazma sınırının (rate-limit) devre dışı kalması veya ` +
      `bir render döngüsünde tekrarlayan hata. Firebase Console > Kullanım ekranından gerçek kotayı doğrulayın.`,
    tarih: getTurkeyDateString(),
    vakit: null,
    cozuldu: false,
    olusturmaTarihi: Timestamp.now(),
  });

  // BİLEREK process.exit(1) YOK: eşik aşımı bir "iş hatası" değil, bir
  // UYARIDIR. Çıkışı 1 yapsaydık workflow'un `if: failure()` adımı ayrıca
  // bir 'otomasyonHatasi' uyarısı daha açar ve admin paneline aynı olay
  // için iki farklı kayıt düşerdi. Gerçek script hataları (Firestore'a
  // ulaşılamaması vb.) aşağıdaki catch'te 1 ile çıkar.
  console.warn(`Eşik aşıldı — admin uyarısı oluşturuldu (${UYARI_TIPI}).`);
}

main().catch((err) => {
  console.error('Kota kontrolü başarısız:', err);
  process.exit(1);
});
