/**
 * Bir günün (yatsı sonrası) tüm bildirimlerinden kalıcı aylık yük
 * sayaçlarına (aylikVakitSayisi/aylikCumaSayisi/aylikYedekSayisi) işlenecek
 * kredileri hesaplayan SAF (yan etkisiz) çekirdek — scripts/yatsiSonuIslemleri.ts
 * bunu çağırıp sonucu Firestore'a yazar. planlamaCekirdegi.ts'teki "saf
 * çekirdek, ince I/O sarmalayıcı" desenini izler: mantık burada test edilir,
 * script yalnızca sorgu/batch-commit yapar.
 */
import { isFriday } from './dateUtils';

export type GunlukBildirimTipi = 'asil' | 'yedek' | 'gorev_cagrisi' | string;

export interface GunlukKrediGirdisi {
  tip: GunlukBildirimTipi;
  durum: string;
  uid: string;
  /** Görevin tarihi (YYYY-MM-DD) — Cuma kredisi (aşağıdaki cumaKredi) bu
   * alandan TAZE hesaplanır, saklı `cumaMi` alanına GÜVENİLMEZ. Bu alan
   * `bildirimler` şemasında zorunludur (isValidBildirim hasAll), bu yüzden
   * burada da zorunlu — sorgu (`where('tarih','==',bugün)`) zaten her
   * belgede garanti ediyor. */
  tarih: string;
  /** ARTIK KULLANILMIYOR (bkz. aşağıdaki cumaKredi hesaplaması) — yalnızca
   * eski çağıranlarla tip uyumu için tutuluyor. `cumaMi` eksik/yanlış olan
   * (backfill öncesi eski) bir belge, bu alana güvenilseydi Cuma kredisini
   * sessizce atlıyordu; bu da tieBreaker.ts'in aylikCumaSayisi adalet
   * kademesini bozabiliyordu (bkz. kod denetimi — "bilinçli olarak
   * dışarıda bırakılanlar" listesinden, artık tarihten hesaplanarak
   * kapatıldı). */
  cumaMi?: boolean;
  /** Bu bildirimin aylık sayaçlara ZATEN işlendiğini işaretler (bkz.
   *  `puanIslenenIndeksleri` ve yatsiSonuIslemleri.ts). Yalnızca 'bekliyor'
   *  → 'okundu_varsayilan' durum geçişi tekrar-çalıştırmaya karşı doğal
   *  korumalıydı; 'onaylandi' kalan (kullanıcının GÜN İÇİNDE kendi
   *  okudumOnayla'sını verdiği) bildirimler hiç işaretlenmiyordu — script
   *  aynı gün için ikinci kez çalışırsa (ör. GitHub Actions
   *  workflow_dispatch ile manuel "Re-run", ya da script'in kredi batch'i
   *  BAŞARIYLA commit olduktan SONRA ay/yıl sonu reset adımlarından biri
   *  başarısız olup job'ı "failed" gösterip birinin re-run tetiklemesi),
   *  bu 'onaylandi' kayıtlar İKİNCİ KEZ kredilendirilirdi — aylikVakitSayisi
   *  (kişi kartlarındaki "GÖREV YÜKÜ"/"KADRO YÜKÜ PAYI" ve tieBreaker.ts'nin
   *  adalet algoritmasının girdisi) kalıcı olarak şişerdi (bkz. kod
   *  denetimi bulgusu). */
  puanIslendi?: boolean;
}

export interface GunlukKrediSonucu {
  /** Asil (ve asil'le eşdeğer ağırlıklı acil çağrı) kredisi. */
  asilKredi: Record<string, number>;
  /** Cuma vakitlerinde asil olunan gün sayısı — aylikVakitSayisi'ndan ayrı
   *  tutulur (bkz. tieBreaker.ts, algoritma denetimi). */
  cumaKredi: Record<string, number>;
  /** Yedek görevi asil'in yarısı ağırlığında kalıcı sayaca işlenir (bkz. K6). */
  yedekKredi: Record<string, number>;
  /** Kendi onayını vermeden gün sonuna kalan acil çağrı sahipleri — admin uyarısı için. */
  uyariUids: string[];
  /** `bildirimler` girdi listesindeki, 'bekliyor' kaldığı için
   *  durum:'okundu_varsayilan' olarak işaretlenmesi gereken kayıtların indeksleri. */
  okunduVarsayilanIndeksleri: number[];
  /** `bildirimler` girdi listesindeki, HERHANGİ bir sayaca (asil/cuma/yedek)
   *  kredi verilmiş TÜM kayıtların indeksleri — `okunduVarsayilanIndeksleri`
   *  ile ÇAKIŞABİLİR (bekliyor kalanlar ikisine de girer). Çağıran taraf bu
   *  indekslerin belgesine `puanIslendi: true` yazmalı ki aynı çalıştırma
   *  tekrar tetiklenirse (bkz. `puanIslendi` alan yorumu) bu kayıtlar
   *  ikinci kez sayılmasın. */
  puanIslenenIndeksleri: number[];
}

