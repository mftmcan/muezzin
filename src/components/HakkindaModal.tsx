import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Sparkles, CalendarClock, BellRing, Repeat, MapPinned, WifiOff, Megaphone } from 'lucide-react';
import { Logo } from './ui/Logo';
import { playClick } from '../lib/sounds';
import { format } from 'date-fns';

interface HakkindaModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Önceki sürümde bu alan "Planlama Motoru / Offline İlk / React Mimarisi /
// Apple HIG" gibi genel geçer, kullanıcıya hiçbir şey anlatmayan pazarlama
// etiketleri gösteriyordu (bkz. tasarım denetimi). Bir müezzinin/admin'in
// "Hakkında" ekranına baktığında görmek isteyeceği şey teknoloji yığını değil,
// uygulamanın GERÇEKTEN ne yaptığı — bu liste README'deki mimari özetle
// (ana koleksiyonlar, otomasyon takvimi) birebir örtüşen, gerçek özellik
// açıklamalarından oluşuyor.
const OZELLIKLER = [
  {
    icon: CalendarClock,
    title: 'Otomatik Nöbet Planı',
    desc: 'Haftalık ezan vakti nöbetleri, adil sırayla her hafta sonu otomatik oluşturulur.',
    color: 'var(--aura-indigo)',
  },
  {
    icon: BellRing,
    title: 'Anlık Vakit Hatırlatmaları',
    desc: 'Göreviniz yaklaşınca anlık bildirimle (isteğe bağlı sesli okuma ile) uyarılırsınız.',
    color: 'var(--aura-amber)',
  },
  {
    icon: Repeat,
    title: 'Mazeret & Vekalet Yönetimi',
    desc: 'Göreve gelemeyeceğinizde mazeret bildirin — yedek personel otomatik devreye girer.',
    color: 'var(--status-success)',
  },
  {
    icon: Megaphone,
    title: 'Resmi Duyurular',
    desc: 'Yönetimin yayınladığı tebliğler ve kurum duyuruları anında elinize ulaşır.',
    color: 'var(--aura-rose)',
  },
  {
    icon: MapPinned,
    title: 'Konuma Duyarlı Ezan Vakitleri',
    desc: 'Bulunduğunuz yere göre hesaplanan hassas ezan vakitlerini gösterir.',
    color: 'var(--status-info)',
  },
  {
    icon: WifiOff,
    title: 'Çevrimdışı Çalışır',
    desc: 'İnternet olmasa bile o günün vakitleri ve nöbet planı cihazınızda kalır.',
    color: 'var(--text-secondary)',
  },
] as const;

