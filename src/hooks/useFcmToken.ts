import { useState, useEffect } from 'react';
import {
  clearIndexedDbPersistence,
  doc,
  serverTimestamp,
  setDoc,
  terminate,
  updateDoc,
  deleteField,
  type DocumentData,
  type UpdateData,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { app, db, auth } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { zamanAsimiIle } from '../lib/timeoutUtils';
import { useNotificationStore } from '../store/useNotificationStore';
import { useGpsVakitStore } from '../store/useGpsVakitStore';
import { telemetryService } from '../services/telemetryService';

// NOT: Bu değer Firebase Console → Proje Ayarları → Cloud Messaging →
// Web push sertifikaları'ndan alınan GERÇEK VAPID public key olmalı.
// Daha önce burada web-push codelab'lerinde dolaşan herkese açık ÖRNEK bir
// anahtar sabitlenmişti — bu, tarayıcının kayıtlı olduğu push aboneliğinin
// projenin gerçek gönderen kimliğiyle eşleşmemesine (SenderIdMismatch) ve
// admin SDK'nın bu token'lara bildirim göndermesinin sessizce başarısız
// olmasına yol açar.
const VAPID_KEY = import.meta.env.VITE_FCM_VAPID_KEY as string | undefined;

// Bu cihazın en son kaydettiği token — rotasyonda ESKİSİNİ fcmTokens
// haritasından silebilmek için (bkz. saveTokenToFirestore, HS-O3).
const LAST_TOKEN_KEY = 'muezzin_fcm_last_token';

async function saveTokenToFirestore(uid: string, token: string) {
  const path = `muezzins/${uid}`;
  try {
    let oncekiToken: string | null = null;
    try {
      oncekiToken = localStorage.getItem(LAST_TOKEN_KEY);
    } catch {
      /* gizli/erisimsiz depolama — yoksay */
    }

    const guncellemeler: Record<string, unknown> = {
      fcmToken: token,
      [`fcmTokens.${token}`]: serverTimestamp(),
    };
    // fcmTokens haritası önceden istemci tarafında HİÇ budanmıyordu —
    // yalnızca gönderim BAŞARISIZ olduğunda sunucu tarafında temizleniyordu
    // (bkz. scripts/lib/fcmNotify.ts). Tarayıcı token'ı periyodik olarak
    // yenilediğinde eski girdi kalıcı olarak birikip firestore.rules'taki
    // 20 girdi tavanına çarpabiliyordu — kullanıcı bunu asla fark etmeden
    // (premium hata analizi HS-O3). Bu cihazın BİR ÖNCEKİ token'ı biliniyorsa
    // (rotasyon) aynı yazımda haritadan silinir.
    if (oncekiToken && oncekiToken !== token) {
      guncellemeler[`fcmTokens.${oncekiToken}`] = deleteField();
    }

    await setDoc(doc(db, 'muezzins', uid), guncellemeler, { merge: true });
    try {
      localStorage.setItem(LAST_TOKEN_KEY, token);
    } catch {
      /* gizli/erisimsiz depolama — yoksay */
    }
  } catch (err) {
    // Push token kaydı arka planda, kullanıcıya görünmeden çalışır — ama
    // sessizce başarısız olursa kişi nöbet hatırlatıcısı almadığını hiç
    // fark etmez. handleFirestoreError ile telemetriye düşürülür ki bu
    // durum en azından geliştirici tarafında görünür olsun (bkz. algoritma
    // denetimi).
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function registerFcmToken(requestPermission = false): Promise<{
  token: string | null;
  permission: NotificationPermission | null;
}> {
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
    return { token: null, permission: null };
  }

  const permission = requestPermission ? await Notification.requestPermission() : Notification.permission;

  if (permission !== 'granted') {
    return { token: null, permission };
  }

  if (!VAPID_KEY) {
    console.warn('VITE_FCM_VAPID_KEY tanımlı değil; push bildirimleri devre dışı.');
    return { token: null, permission };
  }

  const [{ getMessaging, getToken }, registration] = await Promise.all([import('firebase/messaging'), navigator.serviceWorker.ready]);
  const messaging = getMessaging(app);
  const currentToken = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  });

  if (!currentToken) {
    return { token: null, permission };
  }

  const user = auth.currentUser;
  if (user) {
    await saveTokenToFirestore(user.uid, currentToken);
  }

  return { token: currentToken, permission };
}

