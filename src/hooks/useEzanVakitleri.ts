import { useMemo } from 'react';
import { parseISO } from 'date-fns';
import { useVakitStore } from '../store/useVakitStore';
import { useGpsVakitStore } from '../store/useGpsVakitStore';
import { isRamazan } from '../lib/islamicCalendar';
import { getMinutesDiff, getTurkeyDateString } from '../lib/dateUtils';
import { GunlukVakit } from '../types';

function adjustVakitWithOffset(officialVakit: string | undefined, offsetMinutes: number): string {
  if (!officialVakit) return '';
  const [h, m] = officialVakit.split(':').map(Number);
  const totalMinutes = h * 60 + m + offsetMinutes;
  const adjustedMinutes = (totalMinutes + 24 * 60) % (24 * 60);
  const newH = Math.floor(adjustedMinutes / 60);
  const newM = adjustedMinutes % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

function adjustSabahTime(vakitler: GunlukVakit | null): GunlukVakit | null {
  if (!vakitler) return null;
  const date = parseISO(vakitler.tarih);

  // Orijinal imsak vaktini (ham sabah vaktini) sakla
  const originalImsak = vakitler.imsak || vakitler.sabah;

  if (isRamazan(date)) {
    // Ramazan günlerinde: tam imsak vaktinde
    return {
      ...vakitler,
      imsak: originalImsak,
    };
  }
  // Diğer aylarda: güneş doğuş saatinden 1 saat önce
  if (!vakitler.gunes) return vakitler;
  const [h, m] = vakitler.gunes.split(':').map(Number);
  let newH = h - 1;
  if (newH < 0) newH += 24;
  const adjustedSabah = `${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return {
    ...vakitler,
    sabah: adjustedSabah,
    imsak: originalImsak,
  };
}

export function useEzanVakitleri() {
  const { bugunVakitler: officialBugun, yarinVakitler: officialYarin, loading } = useVakitStore();
  const { gpsEnabled, gpsVakitler } = useGpsVakitStore();

  const rawBugunVakitler = useMemo(() => {
    // GPS verisi yalnızca bugünün tarihine aitse güvenilir. Gece yarısını
    // geçtikten sonra periyodik yenileme henüz tamamlanmadıysa dünün GPS
    // vaktini "bugün" diye göstermek yerine resmi vakitlere düşülür.
    if (gpsEnabled && gpsVakitler && gpsVakitler.tarih === getTurkeyDateString()) {
      return gpsVakitler;
    }
    return officialBugun;
  }, [gpsEnabled, gpsVakitler, officialBugun]);

  const rawYarinVakitler = useMemo(() => {
    // Aynı bayatlık kontrolü: GPS verisi bugüne ait değilse, bugünkü resmi
    // vakitle karşılaştırıp yanlış bir offset türetmek yerine yarın için de
    // düz resmi vakitlere düşülür.
    if (!gpsEnabled || !gpsVakitler || !officialYarin || !officialBugun || gpsVakitler.tarih !== getTurkeyDateString()) {
      return officialYarin;
    }
    const sabahOffset = getMinutesDiff(officialBugun.sabah, gpsVakitler.sabah);
    const gunesOffset = getMinutesDiff(officialBugun.gunes, gpsVakitler.gunes);
    const ogleOffset = getMinutesDiff(officialBugun.ogle, gpsVakitler.ogle);
    const ikindiOffset = getMinutesDiff(officialBugun.ikindi, gpsVakitler.ikindi);
    const aksamOffset = getMinutesDiff(officialBugun.aksam, gpsVakitler.aksam);
    const yatsiOffset = getMinutesDiff(officialBugun.yatsi, gpsVakitler.yatsi);

    return {
      ...officialYarin,
      tarih: officialYarin.tarih,
      sabah: adjustVakitWithOffset(officialYarin.sabah, sabahOffset),
      gunes: adjustVakitWithOffset(officialYarin.gunes, gunesOffset),
      ogle: adjustVakitWithOffset(officialYarin.ogle, ogleOffset),
      ikindi: adjustVakitWithOffset(officialYarin.ikindi, ikindiOffset),
      aksam: adjustVakitWithOffset(officialYarin.aksam, aksamOffset),
      yatsi: adjustVakitWithOffset(officialYarin.yatsi, yatsiOffset),
    } as GunlukVakit;
  }, [gpsEnabled, gpsVakitler, officialBugun, officialYarin]);

  const bugunVakitler = useMemo(() => {
    return adjustSabahTime(rawBugunVakitler);
  }, [rawBugunVakitler]);

  const yarinVakitler = useMemo(() => {
    return adjustSabahTime(rawYarinVakitler);
  }, [rawYarinVakitler]);

  // GPS'e göre hesaplanan vaktin resmi ilçe vaktinden farkını göstermek
  // isteyen bileşenler için (bkz. AnaEkranHero'daki "±Ndk" fark rozetleri)
  // GPS'ten bağımsız, yalnızca ilçe önbelleğine dayanan resmi vakit — aynı
  // imsak/sabah düzeltmesiyle — ayrıca dışa aktarılır. `bugunVakitler` GPS
  // açıkken zaten GPS verisine döndüğü için, karşılaştırma bunu KULLANMAZ.
  const resmiBugunVakitler = useMemo(() => {
    return adjustSabahTime(officialBugun);
  }, [officialBugun]);

  return { bugunVakitler, yarinVakitler, loading, resmiBugunVakitler };
}
