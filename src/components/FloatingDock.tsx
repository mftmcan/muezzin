import React, { memo, useCallback, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Home, Calendar, LayoutDashboard, User, Settings, Sun, Moon } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { useAdminIzinlerStore } from '../store/useAdminIzinlerStore';
import { useKrizAlarmlariStore } from '../store/useKrizAlarmlariStore';
import { useThemeStore } from '../store/useThemeStore';
import { playClick } from '../lib/sounds';
import { hapticMedium } from '../lib/haptic';
import { getAdminNavItems, APP_LINKS, toActiveModule, type ActiveModule } from '../pages/admin/config/navConfig';

// framer-motion'ın FLIP interpolasyonu için `--radius-card`'ın (src/index.css)
// sabit bir JS sayısı olarak kopyası gerekiyordu (CSS değişkeni doğrudan
// okunamıyor) — sabit `15` yazmak, token değiştiğinde bu dosyanın sessizce
// eskide kalmasına yol açan ikinci senkronizasyon noktasıydı (bkz. premium
// denetim B48). Modül yüklenirken okumak yerine (o an CSS henüz uygulanmamış
// olabilir, ör. dev sunucusunda) bileşenin İLK render'ında (DOM/CSS kesin
// hazır) tembel okunuyor; 15 yalnızca gerçek okuma başarısız olursa devreye
// giren bir güvenlik ağı.
function readDockRadius(): number {
  if (typeof document === 'undefined') return 15;
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--radius-card'));
  return Number.isFinite(value) ? value : 15;
}

const ALL_NAV_ITEMS = [
  { path: '/', label: 'Vakit', icon: Home, adminOnly: false, component: undefined },
  { path: '/takvim', label: 'Takvim', icon: Calendar, adminOnly: false, component: () => import('../pages/HaftalikTakvim') },
  { path: '/profil', label: 'Profil', icon: User, adminOnly: false, component: () => import('../pages/Profil') },
  { path: '/ayarlar', label: 'Ayarlar', icon: Settings, adminOnly: false, component: () => import('../pages/MuezzinAyarlari') },
  { path: '/admin', label: 'Yönetim', icon: LayoutDashboard, adminOnly: true, component: () => import('../pages/admin/AdminPanel') },
];

const AppNavItem = memo(({ item, isActive }: { item: (typeof ALL_NAV_ITEMS)[0]; isActive: boolean }) => {
  const Icon = item.icon;
  const navigate = useNavigate();

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      e.preventDefault();
      React.startTransition(() => navigate(item.path));
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    playClick();
    React.startTransition(() => navigate(item.path));
  };

  const handlePrefetch = () => item.component?.();

  return (
    // Dıştaki `motion.div` — AnimatePresence'ın exit animasyonunu (opacity
    // fade) tanıyabilmesi için burada gerçek bir motion bileşeni gerekiyor.
    // Bunu doğrudan `motion(Link)` ile yapmak react-router'ın `Link`'iyle ref
    // iletiminde çakışıp "Invalid prop `ref` supplied to React.Fragment"
    // konsol hatasına ve exit animasyonunun hiç bitmemesine yol açıyordu; bu
    // yüzden `Link` motion-wrap edilmeden, boyutu devralan sade bir div
    // içine alınıyor.
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="relative flex-1 h-full"
    >
      <Link
        to={item.path}
        aria-label={`${item.label} sekmesi`}
        onPointerDown={handlePointerDown}
        onMouseEnter={handlePrefetch}
        onClick={handleClick}
        className="relative flex flex-col items-center justify-center w-full h-full select-none touch-manipulation z-10 py-1 group"
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        <motion.div whileTap={{ scale: 0.85 }} className="relative flex flex-col items-center justify-center w-full h-full">
          {isActive && (
            <motion.div
              layoutId="activeNavIndicator"
              className="absolute inset-[6px] sm:inset-0 bg-[var(--text-primary)]/[0.06] rounded-card shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] border transition-all duration-1000"
              style={{
                borderColor: 'color-mix(in srgb, var(--dynamic-aura, var(--text-primary)) 20%, transparent)',
                boxShadow: '0 0 25px -4px color-mix(in srgb, var(--dynamic-aura, var(--text-primary)) 15%, transparent)',
              }}
              transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
            />
          )}

          <div className="relative z-20 flex flex-col items-center justify-center gap-0 sm:gap-1 pointer-events-none">
            <Icon
              size={isActive ? 20 : 22}
              strokeWidth={isActive ? 2.5 : 1.5}
              className={`transition-all duration-500 ${
                isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]'
              }`}
            />
            <AnimatePresence mode="wait">
              {isActive && (
                <motion.div
                  key="active-dock-indicator"
                  layoutId="active-dock-indicator"
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0 }}
                  className="w-1.5 h-1.5 rounded-full bg-[var(--text-primary)] shadow-[0_0_8px_rgba(255,255,255,0.7)] mt-1.5"
                  transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                />
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        <div className="hidden sm:block absolute -top-14 left-1/2 -translate-x-1/2 px-4 py-2 bg-[var(--app-bg)] text-[var(--text-primary)] text-2xs font-sans font-extralight tracking-wide rounded-[14px] opacity-0 group-hover:opacity-100 transition-all duration-500 pointer-events-none -translate-y-2 group-hover:translate-y-0 scale-90 shadow-[var(--spatial-shadow)] border border-[var(--glass-border)] backdrop-blur-xl">
          {item.label}
          <div className="absolute bottom-[-5px] left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-[var(--app-bg)] rotate-45 border-r border-b border-[var(--glass-border)]" />
        </div>
      </Link>
    </motion.div>
  );
});
AppNavItem.displayName = 'AppNavItem';

