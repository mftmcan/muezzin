import { useMemo, useRef, useEffect } from 'react';
import { parseISO, startOfWeek, format } from 'date-fns';
import { useHaftaPlan } from './useHaftaPlan';
import { useVakitBildirimleri } from './useVakitBildirimleri';
import { useAktifIzinlerStore } from '../store/useAktifIzinlerStore';
import { useMuezzinStore } from '../store/useMuezzinStore';
import { useAuthStore } from '../store/useAuthStore';
import { selfHealingTetiklenmeliMi } from '../lib/planSelfHealing';
import { Bildirim, Vakit } from '../types';

function bildirimZamani(bildirim: Bildirim) {
  const value = bildirim.sonGuncelleme as unknown as { toMillis?: () => number; seconds?: number } | undefined;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  return 0;
}

function aktifBildirimSec(bildirimler: Bildirim[], tip: Bildirim['tip']) {
  return bildirimler
    .filter((b) => b.tip === tip && b.durum !== 'reddedildi')
    .sort((a, b) => {
      const statusDiff = (a.durum === 'onaylandi' ? 0 : 1) - (b.durum === 'onaylandi' ? 0 : 1);
      if (statusDiff !== 0) return statusDiff;
      return bildirimZamani(b) - bildirimZamani(a);
    })[0];
}

function normalizeDurum(durum: string | undefined): 'bekliyor' | 'onaylandi' | 'reddedildi' | undefined {
  return durum === 'bekliyor' || durum === 'onaylandi' || durum === 'reddedildi' ? durum : undefined;
}

/**
 * Bugünün (planDateStr) plan atamasını, üzerine bindirilmiş canlı vekalet/
 * mazeret bildirimlerini ve buna bağlı izin/durum bilgisini tek yerde toplar
 * — bkz. useDashboardLogic.ts'teki asıl orkestrasyon.
 */
