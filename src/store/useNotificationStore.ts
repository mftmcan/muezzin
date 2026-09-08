import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { NotificationType } from '../components/ui/NotificationToast';
import { playSuccess, playWarning, getAudioContext } from '../lib/sounds';

interface NotificationAction {
  label: string;
  onClick: () => void;
}

interface Notification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  action?: NotificationAction;
  durationMs?: number;
}

export interface NotificationHistoryEntry {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  timestamp: number;
}

interface ShowNotificationOptions {
  action?: NotificationAction;
  durationMs?: number;
}

// export: NotificationSettings.tsx'teki "son N bildirim" etiketi bu sınırı
// elle kopyalamak yerine buradan okur (bkz. premium standart denetimi) —
// aksi halde limit değişirse etiket sessizce yanlış kalırdı.
export const NOTIFICATION_HISTORY_LIMIT = 50;

// Aynı anda kaç toast EKRANDA görünebilir — geçmiş (history) bundan ayrı ve
// hep tam kaydediliyor, yalnızca canlı yığın sınırlanıyor. Art arda gelen
// birden fazla FCM push'u (ör. bir nöbet hatırlatması + bir duyuru aynı
// tetiklemede) öncesinde sınırsız birikip ekranı toast yığınıyla
// doldurabiliyordu (bkz. kod denetimi — premium standart analizi).
export const MAX_VISIBLE_TOASTS = 4;

interface NotificationState {
  notifications: Notification[];
  history: NotificationHistoryEntry[];
  ttsEnabled: boolean;
  showNotification: (title: string, message: string, type?: NotificationType, options?: ShowNotificationOptions) => void;
  removeNotification: (id: string) => void;
  setTtsEnabled: (enabled: boolean) => void;
  clearHistory: () => void;
}

const VALID_NOTIFICATION_TYPES: NotificationType[] = ['info', 'success', 'warning', 'error'];

export const normalizeNotificationType = (type: unknown): NotificationType => {
  return VALID_NOTIFICATION_TYPES.includes(type as NotificationType) ? (type as NotificationType) : 'info';
};

export const unlockAudioContext = async () => {
  const audioCtx = getAudioContext();
  if (audioCtx && audioCtx.state === 'suspended') {
    try {
      await audioCtx.resume();
    } catch {
      // Silently fail
    }
  }
};

// Pre-warm Turkish SpeechSynthesis voices list on module load
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.getVoices();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    // `addEventListener` — `.onvoiceschanged = ...` bir ATAMAdır, tek bir
    // dinleyici tutar; aşağıdaki `processSpeechQueue` içindeki koşullu
    // atama bu ön-ısıtma dinleyicisini koşulsuz olarak EZİYORDU, ilk
    // anonstan sonra kalıcı olarak kayboluyordu (düşük öncelikli bulgu).
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      window.speechSynthesis.getVoices();
    });
  }
}

const speechQueue: string[] = [];
let isSpeaking = false;

const processSpeechQueue = () => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  if (isSpeaking || speechQueue.length === 0) return;

  const nextText = speechQueue.shift();
  if (!nextText) return;

  try {
    isSpeaking = true;
    const utterance = new SpeechSynthesisUtterance(nextText);
    utterance.lang = 'tr-TR';
    utterance.rate = 0.92; // Slightly calmer, majestic speed for readable Turkish
    utterance.pitch = 1.02; // Pleasant natural pitch

    // Pick highest quality Turkish natural voice
    let voices = window.speechSynthesis.getVoices();
    const findTrVoice = () => {
      return (
        voices.find((v) => v.lang.includes('tr-TR') && v.name.toLowerCase().includes('natural')) ||
        voices.find((v) => v.lang.includes('tr-TR')) ||
        voices.find((v) => v.lang.toLowerCase().includes('tr'))
      );
    };

    const trVoice = findTrVoice();
    if (trVoice) {
      utterance.voice = trVoice;
    } else {
      // `addEventListener` (kendi kendini kaldıran) — `.onvoiceschanged = ...`
      // ataması hem yukarıdaki modül-seviyesi ön-ısıtma dinleyicisini hem
      // önceki anonsların kendi dinleyicisini eziyordu (düşük öncelikli bulgu).
      const onVoicesChanged = () => {
        voices = window.speechSynthesis.getVoices();
        const asyncTrVoice = findTrVoice();
        if (asyncTrVoice) {
          utterance.voice = asyncTrVoice;
        }
        window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
      };
      window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
    }

    utterance.onend = () => {
      isSpeaking = false;
      setTimeout(processSpeechQueue, 350); // Pause between sequential announcements
    };

    utterance.onerror = (e) => {
      console.warn('Konuşma sentezi öğesi hatası:', e);
      isSpeaking = false;
      setTimeout(processSpeechQueue, 200);
    };

    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn('Konuşma sentezi başlatılamadı:', err);
    isSpeaking = false;
    setTimeout(processSpeechQueue, 200);
  }
};

