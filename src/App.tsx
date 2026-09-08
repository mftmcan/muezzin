import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { AuthGuard } from './components/AuthGuard';
import { Layout } from './components/Layout';
import { ErrorBoundary } from 'react-error-boundary';
import { Suspense, lazy, useEffect, useRef } from 'react';
import { StoreInitializer } from './components/StoreInitializer';
import { ForegroundNotifications } from './components/ForegroundNotifications';
import { ChunkErrorFallback } from './components/ChunkErrorFallback';

import { VakitMonitor } from './components/VakitMonitor';
import { telemetryService } from './services/telemetryService';
import { initTimeSync } from './lib/timeSync';
import { toError } from './lib/errorUtils';
import type { ErrorInfo } from 'react';
import MuezzinAnaEkran from './pages/MuezzinAnaEkran';
import NotFound from './pages/NotFound';
import { LoadingState } from './components/ui/LoadingState';
const HaftalikTakvim = lazy(() => import('./pages/HaftalikTakvim'));
const Profil = lazy(() => import('./pages/Profil'));
const MuezzinAyarlari = lazy(() => import('./pages/MuezzinAyarlari'));

const AdminPanel = lazy(() => import('./pages/admin/AdminPanel'));

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Ana Ekran',
  '/takvim': 'Haftalık Takvim',
  '/profil': 'Profil',
  '/ayarlar': 'Ayarlar',
  '/admin': 'Yönetim Paneli',
};

function handleError(rawError: unknown, info: ErrorInfo) {
  const error = toError(rawError);
  try {
    telemetryService.addBreadcrumb(`React ErrorBoundary: ${error.message.slice(0, 100)}`, 'system', {
      componentStack: (info.componentStack ?? '').slice(0, 300),
    });
    telemetryService.logError(error, info.componentStack ?? '');
  } catch (err) {
    console.error('Telemetri hata kaydedici hatası:', err);
  }
}

// Müezzin ekranları ↔ admin paneli arası route değişiminde sert kesme yerine
// kısa bir cross-fade — location.pathname'i key yapıp AnimatePresence'a
// veriyoruz, Routes'a da aynı location'ı geçiyoruz ki eskisi çıkış animasyonu
// oynarken router zaten yeni sayfaya geçmiş olmasın.
function AnimatedRoutes() {
  const location = useLocation();

  // Skip-link'in hedeflediği #main-content'e (Layout.tsx) rota değişince
  // odak taşınır ve sayfa başlığı güncellenir — SPA'da ekran okuyucu/klavye
  // kullanıcısı için navigasyon geri bildirimi (bkz. premium denetim,
  // bölüm 2d). İlk yüklemede odak taşınmaz (tarayıcı zaten body'ye odaklı).
  const isFirstRender = useRef(true);
  useEffect(() => {
    const routeTitle = ROUTE_TITLES[location.pathname] ?? 'Müezzin Hizmet Dizgesi';
    document.title = location.pathname === '/' ? 'Müezzin - Hizmet Dizgesi' : `${routeTitle} — Müezzin Hizmet Dizgesi`;

    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    document.getElementById('main-content')?.focus();
  }, [location.pathname]);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18, ease: 'easeInOut' }}
      >
        {/* Rota-bazlı sınır: kök ErrorBoundary'nin tek başına olması, örn.
            admin panelindeki bir çökmenin TÜM uygulamayı (müezzin ekranları
            dahil) tam-sayfa fallback'e düşürmesi anlamına geliyordu (bkz.
            premium denetim, bölüm 4). location.pathname'i key yaparak rota
            değişince boundary'nin de sıfırlanmasını garanti ediyoruz. */}
        <ErrorBoundary
          key={location.pathname}
          FallbackComponent={({ error, resetErrorBoundary }) => (
            <ChunkErrorFallback error={toError(error)} variant="inline" onReset={resetErrorBoundary} />
          )}
          onError={handleError}
        >
          <Routes location={location}>
            <Route path="/" element={<MuezzinAnaEkran />} />
            <Route path="/takvim" element={<HaftalikTakvim />} />
            <Route path="/profil" element={<Profil />} />
            <Route path="/ayarlar" element={<MuezzinAyarlari />} />
            <Route path="/admin" element={<AdminPanel />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </ErrorBoundary>
      </motion.div>
    </AnimatePresence>
  );
}

export default function App() {
  // İlk açılışta zaman senkronizasyonunu başlat (arka planda çalışır)
  useEffect(() => {
    initTimeSync();
  }, []);

  return (
    // .index.css'teki prefers-reduced-motion bloğu yalnızca CSS
    // transition/animation'ı hedefliyordu — motion/react'in WAAPI ile
    // sürdüğü animasyonları (Modal drag/spring, rota cross-fade, layoutId
    // geçişleri) hiç etkilemiyordu (bkz. premium denetim, bölüm 1).
    // MotionConfig reducedMotion="user" tüm alt ağaca işletim sistemi
    // tercihini uygular.
    <MotionConfig reducedMotion="user">
      <ErrorBoundary
        FallbackComponent={({ error }) => <ChunkErrorFallback error={toError(error)} variant="fullPage" autoReload />}
        onError={handleError}
      >
        <BrowserRouter>
          <AuthGuard>
            <StoreInitializer />
            <Layout>
              <VakitMonitor />
              <ForegroundNotifications />
              <Suspense fallback={<LoadingState label="Sayfa Yükleniyor" heightClassName="min-h-[80vh]" size="lg" />}>
                <AnimatedRoutes />
              </Suspense>
            </Layout>
          </AuthGuard>
        </BrowserRouter>
      </ErrorBoundary>
    </MotionConfig>
  );
}