export function useBugunPlanDurumu(planDateStr: string, vakitKeyForPlan: Vakit) {
  const planDate = useMemo(() => parseISO(planDateStr), [planDateStr]);
  const haftaBaslangic = useMemo(() => startOfWeek(planDate, { weekStartsOn: 1 }), [planDate]);
  const haftaId = useMemo(() => `W${format(haftaBaslangic, 'yyyy-MM-dd')}`, [haftaBaslangic]);

  const { plan, loading: planLoading, sunucudanDogrulandi } = useHaftaPlan(haftaId);
  const isAdmin = useAuthStore((state) => state.isAdmin);

  // Race condition kilidi: bu hook ve HaftalikCizelge aynı anda
  // haftalikPlanOlustur çağırmasın — yalnızca bir kez tetikle.
  // `haftaId`'ye göre kapsanır (bkz. HaftalikCizelge.tsx
  // `selfHealingFiredHaftaIdRef` ile AYNI desen) — düz bir boolean
  // OLSAYDI, Hafta A için tetiklenip henüz `plan` truthy olmadan (hâlâ
  // işlemde/snapshot yayılmamışken) haftaId Hafta B'ye geçerse (o da
  // planssızsa) kilit "tetiklendi" takılı kalır ve Hafta B için
  // self-healing hiç çalışmazdı (bkz. kod denetimi bulgusu).
  const selfHealingFiredHaftaIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Karar HaftalikCizelge.tsx ile ORTAK saf fonksiyondan gelir
    // (src/lib/planSelfHealing.ts) — iki uygulama noktası ayrışmasın diye.
    // `sunucudanDogrulandi` şartı, çevrimdışı/bayat önbellekten gelen
    // yanlış-negatif bir "plan yok" okumasının yayınlanmış çizelgeyi ezmesini
    // engeller.
    if (
      selfHealingTetiklenmeliMi({
        planVarMi: !!plan,
        planLoading,
        sunucudanDogrulandi,
        isAdmin,
        haftaId,
        dahaOnceTetiklenenHaftaId: selfHealingFiredHaftaIdRef.current,
      })
    ) {
      selfHealingFiredHaftaIdRef.current = haftaId;
      if (import.meta.env.DEV) {
        console.log(`[Self-Healing] Hafta planı bulunamadı (${haftaId}). Yönetici yetkisiyle otomatik oluşturuluyor...`);
      }
      import('../services/planServisi').then(({ haftalikPlanOlustur }) => {
        haftalikPlanOlustur(haftaId).catch((err) => {
          console.error('[Self-Healing] Otomatik plan oluşturma başarısız:', err);
          if (selfHealingFiredHaftaIdRef.current === haftaId) {
            selfHealingFiredHaftaIdRef.current = null;
          }
        });
      });
    }
  }, [plan, planLoading, sunucudanDogrulandi, isAdmin, haftaId]);

  const muezzinMap = useMuezzinStore((state) => state.muezzinMap);
  const usersLoading = useMuezzinStore((state) => state.loading);
  const aktifIzinler = useAktifIzinlerStore((state) => state.aktifIzinler);

  const { bildirimler: vakitBildirimleri, loading: vakitBildirimleriLoading } = useVakitBildirimleri(planDateStr, vakitKeyForPlan);

  const isAssignableUid = useMemo(
    () => (uid: string | undefined) => {
      if (!uid || uid === 'SISTEM' || uid === 'Sistem') return true;
      const person = muezzinMap[uid];
      return !!person && person.aktif === true && person.role === 'muezzin';
    },
    [muezzinMap]
  );

  const getMuezzinName = useMemo(
    () => (uid: string | undefined) => {
      if (!uid) return '';
      if (uid === 'SISTEM' || uid === 'Sistem') return 'Sistem';
      if (!isAssignableUid(uid)) return 'Geçersiz Atama';
      return muezzinMap[uid]?.displayName || 'Bilinmiyor';
    },
    [muezzinMap, isAssignableUid]
  );

  const rawBugunPlan = plan?.gunler?.[planDateStr]?.[vakitKeyForPlan];
  const liveAsilBildirim = useMemo(() => aktifBildirimSec(vakitBildirimleri, 'asil'), [vakitBildirimleri]);
  const liveYedekBildirim = useMemo(() => aktifBildirimSec(vakitBildirimleri, 'yedek'), [vakitBildirimleri]);
  const bugunPlan = useMemo(() => {
    if (!rawBugunPlan) return rawBugunPlan;
    const asilUid = liveAsilBildirim?.uid || rawBugunPlan.asil;
    const yedekUid = liveYedekBildirim?.uid || rawBugunPlan.yedek;
    return {
      asil: isAssignableUid(asilUid) ? asilUid : 'Sistem',
      yedek: isAssignableUid(yedekUid) ? yedekUid : 'Sistem',
    };
  }, [rawBugunPlan, liveAsilBildirim?.uid, liveYedekBildirim?.uid, isAssignableUid]);

  const asilIzinde = bugunPlan?.asil ? aktifIzinler.some((izin) => izin.uid === bugunPlan.asil) : false;
  const yedekIzinde = bugunPlan?.yedek ? aktifIzinler.some((izin) => izin.uid === bugunPlan.yedek) : false;

  const asilDurum = useMemo(
    () => normalizeDurum(vakitBildirimleri.find((b) => b.uid === bugunPlan?.asil && b.tip === 'asil')?.durum),
    [vakitBildirimleri, bugunPlan?.asil]
  );

  const yedekDurum = useMemo(
    () => normalizeDurum(vakitBildirimleri.find((b) => b.uid === bugunPlan?.yedek && b.tip === 'yedek')?.durum),
    [vakitBildirimleri, bugunPlan?.yedek]
  );

  const isHademelerLoading = (planLoading && !plan) || vakitBildirimleriLoading || (usersLoading && Object.keys(muezzinMap).length === 0);

  return { bugunPlan, asilDurum, yedekDurum, asilIzinde, yedekIzinde, isHademelerLoading, getMuezzinName };
}
