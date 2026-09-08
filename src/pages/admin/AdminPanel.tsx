import React, { useState, useEffect, lazy, Suspense, useMemo, useCallback } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LogOut, X } from 'lucide-react';
import { performLogout } from '../../hooks/useFcmToken';
import { useKrizAlarmlariStore } from '../../store/useKrizAlarmlariStore';
import { useAdminIzinlerStore } from '../../store/useAdminIzinlerStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useMuezzinStore } from '../../store/useMuezzinStore';
import { motion, AnimatePresence } from 'motion/react';
import { useThemeStore } from '../../store/useThemeStore';
import { useNotificationStore } from '../../store/useNotificationStore';

import { useEzanVakitleri } from '../../hooks/useEzanVakitleri';
import { useMevcutVakit } from '../../hooks/useMevcutVakit';
import { getActiveAuraColor } from '../../lib/auraTheme';
import { IslamicGeometricBg } from '../../components/ui/IslamicGeometricBg';
import { playClick } from '../../lib/sounds';
import { ChunkErrorFallback } from '../../components/ChunkErrorFallback';
import { toError } from '../../lib/errorUtils';

import { SlimSidebar } from './components/SlimSidebar';
import ExecutiveHeroScreen from './modules/ExecutiveHeroScreen';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { PageSkeleton, Skeleton } from '../../components/ui/Skeleton';
import { toActiveModule, type ActiveModule } from './config/navConfig';

const HaftalikCizelge = lazy(() => import('./modules/HaftalikCizelge'));
const KrizAlarmlari = lazy(() => import('./modules/KrizAlarmlari'));
const SistemAnalitigi = lazy(() => import('./modules/SistemAnalitigi'));
const PersonelHub = lazy(() => import('./modules/PersonelHub'));
const AyarlarHub = lazy(() => import('./modules/AyarlarHub'));
const DuyuruYonetimi = lazy(() => import('./modules/DuyuruYonetimi').then((m) => ({ default: m.DuyuruYonetimi })));

