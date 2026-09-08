import React from 'react';
import { useNotificationStore } from '../store/useNotificationStore';
import { NotificationToast, NotificationContainer } from './ui/NotificationToast';

export const GlobalNotifications: React.FC = () => {
  const { notifications, removeNotification } = useNotificationStore();

  if (notifications.length === 0) return null;

  return (
    <NotificationContainer>
      {notifications.map((n) => (
        <NotificationToast
          key={n.id}
          id={n.id}
          title={n.title}
          message={n.message}
          type={n.type}
          action={n.action}
          durationMs={n.durationMs}
          onClose={removeNotification}
        />
      ))}
    </NotificationContainer>
  );
};
