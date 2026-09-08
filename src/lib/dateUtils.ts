import { startOfWeek, format, parseISO, subDays, subWeeks } from 'date-fns';
import { Vakit } from '../types';

/**
 * Firestore'dan gelen bir zaman değerini (Timestamp, {seconds}, ISO string
 * veya Date) güvenli şekilde bir JS Date'e çevirir. Değer yoksa null döner.
 */
export function toJsDate(value: unknown): Date | null {
  if (!value) return null;
  const v = value as { toDate?: () => Date; seconds?: number };
  if (typeof v.toDate === 'function') return v.toDate();
  if (typeof v.seconds === 'number') return new Date(v.seconds * 1000);
  const date = new Date(value as string | number | Date);
  return isNaN(date.getTime()) ? null : date;
}

export const VAKIT_GORA_ISIMLERI: Record<Vakit, string> = {
  sabah: 'Sabah',
  ogle: 'Öğle',
  ikindi: 'İkindi',
  aksam: 'Akşam',
  yatsi: 'Yatsı',
};

export function toTurkishUpperCase(text: string): string {
  return text.toLocaleUpperCase('tr-TR');
}

/** `toTurkishUpperCase`'in küçük harf karşılığı — anahtar kelime arama/
 *  eşleştirme öncesi Türkçe metni normalize ederken kullanılır (bkz.
 *  DuyuruYonetimi.tsx, KiblePusulasiModal.tsx, SistemDenetimSekmesi.tsx).
 *  Locale'siz `.toLowerCase()` "İ" harfini tek bir "i" yerine "i" + birleşen
 *  nokta işaretine çevirir, bu da ardından gelen `.includes(...)`
 *  aramalarının sessizce eşleşmemesine yol açar. */
export function toTurkishLowerCase(text: string): string {
  return text.toLocaleLowerCase('tr-TR');
}

/**
 * Türkiye saati (UTC+3) için çevresel bağımsız yardımcı fonksiyonlar
 */

export function getTurkeyNow(): Date {
  const now = new Date();
  // Add server time offset to correct device clock skew
  const offset = typeof globalThis !== 'undefined' && globalThis.__timeOffset !== undefined ? globalThis.__timeOffset : 0;
  const syncedNow = new Date(now.getTime() + offset);

  // Türkiye sabit UTC+3'tür.
  const turkeyOffset = 3 * 60;
  // getTimezoneOffset() yerel saat ile UTC arasındaki farkı dakika cinsinden döner.
  // Türkiye (UTC+3) için bu değer -180'dir.
  // Biz farkı (HedefOffset - YerelOffset) olarak hesaplayıp timestamp'i kaydırıyoruz.
  const localOffset = -syncedNow.getTimezoneOffset();
  const diff = turkeyOffset - localOffset;
  return new Date(syncedNow.getTime() + diff * 60000);
}

