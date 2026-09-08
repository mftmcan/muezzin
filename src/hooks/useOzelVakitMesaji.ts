/**
 * useOzelVakitMesaji.ts — Özel Dini Vakit Mesajı Hook
 *
 * Gerçek zamanlı olarak şu mesaj tiplerini hesaplar:
 *  - kerahat        : Nafile namaz yasaklı vakitler (Hanefî / Diyanet)
 *  - teheccud       : Gece son üçte birlik dilimi hatırlatması
 *  - bayram_arife   : Bayramdan bir gün önce hazırlık mesajı
 *  - bayram         : Bayram namazı vakti
 *  - tesrik         : Kurban günlerinde farz namazı öncesi/sonrası tekbir hatırlatması
 *  - kandil         : Regaib / Miraç / Berat / Kadir / Mevlid geceleri. İslami
 *                      günün akşamla başlaması ilkesi gereği "hicri X. gece"
 *                      hicri X'in KENDİ akşamı değil, YARIN hicri X olacaksa
 *                      BUGÜNÜN akşamıdır. Sıra GECE ÖNCE, GÜNDÜZ SONRA (bkz.
 *                      kullanıcı doğrulaması) — iki ayrı takvim gününde:
 *                      gece (D'nin akşamından D+1'in imsakına, `yarinDate`
 *                      hicri X ise) kandilin kendisi; ardından gündüz (D+1'in
 *                      kendi imsakından akşamına, `bugunDate` hicri X ise)
 *                      "bu gün kandil günü" hatırlatması.
 *  - hicri_yilbasi  : 1 Muharrem (gece değil gün olarak anılır, kaydırmasız)
 *  - asure_gunu     : 10 Muharrem (gece değil gün olarak anılır, kaydırmasız)
 */

import { useMemo } from 'react';
import { addDays, format } from 'date-fns';
import { GunlukVakit, Vakit } from '../types';
import {
  parseVakitToDate,
  calculateKerahatTimes,
  calculateLastThirdOfNight,
  isFriday as isFridayTarih,
  toTurkishUpperCase,
} from '../lib/dateUtils';
import {
  isRamazanBayram,
  isKurbanBayram,
  isRamazanBayramArife,
  isKurbanBayramArife,
  isRamazanArifeOncesi,
  isKurbanArifeOncesi,
  isRamazanBaslangiciOncesi,
  isTesrikGunu,
  isSonTesrikGunu,
  isRegaibKandili,
  isMiracKandili,
  isBeratKandili,
  isKadirGecesi,
  isMevlidKandili,
  isHicriYilbasi,
  isAsureGunu,
  parseHijriDate,
} from '../lib/islamicCalendar';
import { useSystemSettingsStore } from '../store/useSystemSettingsStore';

export type OzelVakitTip =
  | 'kerahat_dogus'
  | 'kerahat_zeval'
  | 'kerahat_gurub'
  | 'teheccud'
  | 'bayram_arife'
  | 'bayram'
  | 'tesrik'
  | 'cuma'
  | 'kandil'
  | 'hicri_yilbasi'
  | 'asure_gunu'
  | null;

export type TesrikVakitRenk = 'emerald' | 'amber' | 'orange' | 'rose' | 'violet';

export interface OzelVakitDurumu {
  tip: OzelVakitTip;
  baslik: string;
  altBaslik: string;
  aciklama: string;
  arapca?: string;
  transkript?: string;
  /** Teşrik için mevcut vakit rengi */
  tesrikVakitRenk?: TesrikVakitRenk;
  /** Mesajın biteceği zaman (geri sayım için) */
  bitisZamani?: Date;
  /**
   * Bu öncelik zinciri "ilk eşleşme kazanır" mantığıyla çalışır (bkz. mantıksal
   * tutarlılık denetimi) — ama bir kandilin gündüz fazı bazı yıllarda gerçek
   * bir Cuma gününe denk gelebilir (Regaib'in gündüzü TANIM GEREĞİ her zaman
   * Cuma'dır; Miraç/Berat/Kadir/Mevlid sabit hicri günler olduğundan bazı
   * yıllarda tesadüfen Cuma'ya denk gelebilir). Bu tek durumda kandil Cuma'yı
   * SESSİZCE ezmesin diye, ikinci bir banner burada taşınır — yalnızca bu
   * örtüşme için var, genel bir "çoklu durum" sistemi değil (bkz. 3 yıllık
   * simülasyon: başka hiçbir örtüşme yok).
   */
  ikincilDurum?: OzelVakitDurumu;
}

