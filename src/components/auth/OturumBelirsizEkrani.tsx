import React from 'react';
import { motion } from 'motion/react';
import { WifiOff, Loader2 } from 'lucide-react';
import { TaniKopyalaDugmesi } from './TaniKopyalaDugmesi';

interface OturumBelirsizEkraniProps {
  /** `navigator.onLine` durumu — AuthGuard zaten izliyor, buraya geçiliyor. */
  isOffline: boolean;
  /** Kullanıcı beklemekten vazgeçip giriş ekranına geçmek istediğinde. */
  girisEkraninaGec: () => void;
}

/**
 * "Oturum durumunuzu HENÜZ BİLMİYORUZ" ekranı.
 *
 * `useAuthStore`'un 4.5 sn'lik cold-start failsafe'i `onAuthStateChanged` hiç
 * ateşlenmeden devreye girdiğinde gösterilir. ÖNCEDEN bu durumda doğrudan
 * `LoginScreen` render ediliyordu — yani Firebase Auth SDK'sı yalnızca yavaş
 * davranırken (ağ gecikmesi, kilitli/yavaş IndexedDB) oturumu AÇIK olan bir
 * kullanıcıya "çıkış yapmışsınız" deniyordu. Bu ekran aynı belirsizliği
 * dürüstçe anlatır ve tıkanmayı önlemek için iki çıkış yolu bırakır.
 *
 * Bu bir "yükleniyor" ekranı DEĞİL, bilinçli bir ara durumdur: arka planda
 * oturum dinleyicisi çalışmaya devam eder, geç gelen bir yanıt bu ekranı
 * kendiliğinden kapatır (bkz. useAuthStore → handleAuthStateChange, bayrağı
 * temizler).
 *
 * Metin/yerleşim idiyomu AuthErrorScreen/PendingApprovalScreen ile aynı
 * tutuldu; çevrimdışı ile "yavaş" ayrımı AuthGuard'ın splash kartındaki
 * mevcut ayrımın aynısıdır (bkz. ChunkErrorFallback'in de yaptığı ayrım).
 */
export function OturumBelirsizEkrani({ isOffline, girisEkraninaGec }: OturumBelirsizEkraniProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--app-bg)] p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full spatial-glass rounded-card shadow-[var(--spatial-shadow)] p-10 text-center border border-[var(--glass-border)]"
      >
        <div className="w-20 h-20 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-8">
          {isOffline ? <WifiOff className="w-10 h-10 text-amber-500" /> : <Loader2 className="w-10 h-10 text-amber-500 animate-spin" />}
        </div>
        <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-4 tracking-tight">
          {isOffline ? 'Bağlantı Yok' : 'Bağlantı Kuruluyor'}
        </h2>
        {/* Gövde kopyası: cümle düzeni, normal boyut — `authority-title`/
            uppercase yalnızca tek satırlık etiketlerde (bkz. CLAUDE.md). */}
        <p className="text-sm text-muted leading-relaxed mb-8">
          {isOffline
            ? 'İnternet bağlantınız yok, bu yüzden oturumunuz doğrulanamıyor. Bağlantı geri geldiğinde otomatik olarak devam edilecektir.'
            : 'Oturum bilginiz beklenenden yavaş geliyor. Henüz çıkış yapmış sayılmıyorsunuz — bağlantı kurulur kurulmaz kaldığınız yerden devam edeceksiniz.'}
        </p>
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            // Doygun dolgu üzerine `text-[var(--app-bg)]` — ışık temasında
            // `--text-primary` bu zeminde WCAG'ı geçmiyor (bkz. CLAUDE.md).
            className="w-full h-14 bg-[var(--dynamic-aura,var(--aura-indigo))] hover:opacity-90 text-[var(--app-bg)] rounded-2xl font-medium shadow-lg shadow-[color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_20%,transparent)] transition-all"
          >
            SAYFAYI YENİLE
          </button>
          {/* Gerçekten çıkış yapmış AMA ağı da kötü olan kullanıcı bu ekranda
              tıkanmamalı — giriş düğmesine ulaşmasının tek yolu bu. */}
          <button
            type="button"
            onClick={girisEkraninaGec}
            className="w-full h-14 bg-[var(--text-primary)]/5 text-[var(--text-primary)] rounded-2xl font-medium hover:bg-[var(--text-primary)]/10 transition-all"
          >
            GİRİŞ EKRANINA GEÇ
          </button>
          <TaniKopyalaDugmesi error={isOffline ? 'Oturum belirsiz: çevrimdışı' : 'Oturum belirsiz: cold-start failsafe tetiklendi'} />
        </div>
      </motion.div>
    </div>
  );
}
