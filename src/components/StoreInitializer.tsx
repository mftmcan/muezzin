import { useEffect, useRef } from 'react';
import { useSystemSettingsStore } from '../store/useSystemSettingsStore';
import { useMuezzinStore } from '../store/useMuezzinStore';
import { useVakitStore } from '../store/useVakitStore';
import { useAktifIzinlerStore } from '../store/useAktifIzinlerStore';
import { useCircadianTheme } from '../hooks/useCircadianTheme';

/**
 * Bootstraps all global Zustand stores once.
 * Note: We do not unsubscribe the listeners on unmount because these stores
 * are global singletons. Unsubscribing them would cause them to remain permanently
 * unsubscribed when React 18's StrictMode double-mounts components in development mode.
 * The subscriptions are naturally cleaned up when the page reloads (e.g. on logout)
 * or when the user closes the tab.
 */
export const StoreInitializer = () => {
  const initialized = useRef(false);

  // Initialize global Google Neural Expressive circadian theme engine
  useCircadianTheme();

  useEffect(() => {
    // Guard: only ever run once across the app lifetime
    if (initialized.current) return;
    initialized.current = true;

    useSystemSettingsStore.getState().init();
    useMuezzinStore.getState().init();
    useVakitStore.getState().init();
    useAktifIzinlerStore.getState().init();
  }, []); // Empty deps: run once only

  return null;
};
