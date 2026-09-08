import { db, Timestamp } from './lib/firebaseAdminInit.ts';
import { getTurkeyDateString } from '../src/lib/dateUtils.ts';

/**
 * İstemci hata patlaması (aynı imzalı hatanın anormal tekrarı) erken uyarısı.
 *
 * `src/services/telemetryService.ts`'teki `logError` zaten OTURUM başına
 * (imza başına en fazla 3, dizge genelinde dakikada en fazla 5 yazım) bir
 * rate-limit uyguluyor — ama bu limit TEK BİR sekmeyi/oturumu korur. Aynı
 * regresyon (ör. bozuk bir deploy) DEĞİŞİK kullanıcıların oturumlarında aynı
 * anda tetiklenirse, her oturum kendi 3'lük tavanını ayrı ayrı doldurur ve
 * toplam yazım sayısı yine de anormal yükselir — bu script o TOPLAMI (tek
 * oturum sınırının ötesinde) izler.
 *
 * `scripts/kotaKontrol.ts` ile AYNI iskelet: eşik altıysa önceki açık uyarıyı
 * otomatik çözer, eşik üstündeyse (ve zaten açık bir uyarı yoksa) yeni bir
 * `adminUyarilari` kaydı açar. `process.exit(1)` BİLEREK YOK — eşik aşımı bir
 * iş hatası değil bir UYARIdır (bkz. kotaKontrol.ts'teki AYNI gerekçe).
 *
 * Tetikleyici: .github/workflows/hata-esigi-kontrolu.yml (6 saatte bir).
 */

/** İzlenen pencere — 6 saat: günlük (kotaKontrol.ts) kadar seyrek değil,
 * "proaktif" bir erken uyarı için yeterince sık. */
const PENCERE_SAAT = 6;

/**
 * Uyarı eşiği: aynı imzalı hatanın PENCERE_SAAT içindeki tekrar sayısı.
 *
 * telemetryService.ts'in kendi rate-limit'i (oturum başına imza başına 3)
 * sağlıklı bir günde tek bir kullanıcının ürettiği azami yazımı zaten
 * sınırlıyor; 50, "çok sayıda FARKLI oturumda aynı hata" anlamına gelir —
 * yani gerçek bir regresyon, tek bir kullanıcının tekrar tekrar aynı işlemi
 * denemesi değil. Eşiği düşürmek gürültü (birkaç kullanıcının aynı geçici
 * ağ hatasını görmesi bile tetikler), yükseltmek erken uyarı penceresini
 * kaybetmek anlamına gelir.
 */
const ESIK_TEKRAR_SAYISI = 50;

const UYARI_TIPI = 'hataPatlamasi';

/** telemetryService.ts'teki (satır ~522) İMZA formülüyle BİREBİR AYNI —
 * sunucu ve istemci farklı algoritma kullanırsa aynı hata iki farklı imzaya
 * düşer ve sayaç asla eşiğe ulaşmaz. Bu formül değişirse ikisi BİRLİKTE
 * güncellenmeli. */
function imzaHesapla(errorMessage: string, errorStack: string): string {
  return `${errorMessage}::${(errorStack || '').split('\n')[1] || ''}`.slice(0, 300);
}

/** kotaKontrol.ts'teki `acikKotaUyarilariniGetir` ile AYNI desen — yalnızca
 * eşitlik filtreleri, composite index gerekmez. */
async function acikHataPatlamasiUyarilariniGetir() {
  return db.collection('adminUyarilari').where('cozuldu', '==', false).where('tip', '==', UYARI_TIPI).get();
}

/**
 * Testler ve CLI için ortak çekirdek — dönüş değeri entegrasyon testlerinin
 * yan etkileri (adminUyarilari yazımı/otomatik çözümü) doğrulamasına gerek
 * kalmadan sonucu doğrudan assert edebilmesini sağlar.
 */
