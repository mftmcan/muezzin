import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

export function Modal({ isOpen, onClose, title, children, className = '', contentClassName = '' }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const dragControls = useDragControls();
  // `interactive-widget=resizes-content` (index.html) sanal klavye açıldığında
  // dvh birimlerini çoğu tarayıcıda otomatik küçültür, ama iOS Safari bu
  // meta değerini desteklemiyor — orada layout viewport sabit kalır ve
  // `max-h-[85dvh]` alt-sheet'i klavyenin ARKASINDA bırakır (bkz. premium
  // denetim B42, Y7). VisualViewport API, klavye açıkken gerçek görünür
  // yüksekliği veriyor; bunu bir fallback tavan olarak uyguluyoruz.
  const [viewportMaxHeight, setViewportMaxHeight] = useState<number | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !isOpen) return;
    const updateHeight = () => setViewportMaxHeight(vv.height);
    updateHeight();
    vv.addEventListener('resize', updateHeight);
    return () => vv.removeEventListener('resize', updateHeight);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
      dialogRef.current?.focus();
    } else {
      document.body.style.overflow = 'unset';
      previouslyFocusedRef.current?.focus();
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Focus trap yoktu — Tab ile odak arka plandaki içeriğe kaçıyordu
      // (bkz. premium denetim, bölüm 2d).
      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className={`fixed inset-0 z-[500] flex items-center justify-center p-0 sm:p-6 ${className}`}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 dark:bg-black/85 backdrop-blur-md"
          >
            {/* Modal-specific Ambient Aura */}
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] opacity-8 pointer-events-none transition-all duration-1000"
              style={{ background: 'radial-gradient(circle at 50% 50%, var(--dynamic-aura, var(--aura-indigo)), transparent 60%)' }}
            />
          </motion.div>

          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            drag="y"
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0.02, bottom: 0.85 }}
            onDragEnd={(e, info) => {
              if (info.offset.y > 140 || info.velocity.y > 450) {
                onClose();
              }
            }}
            initial={{ opacity: 0, scale: 0.95, y: 150 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 150 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28, mass: 1 }}
            className={`spatial-glass phi-padding w-full sm:max-w-2xl max-h-[85dvh] sm:max-h-[90dvh] flex flex-col overflow-hidden relative z-10 shadow-[var(--spatial-shadow)] mt-auto sm:mt-0 rounded-t-card rounded-b-none sm:rounded-card outline-none ${contentClassName}`}
            style={{
              paddingBottom: 'max(var(--phi-space), env(safe-area-inset-bottom, 0px))',
              ...(viewportMaxHeight ? { maxHeight: Math.round(viewportMaxHeight * 0.92) } : {}),
            }}
          >
            {/* Drag Handle Indicator for Mobile — only this handle starts the sheet drag
          (dragListener={false} above), so touch-scrolling the content below doesn't
          fight the dismiss gesture. */}
            <div
              onPointerDown={(e) => dragControls.start(e)}
              className="w-12 h-1 bg-[var(--text-primary)]/10 hover:bg-[var(--text-primary)]/20 rounded-full mx-auto mb-4 sm:hidden shrink-0 cursor-grab active:cursor-grabbing touch-none transition-colors"
            />

            <div className="flex justify-between items-start mb-6 sm:mb-10 shrink-0">
              <div>
                <h2 id={titleId} className="text-2xl sm:text-4xl font-light tracking-tight text-[var(--text-primary)] apple-thin">
                  {title}
                </h2>
              </div>
              <button
                onClick={onClose}
                aria-label="Kapat"
                className="w-11 h-11 sm:w-12 sm:h-12 bg-[var(--text-primary)]/[0.03] hover:bg-[var(--text-primary)]/[0.06] hover:text-[var(--dynamic-aura,var(--aura-indigo))] hover:border-[var(--dynamic-aura,var(--aura-indigo))]/40 hover:shadow-[0_0_15px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_20%,transparent)] rounded-[18px] sm:rounded-[20px] flex items-center justify-center border border-[var(--glass-border)] transition-all text-[var(--text-primary)]"
              >
                <X size={18} className="sm:hidden" strokeWidth={1.5} />
                <X size={20} className="hidden sm:block" strokeWidth={1} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 no-scrollbar pr-1">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