export default function AdminPanel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = toActiveModule(searchParams.get('tab'));

  const [isPending, startTransition] = React.useTransition();

  const setActiveTab = useCallback(
    (tab: ActiveModule, subtab?: string) => {
      startTransition(() => {
        setSearchParams((prev) => {
          const newParams = new URLSearchParams(prev);
          newParams.set('tab', tab);
          if (subtab) {
            newParams.set('subtab', subtab);
          } else {
            newParams.delete('subtab');
          }
          newParams.delete('sub');
          return newParams;
        });
      });
    },
    [setSearchParams, startTransition]
  );

  const prefetchTab = (tab: ActiveModule) => {
    switch (tab) {
      case 'planlama':
        import('./modules/HaftalikCizelge');
        break;
      case 'ekip':
        import('./modules/PersonelHub');
        break;
      case 'ayarlar':
        import('./modules/AyarlarHub');
        break;
    }
  };

  // Soğuk sayfa yüklemesinde de (ör. paylaşılan bir ?sub= linkine doğrudan
  // girildiğinde) drawer'ın açık başlaması için ilk değer URL'den türetilir —
  // aşağıdaki efekt yalnızca SONRAKİ ?sub= değişimlerini yakalar.
  const [drawerContent, setDrawerContent] = useState<'alarmlar' | 'duyurular' | null>(() => {
    const initial = searchParams.get('sub');
    return initial === 'alarmlar' || initial === 'duyurular' ? initial : null;
  });
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const navigate = useNavigate();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const authLoading = useAuthStore((s) => s.loading);

  // Stats & States
  const muezzinlerLength = useMuezzinStore(
    (s) => s.muezzinler.filter((m) => m.role === 'muezzin' && m.aktif === true && m.arsivlendi !== true).length
  );
  const cozulmamisSayisi = useKrizAlarmlariStore((s) => s.cozulmamisSayisi);
  const pendingIzinler = useAdminIzinlerStore((s) => s.izinler.filter((i) => i.durum === 'onay_bekliyor').length);
  // Hero kartlarındaki sayılar ilk Firestore snapshot'ı gelene kadar "0" göstermesin diye
  // (bu, "uyarı/izin yok" ile karıştırılabiliyordu) — bkz. store'ların kendi `loading` bayrağı.
  // Not: her hook ayrı çağrılır — `||` ile zincirlemek kısa devre nedeniyle
  // sonraki hook'ları koşullu atlatır (Rules of Hooks ihlali).
  const muezzinlerLoading = useMuezzinStore((s) => s.loading);
  const alarmlarLoading = useKrizAlarmlariStore((s) => s.loading);
  const izinlerLoading = useAdminIzinlerStore((s) => s.loading);
  const statsLoading = muezzinlerLoading || alarmlarLoading || izinlerLoading;

  // Admin paneline özgü, tüm alt sekmeler arasında paylaşılan tek abonelikler.
  // StoreInitializer'daki global store'larla aynı yaklaşım: dönen unsubscribe
  // kasıtlı olarak çağrılmaz, `initialized` bayrağı yalnızca aynı oturumda
  // (StrictMode çift-mount dahil) tekrar abone olunmasını engeller.
  // `isAdmin`'e bağımlı: eskiden koşulsuz çalışıyordu, yani /admin'e manuel
  // giden yetkisiz bir kullanıcı için (ya da auth henüz çözülmemişken) admin-
  // scope sorgular deneniyordu — Firestore kuralları bunu doğru reddediyor
  // (veri sızmıyor) ama gereksiz PERMISSION_DENIED hatası/dinleyici
  // üretiyordu (bkz. yetki denetimi). isAdmin sonradan true olursa (auth
  // async çözüldüğünde) efekt yeniden çalışıp abonelik başlatır.
  useEffect(() => {
    if (!isAdmin) return;
    useKrizAlarmlariStore.getState().init();
    useAdminIzinlerStore.getState().init();
  }, [isAdmin]);

  // Sirkadiyen Aura Entegrasyonu
  const { bugunVakitler } = useEzanVakitleri();
  const mevcutVakit = useMevcutVakit(bugunVakitler);

  // URL'deki ?sub= parametresi değiştiğinde drawer'ı render sırasında aç —
  // drawerContent programatik olarak da açılabildiği için (bkz. onOpenDrawer)
  // tamamen türetilmiş bir değer olamaz, bu yüzden "izlenen anahtar
  // değişince state ayarla" deseni kullanılıyor (bkz. useBugunkuGorevlerim.ts).
  const subParam = searchParams.get('sub');
  const [lastSubParam, setLastSubParam] = useState(subParam);
  if (subParam !== lastSubParam) {
    setLastSubParam(subParam);
    if (subParam === 'alarmlar' || subParam === 'duyurular') {
      setDrawerContent(subParam);
    }
  }

  const closeDrawer = () => {
    setDrawerContent(null);
    setSearchParams((prev) => {
      const newParams = new URLSearchParams(prev);
      newParams.delete('sub');
      return newParams;
    });
  };

  // Aktif vakte göre ana aura rengi (bkz. src/lib/auraTheme.ts) — bu sayfanın
  // alt ağacındaki düğme/rozet gibi ön-plan öğeleri için --dynamic-aura'yı
  // yerel olarak override eder.
  const activeAuraColor = useMemo(() => getActiveAuraColor(mevcutVakit), [mevcutVakit]);

  useEffect(() => {
    if (!authLoading && isAdmin === false) {
      navigate('/');
    }
  }, [isAdmin, authLoading, navigate]);

  const renderContent = useMemo(() => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <div className="space-y-10">
            <ExecutiveHeroScreen
              muezzinlerSayisi={muezzinlerLength}
              cozulmamisSayisi={cozulmamisSayisi}
              pendingIzinler={pendingIzinler}
              statsLoading={statsLoading}
              setActiveTab={setActiveTab}
              onOpenDrawer={setDrawerContent}
            />
            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
              {/* SistemAnalitigi'nin gerçek içeriği (grafik kartı min-h-[420px] + kişi
     tablosu) 280px'ten çok daha uzun — kısa fallback, kod-bölünmüş modül
     ilk kez indirilirken belirgin bir layout shift yaratıyordu (bkz. kod
     denetimi bulgusu). */}
              <Suspense fallback={<Skeleton className="min-h-[600px] w-full" rounded="rounded-card" />}>
                <SistemAnalitigi />
              </Suspense>
            </motion.div>
          </div>
        );
      case 'planlama':
        return <HaftalikCizelge />;
      case 'ekip':
        return <PersonelHub />;
      case 'ayarlar':
        return <AyarlarHub />;
      default:
        return null;
    }
  }, [activeTab, muezzinlerLength, cozulmamisSayisi, pendingIzinler, statsLoading, setActiveTab]);

  const pageTitle = useMemo(() => {
    switch (activeTab) {
      case 'dashboard':
        return 'Genel Bakış';
      case 'planlama':
        return 'Hizmet Cetveli';
      case 'ekip':
        return 'Kadro Yönetimi';
      case 'ayarlar':
        return 'Dizge Ayarları';
      default:
        return '';
    }
  }, [activeTab]);

  const { theme, toggleTheme } = useThemeStore();
  const { showNotification } = useNotificationStore();

  // Rules-of-Hooks: bu erken dönüş TÜM hook çağrılarından (useState/useEffect/
  // useMemo/useThemeStore) SONRA gelmelidir. isAdmin bir oturum sırasında
  // false'a dönerse (rol değişikliği/pasifleştirme), hook çağrı sırası hâlâ
  // sabit kalır ve React "Rendered fewer hooks than expected" ile çökmez.
  // Yönlendirme zaten yukarıdaki useEffect ile yapılıyor; authLoading da
  // AuthGuard tarafından ele alınıyor.
  if (!isAdmin) return null;

  const requestLogout = () => setLogoutConfirmOpen(true);
  const confirmLogout = async () => {
    setLogoutConfirmOpen(false);
    try {
      // Admin panelinin kendi "Oturumu Kapat" düğmesi önceden auth.signOut()'u
      // doğrudan çağırıyordu, bu yüzden AuthGuard.tsx'e eklenen FCM token
      // temizliği düzeltmesi buradan hiç geçmiyordu (bkz. performLogout
      // yorumu, code-review — dördüncü denetim turu).
      await performLogout();
      window.location.reload();
    } catch {
      showNotification('Çıkış Başarısız', 'Oturum kapatılırken bir hata oluştu. Lütfen tekrar deneyin.', 'error');
    }
  };

  const navigateApp = (path: string) => {
    playClick?.();
    navigate(path);
  };

  return (
    <div
      style={{ '--dynamic-aura': activeAuraColor } as React.CSSProperties}
      className="min-h-screen flex lg:flex-row bg-[var(--app-bg)] font-apple pb-24 lg:pb-0 overflow-hidden selection:bg-[var(--dynamic-aura,var(--aura-indigo))]/20 fluid-transition"
    >
      {/* Sayfaya özgü ikinci bir aura blob katmanı önceden burada AYRICA render
     ediliyordu — Layout.tsx zaten global bir 2-blob sirkadiyen katman
     sağlıyor (aynı --dynamic-aura'yı okuyarak); üst üste 4 blur katmanı
     doygunluğun katlanmasına yol açıyordu (bkz. premium denetim B34, O8). */}
      {/* Spiritüel Doku Bütünlüğü */}
      <IslamicGeometricBg />

      {/* Navigation Ecosystem — mobil dock artık Layout seviyesinde (bkz.
     src/components/FloatingDock.tsx), müezzin dock'undan admin sekmelerine
     kesintisiz morph olabilmesi için route değişiminde unmount olmuyor. */}
      <SlimSidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onLogout={requestLogout}
        pendingIzinler={pendingIzinler}
        cozulmamisSayisi={cozulmamisSayisi}
        onPrefetch={prefetchTab}
        theme={theme}
        toggleTheme={toggleTheme}
        onNavigateApp={navigateApp}
      />

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 w-full max-w-full lg:ml-[80px] px-2 pt-3 pb-28 sm:pb-32 lg:pb-8 lg:p-8 relative z-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.5, ease: [0.25, 1, 0.5, 1] }}
            className="fluid-wrapper"
          >
            {/* Authority Header */}
            <header className="mb-5 lg:mb-8 px-1 sm:px-0 flex items-center justify-between gap-4">
              <h1
                className={`text-xl sm:text-2xl lg:text-3xl font-light text-[var(--text-primary)] tracking-tight leading-none fluid-transition group-hover:font-bold duration-700 ${isPending ? 'opacity-20 blur-sm' : 'opacity-100'}`}
              >
                {pageTitle}
              </h1>
              <div className="flex items-center gap-2 shrink-0">
                {/* Tema geçişi düğmesi FloatingDock'un daima-görünür, baş parmak
      bölgesindeki ikincil satırına taşındı — bu köşe, sayfayla birlikte
      kayan ve tek elle ulaşılması zor bir konumdaydı (bkz. FloatingDock.tsx
      yorumu). `theme`/`toggleTheme` SlimSidebar'a (masaüstü) aktarılmaya
      devam ediyor. */}
                <button
                  type="button"
                  onClick={requestLogout}
                  className="lg:hidden flex items-center justify-center w-11 h-11 rounded-[14px] border border-[var(--glass-border)] bg-[var(--text-primary)]/[0.025] text-rose-500/50 hover:text-rose-500 hover:bg-rose-500/10 transition-all"
                  aria-label="Oturumu kapat"
                  title="Oturumu kapat"
                >
                  <LogOut size={16} strokeWidth={1.7} />
                </button>
              </div>
            </header>

            <div
              className={`spatial-glass-flat p-3 sm:p-4 lg:p-6 min-h-[70dvh] fluid-transition ${isPending ? 'scale-[0.99] opacity-60' : 'scale-100'} !rounded-card`}
            >
              <ErrorBoundary
                FallbackComponent={({ error, resetErrorBoundary }) => (
                  <ChunkErrorFallback error={toError(error)} variant="inline" onReset={resetErrorBoundary} />
                )}
                onReset={() => setSearchParams((prev) => prev)}
              >
                <Suspense fallback={<PageSkeleton />}>{renderContent}</Suspense>
              </ErrorBoundary>
            </div>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Global Drawer (Neural Overlay) - Portaled for Mobile Stability */}
      {createPortal(
        <AnimatePresence>
          {drawerContent && (
            <div key="admin-drawer" className="fixed inset-0 z-[400] flex justify-end">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={closeDrawer}
                className="absolute inset-0 bg-black/40 dark:bg-black/85 backdrop-blur-[30px]"
              >
                {/* Drawer Ambient Aura */}
                <div
                  className="absolute inset-0 opacity-10 pointer-events-none transition-all duration-1000"
                  style={{ background: 'radial-gradient(circle at 100% 50%, var(--dynamic-aura, var(--aura-indigo)), transparent 60%)' }}
                />
              </motion.div>

              <motion.div
                drag="x"
                dragConstraints={{ left: 0 }}
                dragElastic={{ left: 0.02, right: 0.85 }}
                onDragEnd={(e, info) => {
                  if (info.offset.x > 150 || info.velocity.x > 450) {
                    closeDrawer();
                  }
                }}
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 30, stiffness: 220 }}
                className="relative w-full md:w-[700px] lg:w-[900px] bg-[var(--app-bg)] shadow-[var(--spatial-shadow)] flex flex-col h-[100dvh] border-l border-[var(--glass-border)]"
                style={{
                  transformStyle: 'preserve-3d',
                  paddingTop: 'env(safe-area-inset-top, 0px)',
                  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                }}
              >
                {/* Grab Handle for swipe dismissal */}
                <div className="absolute left-1 top-1/2 -translate-y-1/2 w-[4px] h-16 bg-[var(--text-primary)]/10 rounded-full hidden md:block pointer-events-none" />

                <div className="flex items-center justify-between phi-padding spatial-glass rounded-none border-b border-[var(--glass-border)] relative z-50">
                  <div>
                    <h2 className="text-3xl font-light text-[var(--text-primary)] tracking-tight">
                      {drawerContent === 'alarmlar' ? 'Nöbet Uyarıları' : 'Duyuru Paneli'}
                    </h2>
                  </div>
                  <button
                    onClick={closeDrawer}
                    aria-label="Kapat"
                    className="w-12 h-12 flex items-center justify-center bg-[var(--text-primary)]/[0.03] hover:bg-[var(--text-primary)]/[0.06] hover:text-rose-500 rounded-[20px] border border-[var(--glass-border)] transition-all text-[var(--text-primary)]"
                  >
                    <X size={20} strokeWidth={1} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto phi-padding no-scrollbar relative z-10">
                  <Suspense fallback={<PageSkeleton height="h-full" className="pt-4" />}>
                    {drawerContent === 'alarmlar' && <KrizAlarmlari />}
                    {drawerContent === 'duyurular' && <DuyuruYonetimi />}
                  </Suspense>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
      <ConfirmModal
        isOpen={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
        onConfirm={confirmLogout}
        title="Oturumu Kapat"
        message="Yönetim oturumunuzu kapatmak üzeresiniz. Devam etmek istiyor musunuz?"
        confirmText="Çıkış Yap"
        cancelText="Vazgeç"
        isDanger
      />
    </div>
  );
}
