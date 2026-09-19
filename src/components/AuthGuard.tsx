import { GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { isFirebaseSdkError } from '../lib/firestore-errors';
import { performLogout } from '../hooks/useFcmToken';
import { telemetryService } from '../services/telemetryService';
import { girisTanisiEkle, redirectBaslatildiIsaretle, redirectDamgasiniCekVeTemizle } from '../lib/girisTanisi';
import { girisYoluSec, popupHatasiniDegerlendir, redirectSonucunuDegerlendir } from '../lib/girisStratejisi';
import { LOADING_UYARI_MS, POPUP_MS } from '../lib/authTimeouts';
import { useState, useEffect } from 'react';
import React from 'react';
import { SplashLoader } from './SplashLoader';
import { motion, AnimatePresence } from 'motion/react';
import { useAuthStore } from '../store/useAuthStore';
import { LoginScreen } from './auth/LoginScreen';
import { AuthErrorScreen } from './auth/AuthErrorScreen';
import { PendingApprovalScreen } from './auth/PendingApprovalScreen';
import { OturumBelirsizEkrani } from './auth/OturumBelirsizEkrani';
import { EASE } from '../lib/motion';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const loading = useAuthStore((state) => state.loading);
  const isPending = useAuthStore((state) => state.isPending);
  const error = useAuthStore((state) => state.error);
  const disabledReason = useAuthStore((state) => state.disabledReason);
  const setError = useAuthStore((state) => state.setError);
  const setLoading = useAuthStore((state) => state.setLoading);
  // "Oturum durumunu henüz bilmiyoruz" — `user === null`'dan AYRI (bkz.
  // useAuthStore.ts'teki alan tanımı). Cold-start failsafe tetiklendiğinde
  // true olur; geç gelen `onAuthStateChanged` onu kendiliğinden temizler.
  const authDogrulanamadi = useAuthStore((state) => state.authDogrulanamadi);
  const authBeklemeyiGec = useAuthStore((state) => state.authBeklemeyiGec);

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
    // ESKİDEN bir sessionStorage bayrağı ('muezzin:auth_redirect_pending')
    // set edilmeden getRedirectResult HİÇ çağrılmıyordu. Google'ın çok
    // adımlı yönlendirme zincirinde (uygulama → firebaseapp.com/__/auth/
    // handler → accounts.google.com → tekrar handler → uygulama) bu bayrak
    // bazı mobil tarayıcılarda (ör. Opera'nın veri tasarrufu/proxy modu)
    // hayatta kalmıyor — bayrak kaybolunca redirect SONUÇLANMIŞ olsa bile
    // hiç okunmuyor, kullanıcı oturum açılmadan login ekranına geri
    // dönüyordu (bkz. canlı arıza: redirect'ten sonra tekrar login ekranı).
    // getRedirectResult bekleyen bir redirect yokken de ucuz şekilde
    // null'a çözülüyor, o yüzden koşulsuz her mount'ta çağırmak güvenli.
    const checkRedirect = async () => {
      // Damga yalnızca `login()`'in `signInWithRedirect` çağırmadan hemen
      // önce yazdığı bir işarettir — "bekleyen bir redirect gerçekten vardı"
      // anlamına gelir. Damgasız bir `null` sonucu (ör. login ekranının ilk
      // açılışı, hiç redirect başlatılmamışken) tamamen normaldir.
      const bekleyenRedirectDamgasi = redirectDamgasiniCekVeTemizle();
      try {
        const result = await getRedirectResult(auth);
        if (result?.user) {
          telemetryService.addBreadcrumb('giris: redirect basarili', 'user_action');
        } else if (bekleyenRedirectDamgasi) {
          // Redirect başlatılmıştı ama ne bir kullanıcı ne de bir hata
          // döndü — 3rd-party depolama/ITP engelinin tipik SESSİZ
          // başarısızlık imzası (bkz. AuthGuard.tsx login()'deki aynı
          // gerekçe, ve d0fffba'nın çözdüğü canlı arızanın kökü).
          girisTanisiEkle({ asama: 'redirect-tamamlanmadi', kod: 'sessiz-basarisiz-sonuc-yok' });
          setError("Google'dan geri dönüldü ama oturum kurulamadı. Tarayıcınız üçüncü taraf çerez/depolama erişimini kısıtlıyor olabilir.");
        }
      } catch (err: unknown) {
        // vite.config.ts artık console.error'ı production'da SİLMİYOR (bkz.
        // esbuild.pure) — bu yüzden burada console.error de bırakılabilir,
        // ama asıl teşhis kanalı oturum kurulana kadar hayatta kalan
        // girisTanisi kaydı: bu çağrı OTURUMSUZ aşamada olduğundan
        // telemetryService.logError (auth.currentUser gerektirir) henüz
        // çalışamaz.
        const kod = isFirebaseSdkError(err) ? err.code : 'bilinmeyen-hata';
        console.error('getRedirectResult hatası:', kod, err);
        girisTanisiEkle({ asama: 'redirect-sonuc', kod, mesaj: err instanceof Error ? err.message : undefined });

        // Karar `girisStratejisi.ts`'teki saf fonksiyondan gelir (bkz.
        // tests/unit/girisStratejisi.test.ts) — ağ sınıfı hatalar (offline,
        // zaman aşımı) BİLGİ TAŞIMAZ: zaten oturumu geçerli, offline açılan
        // bir PWA kullanıcısında bu hata atılabilir ve `error` dalı karar
        // zincirinde `children`'dan ÖNCE geldiği için (bkz. render bloğu)
        // kullanıcı yanlışlıkla hata ekranına düşürülüyordu — canlıda
        // gözlemlenen bir arıza.
        if (redirectSonucunuDegerlendir(kod) === 'sadece-logla') {
          return;
        }

        if (isFirebaseSdkError(err) && err.code === 'auth/unauthorized-domain') {
          setError('Bu alan adı (domain) henüz Firebase panelinde yetkilendirilmemiş. Lütfen yöneticiye başvurun.');
        } else {
          setError(`Giriş yapılırken bir sorun oluştu. Lütfen tekrar deneyin. [${kod}]`);
        }
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
    }, LOADING_UYARI_MS);
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
    const isMobileTarayici = /android|iphone|ipad|ipod/i.test(navigator.userAgent);

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: 'select_account',
      });

      // Yol kararı `girisStratejisi.ts`'teki saf fonksiyondan gelir (bkz.
      // tests/unit/girisStratejisi.test.ts). `authDomain` artık hosting ile
      // aynı origin olduğundan (commit 4f39745) popup'ın tarihsel var oluş
      // gerekçesi (3rd-party storage/ITP kısıtı) ortadan kalktı — bugün
      // `girisYoluSec` her zaman 'redirect' döner (`POPUP_DENE=false`).
      // Popup kodu SİLİNMEDİ: `POPUP_DENE=true` yapılırsa (masaüstü boot
      // maliyeti kötü çıkarsa) aşağıdaki dal hemen devreye girer.
      const yol = girisYoluSec(isMobileTarayici);

      if (yol === 'redirect') {
        telemetryService.addBreadcrumb(isMobileTarayici ? 'giris: mobil redirect baslatildi' : 'giris: redirect baslatildi', 'user_action');
        redirectBaslatildiIsaretle();
        await signInWithRedirect(auth, provider);
        return;
      }

      // Try popup first (faster experience)
      telemetryService.addBreadcrumb('giris: popup denendi', 'user_action');
      try {
        // Bazı taraytıcılarda (masaüstü Safari, Brave, sıkı gizlilik modundaki
        // Firefox) üçüncü taraf depolama engeli signInWithPopup'ın postMessage
        // el sıkışmasını NE HATA FIRLATACAK NE DE SONUÇLANACAK şekilde
        // kırıyor — bu yüzden hatasız-askıda-kalma ihtimaline karşı genel
        // bir zaman aşımı şart. Süre dolunca popup hâlâ açık kalabilir
        // (kapatma referansımız yok) ama ana sekme redirect ile devam eder.
        await Promise.race([
          signInWithPopup(auth, provider),
          new Promise((_resolve, reject) => setTimeout(() => reject({ code: 'auth/popup-timeout' }), POPUP_MS)),
        ]);
      } catch (popupErr: unknown) {
        const popupKod = isFirebaseSdkError(popupErr) ? popupErr.code : 'bilinmeyen-hata';
        // DENYLIST (allowlist DEĞİL, bkz. girisStratejisi.ts): yalnızca
        // gerçek kullanıcı iptali ve config hatası redirect denemez —
        // BİLİNMEYEN her hata kodu otomatik olarak redirect-fallback alır.
        if (popupHatasiniDegerlendir(popupKod) === 'redirect-fallback') {
          telemetryService.addBreadcrumb(`giris: popup hatasi ${popupKod}, redirect fallback`, 'user_action');
          redirectBaslatildiIsaretle();
          await signInWithRedirect(auth, provider);
        } else {
          throw popupErr;
        }
      }
    } catch (e: unknown) {
      // vite.config.ts artık console.error'ı production'da SİLMİYOR (bkz.
      // esbuild.pure) — ama asıl kalıcı teşhis kanalı, oturum kurulana kadar
      // hayatta kalan girisTanisi kaydı: giriş bu aşamada henüz oturumsuz
      // olduğundan telemetryService.logError (auth.currentUser gerektirir)
      // burada hiç çalışamaz; kayıt useAuthStore'da oturum kurulunca flush
      // edilir.
      const kod = isFirebaseSdkError(e) ? e.code : 'bilinmeyen-hata';
      console.error('Giriş hatası:', kod, e);
      girisTanisiEkle({ asama: isMobileTarayici ? 'redirect-baslat' : 'popup', kod, mesaj: e instanceof Error ? e.message : undefined });
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
            transition={{ duration: 0.55, ease: EASE.out }}
            className="fixed inset-0 z-[var(--z-splash)] flex flex-col items-center justify-center bg-[var(--app-bg)] text-center p-6"
          >
            <SplashLoader />
            {loadingTimeout && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-8 spatial-glass p-6 max-w-sm border-amber-500/20 z-10 relative pointer-events-auto"
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
          transition={{ duration: 0.55, delay: 0.1, ease: EASE.out }}
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
          ) : authDogrulanamadi && !user ? (
            // `!user` dalından ÖNCE gelmeli: aksi halde bu durum yine
            // "giriş yapılmamış" diye okunurdu. Cold-start failsafe
            // tetiklendiğinde `user` null'dır ama bu bir CEVAP değil,
            // cevabın henüz gelmemiş olmasıdır — gerçekte oturumu açık olan
            // bir kullanıcıyı çıkış yapmış gibi göstermek yerine durumu
            // olduğu gibi anlatıp iki çıkış yolu bırakıyoruz. Erişim
            // GENİŞLEMİYOR: kullanıcı hâlâ `children`'a alınmıyor.
            <OturumBelirsizEkrani isOffline={isOffline} girisEkraninaGec={authBeklemeyiGec} />
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