/**
 * Çıkış (logout) sırasında bu cihazın push aboneliğini iptal eder ve
 * Firestore'daki `fcmTokens` haritasından bu cihaza ait girdiyi siler.
 *
 * Önceden `logout()` yalnızca `auth.signOut()` çağırıyordu — cihazın FCM
 * token'ı hem tarayıcıda hem Firestore'da kayıtlı kalıyordu. Paylaşılan/ortak
 * bir cihazda (ör. cami ofisindeki tablet) bir müezzin çıkış yaptıktan sonra
 * bir başkası giriş yapsa bile, eski kullanıcının push aboneliği hâlâ aktif
 * kalıyor ve nöbet hatırlatıcı/mazeret bildirimleri o cihaza gelmeye devam
 * edebiliyordu. Ayrıca `fcmTokens` haritası yalnızca GÖNDERİM BAŞARISIZ
 * olduğunda sunucu tarafında budanıyor (bkz. scripts/haftalikPlanOlustur.ts,
 * scripts/yatsiSonuIslemleri.ts) — çıkış yapılsa da token teknik olarak
 * hâlâ geçerli olduğundan bu şekilde asla temizlenmiyordu ve
 * firestore.rules'taki `isValidFcmTokens` 20 girdi tavanına (bkz. mimari
 * denetim) zamanla çarpılabiliyordu.
 *
 * Firestore güncellemesi `auth.signOut()`'tan ÖNCE çağrılmalı — kendi
 * `muezzins/{uid}` belgesini güncelleme izni yalnızca oturum açıkken var.
 */
export async function unregisterFcmToken(uid: string | undefined): Promise<void> {
  if (!uid) return;
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) return;
  if (!VAPID_KEY) return;

  try {
    const [{ getMessaging, getToken, deleteToken }, registration] = await Promise.all([
      import('firebase/messaging'),
      navigator.serviceWorker.getRegistration(),
    ]);
    if (!registration) return;

    const messaging = getMessaging(app);
    const currentToken = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    }).catch(() => null);

    await deleteToken(messaging).catch(() => {});

    // Tekil `fcmToken` alanı da (fcmTokens haritasından bağımsız olarak)
    // temizlenir — scripts/lib/fcmNotify.ts, fcmTokens boşaldığında bu
    // alana FALLBACK yapıyor; önceden yalnızca haritadaki girdi
    // siliniyordu, tek cihazlı bir kullanıcı çıkış yaptığında bu alan
    // dokunulmadan kalıp bir sonraki kullanıcının (paylaşılan cihazda)
    // eskisinin bildirimlerini almaya devam etmesine yol açabiliyordu
    // (premium hata analizi HS-O4).
    const guncellemeler: UpdateData<DocumentData> = { fcmToken: deleteField() };
    if (currentToken) {
      guncellemeler[`fcmTokens.${currentToken}`] = deleteField();
    }
    await updateDoc(doc(db, 'muezzins', uid), guncellemeler).catch(() => {});
    try {
      localStorage.removeItem(LAST_TOKEN_KEY);
    } catch {
      /* gizli/erisimsiz depolama — yoksay */
    }
  } catch {
    // Çıkış akışını asla engellemesin — en iyi çaba (best-effort) temizlik.
  }
}

/**
 * Uygulamadaki HER "Oturumu Kapat" düğmesinin çağırması gereken tek
 * çıkış yolu — `unregisterFcmToken` + `auth.signOut()` sırasını garanti eder.
 *
 * Bu tek fonksiyon olmadan üç ayrı ekran (AuthGuard.tsx, MuezzinAyarlari.tsx,
 * admin/AdminPanel.tsx) kendi `auth.signOut()` çağrısını doğrudan yapıyordu;
 * FCM token temizliği yalnızca AuthGuard'a eklenmişti (bkz. yukarıdaki
 * unregisterFcmToken yorumu) — normal kullanıcıların günlük akışta asıl
 * kullandığı MuezzinAyarlari.tsx'in çıkış düğmesi ve admin panelinin çıkış
 * düğmesi bu düzeltmeyi hiç görmüyordu (bkz. code-review, dördüncü denetim
 * turu). Yeni bir çıkış noktası eklenirse aynı sınıf regresyonu tekrarlamamak
 * için doğrudan `auth.signOut()` yerine bu fonksiyon çağrılmalı.
 *
 * `unregisterFcmToken` içindeki Firestore yazımı çevrimdışıyken (SDK'nın
 * persistentLocalCache'i etkinken) sonsuza dek askıda kalabiliyordu — bu da
 * `await`'in hiç dönmemesine, dolayısıyla `auth.signOut()`'un hiç
 * çağrılmamasına yol açıyordu: kullanıcı çevrimdışıyken "çıkış yapamaz"
 * halde kalıyordu (bkz. beşinci denetim turu). `unregisterFcmToken` zaten
 * en-iyi-çaba (best-effort) bir temizlik olduğundan, kısa bir zaman aşımı
 * sonrası beklemeden `auth.signOut()`'a devam edilir — Firestore'un kendi
 * offline kuyruğu token temizliğini arka planda tamamlar.
 */
