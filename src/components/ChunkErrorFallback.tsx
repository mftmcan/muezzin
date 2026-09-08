import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { RefreshCw, WifiOff } from 'lucide-react';
import { isChunkLoadError } from '../lib/errorUtils';

interface ChunkErrorFallbackProps {
  error: Error;
  variant: 'fullPage' | 'inline';
  onReset?: () => void;
  /** Sadece tam sayfa (üst düzey route) varyantında anlamlı: chunk hatasında 1.5sn sonra
   * otomatik yenile, 15sn içinde tekrar tetiklenmesin diye localStorage kilidi kullan. */
  autoReload?: boolean;
}

export function ChunkErrorFallback({ error, variant, onReset, autoReload = false }: ChunkErrorFallbackProps) {
  const isChunkError = isChunkLoadError(error);
  // "Failed to fetch dynamically imported module" hatasının en yaygın gerçek nedeni
  // yeni bir deploy DEĞİL, sahadaki zayıf/kesik internet bağlantısıdır — önceden bu
  // durumda da yanıltıcı biçimde "yeni sürüm yayınlandı" mesajı gösteriliyordu.
  const [isOffline, setIsOffline] = useState(isChunkError && typeof navigator !== 'undefined' && !navigator.onLine);

  useEffect(() => {
    if (!isChunkError) return undefined;
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isChunkError]);

  useEffect(() => {
    if (!autoReload || !isChunkError) return undefined;

    // Çevrimdışıyken körü körüne yeniden denemek (ve tekrar başarısız olmak) yerine,
    // bağlantı geri gelene kadar bekleyip O ZAMAN yenile.
    if (isOffline) {
      const handleReconnect = () => window.location.reload();
      window.addEventListener('online', handleReconnect);
      return () => window.removeEventListener('online', handleReconnect);
    }

    // Sonsuz döngüyü engellemek için son reload zamanını kontrol et (15 saniye içinde tekrar reload etmez)
    const lastReload = localStorage.getItem('last-chunk-reload');
    const now = Date.now();
    if (!lastReload || now - parseInt(lastReload) > 15000) {
      localStorage.setItem('last-chunk-reload', now.toString());
      const timer = setTimeout(() => {
        window.location.reload();
      }, 1500); // 1.5 saniye sonra otomatik yenile
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [autoReload, isChunkError, isOffline]);

  const handleRestart = () => {
    onReset?.();
    window.location.reload();
  };

  if (variant === 'inline') {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center min-h-[50vh]">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="spatial-glass-elevated p-8 max-w-md w-full border-[var(--status-error)]/20"
        >
          <div className="w-16 h-16 bg-[var(--status-error)]/10 rounded-3xl flex items-center justify-center mb-6 mx-auto border border-[var(--status-error)]/20 shadow-[var(--spatial-shadow)]">
            <span className="text-[var(--status-error)] text-3xl font-light">!</span>
          </div>
          <h3 className="text-xl font-light text-[var(--text-primary)] tracking-tight mb-2 apple-thin">
            {isChunkError ? 'Yeni Sürüm Tespit Edildi' : 'Bileşen Yüklenemedi'}
          </h3>
          <p className="text-2xs text-[var(--text-secondary)]/70 leading-relaxed mb-6">
            {isChunkError
              ? 'Dizgede yeni bir güncelleme yayınlandığı için bu modülün yeniden yüklenmesi gerekiyor.'
              : 'Seçilen modül yüklenirken geçici bir hata oluştu.'}
          </p>
          <motion.button
            whileHover={{ scale: 1.02, y: -1 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleRestart}
            className="w-full py-4 bg-[var(--dynamic-aura,var(--aura-indigo))] hover:opacity-90 text-[var(--app-bg)] border border-[var(--dynamic-aura,var(--aura-indigo))]/60 rounded-xl font-bold text-2xs uppercase tracking-wide shadow-[0_10px_20px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_20%,transparent)] transition-all"
          >
            {isChunkError ? 'Sürümü Güncelle & Yenile' : 'Sayfayı Yeniden Yükle'}
          </motion.button>
        </motion.div>
      </div>
    );
  }

  // 'fullPage' variant — üst düzey route sınırı
  if (isChunkError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[var(--app-bg)] p-8 text-center noise-surface">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="spatial-glass-elevated p-12 max-w-lg w-full border-[var(--text-primary)]/10 shadow-[var(--spatial-shadow)]"
        >
          <div
            className={`relative w-20 h-20 rounded-[30px] flex items-center justify-center mb-8 mx-auto border shadow-[var(--spatial-shadow)] ${
              isOffline
                ? 'bg-[var(--status-warning)]/10 border-[var(--status-warning)]/20'
                : 'bg-[var(--dynamic-aura,var(--aura-indigo))]/10 border-[var(--dynamic-aura,var(--aura-indigo))]/20'
            }`}
          >
            {isOffline ? (
              <WifiOff size={28} className="text-[var(--status-warning)]" />
            ) : (
              <RefreshCw size={28} className="text-[var(--dynamic-aura,var(--aura-indigo))] animate-spin" />
            )}
            <div
              className={`absolute inset-0 blur-xl rounded-full opacity-30 ${isOffline ? 'bg-[var(--status-warning)]/20' : 'bg-[var(--dynamic-aura,var(--aura-indigo))]/20'}`}
            />
          </div>
          <h1 className="text-3xl font-light text-[var(--text-primary)] tracking-tight mb-4 apple-thin">
            {isOffline ? 'İnternet Bağlantınız Yok' : 'Yeni Güncelleme Uygulanıyor'}
          </h1>
          <p className="text-xs text-[var(--text-secondary)]/70 leading-relaxed mb-8">
            {isOffline
              ? 'Bir bölümün yüklenmesi bağlantı sorunu nedeniyle tamamlanamadı. Bağlantınız geri geldiğinde sayfa otomatik olarak devam edecek — beklerken diğer sekmelerdeki bilgiler önbellekten görüntülenmeye devam eder.'
              : "Müezzin Hizmet Dizgesi'nin en son sürümü yayınlandı. Arayüzünüz ve veri akışınızın kesintisiz çalışması için uygulama otomatik olarak yenileniyor..."}
          </p>
          <div className="flex flex-col gap-2">
            <span className="premium-label !text-2xs !opacity-30">
              {isOffline ? 'BAĞLANTI BEKLENİYOR' : 'OTOMATİK YENİLEME BAŞLATILDI'}
            </span>
            <span className="text-2xs text-muted font-mono">Bileşen: {error.message.split('assets/').pop()}</span>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[var(--app-bg)] p-8 text-center noise-surface">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="spatial-glass-elevated p-12 max-w-lg w-full border-[var(--status-error)]/20"
      >
        <div className="w-20 h-20 bg-[var(--status-error)]/10 rounded-[30px] flex items-center justify-center mb-8 mx-auto border border-[var(--status-error)]/20 shadow-[var(--spatial-shadow)]">
          <span className="text-[var(--status-error)] text-4xl">!</span>
        </div>
        <h1 className="text-3xl font-light text-[var(--text-primary)] tracking-tight mb-4 apple-thin">Dizgesel Bir Aksama Oluştu</h1>
        <p className="premium-label !text-2xs !opacity-20 mb-8">HATA AYRINTILARI</p>
        <pre className="text-2xs font-mono bg-[var(--text-primary)]/[0.03] p-6 rounded-3xl border border-[var(--glass-border)] text-[var(--status-error)]/80 overflow-auto w-full text-left leading-relaxed mb-10">
          {error.message}
        </pre>
        <motion.button
          whileHover={{ scale: 1.02, y: -2 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleRestart}
          className="w-full py-5 bg-[var(--text-primary)] text-[var(--app-bg)] rounded-2xl font-bold text-2xs uppercase tracking-wide shadow-[var(--spatial-shadow)] hover:opacity-90 transition-all"
        >
          Uygulamayı Yeniden Başlat
        </motion.button>
      </motion.div>
    </div>
  );
}