// Teşrik tekbiri metni
const TESRIK_TEKBIR_ARAPCA =
  'اللَّهُ أَكْبَرُ اللَّهُ أَكْبَرُ لَا إِلَهَ إِلَّا اللَّهُ وَاللَّهُ أَكْبَرُ اللَّهُ أَكْبَرُ وَلِلَّهِ الْحَمْدُ';
const TESRIK_TEKBIR_TRANSKRIPT = 'Allahu Ekber, Allahu Ekber. Lâ ilâhe illallah. Vallahu Ekber, Allahu Ekber. Ve lillâhil hamd.';

/** Vakit adına göre teşrik banner rengi */
function getTesrikRenk(vakit: Vakit | null): TesrikVakitRenk {
  switch (vakit) {
    case 'sabah':
      return 'emerald';
    case 'ogle':
      return 'amber';
    case 'ikindi':
      return 'orange';
    case 'aksam':
      return 'rose';
    case 'yatsi':
      return 'violet';
    default:
      return 'violet';
  }
}

/**
 * Ana hook
 * @param bugunVakitler - Bugünkü namaz vakitleri (string "HH:MM")
 * @param bugunDate     - Bugünün tarih nesnesi
 * @param now           - Gerçek zamanlı saat (useTime() hook'undan)
 */
