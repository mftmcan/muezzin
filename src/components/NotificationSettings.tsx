import React, { useState } from 'react';
import { motion } from 'motion/react';
import { BellRing, History } from 'lucide-react';
import { updateDoc, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { User as FirebaseUser } from 'firebase/auth';
import { Muezzin } from '../types';
import { registerFcmToken } from '../hooks/useFcmToken';
import { useThemeStore } from '../store/useThemeStore';
import { useNotificationStore, NOTIFICATION_HISTORY_LIMIT } from '../store/useNotificationStore';
import { NotificationHistoryPanel } from './NotificationHistoryPanel';
import { NotificationPrimingModal } from './NotificationPrimingModal';
import { Switch } from './ui/Switch';

interface NotificationSettingsProps {
  userData: Muezzin | null;
  user: FirebaseUser | null;
}

export default function NotificationSettings({ userData, user }: NotificationSettingsProps) {
  const [isRequesting, setIsRequesting] = useState(false);
  const [uiMessage, setUiMessage] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [primingModalOpen, setPrimingModalOpen] = useState(false);
  const { theme, toggleTheme } = useThemeStore();
  const { ttsEnabled, setTtsEnabled } = useNotificationStore();

  const handleRequestNotificationPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setUiMessage('Bu tarayıcı anlık bildirim dizgesini desteklemiyor.');
      return;
    }

    if (Notification.permission === 'denied') {
      setUiMessage('Bildirim izinleri tarayıcınızda engellenmiş. Adres çubuğunun solundaki kilit simgesinden manuel izin verin.');
      return;
    }

    setIsRequesting(true);
    try {
      const { token } = await registerFcmToken(true);
      // registerFcmToken izin reddedilmediği halde (ör. VAPID anahtarı
      // yapılandırılmamış, tarayıcı getToken()'ı sessizce başarısız kılmış)
      // hata fırlatmadan token:null ile de dönebiliyor — önceden bu durumda
      // da uiMessage koşulsuz temizleniyordu, kullanıcı "etkinleştirdim"
      // sanıp hiçbir bildirim almadığını hiç fark etmiyordu (bkz.
      // code-review, dördüncü denetim turu).
      if (token) {
        setUiMessage(null);
      } else {
        setUiMessage('Bildirim aboneliği tamamlanamadı. Lütfen tekrar deneyin veya tarayıcı ayarlarınızı kontrol edin.');
      }
    } catch (err) {
      console.error('Bildirim izni istenirken hata:', err);
      setUiMessage('Bildirim aboneliği tamamlanamadı. Lütfen tekrar deneyin veya tarayıcı ayarlarınızı kontrol edin.');
    } finally {
      setIsRequesting(false);
    }
  };

  // Native tarayıcı promptunu doğrudan tetiklemek yerine — izin bir kez
  // reddedilirse kullanıcı geri döndürülemez hale geldiği için (bkz.
  // premium denetim, bölüm 11) — permission hâlâ 'default' iken önce
  // açıklayıcı bir ara modal gösteriyoruz.
  const handlePrimaryCtaClick = () => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      setPrimingModalOpen(true);
      return;
    }
    void handleRequestNotificationPermission();
  };

  const handlePrimingConfirm = () => {
    setPrimingModalOpen(false);
    void handleRequestNotificationPermission();
  };

  const handleTestNotification = () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setUiMessage('Bu tarayıcı bildirimleri desteklemiyor.');
      return;
    }
    if (Notification.permission === 'granted') {
      new Notification('Müezzin Hizmet Dizgesi', {
        body: 'Bu bir dizge tanı test bildirimidir. Bağlantınız başarıyla sağlandı!',
        // '/favicon.ico' public/'te yoktu (yalnızca favicon.svg var) — test
        // bildiriminin ikonu her zaman bozuk çıkıyordu (bkz. premium denetim,
        // bölüm 11).
        icon: '/pwa-192x192.png',
      });
      setUiMessage(null);
    } else {
      setUiMessage('Lütfen önce bildirim iznini verin.');
    }
  };

  const handleToggleSetting = async (key: 'nobetHatirlatici' | 'duyurular' | 'mazeretDurumu') => {
    if (!user || !userData) return;

    const currentSettings = userData.notificationSettings || {
      nobetHatirlatici: true,
      duyurular: true,
      mazeretDurumu: true,
    };

    const newSettings = {
      ...currentSettings,
      [key]: !currentSettings[key],
    };

    try {
      await updateDoc(doc(db, 'muezzins', user.uid), {
        notificationSettings: newSettings,
      });
    } catch (err) {
      // Anahtar canlı `userData.notificationSettings` dinleyicisini
      // yansıttığından, yazım başarısız olursa görsel olarak hiç
      // değişmiyordu — ama kullanıcıya bunun NEDENİNİ açıklayan hiçbir
      // geri bildirim yoktu (bkz. mimari denetim; ProfileHeader.tsx'teki
      // kardeş handleUpdate bu hatayı doğru şekilde gösteriyor).
      const wrapped = handleFirestoreError(err, OperationType.UPDATE, `muezzins/${user.uid}`);
      setUiMessage(wrapped.message);
    }
  };

  return (
    <motion.div
      whileHover={{ y: -4 }}
      className="p-5 sm:p-8 spatial-glass rounded-card border-[var(--glass-border)] shadow-[var(--spatial-shadow)] relative overflow-hidden"
    >
      {/* flex-col sm:flex-row: başlık uzun (37 karakter) + durum rozeti dar
          mobil genişlikte (≤375px) yan yana sığmıyordu (bkz. KrizAlarmlari.tsx'teki
          aynı desen, mobil yerleşim denetimi). */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-8 relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--dynamic-aura,var(--aura-indigo))] animate-pulse" />
          <h4 className="premium-label !text-2xs !opacity-70 tracking-wide">BİLDİRİM TERCİHLERİ VE TANI DİREKTİFİ</h4>
        </div>
        {/* Durum rozeti (bağlı/izin gerekli) kasıtlı olarak sabit semantik
            renk kullanır, dynamic-aura kullanmaz — aksi halde günün vaktine
            göre değişen marka rengiyle karışıp "dikkat gerekiyor" sinyali
            birincil eylem butonundan ayrışamıyordu (bkz. görsel tasarım
            denetimi). */}
        <span
          className={`self-start sm:self-auto text-2xs font-bold px-4 py-1.5 rounded-full uppercase tracking-wide ${
            userData?.fcmToken
              ? 'text-[var(--status-success)] bg-[var(--status-success)]/10'
              : typeof window !== 'undefined' && (!('Notification' in window) || Notification.permission === 'denied')
                ? 'text-[var(--status-danger)] bg-[var(--status-danger)]/10'
                : 'text-[var(--status-warning)] bg-[var(--status-warning)]/10'
          }`}
        >
          {userData?.fcmToken ? 'BAĞLANTI AKTİF' : 'İZİN GEREKLİ'}
        </span>
      </div>

      {uiMessage && (
        <div className="mb-4 px-4 py-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-2xs font-medium leading-relaxed flex justify-between items-start gap-3">
          <span>{uiMessage}</span>
          <button onClick={() => setUiMessage(null)} aria-label="Kapat" className="shrink-0 opacity-50 hover:opacity-100 text-xs">
            ✕
          </button>
        </div>
      )}

      <div className="mb-6 p-4 bg-[var(--text-primary)]/[0.02] border border-[var(--glass-border)] rounded-[20px] flex items-start gap-4 flex-col sm:flex-row">
        <div
          className={`p-2.5 rounded-xl flex items-center justify-center shrink-0 ${
            userData?.fcmToken
              ? 'bg-[var(--status-success)]/10 text-[var(--status-success)]'
              : typeof window !== 'undefined' && !('Notification' in window)
                ? 'bg-[var(--status-danger)]/10 text-[var(--status-danger)]'
                : typeof window !== 'undefined' && Notification.permission === 'denied'
                  ? 'bg-[var(--status-danger)]/10 text-[var(--status-danger)]'
                  : 'bg-[var(--status-warning)]/10 text-[var(--status-warning)]'
          }`}
        >
          <BellRing size={16} />
        </div>
        <div className="space-y-1">
          <h5 className="text-2xs font-bold uppercase tracking-wider text-[var(--text-primary)]">DİZGE DURUM TANI</h5>
          <p className="text-2xs text-muted leading-relaxed font-light">
            {userData?.fcmToken
              ? 'Anlık bildirim alıcınız başarıyla Google sunucularına bağlandı ve bu cihaz yetkilendirildi.'
              : typeof window !== 'undefined' && !('Notification' in window)
                ? 'Bu cihazın tarayıcısı Web-Push anlık bildirim dizgesini desteklemiyor.'
                : typeof window !== 'undefined' && Notification.permission === 'denied'
                  ? 'Tarayıcı bildirim izinleri kalıcı olarak engellenmiş. Lütfen adres çubuğundaki kilit simgesinden izin verin.'
                  : 'İzin verilmemiş veya cihaz kaydı yok. Bildirimleri etkinleştirerek görev ve duyuru uyarılarını alabilirsiniz.'}
          </p>

          {typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted' && (
            <motion.button
              whileHover={{ y: -1, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleTestNotification}
              className="mt-3 px-4 py-2 bg-[var(--text-primary)]/[0.03] border border-[var(--glass-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-xl text-2xs font-bold uppercase tracking-wider hover:bg-[var(--text-primary)]/5 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <BellRing size={10} />
              TANI TEST BİLDİRİMİ GÖNDER
            </motion.button>
          )}
        </div>
      </div>

      {!userData?.fcmToken && typeof window !== 'undefined' && 'Notification' in window && Notification.permission !== 'denied' && (
        <motion.button
          whileHover={{ y: -2, scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          onClick={handlePrimaryCtaClick}
          disabled={isRequesting}
          className={`w-full mb-6 py-4 rounded-2xl bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] text-2xs font-bold uppercase tracking-wide shadow-lg flex items-center justify-center gap-3 ${isRequesting ? 'opacity-70 cursor-wait' : ''}`}
        >
          {isRequesting ? (
            <div className="w-4 h-4 border-2 border-[var(--text-primary)]/30 border-t-white rounded-full animate-spin" />
          ) : (
            <BellRing size={15} strokeWidth={2} />
          )}
          {isRequesting ? 'İSTEK GÖNDERİLİYOR...' : 'BİLDİRİMLERİ ETKİNLEŞTİR'}
        </motion.button>
      )}

      <div className="space-y-5">
        {(
          [
            {
              key: 'nobetHatirlatici',
              title: 'Nöbet & Vakit Hatırlatıcıları',
              desc: 'Adınıza atanan nöbet saatleri yaklaşırken anlık uyarı alırsınız.',
            },
            {
              key: 'duyurular',
              title: 'Resmi Tebliğler & Duyurular',
              desc: 'Yönetim tarafından yayınlanan resmi tebliğlerden anında haberdar olursunuz.',
            },
            {
              key: 'mazeretDurumu',
              title: 'Mazeret & İzin Talebi Güncellemeleri',
              desc: 'Gönderdiğiniz mazeret veya izin talebi onaylandığında anlık bildirim alırsınız.',
            },
          ] as const
        ).map((setting) => {
          const currentSettings = userData?.notificationSettings || {
            nobetHatirlatici: true,
            duyurular: true,
            mazeretDurumu: true,
          };
          const isChecked = currentSettings[setting.key] !== false;

          return (
            <Switch
              key={setting.key}
              checked={isChecked}
              onChange={() => handleToggleSetting(setting.key)}
              label={setting.title}
              description={setting.desc}
            />
          );
        })}

        {/* Tema Seçimi Switch */}
        <div className="border-t border-[var(--glass-border)] pt-5 mt-5">
          <Switch
            checked={theme === 'dark'}
            onChange={(e) => toggleTheme(e)}
            label="Koyu Tema (Karanlık Mod)"
            description="Uygulamanın görsel temasını el ile ayarlar. Açık olduğunda Koyu (Dark) modu etkinleştirir."
          />
        </div>

        {/* Sesli Bildirim Okuma (TTS) Switch */}
        <Switch
          checked={ttsEnabled}
          onChange={() => setTtsEnabled(!ttsEnabled)}
          label="Sesli Bildirim Okuma"
          description="Açıldığında, gelen bildirimler ekran okuyucu sesiyle yüksek sesle okunur. Varsayılan olarak kapalıdır."
        />

        {/* Bildirim Geçmişi */}
        <div className="flex items-center justify-between gap-6 py-2 border-t border-[var(--glass-border)] pt-5 mt-5">
          <div className="space-y-1">
            <h5 className="text-xs font-semibold text-[var(--text-primary)]">Bildirim Geçmişi</h5>
            <p className="text-2xs text-[var(--text-secondary)]/75 leading-normal max-w-[280px] font-light">
              Kaçırdığınız veya kapanmış bildirimleri (son {NOTIFICATION_HISTORY_LIMIT}) buradan tekrar görüntüleyin.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--glass-border)] bg-[var(--text-primary)]/[0.03] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--text-primary)]/5 text-2xs font-bold uppercase tracking-wide transition-all shrink-0"
          >
            <History size={14} />
            Görüntüle
          </button>
        </div>
      </div>

      <NotificationHistoryPanel isOpen={historyOpen} onClose={() => setHistoryOpen(false)} />
      <NotificationPrimingModal
        isOpen={primingModalOpen}
        onClose={() => setPrimingModalOpen(false)}
        onConfirm={handlePrimingConfirm}
        isLoading={isRequesting}
      />
    </motion.div>
  );
}
