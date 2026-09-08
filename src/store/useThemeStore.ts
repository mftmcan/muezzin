import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MouseEvent as ReactMouseEvent } from 'react';

type Theme = 'light' | 'dark';

export type ThemeToggleEvent = ReactMouseEvent | MouseEvent;

// index.html'deki inline script, ilk boyamada FOUC'u önlemek için theme-color
// meta'sını sabit hex tahminleriyle ayarlar; burada CSS tamamen yüklendikten
// sonra --app-bg'nin GERÇEK (hesaplanmış) değeri okunup meta'ya yazılır —
// token ileride değişirse iki yeri elle senkronize tutmaya gerek kalmaz
// (bkz. premium denetim B41, H9).
function syncThemeColorMeta(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const appBg = getComputedStyle(document.documentElement).getPropertyValue('--app-bg').trim();
  if (!appBg) return;
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute('content', appBg);
  });
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: (event?: ThemeToggleEvent) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'dark', // Default to dark as requested in aesthetics
      setTheme: (theme) => {
        set({ theme });
        syncThemeColorMeta(theme);
      },
      toggleTheme: (event?: ThemeToggleEvent) => {
        const toggle = () => {
          set((state) => {
            const newTheme = state.theme === 'light' ? 'dark' : 'light';
            syncThemeColorMeta(newTheme);
            return { theme: newTheme };
          });
        };

        if (!document.startViewTransition || !event) {
          toggle();
          return;
        }

        let x: number | undefined = event.clientX;
        let y: number | undefined = event.clientY;

        if (x === undefined && 'nativeEvent' in event) {
          x = event.nativeEvent.clientX;
          y = event.nativeEvent.clientY;
        }

        if (x === undefined && event.target instanceof Element) {
          const rect = event.target.getBoundingClientRect();
          x = rect.left + rect.width / 2;
          y = rect.top + rect.height / 2;
        }

        if (x === undefined || y === undefined) {
          toggle();
          return;
        }

        const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

        const transition = document.startViewTransition(() => {
          toggle();
        });

        transition.ready.then(() => {
          const clipPath = [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`];
          document.documentElement.animate(
            {
              clipPath: clipPath,
            },
            {
              duration: 400,
              easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
              pseudoElement: '::view-transition-new(root)',
            }
          );
        });
      },
    }),
    {
      name: 'muezzin-theme-storage',
      onRehydrateStorage: () => (state) => {
        if (state) {
          syncThemeColorMeta(state.theme);
        }
      },
    }
  )
);