/**
 * Yüzen alt dock — müezzin ekranlarında (Vakit/Takvim/Profil/Ayarlar/Yönetim)
 * ve admin panelinde (Özet/Cetvel/Kadro/Dizge) aynı fiziksel kap: route
 * `/admin`'e geçince bu bileşen unmount OLMUYOR, sadece `layout` animasyonuyla
 * pill şeklinden admin bloğuna kendini yeniden şekillendiriyor ve içeriği
 * cross-fade ile değişiyor — eskiden AdminPanel kendi ayrı MobileDock'unu
 * mount ediyordu, bu da geçişte dock'un tamamen kaybolup farklı bir dock'un
 * belirmesine (sert kesme) neden oluyordu.
 */
export function FloatingDock() {
  const location = useLocation();
  const navigate = useNavigate();
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const isAdminRoute = location.pathname.startsWith('/admin');
  const [dockRadius] = useState(readDockRadius);
  const { theme, toggleTheme } = useThemeStore();

  const [searchParams, setSearchParams] = useSearchParams();
  const activeAdminTab = toActiveModule(searchParams.get('tab'));
  const setActiveAdminTab = useCallback(
    (tab: ActiveModule) => {
      setSearchParams((prev) => {
        const newParams = new URLSearchParams(prev);
        newParams.set('tab', tab);
        newParams.delete('subtab');
        newParams.delete('sub');
        return newParams;
      });
    },
    [setSearchParams]
  );

  const pendingIzinler = useAdminIzinlerStore((s) => s.izinler.filter((i) => i.durum === 'onay_bekliyor').length);
  const cozulmamisSayisi = useKrizAlarmlariStore((s) => s.cozulmamisSayisi);

  const navigateApp = useCallback(
    (path: string) => {
      playClick();
      React.startTransition(() => navigate(path));
    },
    [navigate]
  );

  const handleAdminPointerAction = useCallback((event: React.PointerEvent<HTMLButtonElement>, action: () => void, isMedium = false) => {
    if (event.pointerType === 'mouse') return;
    event.preventDefault();
    if (isMedium) hapticMedium();
    else playClick();
    action();
  }, []);

  // Aşağı kaydırırken dock'u gizle, yukarı kaydırırken göster (bkz. Layout.tsx
  // eski yorumu) — sadece müezzin ekranlarında; admin panelinde dock her zaman
  // görünür kalıyordu, o davranış korunuyor.
  const [scrollHidden, setScrollHidden] = React.useState(false);
  React.useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastY;
        if (y < 80) setScrollHidden(false);
        else if (delta > 6) setScrollHidden(true);
        else if (delta < -6) setScrollHidden(false);
        lastY = y;
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const navHidden = scrollHidden && !isAdminRoute;

  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mouse-x', `${(e.clientX - rect.left).toFixed(1)}px`);
    e.currentTarget.style.setProperty('--mouse-y', `${(e.clientY - rect.top).toFixed(1)}px`);
  };
  const handleMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.setProperty('--mouse-x', '50%');
    e.currentTarget.style.setProperty('--mouse-y', '50%');
  };

  const navItems = ALL_NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);
  const adminNavItems = getAdminNavItems({ cozulmamisSayisi, pendingIzinler });

  // Kabın GÖRÜNÜR şekli (`flex` mi `grid` mi, hangi boyut sınıfları) `isAdminRoute`
  // ANINDA değişir ama eski içerik `mode="wait"` yüzünden hâlâ ekrandan çıkmakta
  // olabilir — kap şekli hemen değişirse eski 5 öğe yeni 4 sütunlu grid'e
  // zorlanıp taşıyordu (bkz. code-review). Bu yüzden kap şekli kendi state'inde
  // tutulup yalnızca eski içeriğin çıkışı bittiğinde (`onExitComplete`) güncellenir
  // — böylece içerik ve kap şekli hiçbir karede birbiriyle uyuşmaz durumda olmaz.
  const [containerIsAdmin, setContainerIsAdmin] = React.useState(isAdminRoute);

  return (
    <div
      className={`fixed bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:bottom-6 left-4 right-4 sm:left-0 sm:right-0 z-[100] pointer-events-none flex flex-col items-center gap-2 pb-0 md:pb-12 md:px-6 transition-all duration-300 ease-out ${
        isAdminRoute ? 'lg:hidden' : ''
      } ${navHidden ? 'opacity-0 translate-y-[calc(100%+1.5rem)]' : 'opacity-100 translate-y-0'}`}
    >
      {/* Admin'e özgü ikincil satır (müezzin tarafında karşılığı yok, bu yüzden
          morph'a katılmıyor — kendi fade/slide'ıyla giriyor/çıkıyor) */}
      <AnimatePresence>
        {isAdminRoute && (
          <motion.nav
            key="admin-app-links"
            initial={{ opacity: 0, y: 8, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.94 }}
            transition={{ type: 'spring', bounce: 0.1, duration: 0.4 }}
            aria-label="Müezzin menüsü"
            className="apple-glass px-2 py-1 grid grid-cols-5 gap-1 pointer-events-auto touch-manipulation select-none"
          >
            {APP_LINKS.map((item) => (
              <button
                type="button"
                key={item.path}
                aria-label={`${item.label} sayfasına git`}
                title={item.label}
                onPointerDown={(event) => handleAdminPointerAction(event, () => navigateApp(item.path))}
                onClick={() => {
                  playClick();
                  navigateApp(item.path);
                }}
                className="min-w-[42px] h-[38px] px-2 rounded-[14px] flex items-center justify-center text-[var(--text-primary)]/45 hover:text-[var(--text-primary)] hover:bg-[var(--text-primary)]/[0.04] transition-all touch-manipulation"
              >
                <item.icon size={16} strokeWidth={1.7} />
              </button>
            ))}
            {/* Tema geçişi önceden AdminPanel'in kaydırılabilir içerik başlığında
                (sağ üst köşe, `lg:hidden`) duruyordu — o buton bu sabit dock'un
                aksine sayfayla birlikte kayıp gözden kayboluyordu ve köşe konumu
                tek elle (baş parmakla) ulaşmayı zorlaştırıyordu. Aynı fiziksel
                kabın (bkz. yukarıdaki bileşen yorumu) her zaman ekranda kalan,
                baş parmak bölgesindeki bu ikincil satırına taşınarak hem daima
                görünür hem de kolay erişilir hale getirildi. */}
            <button
              type="button"
              onClick={(event) => {
                playClick();
                toggleTheme(event);
              }}
              onPointerDown={(event) => handleAdminPointerAction(event, () => toggleTheme())}
              aria-label={theme === 'dark' ? 'Aydınlık temaya geç' : 'Karanlık temaya geç'}
              title={theme === 'dark' ? 'Aydınlık temaya geç' : 'Karanlık temaya geç'}
              className="min-w-[42px] h-[38px] px-2 rounded-[14px] flex items-center justify-center text-[var(--text-primary)]/45 hover:text-[var(--dynamic-aura,var(--aura-amber))] hover:bg-[var(--text-primary)]/[0.04] transition-all touch-manipulation"
            >
              {theme === 'dark' ? <Sun size={16} strokeWidth={1.7} /> : <Moon size={16} strokeWidth={1.7} />}
            </button>
          </motion.nav>
        )}
      </AnimatePresence>

      {/* Ana kap — hep mount kalır, sadece boyut/köşe yarıçapı `layout` ile
          morph olur; içerik AnimatePresence ile cross-fade eder. */}
      <motion.nav
        layout
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        aria-label={containerIsAdmin ? 'Admin ana menü' : 'Müezzin menüsü'}
        // `--radius-card`'la (src/index.css) elle senkronize tutulur — bu değer
        // framer-motion'ın FLIP sırasında düzgün interpolasyon yapabilmesi için
        // JS tarafında bir sayı olmalı, CSS değişkenini burada okuyamıyoruz.
        animate={{ borderRadius: dockRadius }}
        transition={{
          layout: { type: 'spring', bounce: 0.15, duration: 0.5 },
          borderRadius: { type: 'spring', bounce: 0.15, duration: 0.5 },
        }}
        // Dock sabit (fixed) konumda kaldığı için sayfa kaydırılırken altındaki
        // içerik (ör. Vakit Görevlileri kartı) üst kenarında keskin bir şekilde
        // kesilip yarım kalabiliyordu (bkz. görsel tasarım denetimi). Üst 16px'i
        // saydamdan opağa yumuşatan bir maske, dock'un ikon alanını (ortada,
        // her zaman tam opak) etkilemeden bu geçişi yumuşatır.
        style={{
          WebkitTapHighlightColor: 'transparent',
          maskImage: 'linear-gradient(to bottom, transparent, black 16px)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 16px)',
        }}
        className={`apple-glass pointer-events-auto touch-manipulation select-none relative group/nav overflow-hidden ${
          containerIsAdmin
            ? 'w-full sm:w-fit sm:min-w-[220px] min-h-[56px] sm:min-h-[70px] px-2 sm:px-3 py-1.5 sm:py-2 grid grid-cols-4 gap-1 sm:gap-1.5 max-w-full'
            : 'w-full sm:w-fit md:min-w-[520px] h-[64px] sm:h-[72px] md:h-[88px] flex items-center justify-around md:justify-center gap-1 sm:gap-2 md:gap-8 px-2 sm:px-6 md:px-10'
        }`}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--text-primary)]/5 to-transparent opacity-0 group-hover/nav:opacity-100 transition-opacity duration-700 pointer-events-none" />
        <div
          className="absolute inset-0 opacity-[0.08] pointer-events-none transition-all duration-1000"
          style={{
            background:
              'radial-gradient(circle at var(--mouse-x, 50%) var(--mouse-y, 50%), var(--dynamic-aura, var(--text-primary)), transparent 50%)',
          }}
        />

        {/* `wait`: eski ikon seti tamamen solup bitmeden yenisi hiç render
            edilmeye başlamıyor — müezzin ve admin menüleri asla aynı karede
            çakışmıyor. Bu sırada kap kısa bir an içeriksiz kalır; yukarıdaki
            min-h/min-w pinleri o anda kabın bir çubuğa çökmesini engelleyip
            "içerik gidiyor → kap yeniden şekilleniyor → içerik geliyor"
            sıralı hissini veriyor. */}
        <AnimatePresence mode="wait" onExitComplete={() => setContainerIsAdmin(isAdminRoute)}>
          {isAdminRoute
            ? adminNavItems.map((item) => {
                const isActive = activeAdminTab === item.id;
                return (
                  <motion.button
                    type="button"
                    key={item.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    aria-label={item.fullLabel}
                    aria-current={isActive ? 'page' : undefined}
                    onPointerDown={(event) => handleAdminPointerAction(event, () => setActiveAdminTab(item.id))}
                    onClick={() => {
                      playClick();
                      setActiveAdminTab(item.id);
                    }}
                    title={item.fullLabel}
                    className={`relative min-w-[44px] min-h-[44px] sm:min-w-[54px] sm:min-h-[54px] p-2 sm:p-3 rounded-2xl sm:rounded-[20px] transition-all duration-150 z-10 flex flex-col items-center justify-center gap-1 group touch-manipulation ${
                      isActive
                        ? 'text-[var(--dynamic-aura,var(--aura-indigo))] scale-110'
                        : 'text-faint hover:text-[var(--text-primary)]/60'
                    }`}
                  >
                    <div className="relative z-10 transition-transform duration-500">
                      <item.icon strokeWidth={isActive ? 2 : 1.5} size={20} />
                      {item.badge > 0 && <div className="badge-pulse-danger -top-2 -right-2 w-3.5 h-3.5 !text-2xs">{item.badge}</div>}
                    </div>

                    {isActive && (
                      <>
                        <motion.div
                          layoutId="active-dock-tab"
                          className="absolute inset-0 bg-[var(--surface-medium)] rounded-card -z-10 border border-[var(--glass-border)]"
                          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                        />
                        <motion.div
                          layoutId="active-dock-glow"
                          className="absolute inset-0 bg-[var(--dynamic-aura,var(--aura-indigo))]/10 blur-xl -z-20"
                          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                        />
                        <motion.div
                          layoutId="active-admin-dock-indicator"
                          className="w-1 h-1 rounded-full bg-[var(--dynamic-aura,var(--aura-indigo))] shadow-[0_0_8px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_80%,transparent)] mt-0.5"
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                        />
                      </>
                    )}
                  </motion.button>
                );
              })
            : navItems.map((item) => <AppNavItem key={item.path} item={item} isActive={location.pathname === item.path} />)}
        </AnimatePresence>
      </motion.nav>
    </div>
  );
}
