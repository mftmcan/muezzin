/**
 * Google OAuth giriş kararlarının SAF (yan etkisiz) çekirdeği. Bu mantık
 * önceden `AuthGuard.tsx`'in içinde React efektleriyle iç içeydi ve test
 * edilemiyordu — 7 ardışık commit'in (bkz. proje kökündeki analiz) her biri
 * bir önceki yamanın açığa çıkardığı yeni bir edge-case'i kapatıyordu. Bu
 * modül, `useAuthStore.ts`'teki auth/rol failsafe mantığının izlediği aynı
 * disiplini (saf fonksiyon + `tests/unit/`) giriş kararlarına uygular.
 */

export type GirisYolu = 'redirect' | 'popup';

// `authDomain` artık hosting ile aynı origin (`ezanmerkezi.web.app`, bkz.
// commit 4f39745) — popup'ın tarihsel var oluş gerekçesi (`.firebaseapp.com`
// handler'ının 3rd-party storage/ITP kısıtına takılması) ortadan kalktı.
// Redirect artık TEK yol. Popup kodu SİLİNMEDİ, yalnızca bu bayrağın
// arkasına alındı — masaüstü boot maliyeti (splash + persistent cache +
// rol snapshot yeniden kurulumu) ölçülüp kötü çıkarsa geri dönüş tek satır.
export const POPUP_DENE = false;

/** Hangi giriş yolunun deneneceğine karar verir. */
export function girisYoluSec(mobilMi: boolean): GirisYolu {
  if (!POPUP_DENE) return 'redirect';
  return mobilMi ? 'redirect' : 'popup';
}

export type PopupHataKarari = 'redirect-fallback' | 'kullaniciya-goster';

// DENYLIST (allowlist DEĞİL): yalnızca gerçek kullanıcı iptali ve config
// hatası redirect'e düşmez. Önceki allowlist (`popup-blocked` →
// `+internal-error` → `+web-storage-unsupported` → `+popup-timeout`)
// büyümeye mahkumdu — Firebase'in üretebileceği HER yeni/bilinmeyen hata
// kodu tanımı gereği bir üretim arızası olup ancak kullanıcı şikayetiyle
// keşfediliyordu. Denylist bu sınıfı yapısal olarak kapatır: bilinmeyen kod
// otomatik olarak redirect-fallback alır.
const REDIRECT_FALLBACK_DISI_KODLAR = new Set<string>([
  'auth/popup-closed-by-user', // gerçek kullanıcı iptali — redirect denemesi yersiz
  'auth/unauthorized-domain', // config hatası — redirect de aynı şekilde başarısız olur
]);

/** Popup denendiğinde (POPUP_DENE=true) hata koduna göre ne yapılacağına karar verir. */
export function popupHatasiniDegerlendir(kod: string): PopupHataKarari {
  return REDIRECT_FALLBACK_DISI_KODLAR.has(kod) ? 'kullaniciya-goster' : 'redirect-fallback';
}

export type RedirectSonucKarari = 'hata-goster' | 'sadece-logla';

// Ağ sınıfı hatalar BİLGİ TAŞIMAZ: zaten oturumu geçerli, offline açılan bir
// PWA kullanıcısında `getRedirectResult` bu kodları atabilir — kullanıcı
// akışını kesmemeli, yalnızca tanı kaydı üretilmeli (bkz. canlıda gözlemlenen
// arıza: offline kullanıcı yanlışlıkla hata ekranına düşürülüyordu).
const AG_SINIFI_KODLAR = new Set<string>(['auth/network-request-failed', 'auth/timeout']);

/** `getRedirectResult` hata koduna göre kullanıcıya hata gösterilip gösterilmeyeceğine karar verir. */
export function redirectSonucunuDegerlendir(kod: string): RedirectSonucKarari {
  return AG_SINIFI_KODLAR.has(kod) ? 'sadece-logla' : 'hata-goster';
}
