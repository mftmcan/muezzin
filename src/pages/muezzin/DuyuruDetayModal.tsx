import { motion } from 'motion/react';
import { Modal } from '../../components/ui/Modal';
import type { Duyuru } from '../../hooks/useDuyurular';

interface DuyuruDetayModalProps {
  duyuru: Duyuru | null;
  onClose: () => void;
}

/**
 * Duyuru detay modalı ("Neural Expressive Bottom Sheet") — duyuru kartına
 * tıklanınca açılan tam metin tebliği. Okundu işaretleme (`markAsRead`)
 * ebeveyndeki kapatma geri çağırımında yapılır — localStorage sahipliği
 * MuezzinAnaEkran'a aittir.
 *
 * MuezzinAnaEkran.tsx'ten FE-001 bileşenleme çalışmasında çıkarıldı; JSX ve
 * animasyon değerleri birebir korundu (görsel regresyon sıfır fark hedefi).
 */
export function DuyuruDetayModal({ duyuru, onClose }: DuyuruDetayModalProps) {
  return (
    <Modal isOpen={!!duyuru} onClose={onClose} title={duyuru?.baslik || ''}>
      {duyuru && (
        <div className="flex flex-col py-2 relative">
          <div className="flex flex-col gap-1.5 mb-6 opacity-60">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--dynamic-aura,var(--aura-indigo))] animate-pulse" />
              <p className="text-2xs font-bold tracking-wide uppercase text-[var(--dynamic-aura,var(--aura-indigo))]">RESMİ TEBLİĞ</p>
            </div>
            <span className="text-2xs opacity-40 font-mono">BELGE NO: {duyuru.id?.slice(0, 8)?.toUpperCase() || 'BELİRSİZ'}</span>
          </div>

          <div className="max-h-[40vh] overflow-y-auto mb-8 pr-2 no-scrollbar">
            <p className="text-lg sm:text-xl font-light text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
              {duyuru.icerik}
            </p>
          </div>

          <motion.button
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.95 }}
            onClick={onClose}
            className="w-full py-5 border-none neural-btn cursor-pointer"
          >
            BİLGİ EDİNİLDİ
          </motion.button>
        </div>
      )}
    </Modal>
  );
}
