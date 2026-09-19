import { useState } from 'react';
import { ClipboardCopy, Check } from 'lucide-react';
import { girisTanisiniOku } from '../../lib/girisTanisi';

/**
 * Telemetri yapısal olarak "kullanıcı hiç giriş yapamıyor" senaryosunu
 * kapsayamaz (bkz. useAuthStore.ts flush yorumu — kayıtlar yalnızca BAŞARILI
 * girişte Firestore'a yazılır). Bu düğme o boşluğu kapatır: `error`/`hataKodu`
 * içeren kalıcı bir kilitlenmede kullanıcı tanı bilgisini panoya kopyalayıp
 * yöneticiye (WhatsApp vb.) iletebilir.
 */
export function TaniKopyalaDugmesi({ error }: { error: string }) {
  const [kopyalandi, setKopyalandi] = useState(false);

  const kopyala = async () => {
    const tani = {
      hataMesaji: error,
      girisTanisi: girisTanisiniOku(),
      ua: navigator.userAgent,
      pwaMi: window.matchMedia('(display-mode: standalone)').matches,
      cevrimici: navigator.onLine,
      appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'bilinmeyen',
      zaman: new Date().toISOString(),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(tani, null, 2));
      setKopyalandi(true);
      setTimeout(() => setKopyalandi(false), 2000);
    } catch {
      // Panoya erişim reddedilmiş olabilir (izin, http bağlamı) — sessizce
      // yoksay, bu düğme en iyi çaba niteliğindedir.
    }
  };

  return (
    <button
      type="button"
      onClick={kopyala}
      className="w-full h-11 flex items-center justify-center gap-2 text-2xs uppercase tracking-wide text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer border-none bg-transparent"
    >
      {kopyalandi ? (
        <>
          <Check className="w-3.5 h-3.5" />
          Kopyalandı
        </>
      ) : (
        <>
          <ClipboardCopy className="w-3.5 h-3.5" />
          Tanı Bilgisini Kopyala
        </>
      )}
    </button>
  );
}
