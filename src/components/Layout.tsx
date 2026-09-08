import { useLocation } from 'react-router-dom';
import React from 'react';
import { Download, Share, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useFcmToken } from '../hooks/useFcmToken';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { unlockAudioContext } from '../store/useNotificationStore';
import { GlobalNotifications } from './GlobalNotifications';
import { OfflineBanner } from './ui/OfflineBanner';
import { FloatingDock } from './FloatingDock';
import { useSpecularHighlight } from '../hooks/useSpecularHighlight';
import { telemetryService } from '../services/telemetryService';

export function Layout({ children }: { children: React.ReactNode }) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  useSpecularHighlight();

  // Global Audio Autoplay Failsafe: Unlocks audio/speech synthesis on first interaction
  React.useEffect(() => {
    const unlockAudio = () => {
      unlockAudioContext();
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };

    window.addEventListener('click', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);

    return () => {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
  }, []);

  const location = useLocation();
  useFcmToken();
  const { isInstallable, isIosPrompt, install, dismissIosPrompt, dismissInstallPrompt } = usePWAInstall();

  // Sayfa geçişlerini otomatik izleme (Telemetry tracking)
  React.useEffect(() => {
    const pageName = `PAGE_${location.pathname === '/' ? 'VAKIT' : location.pathname.slice(1).replace(/\//g, '_').toUpperCase()}`;
    telemetryService.logEvent({
      eventType: 'page_view',
      eventName: pageName,
      metadata: { path: location.pathname },
    });
    telemetryService.addBreadcrumb(`Sayfa Geçişi → ${location.pathname}`, 'navigation', { page: pageName });
  }, [location.pathname]);

  const isAdminRoute = location.pathname.startsWith('/admin');

  return (
    <div ref={rootRef} className="flex flex-col min-h-screen noise-surface relative overflow-hidden transition-colors duration-[3000ms]">
      {/* Skip-link + main'in id/odak hedefi yoktu — SPA'da rota değişiminde
          ekran okuyucu/klavye kullanıcısı için navigasyon geri bildirimi
          hiç verilmiyordu (bkz. premium denetim, bölüm 2d). Odağın
          programatik taşınması AnimatedRoutes'ta (App.tsx) yapılır. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[10000] focus:px-5 focus:py-3 focus:rounded-2xl focus:bg-[var(--text-primary)] focus:text-[var(--app-bg)] focus:text-2xs focus:font-bold focus:uppercase focus:tracking-wide"
      >
        İçeriğe atla
      </a>

      {/* Google Neural Expressive: Global Circadian Background Auras */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <motion.div
          className="absolute top-[-10%] right-[-10%] w-[70%] h-[70%] blur-[180px] rounded-full opacity-[0.14] sm:opacity-[0.22] transition-all duration-[3000ms]"
          style={{
            background: 'radial-gradient(circle, var(--dynamic-aura, var(--aura-amber)) 0%, transparent 70%)',
          }}
        />
        <motion.div
          className="absolute bottom-[-10%] left-[-10%] w-[70%] h-[70%] blur-[180px] rounded-full opacity-[0.12] sm:opacity-[0.18] transition-all duration-[3000ms]"
          style={{
            background: 'radial-gradient(circle, var(--dynamic-aura-secondary, var(--aura-indigo)) 0%, transparent 70%)',
          }}
        />
      </div>

      <OfflineBanner />
      <GlobalNotifications />
      {/* Page Content */}
      {/* PWA install/iOS banner'ları nav dock'un ÜZERİNDE ayrıca yüzen sabit
          elemanlar — görünürken alttaki içerikle (ör. AnaEkranHero vakit
          matrisi) çakışmaması için ekstra alt boşluk eklenir. */}
      <main
        id="main-content"
        tabIndex={-1}
        className={`flex-1 w-full outline-none transition-all duration-300 relative z-10 ${
          isAdminRoute
            ? 'pb-0'
            : isIosPrompt
              ? 'pb-[calc(230px+env(safe-area-inset-bottom,0px))] md:pb-36'
              : isInstallable
                ? 'pb-[calc(150px+env(safe-area-inset-bottom,0px))] md:pb-36'
                : 'pb-[calc(96px+env(safe-area-inset-bottom,0px))] md:pb-36'
        }`}
      >
        {children}
      </main>

      {/* PWA Install Banner — sağ-alt köşede, dock'un ve içeriğin üstüne
          binmeyecek şekilde dar (maks. 320px); kapatıldığında 7 gün boyunca
          tekrar gösterilmez (bkz. usePWAInstall, görsel tasarım denetimi).
          Mobil bottom-offset FloatingDock.tsx'in gerçek yüksekliğiyle
          KASITLI olarak eşleştirilir: dock'un üst kenarı viewport altından
          `12px (bottom-[0.75rem]) + 64px (h-[64px])` = 76px'de. Eski 84px
          değeri yalnızca 8px pay bırakıyordu — aura/glow gölgeleri bu payı
          görsel olarak sıfırlayıp banner'ın dock'a yapışık görünmesine yol
          açıyordu (bkz. iPhone viewport denetimi). 100px, dock'un üst
          kenarıyla gerçek (~24px) bir nefes payı bırakır. Dock yüksekliği
          değişirse (FloatingDock.tsx satır ~309) bu değer de gözden
          geçirilmeli. */}
      <AnimatePresence>
        {isInstallable && (
          <motion.div
            initial={{ opacity: 0, y: 80 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 80 }}
            transition={{ type: 'spring', bounce: 0.3, duration: 0.5 }}
            className="fixed bottom-[calc(100px+env(safe-area-inset-bottom,0px))] sm:bottom-[110px] right-4 sm:right-6 max-w-[320px] z-[99] pointer-events-auto flex items-center gap-2"
          >
            <button
              onClick={install}
              className="flex items-center gap-2.5 px-5 py-3 bg-[var(--text-primary)] text-[var(--app-bg)] hover:opacity-90 text-sm font-semibold rounded-full shadow-[var(--spatial-shadow)] transition-all duration-200 touch-manipulation select-none whitespace-nowrap"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <Download size={16} strokeWidth={2.5} />
              Uygulamayı Yükle
            </button>
            <button
              onClick={dismissInstallPrompt}
              aria-label="Kapat"
              className="flex items-center justify-center w-11 h-11 bg-[var(--text-primary)] text-[var(--app-bg)] hover:opacity-90 rounded-full shadow-[var(--spatial-shadow)] transition-all duration-200 touch-manipulation select-none"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <X size={16} strokeWidth={2.5} />
            </button>
          </motion.div>
        )}

        {isIosPrompt && (
          <motion.div
            initial={{ opacity: 0, y: 80 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 80 }}
            transition={{ type: 'spring', bounce: 0.3, duration: 0.5 }}
            className="fixed bottom-[calc(100px+env(safe-area-inset-bottom,0px))] sm:bottom-[110px] left-4 right-4 sm:left-auto sm:right-6 sm:w-[320px] z-[99] pointer-events-auto bg-[var(--app-bg)]/95 backdrop-blur-xl border border-[var(--glass-border)] p-4 rounded-2xl shadow-[var(--spatial-shadow)] flex flex-col gap-3"
          >
            <button
              onClick={dismissIosPrompt}
              aria-label="Kapat"
              className="absolute top-2 right-2 p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-full"
            >
              <X size={16} />
            </button>
            <p className="text-sm font-semibold text-[var(--text-primary)] pr-6">Uygulamayı Ana Ekrana Ekleyin</p>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              iPhone cihazlarda <b>görev alarmlarını ve anlık bildirimleri sesli/yazılı alabilmek için</b> bu uygulamayı ana ekranınıza
              kurmanız gerekmektedir.
              <br />
              <br />
              Bunun için Safari altındaki <Share size={12} className="inline-block align-text-bottom mx-1 text-[var(--status-info)]" />{' '}
              <b>Paylaş</b> ikonuna dokunun, ardından aşağı kaydırıp <b>"Ana Ekrana Ekle"</b> seçeneğini seçin.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <FloatingDock />
    </div>
  );
}
