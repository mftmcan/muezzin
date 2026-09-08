/**
 * islamicCalendar.ts — Hicri Takvim Yardımcı Fonksiyonları
 * Kerahat, Teheccüd, Bayram ve Teşrik vakitlerinin tespiti için
 */

import { addDays } from 'date-fns';
import { getHijriDate } from './dateUtils';

export interface HijriDateParts {
  day: number;
  month: number; // 1–12
  year: number;
  monthName: string;
}

const HICRI_AY_ISIMLERI = [
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

/**
 * getHijriDate() fonksiyonunun döndürdüğü metni parse ederek
 * yapısal bir nesneye çevirir.
 * Örnek: "25 Zilhicce 1446" → { day: 25, month: 12, year: 1446, monthName: 'Zilhicce' }
 */
export function parseHijriDate(date: Date): HijriDateParts {
  const text = getHijriDate(date); // "d MonthName yyyy"
  const parts = text.trim().split(' ');
  const day = parseInt(parts[0], 10);
  const monthName = parts[1];
  const year = parseInt(parts[2], 10);
  const month = HICRI_AY_ISIMLERI.indexOf(monthName) + 1;
  return { day, month, year, monthName };
}

/** Ramazan Bayramı: 1 Şevval (10. ay) */
export function isRamazanBayram(date: Date): boolean {
  const { day, month } = parseHijriDate(date);
  return month === 10 && day === 1;
}

/** Kurban Bayramı: 10 Zilhicce (12. ay) */
export function isKurbanBayram(date: Date): boolean {
  const { day, month } = parseHijriDate(date);
  return month === 12 && day === 10;
}

/** Arefe günü: 9 Zilhicce */
export function isArefe(date: Date): boolean {
  const { day, month } = parseHijriDate(date);
  return month === 12 && day === 9;
}

/**
 * Teşrik günleri: 9–13 Zilhicce
 * (Arefe dahil, Kurban Bayramı 3 günü ve tatil günü dahil)
 */
export function isTesrikGunu(date: Date): boolean {
  const { day, month } = parseHijriDate(date);
  return month === 12 && day >= 9 && day <= 13;
}

/**
 * Son teşrik günü: 13 Zilhicce — İkindi'den sonra teşrik biter
 */
export function isSonTesrikGunu(date: Date): boolean {
  const { day, month } = parseHijriDate(date);
  return month === 12 && day === 13;
}

/** Bir gün öncesi için Hicri tarih kontrolü */
export function isRamazanBayramArife(date: Date): boolean {
  // Bir sonraki gün Ramazan Bayramı mı? → 30 Ramazan (9. ay, 30. gün) veya doğrudan hesap
  const nextDay = addDays(date, 1);
  return isRamazanBayram(nextDay);
}

export function isKurbanBayramArife(date: Date): boolean {
  // Bir sonraki gün Kurban Bayramı mı? → Arefe günü = 9 Zilhicce
  return isArefe(date);
}

/** Arefe gününden 1 gün öncesi kontrolü (Arefe hazırlığı) */
export function isRamazanArifeOncesi(date: Date): boolean {
  // Bir sonraki gün Ramazan Bayramı Arefesi mi?
  const nextDay = addDays(date, 1);
  return isRamazanBayramArife(nextDay);
}

export function isKurbanArifeOncesi(date: Date): boolean {
  // Bir sonraki gün Kurban Bayramı Arefesi mi? (8 Zilhicce)
  const { day, month } = parseHijriDate(date);
  return month === 12 && day === 8;
}

/** Ramazan ayı tespiti: 9. ay */
export function isRamazan(date: Date): boolean {
  const { month } = parseHijriDate(date);
  return month === 9;
}

/** Ramazan'dan 1 gün öncesi tespiti (İlk Sahur & Teravih gecesi) */
export function isRamazanBaslangiciOncesi(date: Date): boolean {
  const nextDay = addDays(date, 1);
  const { day, month } = parseHijriDate(nextDay);
  return month === 9 && day === 1;
}

// ─────────────────────────────────────────────────────
// Kandil Geceleri (Regaib, Miraç, Berat, Kadir, Mevlid)
// ─────────────────────────────────────────────────────

/**
 * Bu beş fonksiyonun HEPSİ, "bu tarih doğrudan hedef hicri (ay, gün)'e denk
 * geliyor mu" sorusuna KAYDIRMASIZ cevap verir — kandil GECESİNİN "bir gün
 * önceki akşam" olması (İslami günün akşamla başlaması ilkesi: "27. gece" =
 * hicri 27'nin kendi akşamı değil, YARIN hicri 27 olacaksa BUGÜNÜN akşamı)
 * kasıtlı olarak burada değil, tek bir yerde — useOzelVakitMesaji.ts'in
 * kandil bloğunda — ele alınır (bkz. kullanıcı doğrulaması). Regaib eskiden
 * bu kaydırmayı burada (Perşembe tespiti olarak) kendi içinde taşıyordu; artık
 * diğer dördüyle simetrik olsun diye doğrudan Cuma'yı (kaydırmasız hedef gün)
 * tespit ediyor.
 */

/** Regaib Kandili: Receb ayının (7. ay) ilk Cuma günü. Bir 7 günlük pencere
 *  haftanın her gününden tam bir tane içerir; bu yüzden ayın ilk 7 günü
 *  içine düşen Cuma, o ayın İLK Cuma'sı olmak zorundadır — tekil ve kesin
 *  bir tespit, hicriden miladiye ters dönüşüm gerektirmez. */
export function isRegaibKandili(date: Date): boolean {
  const { day, month } = parseHijriDate(date);
  return month === 7 && day <= 7 && date.getDay() === 5; // 5 = Cuma
}

/** Miraç Kandili: 27 Receb (7. ay) */
export function isMiracKandili(date: Date): boolean {
  const { day, month } = parseHijriDate(date);
  return month === 7 && day === 27;
}

/** Berat Kandili: 15 Şaban (8. ay) */
export function isBeratKandili(date: Date): boolean {
  const { day, month } = parseHijriDate(date);
  return month === 8 && day === 15;
}

/** Kadir Gecesi: 27 Ramazan (9. ay) — Diyanet takviminde sabit gösterilir. */
export function isKadirGecesi(date: Date): boolean {
  const { day, month } = parseHijriDate(date);
  return month === 9 && day === 27;
}

/** Mevlid Kandili: 12 Rebiülevvel (3. ay) */
export function isMevlidKandili(date: Date): boolean {
  const { day, month } = parseHijriDate(date);
  return month === 3 && day === 12;
}

// ─────────────────────────────────────────────────────
// Hicri Yılbaşı ve Aşure Günü — kandillerin aksine "gece" değil "gün"
// olarak anılır, bu yüzden akşam-kaydırması uygulanmaz.
// ─────────────────────────────────────────────────────

/** Hicri Yılbaşı: 1 Muharrem (1. ay) */
export function isHicriYilbasi(date: Date): boolean {
  const { day, month } = parseHijriDate(date);
  return month === 1 && day === 1;
}

/** Aşure Günü: 10 Muharrem (1. ay) */
export function isAsureGunu(date: Date): boolean {
  const { day, month } = parseHijriDate(date);
  return month === 1 && day === 10;
}
