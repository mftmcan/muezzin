import { GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { isFirebaseSdkError } from '../lib/firestore-errors';
import { performLogout } from '../hooks/useFcmToken';
import { useState, useEffect } from 'react';
import React from 'react';
import { SplashLoader } from './SplashLoader';
import { motion, AnimatePresence } from 'motion/react';
import { useAuthStore } from '../store/useAuthStore';
import { LoginScreen } from './auth/LoginScreen';
import { AuthErrorScreen } from './auth/AuthErrorScreen';
import { PendingApprovalScreen } from './auth/PendingApprovalScreen';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const loading = useAuthStore((state) => state.loading);
  const isPending = useAuthStore((state) => state.isPending);
  const error = useAuthStore((state) => state.error);
  const disabledReason = useAuthStore((state) => state.disabledReason);
  const setError = useAuthStore((state) => state.setError);
  const setLoading = useAuthStore((state) => state.setLoading);

  const [isLoginInProgress, setIsLoginInProgress] = useState(false);
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  // Initialize Auth Store on mount to activate Firebase Auth listeners
  // Note: We do not unsubscribe the listener on unmount because the Auth store
  // is a global singleton, preventing React 18's StrictMode double-mounting in dev
  // from permanently cancelling the active Firebase Auth listeners.
  useEffect(() => {
    useAuthStore.getState().init();
  }, []);

  useEffect(() => {
    const checkRedirect = async () => {
      const isRedirectPending = sessionStorage.getItem('muezzin:auth_redirect_pending') === 'true';
      if (!isRedirectPending) return;

      try {
        const result = await getRedirectResult(auth);
        if (result?.user) {
          // Redirect login successful
        }
      } catch (err: unknown) {
        // Önceden hiç loglanmıyordu; console.error de kullanılmıyor —
        // vite.config.ts esbuild.drop production build'de TÜM console
        // çağrılarını siliyor (bkz. login()'deki aynı gerekçe). Kod
        // doğrudan mesaja ekleniyor.
        const kod = isFirebaseSdkError(err) ? err.code : 'bilinmeyen-hata';
        if (isFirebaseSdkError(err) && err.code === 'auth/unauthorized-domain') {
          setError('Bu alan adı (domain) henüz Firebase panelinde yetkilendirilmemiş. Lütfen yöneticiye başvurun.');
        } else {
          setError(`Giriş yapılırken bir sorun oluştu. Lütfen tekrar deneyin. [${kod}]`);
        }
      } finally {
        sessionStorage.removeItem('muezzin:auth_redirect_pending');
      }
    };
    checkRedirect();
  }, [setError]);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (loading) {
        setLoadingTimeout(true);
      }
    }, 4000); // 4 seconds is enough for a smooth splash, then we show retry/continue
    return () => clearTimeout(timer);
  }, [loading]);

  const logout = async () => {
    try {
      await performLogout();
      window.location.reload(); // Hard reset on logout
    } catch {
      // yoksay — logout en iyi çaba, çıkış başarısız olsa da kullanıcıyı bloklamaz
    }
  };

  const login = async () => {
    if (isLoginInProgress) return;
    setIsLoginInProgress(true);
    setError(null);

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: 'select_account',
      });

      // Try popup first (faster experience)
      try {
        await signInWithPopup(auth, provider);
      } catch (popupErr: unknown) {
        // If popup is blocked or fails, fallback to redirect.
        // 'auth/internal-error' EKLENDİ: bu, popup + postMessage el sıkışması
        // üçüncü taraf çerez/depolama erişimi gerektirdiğinden, tarayıcının
        // (Chrome/Safari'nin giderek varsayılan hale gelen gizlilik
        // kısıtlamaları) bunu engellediği durumda Firebase'in verdiği GENEL
        // hata koduydu — canlıda "Giriş yapılamadı" olarak görünüyordu (bkz.
        // premium denetim, login ekranı canlı arıza teşhisi). Redirect (tam
        // sayfa yönlendirme) bu üçüncü taraf bağımlılığını taşımaz.
        const popupYerineDeneRedirect =
          isFirebaseSdkError(popupErr) &&
          (popupErr.code === 'auth/popup-blocked' ||
            popupErr.code === 'auth/cancelled-popup-request' ||
            popupErr.code === 'auth/internal-error' ||
            popupErr.code === 'auth/web-storage-unsupported');
        if (popupYerineDeneRedirect) {
          sessionStorage.setItem('muezzin:auth_redirect_pending', 'true');
          await signInWithRedirect(auth, provider);
        } else {
          throw popupErr;
        }
      }
    } catch (e: unknown) {
      // Önceden hiç loglanmıyordu — kullanıcıya gösterilen genel mesajın
      // ARDINDAKİ gerçek Firebase hata kodu (auth/...) hiçbir yerde
      // görünmüyordu (bkz. premium denetim, login ekranı incelemesi — canlı
      // bir giriş arızası teşhis edilemez hale geliyordu). console.error
      // KASITLI OLARAK kullanılmıyor: vite.config.ts esbuild.drop production
      // build'de TÜM console çağrılarını siliyor, DevTools'ta hiç görünmez —
      // bu yüzden kod doğrudan (geçici olarak) hata mesajının içine ekleniyor.
      const kod = isFirebaseSdkError(e) ? e.code : 'bilinmeyen-hata';
      if (isFirebaseSdkError(e) && e.code === 'auth/unauthorized-domain') {
        setError('Bu alan adı (domain) yetkilendirilmemiş. Lütfen localhost veya kayıtlı alan adını kullanın.');
      } else if (!isFirebaseSdkError(e) || e.code !== 'auth/popup-closed-by-user') {
        setError(`Giriş yapılamadı. Lütfen internet bağlantınızı ve Google hesabınızı kontrol edin. [${kod}]`);
      }
    } finally {
      setIsLoginInProgress(false);
    }
  };

  return (
    <>
      <AnimatePresence mode="popLayout">
        {loading && (
          <motion.div
            key="splash-overlay"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.96, filter: 'blur(15px)' }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[var(--app-bg)] text-center p-6"
          >
            <SplashLoader />
            {loadingTimeout && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-8 spatial-glass p-6 max-w-sm border-amber-500/20 z-[10000] relative pointer-events-auto"
              >
                {/* isOffline zaten hesaplanıyordu ama hiç render'a
                    bağlanmamıştı — çevrimdışı ve gerçekten yavaş bir sunucu
                    durumu için AYNI belirsiz mesaj gösteriliyordu; kullanıcı
                    çevrimdışıyken "yeniden dene"ye bassa da neden aynı
                    sonucu aldığını anlayamıyordu (bkz. ChunkErrorFallback.tsx'in
                    doğru yaptığı aynı ayrım, mimari denetim). */}
                <p className="text-amber-500 text-xs font-medium mb-4">
                  {isOffline
                    ? 'İnternet bağlantınız yok. Bağlantı geri gelince otomatik devam edecektir.'
                    : 'Bağlantı beklenenden yavaş sürüyor...'}
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => window.location.reload()}
                    className="text-2xs uppercase tracking-wide text-[var(--dynamic-aura,var(--aura-indigo))] font-bold hover:text-[var(--dynamic-aura,var(--aura-indigo))] transition-colors cursor-pointer border-none bg-transparent"
                  >
                    SAYFAYI YENİLE
                  </button>
                  <button
                    onClick={() => {
                      setLoading(false);
                      setLoadingTimeout(false);
                    }}
                    className="text-2xs uppercase tracking-wide text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer border-none bg-transparent"
                  >
                    Giriş Ekranına Devam Et
                  </button>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {!loading && (
        <motion.div
          key="auth-content"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="w-full min-h-screen"
        >
          {disabledReason ? (
            // setError bilerek geçilmiyor: bu durum sunucu tarafından
            // (aktif:false) belirleniyor ve yalnızca canlı muezzins/{uid}
            // dinleyicisi hesabı yeniden aktif görünce kendiliğinden
            // temizleniyor (bkz. useAuthStore). Dismiss edilebilir olsaydı
            // devre dışı hesap "TEKRAR DENE" ile tam uygulamaya sızardı.
            <AuthErrorScreen error={disabledReason} setLoading={setLoading} logout={logout} />
          ) : error ? (
            <AuthErrorScreen error={error} setError={setError} setLoading={setLoading} logout={logout} />
          ) : isPending ? (
            <PendingApprovalScreen logout={logout} />
          ) : !user ? (
            <LoginScreen login={login} isLoginInProgress={isLoginInProgress} />
          ) : (
            children
          )}
        </motion.div>
      )}
    </>
  );
}
