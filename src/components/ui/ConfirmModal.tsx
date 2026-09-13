import React from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { AlertTriangle } from 'lucide-react';
import { toTurkishUpperCase } from '../../lib/dateUtils';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Onayla',
  cancelText = 'Vazgeç',
  isDanger = false,
}: ConfirmModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="flex flex-col items-center text-center py-6">
        <div
          className={`w-20 h-20 rounded-icon flex items-center justify-center mb-10 border transition-all duration-700 ${
            isDanger
              ? 'bg-[var(--status-danger)]/10 border-[var(--status-danger)]/20 text-[var(--status-danger)] shadow-[0_0_25px_color-mix(in_srgb,var(--status-danger)_15%,transparent)] animate-float'
              : 'bg-[var(--status-warning)]/10 border-[var(--status-warning)]/20 text-[var(--status-warning)] shadow-[0_0_25px_color-mix(in_srgb,var(--status-warning)_15%,transparent)]'
          }`}
        >
          <AlertTriangle size={32} strokeWidth={1.2} />
        </div>

        {/* Önceden premium-label/uppercase (11px BÜYÜK HARF) taşıyordu — bu mesaj
        genellikle bir kişinin adını içeren, okunması gereken asıl onay
        cümlesi; büyük harf hem okunabilirliği düşürüyor hem
        toTurkishUpperCase()'in kendisi doğru çalışsa da "Ali" gibi özel
        isimleri "ALİ" gibi tuhaf gösteriyordu (bkz. premium denetim B10, Y2). */}
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed max-w-sm mb-12 px-4">{message}</p>

        <div className="flex items-center gap-4 w-full px-4">
          <Button variant={isDanger ? 'danger' : 'primary'} onClick={onConfirm} className="flex-1">
            {toTurkishUpperCase(confirmText)}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {toTurkishUpperCase(cancelText)}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