/**
 * `bekliyor` → varsayılan olarak görevi yapmış sayılır (kredi + gerekiyorsa
 * okundu_varsayilan işareti). `onaylandi` → kendi onayını vermiş, kredi
 * verilir ama işaret zaten `okudumOnayla`'da set edilmiştir. `reddedildi`
 * (mazeret bildirilmiş) → kredi yok. `puanIslendi === true` olan HERHANGİ
 * bir kayıt (durumu ne olursa olsun) tamamen atlanır — tekrar-çalıştırma
 * güvenliği (bkz. yukarıdaki `puanIslendi` alan yorumu).
 *
 * `gorev_cagrisi` (acil çağrı — hem asil hem yedek mazeret bildirdiğinde
 * devreye giren üçüncü kişi), asil'le birebir aynı işi fiilen yaptığından
 * asilKredi ile aynı ağırlıkta kredilendirilir — önceden HİÇBİR durum dalında
 * kredi verilmiyordu, bu yüzden tekrar acil çağrılan biri adalet
 * algoritmasında sistematik olarak "az yüklü" görünüyordu (bkz. mantık
 * denetimi, aynı sınıf adaletsizlik tieBreaker.ts K6'da zaten ele alınmıştı).
 */
export function gunlukKredileriHesapla(bildirimler: GunlukKrediGirdisi[]): GunlukKrediSonucu {
  const asilKredi: Record<string, number> = {};
  const cumaKredi: Record<string, number> = {};
  const yedekKredi: Record<string, number> = {};
  const uyariUids: string[] = [];
  const okunduVarsayilanIndeksleri: number[] = [];
  const puanIslenenIndeksleri: number[] = [];

  bildirimler.forEach((data, index) => {
    if (data.puanIslendi === true) return;

    // `tarih`ten taze hesaplanır — bkz. yukarıdaki `cumaMi` alan yorumu.
    // `new Date(y, m-1, d)` yerel saat dilimini kullanır ama saf gün-adı
    // hesabı için sorun değildir (saat bileşeni yok); firestore.rules
    // `haftaGunuNumarasi`/`isFriday` ile AYNI takvim mantığı.
    const [gY, gM, gD] = data.tarih.split('-').map(Number);
    const cumaMi = isFriday(new Date(gY!, gM! - 1, gD!));

    if (data.tip === 'asil') {
      if (data.durum === 'bekliyor') {
        okunduVarsayilanIndeksleri.push(index);
        puanIslenenIndeksleri.push(index);
        asilKredi[data.uid] = (asilKredi[data.uid] || 0) + 1;
        if (cumaMi) cumaKredi[data.uid] = (cumaKredi[data.uid] || 0) + 1;
      } else if (data.durum === 'onaylandi') {
        puanIslenenIndeksleri.push(index);
        asilKredi[data.uid] = (asilKredi[data.uid] || 0) + 1;
        if (cumaMi) cumaKredi[data.uid] = (cumaKredi[data.uid] || 0) + 1;
      }
    } else if (data.tip === 'gorev_cagrisi') {
      if (data.durum === 'bekliyor') {
        okunduVarsayilanIndeksleri.push(index);
        puanIslenenIndeksleri.push(index);
        asilKredi[data.uid] = (asilKredi[data.uid] || 0) + 1;
        if (cumaMi) cumaKredi[data.uid] = (cumaKredi[data.uid] || 0) + 1;
        uyariUids.push(data.uid);
      } else if (data.durum === 'onaylandi') {
        puanIslenenIndeksleri.push(index);
        asilKredi[data.uid] = (asilKredi[data.uid] || 0) + 1;
        if (cumaMi) cumaKredi[data.uid] = (cumaKredi[data.uid] || 0) + 1;
      }
      // durum === 'reddedildi': gorev_cagrisi zaten mazeret akışının ürettiği
      // bir devir değil (kriziBaslat/vekalet ile terfi ettirilir), bu dala
      // pratikte düşmez.
    } else if (data.tip === 'yedek') {
      if (data.durum === 'bekliyor') {
        okunduVarsayilanIndeksleri.push(index);
        puanIslenenIndeksleri.push(index);
        yedekKredi[data.uid] = (yedekKredi[data.uid] || 0) + 1;
      } else if (data.durum === 'onaylandi') {
        puanIslenenIndeksleri.push(index);
        yedekKredi[data.uid] = (yedekKredi[data.uid] || 0) + 1;
      }
    }
  });

  return { asilKredi, cumaKredi, yedekKredi, uyariUids, okunduVarsayilanIndeksleri, puanIslenenIndeksleri };
}
