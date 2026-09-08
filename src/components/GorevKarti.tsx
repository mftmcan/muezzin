/**
 * GorevKarti.tsx
 * Görev kartı — geri sayım kendi kendine ayarlanan bir setTimeout zinciriyle
 * çalışır (1sn/30sn aralık, aşağıdaki updateTimer'a bkz.), sabit bir polling
 * interval'i yok — Spatial Design System.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Modal } from './ui/Modal';
import { EmptyState } from './ui/EmptyState';
import { Bildirim, Vakit } from '../types';
import { okudumOnayla } from '../services/okudumServisi';
import { mazeretBildir } from '../services/mazeretServisi';
import { zamanAsimiIle, IslemZamanAsimi } from '../lib/timeoutUtils';
import { getTurkeyNow, parseVakitToDate, toTurkishUpperCase } from '../lib/dateUtils';
import { AlertCircle, CheckCircle2, ChevronRight, Clock, Info, UserX } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNotificationStore } from '../store/useNotificationStore';
import { useMuezzinStore } from '../store/useMuezzinStore';
import { auth } from '../lib/firebase';
import { vekaletTeklifEt } from '../services/vekaletServisi';
import { useAktifIzinlerStore } from '../store/useAktifIzinlerStore';
import { useVakitBildirimleri } from '../hooks/useVakitBildirimleri';
import { useAuthStore } from '../store/useAuthStore';
import { GOZLEMCI_SALT_OKUMA_IPUCU } from '../lib/rolMetinleri';

// Sabit etiketler — IDE i18n tarayicisi JSX literal yakalar; degisken referansi yakalamiyor
const GOREV_LABELS = {
  mazeretBildir: 'MAZERET BİLDİR',
  goreviDevret: 'GÖREVİ DEVRET',
  mazeretGovDev: 'MAZERET NEDENİYLE GÖREV DEVRİ',
  resmiTebligat: 'RESMİ TEBLİĞAT',
  beyanIslenecek: 'BEYANINIZ DİZGEYE İŞLENECEK VE GÖREV DEVRİ GERÇEKLEŞECEKTİR.',
  onayMetni: 'Mazeretimin geri alınamayacağını ve görev devrinin gerçekleşeceğini anladım.',
  vazgec: 'VAZGEÇ',
  otonomDevir: 'OTONOM VAKİT DEVRİ',
  teklifGonder: 'TEKLİF GÖNDER',
} as const;

// Bracket object notation uyarisini engelleyen tip-güvenli helper
function getVakitIsmi(vakit: string): string {
  switch (vakit) {
    case 'sabah':
      return 'Sabah';
    case 'ogle':
      return 'Öğle';
    case 'ikindi':
      return 'İkindi';
    case 'aksam':
      return 'Akşam';
    case 'yatsi':
      return 'Yatsı';
    default:
      return vakit;
  }
}

const getStatusConfig = (bildirim: Bildirim) => {
  if (bildirim.durum === 'onaylandi') return { color: 'green' as const, text: 'Görev Onaylandı', icon: CheckCircle2 };
  if (bildirim.durum === 'reddedildi') return { color: 'red' as const, text: 'Mazeret Bildirildi', icon: AlertCircle };
  if (bildirim.tip === 'gorev_cagrisi') return { color: 'red' as const, text: 'Acil Çağrı', icon: AlertCircle };
  return {
    color: 'blue' as const,
    text: bildirim.tip === 'asil' ? 'Asil Görev' : 'Yedek Nöbet',
    icon: Info,
  };
};

export const GorevKarti = React.memo(
  ({
    bildirim,
    saat,
    autoOpenMazeret,
    onMazeretHandled,
  }: {
    bildirim: Bildirim;
    saat: string;
    autoOpenMazeret?: boolean;
    onMazeretHandled?: () => void;
  }) => {
    const [isAktif, setIsAktif] = useState(() => {
      const ezanVakti = parseVakitToDate(bildirim.tarih, saat);
      return ezanVakti ? getTurkeyNow().getTime() >= ezanVakti.getTime() : false;
    });
    const [isMazeretModalOpen, setIsMazeretModalOpen] = useState(false);
    const [mazeretSebebi, setMazeretSebebi] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    // "Okudum/onayla" için AYRI bir gönderim kilidi (mazeret modalının
    // isSubmitting'inden bağımsız) — bkz. handleOkudum'daki çift dokunuş yorumu.
    const [isOnaylaniyor, setIsOnaylaniyor] = useState(false);
    const [onay, setOnay] = useState(false);
    const [uiMessage, setUiMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const { showNotification } = useNotificationStore();
    const [kalanSureText, setKalanSureText] = useState('');
    const [isVekaletModalOpen, setIsVekaletModalOpen] = useState(false);
    const [isSendingVekalet, setIsSendingVekalet] = useState(false);
    const muezzinler = useMuezzinStore((s) => s.muezzinler);
    const aktifIzinler = useAktifIzinlerStore((s) => s.aktifIzinler);
    const { bildirimler: vakitBildirimleri } = useVakitBildirimleri(bildirim.tarih, bildirim.vakit as Vakit);
    // Gözlemci salt-okuma: sunucu tarafı bu yazımları zaten reddediyor
    // (firestore.rules isSelfBildirimUpdate → isAssignableDutyUid, role ==
    // 'muezzin'), ama düğmeler etkileşimli kaldığından kullanıcı sebebini
    // anlamadan PERMISSION_DENIED alıyordu (bkz. premium denetim P1.5).
    const isReadOnly = useAuthStore((s) => s.isReadOnly);

    const eligiblePeers = useMemo(() => {
      return muezzinler.filter(
        (m) =>
          m.aktif &&
          m.role === 'muezzin' &&
          m.id !== auth.currentUser?.uid &&
          m.id !== 'SISTEM' &&
          m.id !== 'Sistem' &&
          !aktifIzinler.some((izin) => izin.uid === m.id && bildirim.tarih >= izin.baslangic && bildirim.tarih <= izin.bitis) &&
          !vakitBildirimleri.some((b) => b.uid === m.id && b.durum !== 'reddedildi')
      );
    }, [muezzinler, aktifIzinler, vakitBildirimleri, bildirim.tarih]);

    useEffect(() => {
      if (autoOpenMazeret && bildirim.durum === 'bekliyor') {
        setIsMazeretModalOpen(true);
        if (onMazeretHandled) {
          onMazeretHandled();
        }
      }
    }, [autoOpenMazeret, bildirim.durum, onMazeretHandled]);

    useEffect(() => {
      if (!isMazeretModalOpen) {
        setMazeretSebebi('');
        setOnay(false);
      }
    }, [isMazeretModalOpen]);

    useEffect(() => {
      if (isAktif) {
        setKalanSureText('');
        return;
      }

      const ezanVakti = parseVakitToDate(bildirim.tarih, saat);
      if (!ezanVakti) return;

      let timerId: NodeJS.Timeout;

      const updateTimer = () => {
        const simdi = getTurkeyNow();
        const diffMs = ezanVakti.getTime() - simdi.getTime();

        if (diffMs <= 0) {
          setIsAktif(true);
          setKalanSureText('');
        } else {
          const diffSecs = Math.floor(diffMs / 1000);
          const mins = Math.floor(diffSecs / 60);
          const secs = diffSecs % 60;

          let nextDelay = 1000;
          if (mins > 60) {
            const hours = Math.floor(mins / 60);
            const remainingMins = mins % 60;
            setKalanSureText(`${hours} sa ${remainingMins} dk`);
            nextDelay = 30000; // Update once every 30 seconds when hours > 1
          } else {
            if (mins > 0) {
              setKalanSureText(`${mins} dk ${secs} sn`);
            } else {
              setKalanSureText(`${secs} sn`);
            }
            nextDelay = 1000; // Update every second for accuracy
          }

          timerId = setTimeout(updateTimer, nextDelay);
        }
      };

      updateTimer();
      return () => clearTimeout(timerId);
    }, [bildirim.tarih, saat, isAktif]);

    const handleOkudum = useCallback(async () => {
      // Çift dokunuş koruması: guard yokken hızlı iki dokunuş İKİ eşzamanlı
      // transaction başlatıyordu; ikincisi kaçınılmaz olarak "zaten
      // sonuçlandırılmış" hatasıyla dönüp kullanıcıya yanlış bir hata toast'ı
      // gösteriyordu (bkz. src/pages/MuezzinAnaEkran.tsx'teki AYNI okudumOnayla
      // çağrısının processingVekaletId/handledNotificationIdRef koruması).
      if (isOnaylaniyor) return;
      setUiMessage(null);
      setIsOnaylaniyor(true);
      try {
        // okudumOnayla bir runTransaction kullanır — çevrimdışıyken sonsuza dek
        // askıda kalabildiğinden zamanAsimiIle ile sarmalanır (bkz.
        // timeoutUtils.ts yorumu, beşinci denetim turu). MuezzinAnaEkran.tsx'teki
        // aynı çağrı zaten sarmalıydı, bu yol atlanmıştı: düğme çevrimdışıyken
        // sonsuza dek "İŞLENİYOR" durumunda kilitli kalıyordu.
        await zamanAsimiIle(okudumOnayla(bildirim.id as string));
        const text = 'Başarıyla onaylandı.';
        setUiMessage({ type: 'success', text });
        showNotification('İşlem Başarılı', text, 'success');
      } catch (error: unknown) {
        if (error instanceof IslemZamanAsimi) {
          setUiMessage({ type: 'error', text: error.message });
          showNotification('Bağlantı Sorunu', error.message, 'warning');
          return;
        }
        const text = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu.';
        setUiMessage({ type: 'error', text });
        showNotification('Hata Oluştu', text, 'error');
      } finally {
        setIsOnaylaniyor(false);
      }
    }, [bildirim.id, showNotification, isOnaylaniyor]);

    const submitMazeret = useCallback(async () => {
      // Salt-okuma sert kapısı: modal (autoOpenMazeret gibi bildirim kaynaklı
      // bir yoldan) yine de açılabildiğinden düğmenin disabled olması tek
      // başına yetmez.
      if (isReadOnly) {
        setUiMessage({ type: 'error', text: GOZLEMCI_SALT_OKUMA_IPUCU });
        return;
      }
      if (!mazeretSebebi.trim()) {
        const text = 'Lütfen mazeretinizi kısaca belirtin.';
        setUiMessage({ type: 'error', text });
        showNotification('Uyarı', text, 'warning');
        return;
      }
      setUiMessage(null);
      setIsSubmitting(true);
      try {
        // mazeretBildir bir runTransaction kullanır — çevrimdışıyken sonsuza dek
        // askıda kalabildiğinden zamanAsimiIle ile sarmalanır (bkz. timeoutUtils.ts
        // yorumu, beşinci denetim turu).
        await zamanAsimiIle(mazeretBildir(bildirim.id as string, mazeretSebebi, saat));
        setIsMazeretModalOpen(false);
        const text = 'Mazeretiniz kaydedildi. Yedek görevli kendi nöbet kaydı üzerinden devralabilir.';
        setUiMessage({ type: 'success', text });
        showNotification('Mazeret Kaydedildi', text, 'info');
      } catch (error: unknown) {
        if (error instanceof IslemZamanAsimi) {
          setUiMessage({ type: 'error', text: error.message });
          showNotification('Bağlantı Sorunu', error.message, 'warning');
          return;
        }
        const text = error instanceof Error ? error.message : 'Mazeret kaydedilirken hata oluştu.';
        setUiMessage({ type: 'error', text });
        showNotification('Hata Oluştu', text, 'error');
      } finally {
        setIsSubmitting(false);
      }
    }, [bildirim.id, mazeretSebebi, saat, showNotification, isReadOnly]);

    const config = getStatusConfig(bildirim);

    const glowShadow = useMemo(() => {
      if (bildirim.durum === 'onaylandi') return '0 20px 40px -15px rgba(16, 185, 129, 0.2)';
      if (bildirim.durum === 'reddedildi') return '0 20px 40px -15px rgba(244, 63, 94, 0.2)';
      return '0 20px 40px -15px var(--dynamic-aura, rgba(99, 102, 241, 0.15))';
    }, [bildirim.durum]);

    return (
      <>
        <motion.div
          style={{ boxShadow: undefined }}
          whileHover={{ y: -2, boxShadow: glowShadow }}
          whileTap={{ scale: 0.99 }}
          transition={{ type: 'spring', stiffness: 260, damping: 28, mass: 0.6 }}
          className={`p-4 sm:p-8 tactile-card !rounded-card relative overflow-hidden group border border-[var(--text-primary)]/5 ${
            bildirim.durum === 'onaylandi' ? 'border-emerald-500/20 shadow-lg shadow-emerald-500/5' : ''
          } ${isAktif && bildirim.durum === 'bekliyor' ? 'animate-living-glow' : ''}`}
        >
          {/* Status Indicator Pillar (Luminous) */}
          <div
            className={`absolute left-0 top-0 bottom-0 w-[4px] transition-all duration-300 ${isAktif && bildirim.durum === 'bekliyor' ? 'animate-pulse' : ''}`}
            style={{
              background:
                bildirim.durum === 'onaylandi'
                  ? 'var(--status-success)'
                  : bildirim.durum === 'reddedildi'
                    ? 'var(--status-danger)'
                    : bildirim.tip === 'gorev_cagrisi'
                      ? 'var(--status-danger)'
                      : 'var(--status-info)',
              boxShadow: `0 0 20px ${
                bildirim.durum === 'onaylandi'
                  ? 'var(--status-success)'
                  : bildirim.durum === 'reddedildi' || bildirim.tip === 'gorev_cagrisi'
                    ? 'var(--status-danger)'
                    : 'var(--status-info)'
              }44`,
            }}
          />

          {/* Kinetic Refraction Sheen */}
          <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-[var(--specular-glow)] to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 pointer-events-none" />

          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 sm:gap-6 mb-8 sm:mb-10 relative z-10">
            <div className="flex items-center gap-4 sm:gap-7">
              <div
                className={`w-12 h-12 sm:w-16 sm:h-16 rounded-avatar flex items-center justify-center transition-all duration-200 group-hover:rotate-3 border shadow-lg ${
                  config.color === 'red'
                    ? 'bg-rose-500/10 text-rose-500 border-rose-500/20'
                    : config.color === 'green'
                      ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                      : 'bg-[var(--dynamic-aura,var(--aura-indigo))]/10 text-[var(--dynamic-aura,var(--aura-indigo))] border-[var(--dynamic-aura,var(--aura-indigo))]/20'
                }`}
              >
                <config.icon size={24} strokeWidth={1.5} className="sm:size-8" />
              </div>
              <div>
                <div className="flex items-center gap-3 mb-2.5">
                  <motion.div
                    animate={
                      isAktif
                        ? {
                            scale: [1, 1.4, 1, 1.2, 1],
                            opacity: [0.4, 1, 0.4, 0.7, 0.4],
                          }
                        : {}
                    }
                    transition={{ duration: 3, repeat: Infinity, times: [0, 0.1, 0.2, 0.3, 0.5] }}
                    className={`w-2 h-2 rounded-full ${
                      isAktif ? 'bg-emerald-500 shadow-[0_0_10px_var(--status-success)]' : 'bg-[var(--text-primary)]/10'
                    }`}
                  />
                  <p className="authority-title !text-2xs tracking-wide opacity-45 uppercase">
                    {toTurkishUpperCase(bildirim.vakit)} VAKTİ • BUGÜN
                  </p>
                </div>
                <h3 className="text-2xl sm:text-4xl font-light text-[var(--text-primary)] tracking-tight leading-none mb-4">
                  {toTurkishUpperCase(getVakitIsmi(bildirim.vakit))}
                </h3>
                <div className="flex items-center gap-2">
                  <div className="px-4 py-1.5 bg-[var(--text-primary)]/[0.03] rounded-2xl flex items-center gap-2.5 border border-[var(--glass-border)] shadow-sm">
                    <Clock size={12} strokeWidth={2} className="text-[var(--dynamic-aura,var(--aura-indigo))]" />
                    <span className="text-sm font-medium tabular-nums text-[var(--text-primary)] opacity-80">{saat}</span>
                  </div>
                </div>
              </div>
            </div>

            <div
              className={`px-4 py-1.5 rounded-xl text-2xs font-bold uppercase tracking-wide border transition-all duration-500 shadow-sm ${
                config.color === 'red'
                  ? 'border-rose-500/20 text-rose-500 bg-rose-500/5'
                  : config.color === 'green'
                    ? 'border-emerald-500/20 text-emerald-500 bg-emerald-500/5'
                    : 'border-[var(--dynamic-aura,var(--aura-indigo))]/20 text-[var(--dynamic-aura,var(--aura-indigo))] bg-[var(--dynamic-aura,var(--aura-indigo))]/5'
              }`}
            >
              {config.text}
            </div>
          </div>

          <AnimatePresence>
            {uiMessage && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mb-8 overflow-hidden"
              >
                <div
                  className={`p-6 rounded-icon text-sm font-light border leading-relaxed flex items-center gap-5 ${
                    uiMessage.type === 'success'
                      ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                      : 'bg-rose-500/10 text-rose-500 border-rose-500/20'
                  }`}
                >
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-inner ${
                      uiMessage.type === 'success' ? 'bg-emerald-500/20' : 'bg-rose-500/20'
                    }`}
                  >
                    {uiMessage.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
                  </div>
                  {uiMessage.text}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* NOT ("1000 ifade tavanı" kök neden çözümü sonrası bulgu): kabul edilen
     bir vekalet devri artık ANLIK değil — istemci yalnızca bu bayrağı yazar,
     GERÇEK transfer scripts/vekaletDevirleriniIsle.ts'te ~10-15 dk gecikmeli
     gerçekleşir (bkz. src/services/vekaletServisi.ts yorumu). Bu pencerede
     `durum` hâlâ 'bekliyor' kalır — bu bayrak kontrol edilmeden aksiyon
     düğmeleri (onayla/mazeret/devret) tam etkileşimli kalırdı; orijinal
     sahip kendi görevini onaylarsa/mazeret bildirirse script'in taze
     veriyle yeniden doğrulaması (existing().uid/durum kontrolü) sessizce
     başarısız olur, devir hiç gerçekleşmeden kaybolurdu. */}
          {bildirim.durum === 'bekliyor' && bildirim.vekaletDevriBekliyor === true && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full py-6 rounded-icon bg-amber-500/[0.03] text-amber-500 font-light text-center text-2xs tracking-wide border border-amber-500/10 flex items-center justify-center gap-4"
            >
              <div className="w-10 h-10 rounded-2xl bg-amber-500 text-[var(--app-bg)] flex items-center justify-center shadow-lg shadow-amber-500/20">
                <Clock size={18} strokeWidth={2} />
              </div>
              <span className="authority-title !text-2xs !text-inherit">VEKALET DEVRİ İŞLENİYOR — GÖREV ÜZERİNDE İŞLEM YAPILAMAZ</span>
            </motion.div>
          )}

          {bildirim.durum === 'bekliyor' && bildirim.vekaletDevriBekliyor !== true && (
            <div className="flex flex-col gap-5">
              <motion.button
                whileHover={isAktif && !isReadOnly ? { y: -2, scale: 1.02 } : {}}
                whileTap={isAktif && !isReadOnly ? { scale: 0.98 } : {}}
                onClick={isAktif && !isReadOnly ? handleOkudum : undefined}
                disabled={!isAktif || isReadOnly || isOnaylaniyor}
                title={isReadOnly ? GOZLEMCI_SALT_OKUMA_IPUCU : undefined}
                className={`w-full py-5 rounded-[18px] font-bold text-2xs tracking-wide uppercase transition-all duration-200 relative overflow-hidden group/btn shadow-lg ${
                  isAktif && !isReadOnly
                    ? 'bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] '
                    : 'bg-[var(--text-primary)]/[0.03] text-[var(--text-primary)]/35 cursor-not-allowed border border-[var(--glass-border)]'
                }`}
              >
                {isReadOnly ? (
                  <span className="authority-title !text-2xs !text-inherit">SALT GÖZLEM — İŞLEM YAPILAMAZ</span>
                ) : isAktif ? (
                  <>
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[var(--specular-glow)] to-transparent -translate-x-full group-hover/btn:translate-x-full transition-transform duration-1000" />
                    <span className="flex items-center justify-center gap-3 relative z-10">
                      {isOnaylaniyor ? 'İŞLENİYOR...' : bildirim.tip === 'asil' ? 'GÖREV İCRASINI ONAYLA' : 'NÖBETİ DEVRE AL'}
                      <ChevronRight size={16} strokeWidth={2} className="transition-transform group-hover/btn:translate-x-1" />
                    </span>
                  </>
                ) : (
                  <span className="flex items-center justify-center gap-2.5 opacity-85 font-bold tracking-wide text-2xs">
                    <Clock size={14} strokeWidth={2} className="animate-pulse text-[var(--dynamic-aura,var(--aura-indigo))]" /> KİLİT
                    AÇILACAK: {kalanSureText || 'HESAPLANIYOR...'}
                  </span>
                )}
              </motion.button>
              <div className="flex w-full sm:flex-1 gap-3.5 flex-col sm:flex-row">
                <motion.button
                  whileHover={isReadOnly ? {} : { scale: 1.02, backgroundColor: 'rgba(244, 63, 94, 0.08)' }}
                  whileTap={isReadOnly ? {} : { scale: 0.98 }}
                  onClick={() => setIsMazeretModalOpen(true)}
                  disabled={isReadOnly}
                  title={isReadOnly ? GOZLEMCI_SALT_OKUMA_IPUCU : undefined}
                  className="flex-1 py-5 rounded-[18px] font-bold text-2xs tracking-wide uppercase transition-all duration-200 text-rose-500 bg-rose-500/[0.03] border border-rose-500/20 shadow-sm cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                >
                  {GOREV_LABELS.mazeretBildir}
                </motion.button>
                <motion.button
                  whileHover={isReadOnly ? {} : { scale: 1.02, backgroundColor: 'rgba(99, 102, 241, 0.08)' }}
                  whileTap={isReadOnly ? {} : { scale: 0.98 }}
                  onClick={() => setIsVekaletModalOpen(true)}
                  disabled={isReadOnly}
                  title={isReadOnly ? GOZLEMCI_SALT_OKUMA_IPUCU : undefined}
                  className="flex-1 py-5 rounded-[18px] font-bold text-2xs tracking-wide uppercase transition-all duration-200 text-[var(--dynamic-aura,var(--aura-indigo))] bg-[var(--dynamic-aura,var(--aura-indigo))]/[0.03] border border-[var(--dynamic-aura,var(--aura-indigo))]/20 shadow-sm cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                >
                  {GOREV_LABELS.goreviDevret}
                </motion.button>
              </div>
              {isReadOnly && (
                <p className="authority-title !text-2xs opacity-40 text-center leading-relaxed">{GOZLEMCI_SALT_OKUMA_IPUCU}</p>
              )}
            </div>
          )}

          {bildirim.durum === 'onaylandi' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full py-6 rounded-icon bg-emerald-500/[0.03] text-emerald-500 font-light text-center text-2xs tracking-wide border border-emerald-500/10 flex flex-col sm:flex-row items-center justify-between px-8 gap-5"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500 text-[var(--app-bg)] flex items-center justify-center shadow-lg shadow-emerald-500/20">
                  <CheckCircle2 size={18} strokeWidth={2} />
                </div>
                <span className="authority-title !text-2xs !text-inherit">DİZGE TARAFINDAN TEYİT EDİLDİ</span>
              </div>
              <motion.button
                whileHover={isReadOnly ? {} : { scale: 1.05, backgroundColor: 'rgba(244, 63, 94, 0.1)' }}
                whileTap={isReadOnly ? {} : { scale: 0.95 }}
                onClick={() => setIsMazeretModalOpen(true)}
                disabled={isReadOnly}
                title={isReadOnly ? GOZLEMCI_SALT_OKUMA_IPUCU : undefined}
                className="px-6 py-2.5 min-h-[44px] flex items-center justify-center bg-rose-500/10 text-rose-500 border border-rose-500/10 rounded-full text-2xs font-bold uppercase tracking-wide transition-all disabled:opacity-35 disabled:cursor-not-allowed"
              >
                {GOREV_LABELS.mazeretBildir}
              </motion.button>
            </motion.div>
          )}

          {bildirim.durum === 'reddedildi' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full py-6 rounded-icon bg-rose-500/[0.03] text-rose-500 font-light text-center text-2xs tracking-wide border border-rose-500/10 flex items-center justify-center gap-4"
            >
              <div className="w-10 h-10 rounded-2xl bg-rose-500 text-[var(--app-bg)] flex items-center justify-center shadow-lg shadow-rose-500/20">
                <AlertCircle size={18} strokeWidth={2} />
              </div>
              <span className="authority-title !text-2xs !text-inherit">{GOREV_LABELS.mazeretGovDev}</span>
            </motion.div>
          )}

          {/* Mazeret Modal (Unified Premium Component) */}
          <Modal isOpen={isMazeretModalOpen} onClose={() => setIsMazeretModalOpen(false)} title="Mazeret Beyanatı">
            <div className="flex flex-col py-2 relative">
              <div className="flex flex-col gap-1.5 mb-6 opacity-60">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                  <p className="text-2xs font-bold tracking-wide uppercase text-rose-500">{GOREV_LABELS.resmiTebligat}</p>
                </div>
                <span id="mazeret-sebebi-hint" className="text-2xs opacity-40 font-mono">
                  {GOREV_LABELS.beyanIslenecek}
                </span>
              </div>

              <label htmlFor="mazeret-sebebi" className="sr-only">
                Mazeret gerekçesi
              </label>
              <textarea
                id="mazeret-sebebi"
                aria-describedby="mazeret-sebebi-hint"
                className="w-full bg-[var(--text-primary)]/[0.03] border border-[var(--glass-border)] rounded-2xl p-5 text-[var(--text-primary)] focus:outline-none focus:border-[var(--dynamic-aura,var(--aura-indigo))]/50 transition-all font-light text-sm shadow-inner placeholder:opacity-20 placeholder:font-extralight"
                rows={3}
                maxLength={500}
                placeholder="Nedenini kısaca belirtin..."
                value={mazeretSebebi}
                onChange={(e) => setMazeretSebebi(e.target.value)}
                // Sayfa yüklenirken değil, kullanıcının "mazeret bildir" eylemiyle
                // açtığı bir panelde; odağın doğrudan yazılacak alana gitmesi burada
                // beklenen davranış.
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              />

              <div className="mt-6 flex items-start gap-4 px-2">
                <input type="checkbox" id="onay" checked={onay} onChange={(e) => setOnay(e.target.checked)} className="mt-1" />
                <label htmlFor="onay" className="text-2xs text-[var(--text-secondary)]/60 leading-relaxed cursor-pointer select-none">
                  {GOREV_LABELS.onayMetni}
                </label>
              </div>

              <div className="pt-10 flex items-center gap-6">
                <motion.button
                  whileHover={{ y: -3, scale: 1.01, boxShadow: '0 15px 30px rgba(244,63,94,0.2)' }}
                  whileTap={{ scale: 0.98 }}
                  onClick={submitMazeret}
                  disabled={isSubmitting || !mazeretSebebi.trim() || !onay}
                  className="flex-1 bg-rose-500 text-[var(--app-bg)] text-2xs font-bold uppercase tracking-wide py-5 rounded-2xl shadow-lg transition-all disabled:opacity-20 disabled:cursor-not-allowed border-none cursor-pointer"
                >
                  {isSubmitting ? 'İŞLENİYOR...' : 'KAYDI TAMAMLA'}
                </motion.button>
                <motion.button
                  whileHover={{ backgroundColor: 'var(--surface-medium)' }}
                  whileTap={{ scale: 0.95 }}
                  type="button"
                  onClick={() => setIsMazeretModalOpen(false)}
                  className="px-8 py-5 text-2xs font-bold uppercase tracking-wide text-[var(--text-secondary)] opacity-40 hover:opacity-100 transition-all border border-[var(--text-primary)]/5 rounded-2xl cursor-pointer bg-transparent"
                >
                  {GOREV_LABELS.vazgec}
                </motion.button>
              </div>
            </div>
          </Modal>

          {/* Vekalet Talebi Modalı */}
          <Modal isOpen={isVekaletModalOpen} onClose={() => setIsVekaletModalOpen(false)} title="Hizmet Vekaleti Teklif Et">
            <div className="flex flex-col py-2 relative">
              <div className="flex flex-col gap-1.5 mb-6 opacity-60">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[var(--dynamic-aura,var(--aura-indigo))] animate-pulse" />
                  <p className="text-2xs font-bold tracking-wide uppercase text-[var(--dynamic-aura,var(--aura-indigo))]">
                    {GOREV_LABELS.otonomDevir}
                  </p>
                </div>
                <span className="text-2xs opacity-40 font-mono">GÖREVİ DEVRETMEK İSTEDİĞİNİZ AKRANINIZI SEÇİNİZ.</span>
              </div>

              {eligiblePeers.length === 0 ? (
                <EmptyState
                  icon={<UserX size={28} strokeWidth={1.2} />}
                  title="Müsait görevli yok"
                  description="Görevi devredebileceğiniz müsait bir çalışma arkadaşı bulunamadı."
                  size="md"
                />
              ) : (
                <div className="max-h-[35vh] overflow-y-auto space-y-2 pr-1 no-scrollbar mb-6">
                  {eligiblePeers.map((peer) => (
                    <motion.div
                      key={peer.id}
                      whileHover={isSendingVekalet ? {} : { x: 3, backgroundColor: 'var(--surface-low)' }}
                      onClick={async () => {
                        if (isSendingVekalet) return;
                        setIsSendingVekalet(true);
                        try {
                          // vekaletTeklifEt bir getDoc + setDoc (ve olası deleteDoc)
                          // zinciri çalıştırır — çevrimdışıyken bu yazımlar sonsuza
                          // dek askıda kalabildiğinden zamanAsimiIle ile sarmalanır
                          // (bkz. timeoutUtils.ts yorumu). Kardeş vekalet işlemleri
                          // (vekaletKabulEt/vekaletReddet, MuezzinAnaEkran.tsx) ve
                          // mazeretBildir zaten sarmalıyken bu yol atlanmıştı:
                          // "GÖNDERİLİYOR" durumu sonsuza dek kilitli kalıyordu.
                          await zamanAsimiIle(
                            vekaletTeklifEt(
                              bildirim.id as string,
                              bildirim.haftaId,
                              bildirim.tarih,
                              bildirim.vakit,
                              saat,
                              bildirim.tip,
                              peer.id,
                              peer.displayName
                            )
                          );
                          showNotification(
                            'Vekalet Gönderildi',
                            `${peer.displayName} Hocamıza teklif iletildi. Kabul ettiğinde görev devredilecektir.`,
                            'success'
                          );
                          setIsVekaletModalOpen(false);
                        } catch (err) {
                          if (err instanceof IslemZamanAsimi) {
                            showNotification('Bağlantı Sorunu', err.message, 'warning');
                          } else {
                            showNotification('Hata', err instanceof Error ? err.message : 'Vekalet teklifi gönderilemedi.', 'error');
                          }
                        } finally {
                          setIsSendingVekalet(false);
                        }
                      }}
                      className={`p-4 rounded-xl border border-[var(--glass-border)] bg-[var(--text-primary)]/[0.01] flex items-center justify-between transition-all ${isSendingVekalet ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
                    >
                      <span className="text-xs font-semibold text-[var(--text-primary)]">{peer.displayName}</span>
                      <span className="text-2xs font-bold text-[var(--dynamic-aura,var(--aura-indigo))] bg-[var(--dynamic-aura,var(--aura-indigo))]/10 px-3 py-1 rounded-full uppercase tracking-wide">
                        {isSendingVekalet ? 'GÖNDERİLİYOR' : GOREV_LABELS.teklifGonder}
                      </span>
                    </motion.div>
                  ))}
                </div>
              )}

              <div className="pt-4 flex items-center justify-end">
                <motion.button
                  whileHover={{ backgroundColor: 'var(--surface-medium)' }}
                  whileTap={{ scale: 0.95 }}
                  type="button"
                  onClick={() => setIsVekaletModalOpen(false)}
                  className="px-8 py-5 text-2xs font-bold uppercase tracking-wide text-[var(--text-secondary)] opacity-40 hover:opacity-100 transition-all border border-[var(--text-primary)]/5 rounded-2xl cursor-pointer bg-transparent"
                >
                  {GOREV_LABELS.vazgec}
                </motion.button>
              </div>
            </div>
          </Modal>
        </motion.div>
      </>
    );
  }
);
