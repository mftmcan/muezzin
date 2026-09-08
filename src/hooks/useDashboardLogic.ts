import { useMemo, useState, useEffect } from 'react';
import { parseISO } from 'date-fns';
import { useBugunkuGorevlerim } from './useBugunkuGorevlerim';
import { useEzanVakitleri } from './useEzanVakitleri';
import { useSonrakiVakit } from './useSonrakiVakit';
import { useMevcutVakit } from './useMevcutVakit';
import { useAuthStore } from '../store/useAuthStore';
import { Duyuru, useDuyurular } from './useDuyurular';
import { useThemeStore } from '../store/useThemeStore';
import { useGpsVakitStore } from '../store/useGpsVakitStore';
import { getTurkeyDateString } from '../lib/dateUtils';
import { useAuraColors } from './useAuraColors';
import { useBugunPlanDurumu } from './useBugunPlanDurumu';
import { Vakit } from '../types';

export function useDashboardLogic() {
  const { gorevler, loading: gorevLoading } = useBugunkuGorevlerim();
  const { bugunVakitler, yarinVakitler, loading: vakitLoading } = useEzanVakitleri();

  const { gpsEnabled, refreshGpsVakitler } = useGpsVakitStore();

  useEffect(() => {
    if (!gpsEnabled) return;
    // Mount / GPS açılışında hemen dene; ardından gece yarısı geçişini
    // yakalamak için periyodik olarak kontrol et (store içindeki
    // lastFetchDate kilidi sayesinde günde bir kereden fazla API çağrısı
    // yapılmaz — bkz. useGpsVakitStore.refreshGpsVakitler).
    refreshGpsVakitler();
    const interval = setInterval(() => {
      refreshGpsVakitler();
    }, 60_000);
    return () => clearInterval(interval);
  }, [gpsEnabled, refreshGpsVakitler]);

  const sonraki = useSonrakiVakit(bugunVakitler, yarinVakitler);
  const mevcutVakit = useMevcutVakit(bugunVakitler);

  const { theme, toggleTheme } = useThemeStore();

  const bugunStr = bugunVakitler?.tarih || getTurkeyDateString();
  const bugunDate = useMemo(() => parseISO(bugunStr), [bugunStr]);

  const planDateStr = sonraki?.ezanSaati ? getTurkeyDateString(sonraki.ezanSaati) : bugunStr;
  const vakitKeyForPlan = (sonraki?.vakit || mevcutVakit || 'sabah') as Vakit;

  const { bugunPlan, asilDurum, yedekDurum, asilIzinde, yedekIzinde, isHademelerLoading, getMuezzinName } = useBugunPlanDurumu(
    planDateStr,
    vakitKeyForPlan
  );

  const { duyurular } = useDuyurular(3);
  const currentUser = useAuthStore((state) => state.user);

  const [viewingDuyuru, setViewingDuyuru] = useState<Duyuru | null>(null);

  const { auraColor, secondaryAuraColor } = useAuraColors(mevcutVakit);

  const isHeroLoading = vakitLoading && !bugunVakitler;

  // Return memoized state to prevent unnecessary downstream re-renders
  return useMemo(
    () => ({
      gorevler,
      gorevLoading,
      bugunVakitler,
      sonraki,
      mevcutVakit,
      bugunDate,
      planDateStr,
      bugunPlan,
      asilDurum,
      yedekDurum,
      asilIzinde,
      yedekIzinde,
      isHeroLoading,
      isHademelerLoading,
      auraColor,
      duyurular,
      viewingDuyuru,
      setViewingDuyuru,
      currentUser,
      getMuezzinName,
      theme,
      toggleTheme,
      secondaryAuraColor,
    }),
    [
      gorevler,
      gorevLoading,
      bugunVakitler,
      sonraki,
      mevcutVakit,
      bugunDate,
      planDateStr,
      bugunPlan,
      asilDurum,
      yedekDurum,
      asilIzinde,
      yedekIzinde,
      isHeroLoading,
      isHademelerLoading,
      auraColor,
      duyurular,
      viewingDuyuru,
      currentUser,
      getMuezzinName,
      theme,
      toggleTheme,
      secondaryAuraColor,
    ]
  );
}