export const HakkindaModal: React.FC<HakkindaModalProps> = ({ isOpen, onClose }) => {
  const handleClose = () => {
    playClick();
    onClose();
  };

  // Diğer tüm modal/overlay bileşenleri (Modal.tsx, ConfirmModal, GpsHelpModal,
  // AdminPanel'in çekmecesi — "Portaled for Mobile Stability") document.body'ye
  // portallanıyor; bu bileşen tek istisnaydı. `<main>` (`Layout.tsx`) kendi
  // `relative z-10` stacking context'ini kurduğundan, inline render edilen bu
  // modalin z-[100]'ü yalnızca o context içinde anlamlıydı — <main>'in kardeşi
  // olan alt gezinme dock'u (z-[100]) her zaman üstte kalıp dokunuşları
  // kapıyordu (bkz. mimari denetim — üçüncü tur). z-index de paylaşılan
  // Modal.tsx ile aynı katmana (z-[500]) çekildi.
  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center px-4 sm:px-0">
          {/* Deep Backdrop Blur */}
          <motion.div
            initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
            animate={{ opacity: 1, backdropFilter: 'blur(40px)' }}
            exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 bg-black/40"
            onClick={handleClose}
          />

          {/* Modal Content */}
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200, mass: 1 }}
            className="relative w-full max-w-[440px] max-h-[85dvh] spatial-glass border border-[var(--text-primary)]/10 rounded-card shadow-[0_40px_100px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              onClick={handleClose}
              aria-label="Kapat"
              className="absolute top-4 right-4 z-20 w-11 h-11 flex items-center justify-center rounded-full bg-[var(--text-primary)]/5 hover:bg-[var(--text-primary)]/10 border border-[var(--text-primary)]/5 transition-colors"
            >
              <X size={16} className="text-[var(--text-primary)]/60 hover:text-[var(--text-primary)]" />
            </button>

            {/* Glowing Aura Background */}
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-[var(--aura-indigo)]/30 blur-[80px] rounded-full pointer-events-none animate-pulse" />

            {/* Sabit üst bölüm: logo, isim, sürüm, misyon cümlesi — küçük
                ekranlarda içerik büyüyünce (bkz. aşağıdaki özellik listesi)
                bunlar kaybolmasın diye kaydırılabilir alanın DIŞINDA tutuluyor,
                yalnızca özellik listesi kendi içinde kayar (Modal.tsx'teki
                aynı sabit-başlık + kaydırılabilir-gövde deseni). */}
            <div className="shrink-0 flex flex-col items-center pt-8 sm:pt-10 px-8 sm:px-10">
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1, duration: 0.8, ease: 'easeOut' }}
                className="relative z-10 mb-6"
              >
                <Logo
                  size={64}
                  variant="dynamic"
                  className="text-[var(--text-primary)] drop-shadow-[0_0_30px_rgba(255,255,255,0.4)]"
                  glowColor="rgba(255,255,255,0.6)"
                />
              </motion.div>

              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.8, ease: 'easeOut' }}
                className="flex flex-col items-center mb-5 relative z-10"
              >
                <h2 className="text-3xl font-light tracking-tight text-transparent bg-clip-text bg-gradient-to-b from-white to-white/60 mb-2">
                  Müezzin Pro
                </h2>
                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--text-primary)]/5 border border-[var(--text-primary)]/10">
                  <Sparkles size={10} className="text-[var(--aura-indigo)]" />
                  <span className="text-2xs font-bold tracking-widest text-[var(--text-primary)]/80 uppercase">
                    {/* Elle yazılmış "Sürüm 2.2.0 (Build 860)" bir sonraki
                        sürüm çıkışında güncellenmeyi unutma riski taşıyordu
                        (bkz. kod denetimi) — artık build zamanında Vite'in
                        enjekte ettiği gerçek değerlerden (package.json'dan
                        __APP_VERSION__, build tarihinden __BUILD_TIMESTAMP__)
                        geliyor; telemetryService.ts zaten aynı sabitleri
                        kullanıyor. */}
                    Sürüm {__APP_VERSION__} · {format(new Date(__BUILD_TIMESTAMP__), 'dd.MM.yyyy')}
                  </span>
                </div>
              </motion.div>

              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.8, ease: 'easeOut' }}
                className="text-center mb-6 relative z-10"
              >
                <p className="text-sm font-light text-[var(--text-primary)]/60 leading-relaxed max-w-[300px]">
                  Cami personelinin ezan vakti nöbetlerini, mazeret ve vekalet süreçlerini tek çatı altında yönetmesi için tasarlandı.
                </p>
              </motion.div>

              <div className="w-full h-px bg-gradient-to-r from-transparent via-[var(--text-primary)]/10 to-transparent relative z-10" />
            </div>

            {/* Özellik Listesi — kaydırılabilir gövde */}
            <div className="overflow-y-auto no-scrollbar flex-1 px-8 sm:px-10 pt-5 pb-8 sm:pb-10 relative z-10">
              <p className="premium-label !text-2xs !opacity-40 tracking-wide mb-4">UYGULAMA NELER SUNAR</p>
              <div className="flex flex-col gap-1">
                {OZELLIKLER.map((ozellik, i) => (
                  <motion.div
                    key={ozellik.title}
                    initial={{ y: 14, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.35 + i * 0.05, duration: 0.6, ease: 'easeOut' }}
                    className="flex items-start gap-3.5 py-3 border-b border-[var(--glass-border)] last:border-b-0"
                  >
                    <div
                      className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center"
                      style={{ backgroundColor: `color-mix(in srgb, ${ozellik.color} 12%, transparent)`, color: ozellik.color }}
                    >
                      <ozellik.icon size={16} strokeWidth={1.7} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)]">{ozellik.title}</p>
                      <p className="text-2xs text-[var(--text-secondary)]/75 leading-relaxed mt-0.5">{ozellik.desc}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
};
