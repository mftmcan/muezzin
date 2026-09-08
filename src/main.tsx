import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import { useNotificationStore } from './store/useNotificationStore';

// registerType 'autoUpdate' + boş onNeedRefresh/onOfflineReady ile yeni bir
// sürüm geldiğinde uygulama sessizce hard-reload olabiliyordu — admin bir
// form doldururken sayfa aniden yenilenirse veri kaybı riski (bkz. premium
// denetim, bölüm 10; vite.config.ts'te registerType artık 'prompt'). Şimdi
// kullanıcıya engellemeyen bir "Yeni sürüm hazır" bildirimi gösteriliyor,
// yenileme kullanıcının kararına bırakılıyor.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    useNotificationStore
      .getState()
      .showNotification('Yeni Sürüm Hazır', 'Uygulamanın yeni bir sürümü indirildi. Değişiklikleri görmek için yenileyin.', 'info', {
        action: { label: 'YENİLE', onClick: () => updateSW(true) },
        durationMs: 30000,
      });
  },
  onOfflineReady() {
    useNotificationStore
      .getState()
      .showNotification('Çevrimdışı Kullanıma Hazır', 'Uygulama artık internet bağlantısı olmadan da açılabilir.', 'success');
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