export async function performLogout(): Promise<void> {
  try {
    await zamanAsimiIle(unregisterFcmToken(auth.currentUser?.uid), 4000);
  } catch {
    // Zaman aşımı ya da başka bir hata — temizlik en iyi çabaydı, çıkışı
    // engellemeden devam et.
  }
  await auth.signOut();
  // FCM token temizliğiyle AYNI sınıftan bir sızıntı: bildirim geçmişi
  // (localStorage, cihaz bazlı), breadcrumb/telemetri kuyruğu (modül-
  // seviyesi, sekme ömrü boyunca) ve GPS konum/vakit önbelleği kullanıcı
  // bazlı değil — paylaşılan bir cihazda (ör. cami ofisi tableti) çıkış
  // yapmadan temizlenmezse bir sonraki kullanıcı öncekinin bildirim
  // geçmişini/hata izlerini/konumunu görmeye devam eder (bkz. mimari
  // denetim; GPS ve telemetri kuyruğu temizliği kod denetimi kritik
  // bulgularıydı — bildirim geçmişi/breadcrumb temizliği zaten vardı).
  useNotificationStore.getState().clearHistory();
  telemetryService.clearBreadcrumbs();
  telemetryService.clearQueue();
  useGpsVakitStore.getState().disableGps();

  // AYNI sınıftan bir sızıntı, ama Firestore SDK seviyesinde: `db`
  // `persistentLocalCache` (IndexedDB) ile başlatılıyor (bkz. lib/firebase.ts)
  // ve bu önbellek çıkışta hiç temizlenmiyordu — paylaşılan bir cihazda
  // (ör. cami ofisi tableti) bir sonraki kullanıcı, gerçek sunucu
  // snapshot'ından ÖNCE/yanında öncekinin önbelleğe alınmış muezzins/
  // izinler/alarmlar belgelerini görebiliyordu (bkz. kod denetimi
  // güvenlik bulgusu). `clearIndexedDbPersistence` aktif dinleyiciler
  // varken başarısız olur (ve bu uygulamada `useAuthStore`'un dinleyicisi
  // KASITLI olarak hiç unsubscribe edilmiyor — bkz. AuthGuard.tsx yorumu),
  // bu yüzden önce `terminate` ile bu sekmenin Firestore istemcisi
  // kapatılır. Bu YALNIZCA güvenli çünkü AuthGuard'ın `logout` çağıranı
  // hemen ardından `window.location.reload()` yapıyor — bu JS bağlamında
  // `db`'nin bir daha kullanılması gerekmiyor, sayfa sıfırdan başlıyor.
  // En iyi çaba: başka bir sekme aynı hesapla açık kalmışsa (persistentMultiple-
  // TabManager) temizleme başarısız olabilir, çıkışı engellememeli.
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch {
    // best-effort — bkz. yukarıdaki yorum.
  }
}

export function useFcmToken() {
  const [token, setToken] = useState<string | null>(null);
  const [notificationPermissionStatus, setNotificationPermissionStatus] = useState<NotificationPermission | null>(null);

  useEffect(() => {
    let unsubAuth: (() => void) | null = null;
    // `retrieveToken` asenkron; bileşen bu tamamlanmadan unmount olursa
    // (StrictMode çift-mount'ta ya da hızlı ekran geçişinde) `unsubAuth`
    // aşağıdaki cleanup çalıştığı anda hâlâ null olabiliyordu — sonradan
    // (cleanup'tan SONRA) kurulan dinleyici bir daha asla kaldırılmıyordu
    // (düşük öncelikli bulgu). Bu bayrak, cleanup'tan sonra gelen geç
    // kurulumu engeller.
    let iptalEdildi = false;

    const retrieveToken = async () => {
      try {
        if (typeof window === 'undefined' || !('Notification' in window)) return;
        const { token: currentToken, permission } = await registerFcmToken(false);
        if (iptalEdildi) return;
        setNotificationPermissionStatus(permission);

        if (!currentToken) return;
        setToken(currentToken);

        if (!auth.currentUser) {
          unsubAuth = onAuthStateChanged(auth, async (freshUser) => {
            if (freshUser) {
              await saveTokenToFirestore(freshUser.uid, currentToken);
              unsubAuth?.();
              unsubAuth = null;
            }
          });
          // Cleanup, `unsubAuth`'ı henüz null iken (yukarıdaki await sırasında)
          // çalışmış olabilir — burada tekrar kontrol edilip geç kaydedilen
          // dinleyici hemen kaldırılır.
          if (iptalEdildi) {
            unsubAuth?.();
            unsubAuth = null;
          }
        }
      } catch (error) {
        console.warn('FCM token alinamadi:', error);
      }
    };

    const timeoutId = setTimeout(retrieveToken, 300);

    return () => {
      iptalEdildi = true;
      clearTimeout(timeoutId);
      if (unsubAuth) unsubAuth();
    };
  }, []);

  return { token, notificationPermissionStatus };
}