const speakNotification = (text: string) => {
  speechQueue.push(text);
  processSpeechQueue();
};

const playNotificationSound = async () => {
  try {
    // getAudioContext() 'closed' durumunu kendi içinde tespit edip yeniden
    // oluşturuyor (bkz. lib/sounds.ts) — burada ayrıca ele almaya gerek yok.
    const audioCtx = getAudioContext();
    if (!audioCtx) return;

    if (audioCtx.state === 'suspended') {
      try {
        await audioCtx.resume();
      } catch (e) {
        console.warn('Tarayıcı politikası sesi engelledi (Kullanıcı etkileşimi bekleniyor).', e);
        return; // Sessizce çık
      }
    }

    const t = audioCtx.currentTime;

    // Master Gain (Premium soft attack and long decay)
    const masterGain = audioCtx.createGain();
    masterGain.connect(audioCtx.destination);

    masterGain.gain.setValueAtTime(0, t);
    masterGain.gain.linearRampToValueAtTime(0.25, t + 0.05);
    masterGain.gain.exponentialRampToValueAtTime(0.01, t + 1.5);

    // Harmonious dual-tone (Major third: C5, E5) for a pleasant chime
    const freqs = [523.25, 659.25];

    const oscillators = freqs.map((freq) => {
      const osc = audioCtx!.createOscillator();
      osc.type = 'sine'; // Soft, pure tone
      osc.frequency.setValueAtTime(freq, t);
      osc.connect(masterGain);
      osc.start(t);
      osc.stop(t + 2.0);
      return osc;
    });

    // Cleanup nodes after playing
    setTimeout(() => {
      oscillators.forEach((osc) => osc.disconnect());
      masterGain.disconnect();
    }, 2500);
  } catch (err) {
    console.warn('Ses çalınamadı:', err);
  }
};

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      notifications: [],
      history: [],
      ttsEnabled: false,
      showNotification: (title, message, type = 'info', options) => {
        const id = Math.random().toString(36).substring(2, 9);
        const safeType = normalizeNotificationType(type);
        const timestamp = Date.now();
        set((state) => ({
          // En eski toast(lar) sessizce düşer — kullanıcı onları kaçırmaz, aynı
          // olay zaten history'e tam olarak yazıldı (bkz. Bildirim Geçmişi paneli).
          notifications: [
            ...state.notifications,
            { id, title, message, type: safeType, action: options?.action, durationMs: options?.durationMs },
          ].slice(-MAX_VISIBLE_TOASTS),
          history: [{ id, title, message, type: safeType, timestamp }, ...state.history].slice(0, NOTIFICATION_HISTORY_LIMIT),
        }));

        // Play dynamic localized feedback sounds based on type
        if (safeType === 'success') {
          playSuccess();
        } else if (safeType === 'error' || safeType === 'warning') {
          playWarning();
        } else {
          playNotificationSound();
        }

        // Voice announcement (Text-To-Speech) — kullanıcı tercihine göre, varsayılan kapalı
        if (get().ttsEnabled) {
          const speakableText = `${title}. ${message}`;
          speakNotification(speakableText);
        }
      },
      removeNotification: (id) => {
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        }));
      },
      setTtsEnabled: (enabled) => set({ ttsEnabled: enabled }),
      clearHistory: () => set({ history: [] }),
    }),
    {
      name: 'muezzin-notification-preferences',
      partialize: (state) => ({ ttsEnabled: state.ttsEnabled, history: state.history }),
    }
  )
);