export async function hataEsigiKontroluCalistir(): Promise<{
  toplamKayit: number;
  benzersizImzaSayisi: number;
  enYuksekTekrar: number;
  esikAsildiMi: boolean;
}> {
  const esik = Timestamp.fromMillis(Date.now() - PENCERE_SAAT * 60 * 60 * 1000);

  // .select() ile field mask — yalnızca imza hesabı için gereken iki alan
  // çekilir, tüm belge (breadcrumbs/stateSnapshot dahil) değil (bkz.
  // kotaKontrol.ts'teki count() ölçümünün AYNI "ölçümün kendisi kotayı
  // tüketmesin" gerekçesi).
  const snap = await db.collection('error_logs').where('timestamp', '>=', esik).select('errorMessage', 'errorStack').get();

  const sayaclar = new Map<string, number>();
  snap.docs.forEach((docSnap) => {
    const data = docSnap.data() as { errorMessage?: string; errorStack?: string };
    const imza = imzaHesapla(data.errorMessage || '', data.errorStack || '');
    sayaclar.set(imza, (sayaclar.get(imza) ?? 0) + 1);
  });

  let enYuksekImza = '';
  let enYuksekSayi = 0;
  for (const [imza, sayi] of sayaclar) {
    if (sayi > enYuksekSayi) {
      enYuksekSayi = sayi;
      enYuksekImza = imza;
    }
  }

  console.log(
    `Son ${PENCERE_SAAT} saat — ${snap.size} hata kaydı, ${sayaclar.size} benzersiz imza, en yüksek tekrar: ${enYuksekSayi} ` +
      `(eşik: ${ESIK_TEKRAR_SAYISI}).`
  );

  if (enYuksekSayi < ESIK_TEKRAR_SAYISI) {
    const acikUyarilar = await acikHataPatlamasiUyarilariniGetir();
    if (!acikUyarilar.empty) {
      const batch = db.batch();
      acikUyarilar.docs.forEach((d) => batch.update(d.ref, { cozuldu: true, cozulmeTarihi: Timestamp.now() }));
      await batch.commit();
      console.log(`Hata tekrarı normal aralığa döndü — ${acikUyarilar.size} açık hataPatlamasi uyarısı otomatik çözüldü.`);
    } else {
      console.log('Hata tekrarı normal aralıkta, uyarı üretilmedi.');
    }
    return { toplamKayit: snap.size, benzersizImzaSayisi: sayaclar.size, enYuksekTekrar: enYuksekSayi, esikAsildiMi: false };
  }

  const acikUyarilar = await acikHataPatlamasiUyarilariniGetir();
  if (!acikUyarilar.empty) {
    console.log('Eşik aşıldı ancak çözülmemiş bir hata patlaması uyarısı zaten açık — yenisi üretilmedi.');
    return { toplamKayit: snap.size, benzersizImzaSayisi: sayaclar.size, enYuksekTekrar: enYuksekSayi, esikAsildiMi: true };
  }

  await db.collection('adminUyarilari').add({
    tip: UYARI_TIPI,
    mesaj:
      `Hata patlaması: son ${PENCERE_SAAT} saatte aynı imzalı bir istemci hatası ${enYuksekSayi} kez kaydedildi ` +
      `(eşik: ${ESIK_TEKRAR_SAYISI}). İmza: "${enYuksekImza}". Admin panelinde Sistem Hataları sekmesinden ayrıntılara bakın — ` +
      `bu, tek bir kullanıcının tekrarından ziyade çok sayıda farklı oturumda aynı hatanın görülmesi anlamına gelir ` +
      `(telemetryService.ts'in oturum-başına rate-limit'i bunu tek başına engellemez).`,
    tarih: getTurkeyDateString(),
    vakit: null,
    cozuldu: false,
    olusturmaTarihi: Timestamp.now(),
  });

  // BİLEREK process.exit(1) YOK — bkz. dosya başı yorumu ve
  // kotaKontrol.ts'teki AYNI gerekçe (eşik aşımı bir iş hatası değil).
  console.warn(`Eşik aşıldı — admin uyarısı oluşturuldu (${UYARI_TIPI}).`);
  return { toplamKayit: snap.size, benzersizImzaSayisi: sayaclar.size, enYuksekTekrar: enYuksekSayi, esikAsildiMi: true };
}

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  hataEsigiKontroluCalistir().catch((err) => {
    console.error('Hata eşiği kontrolü başarısız:', err);
    process.exit(1);
  });
}
