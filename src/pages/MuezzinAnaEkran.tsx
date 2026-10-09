import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';

import { useDashboardLogic } from '../hooks/useDashboardLogic';
import { Muezzinler } from '../components/Muezzinler';
import { KisiselGorevAkisi } from '../components/KisiselGorevAkisi';
import { AnaEkranHero } from '../components/AnaEkranHero';
import { IslamicGeometricBg } from '../components/ui/IslamicGeometricBg';
import { Skeleton } from '../components/ui/Skeleton';
import { GpsConsentModal } from '../components/GpsConsentModal';
import { GpsHelpModal } from '../components/GpsHelpModal';
import { SiradakiGorevSinyali } from './muezzin/SiradakiGorevSinyali';
import { HizliErisimPaneli } from './muezzin/HizliErisimPaneli';
import { DuyuruSlider } from './muezzin/DuyuruSlider';
import { GelenVekaletTalepleri } from './muezzin/GelenVekaletTalepleri';
import { BentoNavigasyon } from './muezzin/BentoNavigasyon';
import { DuyuruDetayModal } from './muezzin/DuyuruDetayModal';

import { useGpsVakitStore } from '../store/useGpsVakitStore';
import { gpsHataTuruBelirle, GpsHataTuru } from '../services/gpsVakitServisi';
import { KiblePusulasiModal } from '../components/KiblePusulasiModal';
import { useVekaletTalepleri } from '../hooks/useVekaletTalepleri';
import { useHaftalikGorevOzeti } from '../hooks/useHaftalikGorevOzeti';
import { useAktifSistemUyarisi } from '../hooks/useAktifSistemUyarisi';
import { SistemUyarisiBanner } from '../components/SistemUyarisiBanner';
import { useNotificationStore } from '../store/useNotificationStore';
import { useAuthStore } from '../store/useAuthStore';
import { okudumOnayla } from '../services/okudumServisi';
import { zamanAsimiIle, IslemZamanAsimi } from '../lib/timeoutUtils';
import { GOZLEMCI_SALT_OKUMA_IPUCU } from '../lib/rolMetinleri';
import { EASE } from '../lib/motion';

const VacationRequestCard = lazy(() => import('../components/VacationRequestCard'));

