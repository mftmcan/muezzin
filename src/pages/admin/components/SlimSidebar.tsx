import React from 'react';
import { motion } from 'motion/react';
import { LogOut, Sun, Moon } from 'lucide-react';
import { Logo } from '../../../components/ui/Logo';
import { getAdminNavItems, APP_LINKS, type ActiveModule } from '../config/navConfig';
import type { ThemeToggleEvent } from '../../../store/useThemeStore';
import { toTurkishUpperCase } from '../../../lib/dateUtils';

interface SlimSidebarProps {
  activeTab: ActiveModule;
  setActiveTab: (tab: ActiveModule) => void;
  onLogout: () => void;
  pendingIzinler: number;
  cozulmamisSayisi: number;
  onPrefetch?: (tab: ActiveModule) => void;
  theme: 'dark' | 'light';
  toggleTheme: (event?: ThemeToggleEvent) => void;
  onNavigateApp: (path: string) => void;
}

export const SlimSidebar = React.memo<SlimSidebarProps>(
  ({ activeTab, setActiveTab, onLogout, pendingIzinler, cozulmamisSayisi, onPrefetch, theme, toggleTheme, onNavigateApp }) => {
    const navItems = getAdminNavItems({ cozulmamisSayisi, pendingIzinler });
    const appLinks = APP_LINKS;

    return (
      <aside
        className="w-[80px] flex-shrink-0 flex flex-col items-center py-10 fixed inset-y-0 hidden lg:flex z-50 rounded-none border-r border-[var(--glass-border)] bg-[var(--spatial-glass-bg)] backdrop-blur-[56px] saturate-[160%] shadow-[var(--spatial-shadow)] overflow-y-auto"
        style={{
          paddingTop: 'max(2.5rem, env(safe-area-inset-top, 0px))',
          paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom, 0px))',
        }}
      >
        {/* Brand & Authority
     flex-shrink-0 — <aside> fixed inset-y-0 (viewport yüksekliğine sabit) ve
     hiçbir çocuğu flex-shrink-0 taşımıyordu. İçerik viewport'tan sadece
     birkaç piksel taşınca (kısa pencere yüksekliklerinde — ör. 1366×768
     dizüstü ekranları — sıradan), flexbox varsayılan davranışıyla bu
     taşmayı orantısız biçimde İLK çocuktan (bu logo butonu, 48px→0px'e
     kadar) kırpıyordu (manuel görsel denetimde bulundu — buton pratikte
     TAMAMEN GÖRÜNMEZ oluyordu). Kalıcı çözüm: her sabit boyutlu çocuk
     flex-shrink-0 alır, <aside> kendisi overflow-y-auto ile gerçek taşma
     durumunda kırpmak yerine iç kaydırma sunar. */}
        <button
          type="button"
          onClick={() => onNavigateApp('/')}
          aria-label="Müezzin vakit ekranına git"
          title="Vakit ekranı"
          className="w-12 h-12 flex-shrink-0 bg-[var(--text-primary)]/[0.03] border border-[var(--glass-border)] rounded-[18px] flex items-center justify-center text-[var(--text-primary)] mb-12 shadow-[var(--spatial-shadow)] group cursor-pointer transition-all duration-500 relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-tr from-[var(--dynamic-aura,var(--aura-indigo))]/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
          <Logo
            size={24}
            variant="dynamic"
            className="text-[var(--dynamic-aura,var(--aura-indigo))] group-hover:rotate-12 transition-transform duration-700"
          />
        </button>

        {/* Nav Items Ecosystem */}
        <nav aria-label="Admin ana menü" className="flex-shrink-0 flex flex-col gap-3 w-full px-3">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                aria-label={item.fullLabel}
                aria-current={isActive ? 'page' : undefined}
                title={item.fullLabel}
                onClick={() => setActiveTab(item.id)}
                onMouseEnter={() => onPrefetch?.(item.id)}
                className={`relative flex flex-col items-center justify-center gap-2 w-full h-[72px] rounded-[20px] transition-all duration-300 group z-10 ${
                  isActive
                    ? 'text-[var(--text-primary)] shadow-inner'
                    : 'text-subtle hover:text-[var(--text-primary)]/60 hover:bg-[var(--text-primary)]/[0.02]'
                }`}
              >
                <div className={`transition-all duration-700 relative z-10 ${isActive ? 'scale-110' : ''}`}>
                  <item.icon
                    strokeWidth={isActive ? 2 : 1.5}
                    size={22}
                    className={isActive ? 'text-[var(--dynamic-aura,var(--aura-indigo))]' : ''}
                  />
                </div>
                <span
                  className={`authority-title !text-2xs relative z-10 transition-all duration-700 font-bold tracking-wide ${isActive ? 'opacity-100 font-black' : 'opacity-30 font-medium group-hover:font-bold'}`}
                >
                  {toTurkishUpperCase(item.shortLabel)}
                </span>

                {item.badge > 0 && <div className="badge-pulse-danger -top-1 -right-1 w-4 h-4">{item.badge}</div>}

                {isActive && (
                  <>
                    <motion.div
                      layoutId="active-slim-pill"
                      className="absolute inset-0 bg-[var(--text-primary)]/[0.03] border border-[var(--glass-border)] rounded-[20px] -z-10 shadow-lg"
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                    <motion.div
                      layoutId="active-glow"
                      className="absolute inset-0 bg-[var(--dynamic-aura,var(--aura-indigo))]/5 blur-xl -z-20"
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                    <motion.div
                      layoutId="active-line"
                      className="absolute left-[-4px] top-1/2 -translate-y-1/2 w-[3px] h-8 bg-[var(--dynamic-aura,var(--aura-indigo))] rounded-full shadow-[0_0_20px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_80%,transparent)]"
                    />
                  </>
                )}
              </button>
            );
          })}
        </nav>

        <nav aria-label="Müezzin menüsü" className="flex-shrink-0 mt-5 flex flex-col gap-2 w-full px-4">
          {appLinks.map((item) => (
            <button
              key={item.path}
              type="button"
              aria-label={`${item.label} sayfasına git`}
              title={item.label}
              onClick={() => onNavigateApp(item.path)}
              className="relative w-full h-11 rounded-[14px] flex items-center justify-center text-[var(--text-primary)]/45 hover:text-[var(--text-primary)]/70 hover:bg-[var(--text-primary)]/[0.025] border border-transparent hover:border-[var(--glass-border)] transition-all group"
            >
              <item.icon strokeWidth={1.6} size={18} />
              <span className="absolute left-[58px] px-3 py-1.5 rounded-xl bg-[var(--app-bg)] border border-[var(--glass-border)] shadow-[var(--spatial-shadow)] text-2xs font-medium tracking-wide opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 pointer-events-none whitespace-nowrap transition-all">
                {item.label}
              </span>
            </button>
          ))}
        </nav>

        {/* Global Actions Stack */}
        <div className="flex-shrink-0 mt-auto flex flex-col gap-3 pb-8">
          <button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Aydınlık temaya geç' : 'Karanlık temaya geç'}
            title={theme === 'dark' ? 'Aydınlık temaya geç' : 'Karanlık temaya geç'}
            className="w-11 h-11 flex items-center justify-center rounded-2xl bg-[var(--text-primary)]/[0.02] border border-[var(--glass-border)] text-subtle hover:text-[var(--dynamic-aura,var(--aura-indigo))] hover:bg-[var(--dynamic-aura,var(--aura-indigo))]/5 transition-all group relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-[var(--dynamic-aura,var(--aura-indigo))]/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            {theme === 'dark' ? <Sun size={20} strokeWidth={1.5} /> : <Moon size={20} strokeWidth={1.5} />}
          </button>

          <button
            onClick={onLogout}
            aria-label="Oturumu kapat"
            title="Oturumu kapat"
            className="w-11 h-11 flex items-center justify-center rounded-2xl bg-[var(--text-primary)]/[0.02] border border-[var(--glass-border)] text-subtle hover:text-rose-500 hover:bg-rose-500/10 transition-all group"
          >
            <LogOut size={20} strokeWidth={1.5} />
          </button>
        </div>
      </aside>
    );
  }
);
