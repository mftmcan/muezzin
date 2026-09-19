/**
 * Giriş/oturum boot yolundaki zaman aşımları önceden 3 ayrı dosyaya (`AuthGuard.tsx`,
 * `useAuthStore.ts`) dağılmış, aralarındaki ilişki yalnızca kod okunarak
 * çıkarılabiliyordu. Sayılar burada TEK yerde toplanır — birini değiştirirken
 * diğerleriyle ilişkisini görmeden değiştirmeyi zorlaştırır.
 *
 * Sıralama önemlidir (küçükten büyüğe): `LOADING_UYARI_MS` en erken tetiklenip
 * kullanıcıya "yavaş sürüyor" ipucu verir; `POPUP_MS` ondan hemen sonra devreye
 * girip masaüstünde sessiz-askıda-kalan bir popup'ı redirect'e düşürür;
 * `AUTH_COLD_START_MS` `onAuthStateChanged` hiç ateşlenmezse "oturum belirsiz"
 * durumuna geçer; `ROL_SNAPSHOT_MS` en geç tetiklenir çünkü rol/profil
 * snapshot'ı yalnızca auth ZATEN çözüldükten sonra beklenir.
 */

/** `AuthGuard.tsx` — splash ekranında "bağlantı yavaş" uyarısını gösterme eşiği. */
export const LOADING_UYARI_MS = 4000;

/** `AuthGuard.tsx` login() — `signInWithPopup`'ın sessiz-askıda-kalma ihtimaline karşı zaman aşımı (redirect fallback tetikler). */
export const POPUP_MS = 8000;

/** `useAuthStore.ts` init() — `onAuthStateChanged` hiç ateşlenmezse cold-start failsafe (`authDogrulanamadi`). */
export const AUTH_COLD_START_MS = 4500;

/** `useAuthStore.ts` handleAuthStateChange() — `muezzins/{uid}` snapshot'ı gelmezse rol failsafe (`rolDogrulanamadi`). */
export const ROL_SNAPSHOT_MS = 6000;