export function getTurkeyTimeFormatted(date?: Date): string {
  const d = date || getTurkeyNow();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function getTurkeyDateString(date?: Date): string {
  const d = date || getTurkeyNow();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * İki "HH:mm" saati arasındaki farkı dakika cinsinden döner (time2 - time1).
 * Gece yarısını çevreleyen saatlerde (örn. 23:58 → 00:02) sonucu en kısa
 * yöne sararak normalize eder — aksi halde -1436 gibi anlamsız bir fark
 * çıkar, oysa gerçek fark +4 dakikadır.
 */
export function getMinutesDiff(time1: string | undefined, time2: string | undefined): number {
  if (!time1 || !time2) return 0;
  const [h1, m1] = time1.split(':').map(Number);
  const [h2, m2] = time2.split(':').map(Number);
  let diff = h2 * 60 + m2 - (h1 * 60 + m1);
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return diff;
}

/**
 * Bir "YYYY-MM-DD" tarih dizgesini katı biçimde ayrıştırır. Biçim bozuksa
 * (ör. "2026-5-3", "abc", boş) `null` döner — `Number('abc') === NaN`
 * sessizce `Invalid Date` üretip ARDINDAN gelen her karşılaştırmayı `false`
 * yapıyordu (bkz. `normalizeVakitSaati` yorumu, aynı fail-open sınıfı).
 */
function parseTarihParcalari(tarih: unknown): [number, number, number] | null {
  if (typeof tarih !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(tarih)) return null;
  const [y, m, d] = tarih.split('-').map(Number);
  if (m! < 1 || m! > 12 || d! < 1 || d! > 31) return null;
  return [y!, m!, d!];
}

/**
 * Ezan vakti dizgelerinin TEK normalize/doğrulama noktası.
 *
 * KÖK NEDEN (kod denetimi — "ezan saati biçim asimetrisi"): `vakitler`
 * koleksiyonundaki saat dizgeleri hiçbir yerde doğrulanmıyordu — üç ayrı API
 * ayrıştırıcısı (`parseResmiResponse`, `parseDiyanetResponse`,
 * `parseAladhanResponse`) ham `unknown` değerleri doğrudan `VakitKaydi`'ye
 * cast ediyordu. Aşağı akışta ise iki taraf FARKLI davranıyordu:
 *  - `scripts/vekaletDevirleriniIsle.ts` KATI bir `/^\d{2}:\d{2}$/` uyguluyor,
 *    eşleşmezse `null` döndürüp "ezan geçmedi" varsayıyordu (FAIL-OPEN);
 *  - istemci (`parseVakitToDate`) hiç doğrulamıyor, `"abc"` gibi bir değerde
 *    `Invalid Date` üretiyordu — `suAn >= InvalidDate` HER ZAMAN `false`'tur,
 *    yani "pencere hâlâ açık" (yine FAIL-OPEN).
 * Yani `"9:05"` gibi tek haneli saatli bir kayıt istemcide pencereyi doğru
 * kapatırken cron'da devri UYGULATABİLİYORDU.
 *
 * Çözüm iki katmanlı: (1) veri KAYNAĞINDA (API ayrıştırıcıları) bu fonksiyonla
 * normalize/reddet — bozuk değer `vakitler` belgesine hiç ulaşmasın; (2) her
 * okuma noktası yine bu fonksiyondan geçsin ve ayrıştırılamayan değerde
 * FAIL-CLOSED davransın (bkz. `mazeretKapaliMi`, `scripts/lib/ezanVakitleri.ts`).
 *
 * Kabul edilen girdiler: "H:MM", "HH:MM", "HH:MM:SS" (baştaki/sondaki boşluk
 * kırpılır). Dönüş her zaman sıfır dolgulu "HH:MM"; geçersizse `null`.
 */
export function normalizeVakitSaati(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const eslesme = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!eslesme) return null;
  const saat = Number(eslesme[1]);
  const dakika = Number(eslesme[2]);
  if (saat > 23 || dakika > 59) return null;
  return `${String(saat).padStart(2, '0')}:${String(dakika).padStart(2, '0')}`;
}

/**
 * Bir (tarih, "HH:MM") çiftini GERÇEK bir UTC anına çevirir — çalıştığı
 * makinenin saat diliminden BAĞIMSIZ. Türkiye DST uygulamadığından (sabit
 * UTC+3) doğru an doğrudan hesaplanabilir.
 *
 * `parseVakitToDate`'ten farkı KASITLI: o, `getTurkeyNow()`'un "kaydırılmış"
 * yerel çerçevesinde çalışır (istemci içi karşılaştırmalar için tutarlı ama
 * epoch değeri gerçek an DEĞİLDİR). Firestore'a `Timestamp` olarak YAZILACAK
 * ya da Admin SDK'da `Date.now()` ile karşılaştırılacak her değer bu
 * fonksiyondan gelmelidir (bkz. scripts/vekaletDevirleriniIsle.ts'teki
 * `Date.UTC(..., hh - 3, mm)` deseni — premium hata analizi MV-O1/O2).
 */
export function ezanAniUtc(tarih: unknown, vakitSaati: unknown): Date | null {
  const parcalar = parseTarihParcalari(tarih);
  const saat = normalizeVakitSaati(vakitSaati);
  if (!parcalar || !saat) return null;
  const [y, m, d] = parcalar;
  const [hh, mm] = saat.split(':').map(Number);
  const an = new Date(Date.UTC(y, m - 1, d, hh! - 3, mm!));
  return isNaN(an.getTime()) ? null : an;
}

/**
 * "YYYY-MM-DD" biçiminde bir önceki günün tarihini döner (ay/yıl sınırlarını
 * doğru geçer). Sabah vaktinin mazeret penceresi bir ÖNCEKİ günün yatsısına
 * bağlı olduğundan (bkz. `mazeretKapaliMi`) hem istemci hem cron tarafında
 * gereklidir — UTC aritmetiği kullanır, yerel saat dilimi/DST'den etkilenmez.
 */
export function oncekiGunTarihi(tarih: unknown): string | null {
  const parcalar = parseTarihParcalari(tarih);
  if (!parcalar) return null;
  const [y, m, d] = parcalar;
  const onceki = new Date(Date.UTC(y, m - 1, d - 1));
  if (isNaN(onceki.getTime())) return null;
  return `${onceki.getUTCFullYear()}-${String(onceki.getUTCMonth() + 1).padStart(2, '0')}-${String(onceki.getUTCDate()).padStart(2, '0')}`;
}

export function parseVakitToDate(tarih: string, vakitSaati: string): Date | null {
  const parcalar = parseTarihParcalari(tarih);
  const saat = normalizeVakitSaati(vakitSaati);
  // Biçim doğrulaması EKLENDİ (bkz. `normalizeVakitSaati` yorumu): önceden
  // `"abc"`/`"9:05"` gibi değerler `Number(...)` üzerinden NaN'a düşüp
  // `Invalid Date` döndürüyordu, çağıranların `if (!date)` kontrolü bunu
  // yakalamıyordu ve sonraki her karşılaştırma sessizce `false` oluyordu.
  if (!parcalar || !saat) return null;
  const [year, month, day] = parcalar;
  const [hour, minute] = saat.split(':').map(Number);

  // Önce gerçek bir UTC tarihi oluşturup sonra Türkiye farkını eklemek
  // yerine, getTurkeyNow() üzerinden gelen "kaydırılmış" zamanı baz alarak
  // setHours yapıyoruz. Bu, karşılaştırmaların (now >= target) her zaman
  // tutarlı olmasını sağlar.
  const date = getTurkeyNow();
  date.setFullYear(year, month - 1, day);
  date.setHours(hour!, minute!, 0, 0);
  return isNaN(date.getTime()) ? null : date;
}

export const GUNLER_TR: Record<number, string> = {
  1: 'Pazartesi',
  2: 'Salı',
  3: 'Çarşamba',
  4: 'Perşembe',
  5: 'Cuma',
  6: 'Cumartesi',
  7: 'Pazar',
};

export function isFriday(date: Date): boolean {
  return date.getDay() === 5;
}

/**
 * Bir izin aralığının ([baslangic, bitis], her ikisi de dahil) kaç gün
 * sürdüğünü hesaplar — yıllık izin 30 gün/yıl kotası için (bkz.
 * useAdminIzinlerStore.ts izinOnayla, firestore.rules isValidMuezzin).
 */
export function izinGunSayisi(baslangic: string, bitis: string): number {
  const [by, bm, bd] = baslangic.split('-').map(Number);
  const [ey, em, ed] = bitis.split('-').map(Number);
  const start = new Date(by, bm - 1, bd);
  const end = new Date(ey, em - 1, ed);
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

/**
 * Bir izin aralığının ([baslangic, bitis], her ikisi de dahil) bir Cuma günü
 * içerip içermediğini kontrol eder — "Cuma günü kapsayan yıllık/haftalık izin
 * onaylanamaz" kuralı için tek kaynak. Önceden bu mantık yalnızca
 * IzinYonetimi.tsx'in onay düğmesinde satır içi bir döngü olarak vardı;
 * ExecutiveHeroScreen.tsx'teki aynı izni onaylayan hızlı-onay yolu bu
 * kontrolü hiç yapmıyordu (bkz. code-review, dördüncü denetim turu) — iki
 * yer de artık bu fonksiyonu çağırıyor. firestore.rules'taki
 * izinAraligiCumaIceriyorMu ile aynı iş kuralının istemci tarafı karşılığı
 * (CEL kuralları TS import edemediği için ayrı ayrı tutuluyor — birini
 * değiştirirsen diğerini de güncelle).
 */
export function izinAraligiCumaIceriyorMu(baslangic: string, bitis: string): boolean {
  const [by, bm, bd] = baslangic.split('-').map(Number);
  const [ey, em, ed] = bitis.split('-').map(Number);
  const gun = new Date(by, bm - 1, bd);
  const sonGun = new Date(ey, em - 1, ed);
  // Güvenlik sayacı: ters/aşırı uzun aralıklarda sonsuz döngüyü önler
  // (bkz. useAdminIzinlerStore.ts izinAraligindakiHaftaIdleri aynı desen).
  let guvenlikSayaci = 0;
  while (gun <= sonGun && guvenlikSayaci < 3650) {
    if (isFriday(gun)) return true;
    gun.setDate(gun.getDate() + 1);
    guvenlikSayaci++;
  }
  return false;
}

/**
 * Bir izin talebinin onaylanmasını Cuma kısıtlaması gerekçesiyle engelleyip
 * engellemediğine karar verir; engelleniyorsa admin'e gösterilecek uyarı
 * metnini, engellenmiyorsa `null` döner. Önceden IzinYonetimi.tsx ve
 * ExecutiveHeroScreen.tsx'te birebir kopyalanmış, `tip !== 'mazeret'`
 * istisnası taşıyan iki ayrı blok vardı — o istisna hiçbir zaman
 * tetiklenemezdi çünkü VacationRequestCard.tsx (oluşturma anı) ve
 * firestore.rules'taki isValidIzinTarihAraligi (sunucu) Cuma'yı kapsayan
 * HERHANGİ bir izni, tipinden bağımsız, oluşturma anında zaten reddediyor —
 * yani Cuma içeren bir mazeret-tipi izin kaydı hiçbir zaman var olamaz. Bu
 * istisna admin'e olmayan bir yetkiyi ("mazeret izinleri Cuma'da da
 * onaylanabilir") vaat eden yanıltıcı ölü koddu; kaldırıldı (bkz. mimari
 * denetim).
 */
export function izinOnayCumaEngelMesaji(izin: { baslangic: string; bitis: string }): string | null {
  if (!izinAraligiCumaIceriyorMu(izin.baslangic, izin.bitis)) return null;
  return "Cuma günü kapsayan bir izin onaylanamaz — haftalık mihrap koordinasyonu Cuma'da her zaman dolu olmalıdır.";
}

/**
 * Bir kişinin belirli bir tarihte göreve atanabilir olup olmadığını, onaylı
 * izin kapsamı ve sabit haftalık izin günü kurallarına göre belirler.
 * `planlamaCekirdegi.ts`'teki `haftalikPlanUret`'in (otomatik planlama
 * motoru) `musaitMuezzinler` filtresiyle AYNI formülü kullanır — o dosya
 * hassas/test kapsamlı olduğu için buraya taşınmadı, ama HaftalikCizelge.tsx
 * (manuel atama) daha önce bu kuralı hiç bilmiyordu: bir admin, kendi
 * onayladığı bir izinli günde veya kişinin sabit izin gününde kişiyi manuel
 * olarak göreve atayabiliyordu — otomatik motorun mutlak saydığı bir kural
 * manuel yolda tamamen atlanıyordu (bkz. mimari denetim). Bu formülü
 * değiştirirsen `planlamaCekirdegi.ts`'teki karşılığını da güncelle.
 */
export function kisiGunIcinMusaitMi(
  person: { id: string; haftalikIzinGunu?: number },
  tarih: string,
  onayliIzinler: { uid: string; baslangic: string; bitis: string }[]
): boolean {
  const isOnIzin = onayliIzinler.some((izin) => izin.uid === person.id && tarih >= izin.baslangic && tarih <= izin.bitis);
  const [gY, gM, gD] = tarih.split('-').map(Number);
  const gunTarihi = new Date(gY, gM - 1, gD);
  // Pazartesi=1 ... Pazar=7 (haftalikIzinGunu ile aynı ölçek)
  const gunIndex = (gunTarihi.getDay() + 6) % 7;
  const isFixedDayOff = person.haftalikIzinGunu === gunIndex + 1;
  return !isOnIzin && !isFixedDayOff;
}

export function getHaftaIdFromDate(dateStr: string): string {
  const date = parseISO(dateStr);
  const pazartesi = startOfWeek(date, { weekStartsOn: 1 });
  return `W${format(pazartesi, 'yyyy-MM-dd')}`;
}

/**
 * Verilen haftaId'nin (W-YYYY-MM-DD, Pazartesi başlangıçlı) bir önceki
 * haftasının haftaId'sini ve o haftanın son gününün (Pazar) tarihini döner.
 * Haftalık plan üretiminde dinlenme kuralının (SOS) hafta sınırında
 * sıfırlanmasını önlemek için kullanılır (bkz. algoritma denetimi,
 * src/lib/planlamaCekirdegi.ts `haftalikPlanUret`'in `oncekiHaftaSonEkibi` parametresi).
 */
export function getOncekiHafta(haftaId: string): { haftaId: string; sonGun: string } {
  const buHaftaninPazartesi = parseISO(haftaId.substring(1));
  const oncekiPazartesi = subWeeks(buHaftaninPazartesi, 1);
  const oncekiPazar = subDays(buHaftaninPazartesi, 1);
  return {
    haftaId: `W${format(oncekiPazartesi, 'yyyy-MM-dd')}`,
    sonGun: format(oncekiPazar, 'yyyy-MM-dd'),
  };
}

export function calculateLastThirdOfNight(aksam: Date, imsak: Date): Date {
  let imsakTime = imsak.getTime();
  const aksamTime = aksam.getTime();
  if (imsakTime <= aksamTime) imsakTime += 24 * 60 * 60 * 1000;
  const birBolum = (imsakTime - aksamTime) / 3;
  return new Date(Math.round(imsakTime - birBolum));
}

export function calculateKerahatTimes(gunes: Date, ogle: Date, aksam: Date) {
  return {
    sabah: { baslangic: new Date(gunes), bitis: new Date(gunes.getTime() + 40 * 60 * 1000) },
    ogle: { baslangic: new Date(ogle.getTime() - 15 * 60 * 1000), bitis: new Date(ogle) }, // Zeval: 15 dk
    aksam: { baslangic: new Date(aksam.getTime() - 40 * 60 * 1000), bitis: new Date(aksam) },
  };
}

export function calculateVakitProgress(baslangic: Date, bitis: Date, suan: Date): number {
  const total = bitis.getTime() - baslangic.getTime();
  const elapsed = suan.getTime() - baslangic.getTime();
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, elapsed / total));
}

