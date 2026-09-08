interface LoadingStateProps {
  /** Yükleme sırasında gösterilecek etiket (küçük harfle de yazılabilir — bileşen görsel olarak uppercase uygular). */
  label: string;
  /** Dış konteynerin yüksekliği — ekranın tipik içerik yüksekliğine göre ayarlanır. */
  heightClassName?: string;
  /** Spinner boyutu. */
  size?: 'md' | 'lg';
}

/**
 * Uygulama genelindeki "veri yükleniyor" ekranlarının ortak spinner+etiket
 * bloğu — önceden yalnızca admin panelinde (`AdminLoadingState`, 11
 * tüketici) sistematize edilmişti, müezzin tarafı (`App.tsx` Suspense
 * fallback'i, `HaftalikTakvim.tsx` vb.) elle kopyalanmış ayrı bir iskelet
 * kullanıyordu (bkz. premium denetim, bölüm 4).
 */
export function LoadingState({ label, heightClassName = 'h-[500px]', size = 'md' }: LoadingStateProps) {
  const spinnerSizeClass = size === 'lg' ? 'w-14 h-14' : 'w-12 h-12';

  return (
    <div className={`flex ${heightClassName} items-center justify-center`}>
      <div className="flex flex-col items-center gap-6">
        <div
          className={`${spinnerSizeClass} border-4 border-[var(--dynamic-aura,var(--aura-indigo))]/10 border-t-[var(--dynamic-aura,var(--aura-indigo))] rounded-full animate-spin shadow-[var(--spatial-shadow)]`}
        />
        <p className="authority-title !text-2xs opacity-30 tracking-wide uppercase">{label}</p>
      </div>
    </div>
  );
}
