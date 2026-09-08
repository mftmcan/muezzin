import React from 'react';
import { Modal } from './ui/Modal';
import { ShieldAlert, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { hapticMedium } from '../lib/haptic';
import { GpsHataTuru } from '../services/gpsVakitServisi';

interface GpsHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRetry: () => void;
  /** Önceden bu modal tek bir sabit "tarayıcı ayarlarından izin verin"
   *  mesajıyla açılıyordu — GeolocationPositionError'ın izin reddi DIŞINDAKİ
   *  kodlarında (konum belirlenemedi, zaman aşımı) veya API/ağ hatasında bu
   *  talimat yanlış ve işe yaramazdı (bkz. gpsHataTuruBelirle yorumu, beşinci
   *  denetim turu). Varsayılan 'izin_reddi' — geriye dönük uyumlu.  */
  hataTuru?: GpsHataTuru;
}

const HATA_METINLERI: Record<GpsHataTuru, { baslik: string; mesaj: string; talimatGoster: boolean; butonMetni: string }> = {
  izin_reddi: {
    baslik: 'Konum İzni Gerekli',
    mesaj: 'Konum erişimi tarayıcı veya cihaz ayarlarından engellenmiş.',
    talimatGoster: true,
    butonMetni: 'AYARLARI YAPTIM, TEKRAR DENE',
  },
  konum_belirlenemedi: {
    baslik: 'Konum Belirlenemedi',
    mesaj: 'Cihazınızın konumu şu anda belirlenemedi. GPS/konum servisinin açık olduğundan emin olup tekrar deneyin.',
    talimatGoster: false,
    butonMetni: 'TEKRAR DENE',
  },
  zaman_asimi: {
    baslik: 'Konum Alınamadı',
    mesaj: 'Konum alma işlemi zaman aşımına uğradı. Açık bir alanda veya daha güçlü bir sinyalde tekrar deneyin.',
    talimatGoster: false,
    butonMetni: 'TEKRAR DENE',
  },
  desteklenmiyor: {
    baslik: 'Konum Desteklenmiyor',
    mesaj: 'Bu cihaz veya tarayıcı konum özelliğini desteklemiyor. Bunun yerine ilçe bazlı vakitler kullanılabilir.',
    talimatGoster: false,
    butonMetni: 'TEKRAR DENE',
  },
  bilinmeyen: {
    baslik: 'Konum Vakitleri Alınamadı',
    mesaj: 'Konum vakitleri şu anda alınamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.',
    talimatGoster: false,
    butonMetni: 'TEKRAR DENE',
  },
};

export function GpsHelpModal({ isOpen, onClose, onRetry, hataTuru = 'izin_reddi' }: GpsHelpModalProps) {
  const { baslik, mesaj, talimatGoster, butonMetni } = HATA_METINLERI[hataTuru];
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={baslik}>
      <div className="flex flex-col items-center text-center py-2">
        {/* Warning Icon */}
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center justify-center mb-6 shrink-0">
          <ShieldAlert size={28} strokeWidth={1.5} />
        </div>

        <p className="text-base sm:text-lg font-light text-[var(--text-primary)] leading-normal mb-6">{mesaj}</p>

        {/* Browser Mock Address Bar visual guide — yalnızca izin reddi
            durumunda anlamlı (bkz. HATA_METINLERI.talimatGoster) */}
        {talimatGoster && (
          <div className="w-full max-w-sm border border-[var(--glass-border)] bg-[var(--text-primary)]/[0.02] rounded-2xl p-4 mb-8 text-left relative overflow-hidden">
            <div className="flex items-center gap-2 mb-3 opacity-60">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/60" />
              <span className="w-2.5 h-2.5 rounded-full bg-green-400/60" />
              <div className="flex-1 bg-[var(--text-primary)]/5 rounded-md h-5 flex items-center px-2 gap-1.5 ml-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                <span className="text-2xs font-mono opacity-50 truncate">muezzin.pro/anaekran</span>
              </div>
            </div>
            <ol className="text-2xs sm:text-xs text-[var(--text-secondary)]/85 space-y-2 list-decimal list-inside leading-relaxed">
              <li>
                Adres çubuğunun solundaki <strong>kilit 🔒 veya ayar ⚙️</strong> simgesine dokunun.
              </li>
              <li>
                <strong>Konum / Location</strong> seçeneğini bulun ve <strong>İzin Ver / Allow</strong> konumuna getirin.
              </li>
              <li>Ayarlar kaydedildikten sonra sayfayı yeniden yükleyin.</li>
            </ol>
          </div>
        )}

        {/* Actions */}
        <div className="w-full flex flex-col gap-3">
          <motion.button
            whileHover={{ scale: 1.02, y: -1 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              hapticMedium();
              onRetry();
            }}
            className="w-full py-5 rounded-avatar border-none bg-gradient-to-r from-amber-500 to-orange-600 hover:to-orange-500 text-[var(--text-primary)] font-bold tracking-wider cursor-pointer shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2"
          >
            <RefreshCw size={15} />
            <span>{butonMetni}</span>
          </motion.button>
        </div>
      </div>
    </Modal>
  );
}