export default function MuezzinAnaEkran() {
  const {
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
  } = useDashboardLogic();

  const [isQiblaOpen, setIsQiblaOpen] = useState(false);

  // İzin (leave) yalnızca nöbete atanabilen 'muezzin' rolü için anlamlı —
  // sunucu tarafı artık bunu isValidIzin'de zorunlu kılıyor (bkz.
  // firestore.rules); kart burada da admin/gözlemci'ye gösterilmeyip
  // PERMISSION_DENIED ile karşılaşmaları önlenir (bkz. yetki denetimi).
  const role = useAuthStore((s) => s.role);
  // Gözlemci salt-okuma (bkz. premium denetim P1.5): bildirim derin
  // bağlantısı aksiyonları da kesilir — gelen vekalet kutusunun kendi
  // salt-okuma kapısı GelenVekaletTalepleri bileşenindedir.
  const isReadOnly = useAuthStore((s) => s.isReadOnly);

  const { gpsEnabled, gpsLoading, enableGps, disableGps } = useGpsVakitStore();

  const [autoOpenMazeretId, setAutoOpenMazeretId] = useState<string | null>(null);
  const [isGpsConsentOpen, setIsGpsConsentOpen] = useState(false);
  const [isGpsHelpOpen, setIsGpsHelpOpen] = useState(false);
  const [gpsHataTuru, setGpsHataTuru] = useState<GpsHataTuru>('izin_reddi');
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const showNotification = useNotificationStore((s) => s.showNotification);
  // Son işlenen bildirimId'yi tutar (boolean kilit değil) — böylece aynı
  // SPA oturumunda farklı bir push bildirimine tıklanırsa o da işlenebilir,
  // yalnızca aynı bildirimin tekrar işlenmesi engellenir.
  const handledNotificationIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (gorevLoading || !currentUser) return;

    const action = searchParams.get('notificationAction');
    const bildirimId = searchParams.get('bildirimId');

    if (!action || !bildirimId || handledNotificationIdRef.current === bildirimId) return;
    handledNotificationIdRef.current = bildirimId;

    const processAction = async () => {
      // Clear URL params immediately to prevent double-execution
      const cleanParams = new URLSearchParams(searchParams);
      cleanParams.delete('notificationAction');
      cleanParams.delete('bildirimId');
      navigate({ search: cleanParams.toString() }, { replace: true });

      // Salt-okuma (gözlemci) sert kapısı: bildirim derin bağlantısı UI
      // düğmelerini tamamen atlar, bu yüzden aksiyon burada da kesilir
      // (bkz. premium denetim P1.5).
      if (isReadOnly) {
        showNotification('İşlem Yapılamaz', GOZLEMCI_SALT_OKUMA_IPUCU, 'warning');
        return;
      }

      if (action === 'onayla') {
        showNotification('İşlem Başlatıldı', 'Göreviniz onaylanıyor...', 'info');
        try {
          // okudumOnayla bir runTransaction kullanır — çevrimdışıyken sonsuza
          // dek askıda kalabildiğinden zamanAsimiIle ile sarmalanır (bkz.
          // timeoutUtils.ts yorumu, beşinci denetim turu).
          await zamanAsimiIle(okudumOnayla(bildirimId));
          showNotification('Görev Onaylandı', 'Göreviniz başarıyla dizgeye işlendi. Allah kabul etsin.', 'success');
        } catch (error) {
          if (error instanceof IslemZamanAsimi) {
            showNotification('Bağlantı Sorunu', error.message, 'warning');
            return;
          }
          const errMsg = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu.';
          if (errMsg.includes('ezan vakti')) {
            showNotification('Henüz Erken', 'Görev vakti gelmeden onay veremezsiniz. Lütfen vakit girdikten sonra onaylayın.', 'warning');
          } else {
            showNotification('Onay Hatası', errMsg, 'error');
          }
        }
      } else if (action === 'mazeret') {
        setAutoOpenMazeretId(bildirimId);
      }
    };

    processAction();
  }, [searchParams, gorevLoading, currentUser, navigate, showNotification, isReadOnly]);

  const handleGpsToggle = async () => {
    if (gpsEnabled) {
      disableGps();
    } else {
      setIsGpsConsentOpen(true);
    }
  };

  const handleGpsConfirm = async () => {
    try {
      await enableGps();
      setIsGpsConsentOpen(false);
    } catch (err: unknown) {
      console.error('GPS Vakit Hatası:', err);
      setIsGpsConsentOpen(false);
      // Önceden err ayrımsız her zaman aynı "tarayıcı ayarlarından izin
      // verin" mesajını gösteriyordu — GeolocationPositionError'ın izin
      // reddi DIŞINDAKİ kodlarında (konum belirlenemedi, zaman aşımı) veya
      // API/ağ hatasında bu talimat yanlış ve işe yaramazdı (bkz.
      // gpsHataTuruBelirle yorumu, beşinci denetim turu).
      setGpsHataTuru(gpsHataTuruBelirle(err));
      setIsGpsHelpOpen(true);
    }
  };

  const [readDuyurular, setReadDuyurular] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('muezzin-read-duyurular');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const markAsRead = React.useCallback((id: string) => {
    setReadDuyurular((prev) => {
      if (prev.includes(id)) return prev;
      const updated = [...prev, id];
      localStorage.setItem('muezzin-read-duyurular', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const handleCloseDuyuru = React.useCallback(() => {
    if (viewingDuyuru) {
      markAsRead(viewingDuyuru.id);
    }
    setViewingDuyuru(null);
  }, [viewingDuyuru, markAsRead, setViewingDuyuru]);

  // TEK dinleyici: gelen teklifler ve bekleyen devirler aynı `onSnapshot`'tan
  // türetilir (bkz. useVekaletTalepleri).
  const { gelenVekaletler, bekleyenDevirler: bekleyenVekaletDevirleri } = useVekaletTalepleri(currentUser?.uid);
  const haftalikOzet = useHaftalikGorevOzeti(currentUser?.uid, bugunDate);
  const aktifSistemUyarisi = useAktifSistemUyarisi(currentUser?.uid);
  const siradakiGorev = React.useMemo(() => gorevler.find((g) => g.durum === 'bekliyor') || gorevler[0] || null, [gorevler]);

  return (
    <div
      style={{ '--dynamic-aura': auraColor } as React.CSSProperties}
      className="w-full min-h-screen bg-[var(--app-bg)] relative overflow-hidden transition-colors duration-[3000ms]"
      // SALT TEST-GÖZLEMLENEBİLİRLİĞİ (hiçbir stil/davranış etkisi yok):
      // ekranın TÜM Firestore kaynaklarının ilk snapshot'ını teslim edip
      // iskelet/spinner katmanlarından çıktığı anı DOM'a yansıtır. Görsel
      // regresyon testi (tests/e2e/visual.spec.ts) önceden bunun yerine
      // `waitForTimeout(3000)` ile KEYFİ bir süre bekliyordu — CI'da
      // emülatörün teslim süresi değişken olduğundan bu pay defalarca
      // yetersiz kalıp sayfayı yükleniyor durumundayken yakaladı ve gerçek
      // bir regresyon olmadan baseline'ı kırdı (1500ms → 3000ms
      // yükseltmesinin kendisi de bu sınıfın kanıtı). `isHeroLoading`
      // ayrıca `.skeleton-shimmer` DEĞİL bir spinner render ettiğinden
      // (AnaEkranHero.tsx) iskelet-yok kontrolü tek başına yeterli değildi.
      data-ekran-hazir={!isHeroLoading && !isHademelerLoading && !gorevLoading ? 'evet' : 'hayir'}
    >
      {/* Sayfaya özgü ikinci bir aura blob katmanı önceden burada AYRICA render
     ediliyordu — Layout.tsx zaten global bir 2-blob sirkadiyen katman
     sağlıyor (aynı --dynamic-aura'yı okuyarak); üst üste 4 blur katmanı
     doygunluğun katlanmasına yol açıyordu (bkz. premium denetim B34, O8).
     Yukarıdaki `--dynamic-aura` override'ı KALDIRILMADI — bu sayfadaki
     düğme/rozet gibi ön-plan öğeleri hâlâ ona bağlı. */}
      <IslamicGeometricBg />

      {/* Alt boşluk: Layout.tsx'teki <main> zaten dock/PWA banner'ını temizlemek için
      dinamik pb (mobilde 96px+safe-area, md:144px) ayırıyor — burada AYRICA pb-32
      eklemek toplamda 220px+ boş kaydırma alanına (mobil ekranın ~%30'u) yol
      açıyordu (bkz. mobil yerleşim denetimi). Kalan pb-8/10 sadece son karta
      görsel nefes payı için.

      DİKKAT: `pt-*`/`pb-*` BİLEREK `fluid-wrapper`'ın kendi className'inde
      DEĞİL, ayrı bir iç div'de. `fluid-wrapper` (index.css) `padding-top:
      env(safe-area-inset-top)` taşıyor — aynı elementte `pt-3` gibi tek
      özellikli bir Tailwind utility'siyle birlikte kullanılırsa, Tailwind
      v4'ün katman sıralamasında tek özellikli utility her zaman kazanıyor,
      yani safe-area-inset TAMAMEN devre dışı kalıyordu (çentikli/Dynamic
      Island'lı iPhone'da başlık durum çubuğunun ALTINDA kırpılıyordu, bkz.
      mobil yerleşim denetimi — bu regresyon `pt-6`den `pt-3`e düşürülünce
      görünür hale geldi, ama kök neden önceden de vardı). İki farklı
      element olduğunda iki padding-top artık ÇAKIŞMAZ, üst üste TOPLANIR. */}
      <div className="fluid-wrapper max-sm:!px-2.5 relative z-10">
        <div className="pt-3 sm:pt-8 pb-6 sm:pb-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-8 lg:gap-12 relative z-10">
            {/* Hero Section — `sticky-hero` sadece AnaEkranHero'yu sarmalıyor (aşağıda),
      dış kapsayıcının kendisi artık sticky/overflow-constrained DEĞİL. Önceden
      bu dış motion.div'in tamamı sticky-hero idi; "Sıradaki görevim" kartı
      buraya taşınınca lg: (≥1024px) breakpoint'te masaüstü sticky kutusunun
      max-height + overflow-y:auto sınırını aşıp kutunun içine gömülüyor,
      görünür alanın dışında kalabiliyordu (CI E2E testi bunu yakaladı). */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: EASE.out }}
              className="lg:col-span-5 flex flex-col gap-4"
            >
              {/* `sticky-hero` masaüstünde (≥1024px, bkz. index.css) `overflow-y: auto`
            ile kaydırılabilir hale geliyor — klavye kullanıcısının bu bölgeyi
            fare olmadan (Tab + ok tuşları) kaydırabilmesi için `tabIndex={0}`
            + `role="region"` gerekiyor, aksi halde axe-core'un
            `scrollable-region-focusable` kuralı ihlal ediyor (bkz. CI a11y
            testi, tests/e2e/a11y.spec.ts). Bu, WAI-ARIA Authoring Practices'in
            resmi "kaydırılabilir bölge" deseni — eslint'in
            no-noninteractive-tabindex kuralı `role="region"`'ı etkileşimli
            saymadığından burada kasıtlı bir istisna. */}
              {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
              <div className="sticky-hero isolate flex flex-col" tabIndex={0} role="region" aria-label="Namaz vakitleri ve geri sayım">
                <AnaEkranHero
                  isLoading={isHeroLoading}
                  mevcutVakit={mevcutVakit}
                  sonraki={sonraki}
                  bugunDate={bugunDate}
                  bugunVakitler={bugunVakitler}
                />
              </div>

              {/* Next Duty Signal — sayacın hemen altına, mobilde ilk view-port'a taşındı.
      Önceden GPS/Kıble panelinin ALTINDA, içerik sütununun başında yer alıyordu;
      uygulamanın asıl değeri (nöbet bilgisi) vakit bilgisinden çok daha geç
      görünüyordu (bkz. tasarım denetimi). */}
              <SiradakiGorevSinyali siradakiGorev={siradakiGorev} />

              <SistemUyarisiBanner uyari={aktifSistemUyarisi} />

              {/* Hızlı Erişim Kontrol Paneli */}
              <HizliErisimPaneli
                gpsEnabled={gpsEnabled}
                gpsLoading={gpsLoading}
                onGpsToggle={handleGpsToggle}
                onQiblaOpen={() => setIsQiblaOpen(true)}
              />
            </motion.div>

            {/* Content Section */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1, ease: EASE.out }}
              className="lg:col-span-7 flex flex-col gap-6 sm:gap-8"
            >
              {role === 'muezzin' && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: 0.14, ease: EASE.out }}
                >
                  <Suspense fallback={<Skeleton className="h-40" rounded="rounded-card" />}>
                    <VacationRequestCard user={currentUser} />
                  </Suspense>
                </motion.div>
              )}

              {/* Announcements Slider */}
              <DuyuruSlider duyurular={duyurular} readDuyurular={readDuyurular} onSelectDuyuru={setViewingDuyuru} />

              {/* Duty Roster */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.2, ease: EASE.out }}
                className="spatial-glass p-4 sm:p-8"
              >
                <Muezzinler
                  asilIsim={getMuezzinName(bugunPlan?.asil)}
                  yedekIsim={getMuezzinName(bugunPlan?.yedek)}
                  asilDurum={asilDurum}
                  yedekDurum={yedekDurum}
                  planVarMi={!!bugunPlan}
                  isAsilSizMisiniz={currentUser?.uid === bugunPlan?.asil}
                  isYedekSizMisiniz={currentUser?.uid === bugunPlan?.yedek}
                  asilIzinde={asilIzinde}
                  yedekIzinde={yedekIzinde}
                  loading={isHademelerLoading}
                  planTarih={planDateStr}
                />
              </motion.div>

              {/* Gelen vekalet teklifleri + bekleyen devirler — kabul/red aksiyon
                  durumları dahil tümü GelenVekaletTalepleri bileşeninde. */}
              <GelenVekaletTalepleri gelenVekaletler={gelenVekaletler} bekleyenDevirler={bekleyenVekaletDevirleri} />

              {/* Task Flow */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.28, ease: EASE.out }}
                id="gorev-akisi"
              >
                <KisiselGorevAkisi
                  loading={gorevLoading}
                  gorevler={gorevler}
                  bugunVakitler={bugunVakitler}
                  autoOpenMazeretId={autoOpenMazeretId}
                  onMazeretHandled={() => setAutoOpenMazeretId(null)}
                />
              </motion.div>

              {/* Bento Navigation Grid */}
              <BentoNavigasyon haftalikOzet={haftalikOzet} />
            </motion.div>
          </div>

          {/* Duyuru detay modalı — okundu işaretleme handleCloseDuyuru içinde. */}
          <DuyuruDetayModal duyuru={viewingDuyuru} onClose={handleCloseDuyuru} />

          {/* Kıble Pusulası Modalı */}
          <KiblePusulasiModal isOpen={isQiblaOpen} onClose={() => setIsQiblaOpen(false)} />

          <GpsConsentModal
            isOpen={isGpsConsentOpen}
            onClose={() => setIsGpsConsentOpen(false)}
            onConfirm={handleGpsConfirm}
            isLoading={gpsLoading}
          />

          <GpsHelpModal
            isOpen={isGpsHelpOpen}
            onClose={() => setIsGpsHelpOpen(false)}
            hataTuru={gpsHataTuru}
            onRetry={() => {
              setIsGpsHelpOpen(false);
              setIsGpsConsentOpen(true);
            }}
          />
        </div>
      </div>
    </div>
  );
}
