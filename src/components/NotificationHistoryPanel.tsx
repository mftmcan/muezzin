import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trash2, BellOff } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Modal } from './ui/Modal';
import { ConfirmModal } from './ui/ConfirmModal';
import { EmptyState } from './ui/EmptyState';
import { useNotificationStore } from '../store/useNotificationStore';
import { TYPE_CONFIG } from './ui/NotificationToast';

interface NotificationHistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NotificationHistoryPanel({ isOpen, onClose }: NotificationHistoryPanelProps) {
  const history = useNotificationStore((s) => s.history);
  const clearHistory = useNotificationStore((s) => s.clearHistory);
  // "Tümünü Temizle" önceden tek tıkla, onaysız geri alınamaz bir silme
  // yapıyordu — uygulamanın geri kalanındaki HER yıkıcı işlem (Duyuruyu Sil,
  // Kaydı Sil, Mazeret Kaydını Sil...) ConfirmModal ile korunurken burası tek
  // istisnaydı (bkz. kod denetimi).
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Bildirim Geçmişi">
      {history.length === 0 ? (
        <EmptyState
          icon={<BellOff size={28} strokeWidth={1.2} />}
          title="Henüz bildirim yok"
          description="Yeni bir bildirim geldiğinde burada listelenecek."
          size="md"
        />
      ) : (
        <div className="space-y-6">
          <div className="flex justify-end">
            <button
              onClick={() => setConfirmClearOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--glass-border)] text-[var(--text-secondary)] hover:text-[var(--status-danger)] hover:border-[var(--status-danger)]/30 text-2xs font-bold uppercase tracking-wide transition-all"
            >
              <Trash2 size={13} />
              Tümünü Temizle
            </button>
          </div>
          <ul className="space-y-3">
            {/* Toast'ın (bkz. NotificationToast.tsx) tip-özel ikon + sol kenar
                accent + giriş animasyonu görsel dili burada hiç yoktu — aynı
                bildirimin geçmiş kaydı canlı toast'tan görsel olarak kopuk,
                düz bir liste gibi duruyordu (bkz. premium standart denetimi).
                TYPE_CONFIG'i paylaşarak iki bileşen artık aynı dili konuşuyor. */}
            <AnimatePresence initial={false}>
              {history.map((entry, idx) => {
                const cfg = TYPE_CONFIG[entry.type] ?? TYPE_CONFIG.info;
                return (
                  <motion.li
                    key={entry.id}
                    layout
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: idx * 0.03 } }}
                    exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }}
                    transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                    className="flex items-start gap-3 p-4 rounded-2xl border border-[var(--glass-border)] bg-[var(--text-primary)]/[0.02] hover:bg-[var(--text-primary)]/[0.04] transition-colors"
                    style={{ borderLeftWidth: '3px', borderLeftColor: cfg.borderColor }}
                  >
                    <div className="flex-shrink-0 mt-0.5 flex items-center justify-center w-7 h-7 rounded-xl bg-[var(--text-primary)]/[0.03] border border-[var(--text-primary)]/5">
                      {cfg.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-xs font-medium text-[var(--text-primary)]">{entry.title}</h4>
                        <span className="text-2xs text-muted shrink-0">
                          {formatDistanceToNow(entry.timestamp, { addSuffix: true, locale: tr })}
                        </span>
                      </div>
                      <p className="text-2xs text-[var(--text-secondary)]/60 leading-relaxed mt-1">{entry.message}</p>
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmClearOpen}
        onClose={() => setConfirmClearOpen(false)}
        onConfirm={() => {
          clearHistory();
          setConfirmClearOpen(false);
        }}
        title="Tümünü Temizle"
        message="Bildirim geçmişindeki tüm kayıtlar bu cihazdan kalıcı olarak silinecektir. Bu işlem geri alınamaz."
        confirmText="Temizle"
        cancelText="Vazgeç"
        isDanger
      />
    </Modal>
  );
}
