import { useEffect } from 'react';
import { app } from '../lib/firebase';
import { normalizeNotificationType, useNotificationStore } from '../store/useNotificationStore';

export const ForegroundNotifications = () => {
  const showNotification = useNotificationStore((s) => s.showNotification);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    import('firebase/messaging')
      .then(({ getMessaging, onMessage }) => {
        if (!mounted) return;

        const messaging = getMessaging(app);
        unsubscribe = onMessage(messaging, (payload) => {
          const { title, body } = payload.notification || {};
          const type = normalizeNotificationType(payload.data?.type);

          if (title || body) {
            showNotification(title || 'Yeni Bildirim', body || '', type);
          }
        });
      })
      .catch((error) => {
        if (import.meta.env.DEV) {
          console.warn('Foreground messaging baslatilamadi:', error);
        }
      });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [showNotification]);

  return null;
};
