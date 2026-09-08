import { useState, useEffect, useRef } from 'react';

// Gerçek erişilebilirliği doğrulamak için periyodik prob aralığı — `online`/
// `offline` olayları arasında da (ör. captive portal, veri kotası bitmiş bir
// hat) durumu tazeler.
const PROB_ARALIGI_MS = 30_000;
const PROB_ZAMAN_ASIMI_MS = 5_000;

/**
 * `navigator.onLine` yalnızca cihazda bir ağ ARAYÜZÜ olup olmadığını söyler
 * — gerçek internet erişimini değil. Captive portal'lı bir Wi-Fi'ye veya
 * veri kotası bitmiş bir hatta bağlıyken `navigator.onLine === true` kalır,
 * ama Firestore yazımları/okumaları sessizce askıda kalır ve OfflineBanner
 * hiç görünmez (düşük öncelikli bulgu). Aynı köken (same-origin) bir HEAD
 * isteğiyle periyodik olarak gerçek erişilebilirlik doğrulanır — üçüncü
 * taraf bir uç nokta gerekmediğinden CSP/gizlilik sorunu yaratmaz ve
 * uygulamayı fiilen barındıran sunucuya erişilebiliyorsa internetin de
 * çalıştığına dair makul bir kanıttır.
 */
async function gercektenCevrimIciMi(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  if (typeof fetch === 'undefined') return true;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROB_ZAMAN_ASIMI_MS);
  try {
    await fetch(`${location.origin}/favicon.svg?_probe=${Date.now()}`, {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(() => (typeof window !== 'undefined' ? navigator.onLine : true));
  // Aynı anda birden fazla prob'un çakışmasını önler (ör. bir 'online'
  // olayı ile periyodik zamanlayıcı aynı ana denk gelirse).
  const probCalisiyorRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const probEt = async () => {
      if (probCalisiyorRef.current) return;
      probCalisiyorRef.current = true;
      try {
        setIsOnline(await gercektenCevrimIciMi());
      } finally {
        probCalisiyorRef.current = false;
      }
    };

    const handleOnline = () => {
      void probEt();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const interval = setInterval(() => {
      void probEt();
    }, PROB_ARALIGI_MS);
    void probEt();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  return { isOnline };
}
