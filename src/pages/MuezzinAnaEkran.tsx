import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Megaphone, Calendar, ChevronRight, ChevronLeft, Compass, Navigation, ClipboardList, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { useDashboardLogic } from '../hooks/useDashboardLogic';
import { Muezzinler } from '../components/Muezzinler';
import { KisiselGorevAkisi } from '../components/KisiselGorevAkisi';
import { AnaEkranHero } from '../components/AnaEkranHero';
import { IslamicGeometricBg } from '../components/ui/IslamicGeometricBg';
import { Modal } from '../components/ui/Modal';
import { Skeleton } from '../components/ui/Skeleton';
import { GpsConsentModal } from '../components/GpsConsentModal';
import { GpsHelpModal } from '../components/GpsHelpModal';

import { useGpsVakitStore } from '../store/useGpsVakitStore';
import { gpsHataTuruBelirle, GpsHataTuru } from '../services/gpsVakitServisi';
import { KiblePusulasiModal } from '../components/KiblePusulasiModal';
import { useGelenVekaletler } from '../hooks/useGelenVekaletler';
import { useBekleyenVekaletDevirleri } from '../hooks/useBekleyenVekaletDevirleri';
import { useHaftalikGorevOzeti } from '../hooks/useHaftalikGorevOzeti';
import { useAktifSistemUyarisi } from '../hooks/useAktifSistemUyarisi';
import { SistemUyarisiBanner } from '../components/SistemUyarisiBanner';
import { vekaletKabulEt, vekaletReddet } from '../services/vekaletServisi';
import { VAKIT_GORA_ISIMLERI, toTurkishUpperCase } from '../lib/dateUtils';
import { Vakit } from '../types';
import { useNotificationStore } from '../store/useNotificationStore';
import { useAuthStore } from '../store/useAuthStore';
import { okudumOnayla } from '../services/okudumServisi';
import { hapticMedium } from '../lib/haptic';
import { zamanAsimiIle, IslemZamanAsimi } from '../lib/timeoutUtils';
import { GOZLEMCI_SALT_OKUMA_IPUCU } from '../lib/rolMetinleri';

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

  const [activeDuyuruIdx, setActiveDuyuruIdx] = useState(0);
  // İzin (leave) yalnızca nöbete atanabilen 'muezzin' rolü için anlamlı —
  // sunucu tarafı artık bunu isValidIzin'de zorunlu kılıyor (bkz.
  // firestore.rules); kart burada da admin/gözlemci'ye gösterilmeyip
  // PERMISSION_DENIED ile karşılaşmaları önlenir (bkz. yetki denetimi).
  const role = useAuthStore((s) => s.role);
  // Gözlemci salt-okuma (bkz. premium denetim P1.5): gelen vekalet
  // teklifleri kutusu görüntülenebilir ama kabul/red aksiyonları
  // kapatılır — sunucu tarafı zaten reddeder (firestore.rules
  // isRecipientVekaletStatusUpdate sonrası devir bayrağı
  // isAssignableDutyUid'e takılır), bu katman sebebi görünür kılar.
  const isReadOnly = useAuthStore((s) => s.isReadOnly);

  const { gpsEnabled, gpsLoading, enableGps, disableGps } = useGpsVakitStore();
  const [isQiblaOpen, setIsQiblaOpen] = useState(false);
  const [pendingRejectId, setPendingRejectId] = useState<string | null>(null);
  const [processingVekaletId, setProcessingVekaletId] = useState<string | null>(null);

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

  const gelenVekaletler = useGelenVekaletler(currentUser?.uid);
  const bekleyenVekaletDevirleri = useBekleyenVekaletDevirleri(currentUser?.uid);
  const haftalikOzet = useHaftalikGorevOzeti(currentUser?.uid, bugunDate);
  const aktifSistemUyarisi = useAktifSistemUyarisi(currentUser?.uid);
  const siradakiGorev = React.useMemo(() => gorevler.find((g) => g.durum === 'bekliyor') || gorevler[0] || null, [gorevler]);

  return (
    <div
      style={{ '--dynamic-aura': auraColor } as React.CSSProperties}
      className="w-full min-h-screen bg-[var(--app-bg)] relative overflow-hidden transition-colors duration-[3000ms]"
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
      görsel nefes payı için. */}
      <div className="fluid-wrapper pt-6 sm:pt-8 pb-8 sm:pb-10 relative z-10">
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
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-5 flex flex-col gap-4"
          >
            <div className="sticky-hero isolate flex flex-col">
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
            {siradakiGorev && (
              <motion.button
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => document.getElementById('gorev-akisi')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="w-full spatial-glass p-5 sm:p-6 border border-[var(--dynamic-aura,var(--aura-indigo))]/20 bg-[var(--dynamic-aura,var(--aura-indigo))]/[0.025] flex items-center justify-between gap-4 text-left cursor-pointer hover:bg-[var(--dynamic-aura,var(--aura-indigo))]/[0.045] transition-all"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-12 h-12 rounded-[18px] bg-[var(--dynamic-aura,var(--aura-indigo))]/10 border border-[var(--dynamic-aura,var(--aura-indigo))]/20 text-[var(--dynamic-aura,var(--aura-indigo))] flex items-center justify-center shrink-0">
                    <ClipboardList size={20} strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0">
                    <p className="authority-title !text-2xs text-[var(--dynamic-aura,var(--aura-indigo))]/80 font-bold tracking-wide uppercase">
                      Sıradaki görevim
                    </p>
                    <h3 className="text-base sm:text-lg font-light text-[var(--text-primary)] tracking-tight truncate">
                      {toTurkishUpperCase(VAKIT_GORA_ISIMLERI[siradakiGorev.vakit as Vakit] || siradakiGorev.vakit)} vakti -{' '}
                      {siradakiGorev.tip === 'asil' ? 'Asil görev' : siradakiGorev.tip === 'yedek' ? 'Yedek nöbet' : 'Acil çağrı'}
                    </h3>
                  </div>
                </div>
                <ChevronRight size={18} className="text-[var(--text-secondary)]/45 shrink-0" />
              </motion.button>
            )}

            <SistemUyarisiBanner uyari={aktifSistemUyarisi} />

            {/* Hızlı Erişim Kontrol Paneli */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.45 }}
              className="w-full p-3 spatial-glass rounded-card border border-[var(--glass-border)] grid grid-cols-2 gap-2 shadow-[var(--spatial-shadow)]"
            >
              {/* GPS Senkronizasyonu */}
              <button
                onClick={() => {
                  hapticMedium();
                  handleGpsToggle();
                }}
                disabled={gpsLoading}
                className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl border transition-all duration-300 relative group cursor-pointer border-none bg-transparent"
              >
                <div
                  className={`absolute inset-0 rounded-2xl transition-opacity duration-500 opacity-0 group-hover:opacity-100 ${
                    gpsEnabled ? 'bg-emerald-500/10' : 'bg-[var(--text-primary)]/[0.04]'
                  }`}
                />

                <div
                  className={`p-1.5 rounded-xl border transition-all duration-300 relative ${
                    gpsEnabled
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                      : 'bg-[var(--text-primary)]/[0.03] border-[var(--glass-border)] text-muted group-hover:text-[var(--text-secondary)]/85'
                  }`}
                >
                  {gpsLoading ? (
                    <div className="w-4 h-4 rounded-full border-2 border-[var(--dynamic-aura,var(--aura-indigo))]/20 border-t-[var(--dynamic-aura,var(--aura-indigo))] animate-spin" />
                  ) : (
                    <Navigation
                      size={15}
                      className={`transition-transform duration-300 ${gpsEnabled ? 'rotate-45' : 'group-hover:-rotate-12'}`}
                    />
                  )}
                  {gpsEnabled && (
                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse" />
                  )}
                </div>

                <div className="flex flex-col items-start leading-tight">
                  <span
                    className={`text-2xs font-bold tracking-wide transition-colors ${
                      gpsEnabled ? 'text-emerald-400' : 'text-muted group-hover:text-[var(--text-secondary)]/80'
                    }`}
                  >
                    GPS VAKİT
                  </span>
                  <span className="text-2xs text-muted group-hover:text-[var(--text-secondary)]/60 uppercase">
                    {gpsEnabled ? 'Aktif' : 'Pasif'}
                  </span>
                </div>
              </button>

              {/* Kıble Pusulası */}
              <button
                onClick={() => {
                  hapticMedium();
                  setIsQiblaOpen(true);
                }}
                className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl border transition-all duration-300 relative group cursor-pointer border-none bg-transparent"
              >
                <div className="absolute inset-0 rounded-2xl transition-opacity duration-500 opacity-0 group-hover:opacity-100 bg-[var(--text-primary)]/[0.04]" />

                <div className="p-1.5 rounded-xl border bg-[var(--text-primary)]/[0.03] border-[var(--glass-border)] text-muted group-hover:text-[var(--text-secondary)]/85 group-hover:border-[var(--dynamic-aura,var(--aura-indigo))]/30 transition-all duration-300">
                  <Compass size={15} className="transition-transform duration-500 group-hover:rotate-180" />
                </div>

                <div className="flex flex-col items-start leading-tight">
                  <span className="text-2xs font-bold tracking-wide text-muted group-hover:text-[var(--text-secondary)]/80">KIBLE</span>
                  <span className="text-2xs text-muted group-hover:text-[var(--text-secondary)]/60 uppercase">Pusula</span>
                </div>
              </button>
            </motion.div>
          </motion.div>

          {/* Content Section */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-7 flex flex-col gap-6 sm:gap-8"
          >
            {role === 'muezzin' && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.14, ease: [0.16, 1, 0.3, 1] }}
              >
                <Suspense fallback={<Skeleton className="h-40" rounded="rounded-card" />}>
                  <VacationRequestCard user={currentUser} />
                </Suspense>
              </motion.div>
            )}

            {/* Announcements Slider */}
            {duyurular.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
                className="spatial-glass !bg-[var(--status-info)]/[0.03] !border-[var(--status-info)]/15 p-5 sm:p-6 relative overflow-hidden group"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--status-info)]/[0.015] blur-2xl rounded-full pointer-events-none" />

                <div className="flex items-center justify-between mb-4 relative z-10">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--status-info)] animate-pulse" />
                    <p className="text-2xs text-[var(--status-info)]/85 font-bold tracking-wide uppercase">
                      RESMİ GÖREVLENDİRME DUYURULARI
                    </p>
                  </div>
                  {duyurular.length > 1 && (
                    <div className="flex items-center gap-1.5 bg-[var(--text-primary)]/[0.03] border border-[var(--glass-border)] p-1 rounded-xl backdrop-blur-md relative z-20">
                      <button
                        disabled={activeDuyuruIdx === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveDuyuruIdx((prev) => Math.max(0, prev - 1));
                        }}
                        aria-label="Önceki duyuru"
                        className={`min-w-[32px] min-h-[32px] p-2 rounded-lg hover:bg-[var(--text-primary)]/5 transition-all flex items-center justify-center ${activeDuyuruIdx === 0 ? 'opacity-20 cursor-not-allowed' : 'opacity-80 hover:opacity-100'}`}
                      >
                        <ChevronLeft size={12} strokeWidth={2.5} />
                      </button>
                      <span className="text-2xs font-bold text-[var(--text-secondary)]/65 px-1.5 tabular-nums">
                        {activeDuyuruIdx + 1} / {duyurular.length}
                      </span>
                      <button
                        disabled={activeDuyuruIdx === duyurular.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveDuyuruIdx((prev) => Math.min(duyurular.length - 1, prev + 1));
                        }}
                        aria-label="Sonraki duyuru"
                        className={`min-w-[32px] min-h-[32px] p-2 rounded-lg hover:bg-[var(--text-primary)]/5 transition-all flex items-center justify-center ${activeDuyuruIdx === duyurular.length - 1 ? 'opacity-20 cursor-not-allowed' : 'opacity-80 hover:opacity-100'}`}
                      >
                        <ChevronRight size={12} strokeWidth={2.5} />
                      </button>
                    </div>
                  )}
                </div>

                {(() => {
                  const isCurrentDuyuruRead = readDuyurular.includes(duyurular[activeDuyuruIdx]?.id || '');

                  return (
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={activeDuyuruIdx}
                        initial={{ opacity: 0, x: 8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -8 }}
                        transition={{ duration: 0.25 }}
                        onClick={() => setViewingDuyuru(duyurular[activeDuyuruIdx])}
                        className="flex items-center gap-4 sm:gap-5 cursor-pointer relative overflow-hidden group/item shimmer-trigger"
                      >
                        <div className="kinetic-sheen" />
                        <div
                          className={`w-12 h-12 sm:w-13 sm:h-13 rounded-2xl flex items-center justify-center shrink-0 border group-hover/item:scale-105 group-hover/item:shadow-[0_0_15px_color-mix(in srgb, var(--dynamic-aura, var(--aura-indigo)) 20%, transparent)] transition-all duration-500 relative ${
                            isCurrentDuyuruRead
                              ? 'bg-[var(--text-primary)]/[0.01] border-[var(--glass-border)] opacity-60'
                              : 'bg-gradient-to-br from-[var(--status-info)]/15 via-[var(--status-info)]/5 to-transparent border-[var(--status-info)]/25'
                          }`}
                        >
                          <Megaphone
                            size={16}
                            className={`${isCurrentDuyuruRead ? 'text-muted' : 'text-[var(--status-info)]'} group-hover/item:rotate-12 transition-transform duration-500`}
                            strokeWidth={1.75}
                          />
                          {/* Nokta bg-[var(--status-info)] (sabit mavi) ama parıltısı yanlışlıkla
      dynamic-aura'ya (günün vaktine göre amber/ruby/emerald olabilir)
      bağlıydı — nokta ile parıltısı aynı renk olmalı (bkz. GPS aktif
      noktasındaki established desen: bg-emerald-400 + shadow rgba(52,211,153),
      premium standart denetimi). */}
                          {!isCurrentDuyuruRead && (
                            <div className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[var(--status-info)] shadow-[0_0_8px_color-mix(in_srgb,var(--status-info)_80%,transparent)] animate-pulse" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3
                            className={`text-base sm:text-lg font-light text-[var(--text-primary)] group-hover/item:font-normal transition-all duration-300 truncate ${isCurrentDuyuruRead ? 'opacity-50' : ''}`}
                          >
                            {duyurular[activeDuyuruIdx].baslik}
                          </h3>
                          <p className="text-2xs text-muted mt-0.5 line-clamp-1">{duyurular[activeDuyuruIdx].icerik}</p>
                        </div>
                        <ChevronRight
                          size={16}
                          className="text-muted group-hover/item:text-[var(--text-secondary)]/60 group-hover/item:translate-x-0.5 transition-all duration-300 shrink-0"
                        />
                      </motion.div>
                    </AnimatePresence>
                  );
                })()}
              </motion.div>
            )}

            {/* Duty Roster */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
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

            {/* Gelen Vekalet Talepleri (Real-time P2P Inbox) */}
            {gelenVekaletler.length > 0 && (
              <div className="space-y-3 mb-6 relative z-10">
                {gelenVekaletler.map((talep) => (
                  <motion.div
                    key={talep.id}
                    initial={{ opacity: 0, y: -10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    className="p-6 spatial-glass border-emerald-500/25 bg-emerald-500/[0.015] shadow-lg shadow-emerald-500/5 rounded-card flex flex-col sm:flex-row sm:items-center justify-between gap-5 relative overflow-hidden"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center animate-pulse shrink-0">
                        <Megaphone size={18} />
                      </div>
                      <div className="text-left">
                        <span className="text-2xs font-extrabold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2.5 py-1 rounded uppercase tracking-wide leading-none">
                          VEKALET TEKLİFİ
                        </span>
                        <p className="text-sm font-light text-[var(--text-primary)] mt-1">
                          {talep.gonderenIsim} Hocam, size{' '}
                          <strong className="text-[var(--dynamic-aura,var(--aura-indigo))]">{talep.tarih}</strong> günü{' '}
                          <strong className="text-[var(--dynamic-aura,var(--aura-indigo))]">
                            {toTurkishUpperCase(VAKIT_GORA_ISIMLERI[talep.vakit as Vakit] || talep.vakit)}
                          </strong>{' '}
                          vakti vekaletini teklif ediyor.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-auto sm:ml-0">
                      <motion.button
                        whileHover={isReadOnly ? {} : { y: -1, scale: 1.03 }}
                        whileTap={isReadOnly ? {} : { scale: 0.97 }}
                        disabled={processingVekaletId === talep.id || isReadOnly}
                        title={isReadOnly ? GOZLEMCI_SALT_OKUMA_IPUCU : undefined}
                        onClick={async () => {
                          if (processingVekaletId || isReadOnly) return;
                          setProcessingVekaletId(talep.id);
                          try {
                            // vekaletKabulEt bir runTransaction kullanır — çevrimdışıyken
                            // sonsuza dek askıda kalabildiğinden (bkz. timeoutUtils.ts
                            // yorumu, beşinci denetim turu) zamanAsimiIle ile sarmalanır;
                            // düğme sonsuza dek "İŞLENİYOR" durumunda kilitli kalmasın.
                            await zamanAsimiIle(vekaletKabulEt(talep.id));
                            // NOT: transfer artık ANLIK değil — bkz. src/services/vekaletServisi.ts
                            // yorumu ("1000 ifade tavanı" kök neden çözümü). Gerçek uid
                            // transferi scripts/vekaletDevirleriniIsle.ts'in bir sonraki
                            // çalışmasına kadar (~10-15 dk) gecikmeli.
                            showNotification(
                              'Kabulünüz Alındı',
                              'Kabulünüz kaydedildi, göreviniz planınıza kısa süre içinde işlenecektir.',
                              'success'
                            );
                          } catch (err: unknown) {
                            if (err instanceof IslemZamanAsimi) {
                              showNotification('Bağlantı Sorunu', err.message, 'warning');
                            } else {
                              showNotification('Hata', err instanceof Error ? err.message : 'Vekalet kabul edilemedi.', 'error');
                            }
                          } finally {
                            setProcessingVekaletId(null);
                          }
                        }}
                        className="px-4 py-2.5 bg-emerald-500 text-[var(--app-bg)] rounded-xl text-2xs font-extrabold uppercase tracking-wide cursor-pointer shadow-md shadow-emerald-500/20 border-none disabled:opacity-45 disabled:cursor-wait"
                      >
                        {processingVekaletId === talep.id ? 'İŞLENİYOR' : 'KABUL ET'}
                      </motion.button>
                      {pendingRejectId === talep.id ? (
                        <motion.button
                          initial={{ scale: 0.95 }}
                          animate={{ scale: 1 }}
                          whileTap={{ scale: 0.97 }}
                          disabled={processingVekaletId === talep.id || isReadOnly}
                          title={isReadOnly ? GOZLEMCI_SALT_OKUMA_IPUCU : undefined}
                          onClick={async () => {
                            if (processingVekaletId || isReadOnly) return;
                            setProcessingVekaletId(talep.id);
                            setPendingRejectId(null);
                            try {
                              await zamanAsimiIle(vekaletReddet(talep.id));
                              showNotification('Reddedildi', 'Vekalet teklifi reddedildi.', 'info');
                            } catch (err: unknown) {
                              if (err instanceof IslemZamanAsimi) {
                                showNotification('Bağlantı Sorunu', err.message, 'warning');
                              } else {
                                showNotification('Hata', err instanceof Error ? err.message : 'İşlem başarısız.', 'error');
                              }
                            } finally {
                              setProcessingVekaletId(null);
                            }
                          }}
                          className="px-4 py-2.5 bg-rose-500 text-[var(--app-bg)] rounded-xl text-2xs font-extrabold uppercase tracking-wide cursor-pointer shadow-md shadow-rose-500/20 border-none disabled:opacity-45 disabled:cursor-wait"
                        >
                          {processingVekaletId === talep.id ? 'İŞLENİYOR' : 'EMİN MİSİNİZ?'}
                        </motion.button>
                      ) : (
                        <motion.button
                          whileHover={isReadOnly ? {} : { y: -1, scale: 1.03, backgroundColor: 'rgba(244,63,94,0.15)' }}
                          whileTap={isReadOnly ? {} : { scale: 0.97 }}
                          disabled={!!processingVekaletId || isReadOnly}
                          title={isReadOnly ? GOZLEMCI_SALT_OKUMA_IPUCU : undefined}
                          onClick={() => {
                            if (!isReadOnly) setPendingRejectId(talep.id);
                          }}
                          className="px-4 py-2.5 bg-transparent border border-rose-500/20 text-rose-500 hover:text-rose-400 rounded-xl text-2xs font-extrabold uppercase tracking-wide cursor-pointer hover:bg-rose-500/5 transition-all disabled:opacity-45 disabled:cursor-wait"
                        >
                          REDDET
                        </motion.button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            {/* Kabul edilmiş ama scripts/vekaletDevirleriniIsle.ts tarafından henüz
      uygulanmamış devirler — "1000 ifade tavanı" kök neden çözümü sonrası
      transfer artık anlık değil (~10-15 dk gecikmeli), bkz. useBekleyenVekaletDevirleri
      yorumu. Alıcı, kabul ettiği görevin planına henüz yansımadığını
      görebilsin diye. */}
            {bekleyenVekaletDevirleri.length > 0 && (
              <div className="space-y-3 mb-6 relative z-10">
                {bekleyenVekaletDevirleri.map((talep) => (
                  <motion.div
                    key={talep.id}
                    initial={{ opacity: 0, y: -10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    className="p-6 spatial-glass border-amber-500/25 bg-amber-500/[0.015] shadow-lg shadow-amber-500/5 rounded-card flex items-center gap-4 relative overflow-hidden"
                  >
                    <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center shrink-0">
                      <Clock size={18} />
                    </div>
                    <div className="text-left">
                      <span className="text-2xs font-extrabold bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2.5 py-1 rounded uppercase tracking-wide leading-none">
                        DEVİR İŞLENİYOR
                      </span>
                      <p className="text-sm font-light text-[var(--text-primary)] mt-1">
                        <strong className="text-[var(--dynamic-aura,var(--aura-indigo))]">{talep.tarih}</strong> günü{' '}
                        <strong className="text-[var(--dynamic-aura,var(--aura-indigo))]">
                          {toTurkishUpperCase(VAKIT_GORA_ISIMLERI[talep.vakit as Vakit] || talep.vakit)}
                        </strong>{' '}
                        vakti için kabulünüz alındı, kısa süre içinde planınıza işlenecektir.
                      </p>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            {/* Task Flow */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.28, ease: [0.16, 1, 0.3, 1] }}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.32, ease: [0.16, 1, 0.3, 1] }}
              >
                <Link
                  to="/takvim"
                  className="h-full p-6 spatial-glass hover:bg-[var(--text-primary)]/[0.015] hover:border-[var(--text-primary)]/10 dark:hover:border-[var(--text-primary)]/15 hover:shadow-[var(--spatial-shadow)] transition-all duration-500 flex flex-col justify-between relative overflow-hidden shimmer-trigger group/cal"
                >
                  <div className="kinetic-sheen" />
                  <div className="w-12 h-12 rounded-2xl bg-[var(--text-primary)]/[0.04] border border-[var(--glass-border)] flex items-center justify-center group-hover/cal:scale-105 group-hover/cal:bg-[var(--text-primary)]/[0.08] transition-all duration-500 mb-6">
                    <Calendar
                      size={20}
                      className="text-muted group-hover/cal:text-[var(--text-secondary)]/85 transition-colors duration-500"
                    />
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-light text-[var(--text-primary)] group-hover/cal:font-normal transition-all duration-500">
                      Haftalık Plan
                    </h3>
                    <p className="text-2xs text-muted mt-1.5 uppercase tracking-wide leading-none">Koordinasyon Takvimi</p>
                  </div>
                </Link>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.38, ease: [0.16, 1, 0.3, 1] }}
              >
                <Link
                  to="/profil"
                  className="h-full p-6 spatial-glass hover:bg-[var(--text-primary)]/[0.015] hover:border-[var(--text-primary)]/10 dark:hover:border-[var(--text-primary)]/15 hover:shadow-[var(--spatial-shadow)] transition-all duration-500 flex flex-col justify-between relative overflow-hidden shimmer-trigger group/prof"
                >
                  <div className="kinetic-sheen" />
                  <div className="w-12 h-12 rounded-2xl bg-[var(--text-primary)]/[0.04] border border-[var(--glass-border)] flex items-center justify-center group-hover/prof:scale-105 group-hover/prof:bg-[var(--text-primary)]/[0.08] transition-all duration-500 mb-6">
                    <ClipboardList
                      size={20}
                      className="text-muted group-hover/prof:text-[var(--text-secondary)]/85 transition-colors duration-500"
                      strokeWidth={1.7}
                    />
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-light text-[var(--text-primary)] group-hover/prof:font-normal transition-all duration-500">
                      Haftalık Görev Özeti
                    </h3>
                    <p className="text-2xs text-muted mt-1.5 uppercase tracking-wide leading-none">
                      {haftalikOzet.toplam} görev • {haftalikOzet.tamamlanan} tamamlandı • {haftalikOzet.bekleyen} bekliyor
                    </p>
                  </div>
                </Link>
              </motion.div>
            </div>
          </motion.div>
        </div>

        {/* Announcement Modal (Neural Expressive Bottom Sheet) */}
        <Modal isOpen={!!viewingDuyuru} onClose={handleCloseDuyuru} title={viewingDuyuru?.baslik || ''}>
          {viewingDuyuru && (
            <div className="flex flex-col py-2 relative">
              <div className="flex flex-col gap-1.5 mb-6 opacity-60">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[var(--dynamic-aura,var(--aura-indigo))] animate-pulse" />
                  <p className="text-2xs font-bold tracking-wide uppercase text-[var(--dynamic-aura,var(--aura-indigo))]">RESMİ TEBLİĞ</p>
                </div>
                <span className="text-2xs opacity-40 font-mono">
                  BELGE NO: {viewingDuyuru.id?.slice(0, 8)?.toUpperCase() || 'BELİRSİZ'}
                </span>
              </div>

              <div className="max-h-[40vh] overflow-y-auto mb-8 pr-2 no-scrollbar">
                <p className="text-lg sm:text-xl font-light text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
                  {viewingDuyuru.icerik}
                </p>
              </div>

              <motion.button
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleCloseDuyuru}
                className="w-full py-5 border-none neural-btn cursor-pointer"
              >
                BİLGİ EDİNİLDİ
              </motion.button>
            </div>
          )}
        </Modal>

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
  );
}
