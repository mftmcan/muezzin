import { useEffect } from 'react';
import { useEzanVakitleri } from './useEzanVakitleri';
import {
  getTurkeyNow,
  parseVakitToDate,
  calculateLastThirdOfNight,
  calculateKerahatTimes,
  isFriday as isFridayTarih,
} from '../lib/dateUtils';
import { mevcutVaktiHesapla } from '../services/ezanVaktiServisi';
import { getActiveAuraColor, getSecondaryAuraColor } from '../lib/auraTheme';
import { Vakit } from '../types';

export function useCircadianTheme() {
  const { bugunVakitler } = useEzanVakitleri();

  useEffect(() => {
    if (!bugunVakitler) return;

    const bugunStr = bugunVakitler.tarih;

    // Parse prayer times once
    const imsakSaati = parseVakitToDate(bugunStr, bugunVakitler.imsak || bugunVakitler.sabah);
    const gunesSaati = parseVakitToDate(bugunStr, bugunVakitler.gunes);
    const ogleSaati = parseVakitToDate(bugunStr, bugunVakitler.ogle);
    const aksamSaati = parseVakitToDate(bugunStr, bugunVakitler.aksam);

    if (!imsakSaati || !gunesSaati || !ogleSaati || !aksamSaati) return;

    const updateTheme = () => {
      const now = getTurkeyNow();

      // Temel vakit hesaplaması artık merkezi çekirdekten (mevcutVaktiHesapla
      // — useMevcutVakit'in de kullandığı TEK kaynak, bkz. src/services/
      // ezanVaktiServisi.ts) geliyor. Önceden burada aynı "sondan başa doğru
      // tara" algoritması bağımsız bir kopya olarak yeniden yazılmıştı; bu,
      // çekirdekte yapılacak bir düzeltmenin (ör. DST/Ramazan sabah kayması)
      // buraya hiç yansımaması riskini taşıyordu (bkz. kod denetimi). Bu hook
      // yalnızca çekirdeğin kapsamadığı 'gunes' özel durumunu üstüne ekler.
      let mevcutVakit: Vakit | 'gunes' = mevcutVaktiHesapla(bugunVakitler);

      // Special case: gunes period is between sunrise and dhuhr
      if (now >= gunesSaati && now < ogleSaati) {
        mevcutVakit = 'gunes';
      }

      // ── 1. Friday/Cuma Check ──
      const isFriday = isFridayTarih(now);
      const isCumaVakti = isFriday && mevcutVakit === 'gunes';

      // ── 2. Teheccüd Check ──
      let isTeheccud = false;
      if (imsakSaati && aksamSaati) {
        const aksamReferansi = now < imsakSaati ? new Date(aksamSaati.getTime() - 24 * 60 * 60 * 1000) : aksamSaati;
        const teheccudBaslangic = calculateLastThirdOfNight(aksamReferansi, imsakSaati);
        isTeheccud = now >= teheccudBaslangic && now < imsakSaati;
      }

      // ── 3. Kerahat Check ──
      let isKerahat = false;
      if (gunesSaati && ogleSaati && aksamSaati) {
        const { sabah, ogle, aksam: kerahatAksam } = calculateKerahatTimes(gunesSaati, ogleSaati, aksamSaati);
        isKerahat =
          (now >= sabah.baslangic && now < sabah.bitis) ||
          (now >= ogle.baslangic && now < ogle.bitis) ||
          (now >= kerahatAksam.baslangic && now < kerahatAksam.bitis);
      }

      // ── 4. Set dynamic variables ──
      // Kerahat/cuma/teheccüd birer geçici ÖRTÜŞME katmanı — vaktin kendi
      // renk kimliğini geçici olarak bastırır. Bunların dışında (standard /
      // aksam_yatsi) renk artık auraTheme.ts'teki VAKIT_KIMLIGI'nin TEK
      // kaynağından okunuyor (bkz. o dosyanın başındaki yorum, V1) — burada
      // ayrıca bir amber/ruby ikilemesi tutulmuyor.
      let period = 'standard';
      if (isKerahat) {
        period = 'kerahat';
      } else if (isCumaVakti) {
        period = 'cuma';
      } else if (isTeheccud) {
        period = 'teheccud';
      } else if (mevcutVakit === 'aksam' || mevcutVakit === 'yatsi') {
        period = 'aksam_yatsi';
      }

      let aura: string;
      let auraSecondary: string;
      if (isKerahat) {
        aura = 'var(--aura-ruby)';
        auraSecondary = 'var(--aura-amber)';
      } else if (isCumaVakti) {
        aura = 'var(--aura-emerald)';
        auraSecondary = 'var(--aura-indigo)';
      } else if (isTeheccud) {
        aura = 'var(--aura-indigo)';
        auraSecondary = 'var(--aura-rose)';
      } else {
        aura = getActiveAuraColor(mevcutVakit);
        auraSecondary = getSecondaryAuraColor(mevcutVakit);
      }

      // Write variables to root element
      const root = document.documentElement;
      root.style.setProperty('--dynamic-aura', aura);
      root.style.setProperty('--dynamic-aura-secondary', auraSecondary);
      root.setAttribute('data-circadian-period', period);
    };

    // Run check every 15 seconds
    const timer = setInterval(updateTheme, 15_000);
    updateTheme();

    return () => clearInterval(timer);
  }, [bugunVakitler]);
}