export function getHijriDate(date: Date): string {
  // Read Hicri offset from globalThis (safe for SSR, testing environments and decoupling module loads)
  const offsetDays = typeof globalThis !== 'undefined' && globalThis.__hicriOffset !== undefined ? globalThis.__hicriOffset : 0;

  // Timezone-safe local day count (immune to UTC midnight shifts)
  const localMs = date.getTime() - date.getTimezoneOffset() * 60000;
  const localDays = Math.floor(localMs / 86400000) + offsetDays;

  // Diyanet/Turkey 2026 Kurban alignment adjustment (-1 day offset compared to standard astronomical tabulate)
  const jd = localDays + 2440588;

  let l = jd - 1948440 + 10632;
  const n = Math.floor((l - 1) / 10631);
  l = l - 10631 * n + 354;
  const j = Math.floor((10985 - l) / 5316) * Math.floor((50 * l) / 17719) + Math.floor(l / 5670) * Math.floor((43 * l) / 15238);
  l = l - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) - Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;
  const m = Math.floor((24 * l) / 709);
  const d = l - Math.floor((709 * m) / 24);
  const y = 30 * n + j - 30;
  const months = [
    'Muharrem',
    'Safer',
    'Rebiülevvel',
    'Rebiülahir',
    'Cemaziyelevvel',
    'Cemaziyelahir',
    'Recep',
    'Şaban',
    'Ramazan',
    'Şevval',
    'Zilkade',
    'Zilhicce',
  ];
  return `${d} ${months[m - 1]} ${y}`;
}