export function useOzelVakitMesaji(bugunVakitler: GunlukVakit | null, bugunDate: Date, now: Date): OzelVakitDurumu {
  const { settings } = useSystemSettingsStore();

  // Bu hesaplamanın TÜM sınır koşulları (ezan vakti, kerahat, teşrik hazırlık
  // eşiği vb.) dakika hassasiyetindedir — `now` saniyede bir değiştiği için
  // aşağıdaki useMemo önceden fiilen hiçbir önbellekleme sağlamıyordu: 7 tarih
  // parse + hicri takvim + kerahat/teşrik/bayram kontrolleri saniyede bir
  // tekrar çalışıyordu (bkz. kod denetimi). `now` dakikaya yuvarlanmış
  // sayısal bir anahtara indirgenip yalnızca dakika değiştiğinde yeniden
  // hesaplanır; canlı geri sayım zaten OzelVakitBanner'ın kendi `useTime()`'ına
  // (KalanSure bileşeni) dayandığından bu hook için dakika hassasiyeti yeterli.
  const nowDakikaKey = Math.floor(now.getTime() / 60000);

  return useMemo<OzelVakitDurumu>(() => {
    const now = new Date(nowDakikaKey * 60000);
    const NULL_DURUM: OzelVakitDurumu = { tip: null, baslik: '', altBaslik: '', aciklama: '' };

    if (!bugunVakitler) return NULL_DURUM;

    const dateStr = format(bugunDate, 'yyyy-MM-dd');
    // Kandil tespiti bu tarihe göre değil YARINA göre yapılır (bkz. dosya
    // başı yorumu — İslami günün akşamla başlaması ilkesi).
    const yarinDate = addDays(bugunDate, 1);

    // Tüm vakit nesnelerini parse et
    const sabahDate = parseVakitToDate(dateStr, bugunVakitler.sabah);
    const imsakDate = parseVakitToDate(dateStr, bugunVakitler.imsak || bugunVakitler.sabah);
    const gunesDate = parseVakitToDate(dateStr, bugunVakitler.gunes);
    const ogleDate = parseVakitToDate(dateStr, bugunVakitler.ogle);
    const ikindiDate = parseVakitToDate(dateStr, bugunVakitler.ikindi);
    const aksamDate = parseVakitToDate(dateStr, bugunVakitler.aksam);
    const yatsiDate = parseVakitToDate(dateStr, bugunVakitler.yatsi);

    // Bir sonraki güne ait imsak (sabah) = 24 saat sonra
    const yarinSabahDate = sabahDate ? new Date(sabahDate.getTime() + 24 * 60 * 60 * 1000) : null;

    const yarinImsakDate = imsakDate ? new Date(imsakDate.getTime() + 24 * 60 * 60 * 1000) : null;

    // Yatsı'dan imsak'a olan gece aralığı (teheccüd hesabı için)
    // calculateLastThirdOfNight(aksam, imsak) API'si mevcut — bunu yatsi→yarinSabah aralığı üzerinden kullanıyoruz
    // ancak gece uzunluğu aksamdan imsaksa daha doğru hesaplanır
    const geceBaslangicDate = aksamDate; // Gece akşamdan başlar
    const geceBitisDate = yarinImsakDate; // İmsak = astronomik imsak vaktidir (sabah namazı saati değil)

    // ─────────────────────────────────────────────────────
    // 1. BAYRAM NAMAZI VAKTİ (güneş doğuşu + 40 dk → Öğle)
    // ─────────────────────────────────────────────────────
    const isRB = isRamazanBayram(bugunDate);
    const isKB = isKurbanBayram(bugunDate);

    if ((isRB || isKB) && gunesDate && ogleDate) {
      const bayramBaslangic = new Date(gunesDate.getTime() + 40 * 60 * 1000);
      if (now >= bayramBaslangic && now < ogleDate) {
        const bayramTuru = isRB ? 'Ramazan' : 'Kurban';
        return {
          tip: 'bayram',
          baslik: `${bayramTuru} Bayramı Namazı`,
          altBaslik: 'BAYRAM NAMAZI VAKTİ',
          aciklama: `Bayram namazı şu anda kılınabilir. Öğle ezanına kadar vakti devam eder.`,
          bitisZamani: ogleDate,
        };
      }
    }

    // ─────────────────────────────────────────────────────
    // 2. TEŞRİK TEKBİRLERİ (9–13 Zilhicce)
    // Her namaz vaktinden 30 dk önce → bir sonraki ezana kadar
    // ─────────────────────────────────────────────────────
    if (isTesrikGunu(bugunDate)) {
      const vakitler: Array<{ vakit: Vakit; date: Date | null; sonraki: Date | null }> = [
        { vakit: 'sabah', date: sabahDate, sonraki: ogleDate },
        { vakit: 'ogle', date: ogleDate, sonraki: ikindiDate },
        { vakit: 'ikindi', date: ikindiDate, sonraki: aksamDate },
        { vakit: 'aksam', date: aksamDate, sonraki: yatsiDate },
        { vakit: 'yatsi', date: yatsiDate, sonraki: yarinSabahDate },
      ];

      for (const v of vakitler) {
        if (!v.date) continue;

        // Son teşrik günü İkindi sonrası teşrik biter
        if (isSonTesrikGunu(bugunDate) && v.vakit === 'ikindi' && v.sonraki) {
          const hazirlikBaslangic = new Date(v.date.getTime() - 30 * 60 * 1000);
          if (now >= hazirlikBaslangic && now < v.sonraki) {
            return {
              tip: 'tesrik',
              baslik: 'Teşrik Tekbirleri',
              altBaslik: `${toTurkishUpperCase(v.vakit)} NAMAZI`,
              aciklama: 'Son teşrik vakti. Bu namazın ardından teşrik tekbirleri tamamlanır.',
              arapca: TESRIK_TEKBIR_ARAPCA,
              transkript: TESRIK_TEKBIR_TRANSKRIPT,
              tesrikVakitRenk: getTesrikRenk(v.vakit),
              bitisZamani: v.sonraki,
            };
          }
          // İkindiden sonra teşrik bitti — gösterme
          if (v.sonraki && now >= v.sonraki) break;
          continue;
        }

        const hazirlikBaslangic = new Date(v.date.getTime() - 30 * 60 * 1000);
        const sonrakiEzan = v.sonraki;

        if (sonrakiEzan && now >= hazirlikBaslangic && now < sonrakiEzan) {
          const { day: zilhicceGunu } = parseHijriDate(bugunDate);
          const gunAciklama =
            zilhicceGunu === 9
              ? 'Arefe günü'
              : zilhicceGunu === 10
                ? 'Kurban Bayramı 1. gün'
                : zilhicceGunu === 11
                  ? 'Kurban Bayramı 2. gün'
                  : zilhicceGunu === 12
                    ? 'Kurban Bayramı 3. gün'
                    : 'Son teşrik günü';
          return {
            tip: 'tesrik',
            baslik: 'Teşrik Tekbirleri',
            altBaslik: `${toTurkishUpperCase(v.vakit)} NAMAZI`,
            aciklama: `${gunAciklama} — Her farz namazdan sonra teşrik tekbiri getirilir.`,
            arapca: TESRIK_TEKBIR_ARAPCA,
            transkript: TESRIK_TEKBIR_TRANSKRIPT,
            tesrikVakitRenk: getTesrikRenk(v.vakit),
            bitisZamani: sonrakiEzan,
          };
        }
      }
    }

    // ─────────────────────────────────────────────────────
    // 3. BAYRAM AREFESİ (Arefe günü boyu gösterilir, namaz vakitlerinde teşrik tekbiri önceliklidir)
    // ─────────────────────────────────────────────────────
    const isRBArife = isRamazanBayramArife(bugunDate);
    const isKBArife = isKurbanBayramArife(bugunDate);

    if ((isRBArife || isKBArife) && aksamDate) {
      const bayramTuru = isRBArife ? 'Ramazan' : 'Kurban';
      // Bitiş: Yarın güneş doğuşu (bayram namazı başlamadan önce)
      const yarinGunesDate = gunesDate ? new Date(gunesDate.getTime() + 24 * 60 * 60 * 1000) : null;
      return {
        tip: 'bayram_arife',
        baslik: `${bayramTuru} Bayramınız Mübarek Olsun`,
        altBaslik: 'YARIN BAYRAM NAMAZI',
        aciklama: isKBArife
          ? 'Yarın bayram namazına hazırlıklı olunuz. Farz namazların ardından Teşrik Tekbiri getirmeyi unutmayınız.'
          : 'Yarın bayram namazına hazırlıklı olunuz. Güneş doğumundan yaklaşık 40 dakika sonra kılınır.',
        bitisZamani: yarinGunesDate ?? undefined,
      };
    }

    // ─────────────────────────────────────────────────────
    // 3b. AREFE GÜNÜNDEN 1 GÜN ÖNCESİ (Arefe Hazırlığı - Gün boyu gösterilir)
    // ─────────────────────────────────────────────────────
    const isRBArifeOncesi = isRamazanArifeOncesi(bugunDate);
    const isKBArifeOncesi = isKurbanArifeOncesi(bugunDate);

    if ((isRBArifeOncesi || isKBArifeOncesi) && aksamDate) {
      const bayramTuru = isRBArifeOncesi ? 'Ramazan' : 'Kurban';
      // Bitiş: Yarın sabah (Arefe sabahı itibarıyla bu banner biter ve yerine Arefe günü bannerı gelir)
      const yarinSabahDate = new Date(aksamDate.getTime() + 12 * 60 * 60 * 1000);
      return {
        tip: 'bayram_arife',
        baslik: `${bayramTuru} Bayramı Arefesi Yaklaşıyor`,
        altBaslik: 'YARIN AREFE GÜNÜ',
        aciklama: isKBArifeOncesi
          ? 'Yarın Kurban Bayramı Arefesidir. Yarın sabah namazından itibaren her farz namazın ardından Teşrik Tekbiri getirilmeye başlanacaktır.'
          : 'Yarın Ramazan Bayramı Arefesidir. Yarınki günü dua, ibadet ve bayram hazırlıklarıyla geçirmeye gayret edelim.',
        bitisZamani: yarinSabahDate,
      };
    }

    // ─────────────────────────────────────────────────────
    // 3c. RAMAZAN BAŞLANGICI (1 Gün Öncesi - İlk Sahur & Teravih Gecesi)
    // ─────────────────────────────────────────────────────
    const isRamazanOncesi = isRamazanBaslangiciOncesi(bugunDate);

    if (isRamazanOncesi && aksamDate) {
      // Bitiş: Yarın sabah (Ramazan'ın ilk günü sabahı)
      const yarinSabahDate = new Date(aksamDate.getTime() + 12 * 60 * 60 * 1000);
      return {
        tip: 'bayram_arife',
        baslik: 'Ramazan-ı Şerif Başlıyor',
        altBaslik: 'BU GECE İLK SAHUR & TERAVİH',
        aciklama:
          "Yarın Ramazan-ı Şerif'in ilk günüdür. Bu akşam yatsı namazıyla birlikte ilk Teravih kılınacak ve gece ilk Sahur'a kalkılacaktır. Mübarek olsun!",
        bitisZamani: yarinSabahDate,
      };
    }

    // ─────────────────────────────────────────────────────
    // 3d. KANDİL GECELERİ (Regaib / Miraç / Berat / Kadir / Mevlid)
    // Sıra GECE ÖNCE, GÜNDÜZ SONRA (bkz. kullanıcı doğrulaması) — iki faz
    // birbirini takip eden İKİ FARKLI takvim gününde gerçekleşir:
    //  1) Gece: BUGÜNÜN akşamından YARININ imsakına — YARIN hicri X ise
    //     (İslami günün akşamla başlaması ilkesi, bkz. dosya başı yorumu).
    //  2) Gündüz: BİR SONRAKİ günün (hicri X'in kendi günü — dün geceki
    //     kandilin ertesi) imsakından akşamına — BUGÜN hicri X ise.
    // Yani bir kandil döngüsünde önce (D günü akşamı) gece fazı, sonra
    // (D+1 günü gündüzü) gündüz fazı gösterilir; aynı takvim gününde asla
    // ikisi birden tetiklenmez. kerahat/teheccüd/cuma gibi rutin
    // bannerlardan daha yüksek öncelikli — bayram/teşrik/arife ile aynı
    // gerekçe: yılda bir kez olan mübarek bir gece.
    // ─────────────────────────────────────────────────────
    const KANDIL_ACIKLAMA: Record<string, string> = {
      'Regaib Kandili':
        'Üç Ayların ve mübarek gecelerin ilkidir. Receb ayının ilk Cuma gecesine denk gelir; dua, tövbe ve ibadetle ihya edilir.',
      'Miraç Kandili': "Peygamber Efendimiz (s.a.v)'in Cenâb-ı Hakk'ın huzuruna yükseldiği, beş vakit namazın farz kılındığı gecedir.",
      'Berat Kandili': 'Yıllık rızık, ecel ve amellerin yazıldığına inanılan; af ve mağfiret gecesidir.',
      'Kadir Gecesi': 'Kur\'ân-ı Kerîm\'in indirilmeye başlandığı, "bin aydan hayırlı" olduğu bildirilen gecedir.',
      'Mevlid Kandili': "Peygamber Efendimiz Hz. Muhammed (s.a.v)'in dünyayı teşrif ettiği doğum gecesidir.",
    };

    const kandilAdiGece = isRegaibKandili(yarinDate)
      ? 'Regaib Kandili'
      : isMiracKandili(yarinDate)
        ? 'Miraç Kandili'
        : isBeratKandili(yarinDate)
          ? 'Berat Kandili'
          : isKadirGecesi(yarinDate)
            ? 'Kadir Gecesi'
            : isMevlidKandili(yarinDate)
              ? 'Mevlid Kandili'
              : null;

    // Gece: kandilin kendisi (bugünün akşamından yarının imsakına)
    if (kandilAdiGece && aksamDate && yarinImsakDate && now >= aksamDate && now < yarinImsakDate) {
      return {
        tip: 'kandil',
        baslik: kandilAdiGece,
        altBaslik: 'MÜBAREK GECE',
        aciklama: `${KANDIL_ACIKLAMA[kandilAdiGece]} ${kandilAdiGece} mübarek olsun.`,
        bitisZamani: yarinImsakDate,
      };
    }

    const kandilAdiGunduz = isRegaibKandili(bugunDate)
      ? 'Regaib Kandili'
      : isMiracKandili(bugunDate)
        ? 'Miraç Kandili'
        : isBeratKandili(bugunDate)
          ? 'Berat Kandili'
          : isKadirGecesi(bugunDate)
            ? 'Kadir Gecesi'
            : isMevlidKandili(bugunDate)
              ? 'Mevlid Kandili'
              : null;

    // Gündüz: "bu gün kandil günü" (bugünün imsakından akşamına) — dün
    // geceki kandilin ertesi günü. Regaib'in gündüzü TANIM GEREĞİ her zaman
    // Cuma'dır; diğer dördü sabit hicri gün olduğundan bazı yıllarda
    // tesadüfen Cuma'ya denk gelebilir — o durumda Cuma bannerı SESSİZCE
    // ezilmesin diye ikincil durum olarak taşınır (bkz. OzelVakitDurumu.ikincilDurum).
    if (kandilAdiGunduz && imsakDate && aksamDate && now >= imsakDate && now < aksamDate) {
      const buGunCuma = isFridayTarih(bugunDate);
      return {
        tip: 'kandil',
        baslik: kandilAdiGunduz,
        altBaslik: 'BU GÜN',
        aciklama: `Bu gün ${kandilAdiGunduz} günü. ${KANDIL_ACIKLAMA[kandilAdiGunduz]}`,
        bitisZamani: aksamDate,
        ikincilDurum: buGunCuma
          ? {
              tip: 'cuma',
              baslik: 'Hayırlı Cumalar',
              altBaslik: 'CUMA GÜNÜ',
              aciklama: 'Bugün Müslümanların haftalık bayramıdır. Günün hayrı, bereketi ve huzuru üzerinize olsun.',
              bitisZamani: aksamDate,
            }
          : undefined,
      };
    }

    // ─────────────────────────────────────────────────────
    // 3e. HİCRİ YILBAŞI (1 Muharrem) VE AŞURE GÜNÜ (10 Muharrem)
    // Kandillerin aksine "gece" değil "gün" olarak anılır — kaydırmasız,
    // o günün imsakından akşamına kadar (cuma bannerıyla aynı desen).
    // ─────────────────────────────────────────────────────
    const ozelGunAdi = isHicriYilbasi(bugunDate) ? 'Hicri Yılbaşı' : isAsureGunu(bugunDate) ? 'Aşure Günü' : null;

    if (ozelGunAdi && imsakDate && aksamDate) {
      if (now >= imsakDate && now < aksamDate) {
        const tip = ozelGunAdi === 'Hicri Yılbaşı' ? ('hicri_yilbasi' as const) : ('asure_gunu' as const);
        const aciklama =
          ozelGunAdi === 'Hicri Yılbaşı'
            ? 'Hicri takvimin yeni yılı başlıyor. Yeni hicri yılınız hayırlara vesile olsun.'
            : 'Muharrem ayının onuncu günü — oruç tutmanın, sadaka vermenin ve akrabalık bağlarını gözetmenin faziletli olduğu gündür.';
        return {
          tip,
          baslik: ozelGunAdi,
          altBaslik: ozelGunAdi === 'Hicri Yılbaşı' ? 'HİCRİ YILBAŞI' : 'AŞURE GÜNÜ',
          aciklama,
          bitisZamani: aksamDate,
        };
      }
    }

    // ─────────────────────────────────────────────────────
    // 4. KERAHAT VAKİTLERİ (Hanefî / Diyanet standardı)
    // ─────────────────────────────────────────────────────
    if (gunesDate && ogleDate && aksamDate) {
      const kerahat = calculateKerahatTimes(gunesDate, ogleDate, aksamDate);

      // Doğuş kerahati (Güneş doğuşu → +40 dk)
      if (now >= kerahat.sabah.baslangic && now < kerahat.sabah.bitis) {
        return {
          tip: 'kerahat_dogus',
          baslik: 'Kerahat Vakti',
          altBaslik: 'GÜNEŞ DOĞUŞU KERÂHATİ',
          aciklama: 'Güneş doğuşu tamamlanıyor. Bu sürede nafile namaz kılmak mekruhtur.',
          bitisZamani: kerahat.sabah.bitis,
        };
      }

      // Zeval kerahati (Öğle'den 15 dk önce → Öğle) — sabah/akşam kerahati
      // gibi calculateKerahatTimes'tan okunur; önceden burada aynı 15dk'lık
      // hesap elle tekrarlanıyordu (bkz. premium standart / hata denetimi,
      // "aynı algoritmayı yeniden yazma" riski).
      if (now >= kerahat.ogle.baslangic && now < ogleDate) {
        return {
          tip: 'kerahat_zeval',
          baslik: 'Kerahat Vakti',
          altBaslik: 'ZEVAL KERÂHATİ',
          aciklama: 'Güneş tam tepedeyken nafile namaz kılmak mekruhtur. Öğle ezanı bekleniyor.',
          bitisZamani: ogleDate,
        };
      }

      // Gurub kerahati (Akşam'dan 40 dk önce → Akşam)
      if (now >= kerahat.aksam.baslangic && now < kerahat.aksam.bitis) {
        return {
          tip: 'kerahat_gurub',
          baslik: 'Kerahat Vakti',
          altBaslik: 'GÜNEŞ BATIŞI KERÂHATİ',
          aciklama: 'Güneş ufka yaklaşıyor. Akşam ezanına kadar nafile namaz kılmak mekruhtur.',
          bitisZamani: kerahat.aksam.bitis,
        };
      }
    }

    // ─────────────────────────────────────────────────────
    // 5. TEHECCÜD VAKTİ (Gecenin son 1/3'ü)
    // calculateLastThirdOfNight(akşam, imsak) — gece akşamdan imsakla bölünür
    // ─────────────────────────────────────────────────────
    if (geceBaslangicDate && geceBitisDate && yatsiDate) {
      const teheccudBaslangic = calculateLastThirdOfNight(geceBaslangicDate, geceBitisDate);
      // İmsak'tan 15 dk önce kadar göster (ekran çok geç kapatılmasın)
      const teheccudBitis = new Date(geceBitisDate.getTime() - 15 * 60 * 1000);

      // Sadece yatsı namazından sonra göster
      if (now >= yatsiDate && now >= teheccudBaslangic && now < teheccudBitis) {
        return {
          tip: 'teheccud',
          baslik: 'Teheccüd Vakti',
          altBaslik: 'GECENİN SON ÜÇTE BİRİ',
          aciklama: 'Teheccüd namazı için en faziletli zaman. İmsak ezanından önce kılınmalıdır.',
          bitisZamani: teheccudBitis,
        };
      }
    }

    // Cuma Günü (İmsak ile Akşam ezanı arasında)
    const isFriday = isFridayTarih(bugunDate);
    if (isFriday && imsakDate && aksamDate) {
      if (now >= imsakDate && now < aksamDate) {
        return {
          tip: 'cuma',
          baslik: 'Hayırlı Cumalar',
          altBaslik: 'CUMA GÜNÜ',
          aciklama: 'Bugün Müslümanların haftalık bayramıdır. Günün hayrı, bereketi ve huzuru üzerinize olsun.',
          bitisZamani: aksamDate,
        };
      }
    }

    return NULL_DURUM;
    // `settings.hicriDuzeltme` parseHijriDate'e (satır ~224) doğrudan argüman
    // olarak geçilmiyor — düzeltme değeri getHijriDate/parseHijriDate
    // içinde globalThis.__hicriOffset üzerinden okunuyor (bkz.
    // useSystemSettingsStore.ts) — eslint statik olarak kullanımı göremiyor;
    // kasıtlı olarak listede tutuluyor, aksi halde admin düzeltmeyi
    // değiştirdiğinde bu memo yeniden hesaplanmaz.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bugunVakitler, bugunDate, nowDakikaKey, settings.hicriDuzeltme]);
}
