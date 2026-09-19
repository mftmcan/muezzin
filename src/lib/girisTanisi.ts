/**
 * Google OAuth giriş akışının oturumsuz aşamasında (henüz `auth.currentUser`
 * yokken) telemetryService.logError çağrılamıyor — `if (!auth.currentUser)
 * return` kapısı ve firestore.rules'un `isSignedIn()` şartı yüzünden. Bu
 * modül, giriş hatalarını başarılı girişe kadar `localStorage`'da (sessionStorage
 * DEĞİL — d0fffba'nın dersi: bazı mobil proxy/veri-tasarrufu modlarında
 * sessionStorage bayrağı redirect zincirini hayatta çıkaramıyordu) küçük bir
 * halka tamponda tutar; `useAuthStore.ts` oturum kurulduğunda bunu okuyup
 * `telemetryService.logError` ile Firestore'a (artık oturum var, kurallar
 * sağlanır) yazar.
 */

export interface GirisTaniKaydi {
  ts: number;
  asama: 'popup' | 'redirect-baslat' | 'redirect-sonuc' | 'redirect-tamamlanmadi';
  kod: string;
  mesaj?: string;
  ua: string;
  mobilMi: boolean;
  pwaMi: boolean;
  cevrimici: boolean;
  appVersion: string;
  authDomain: string;
}

const STORAGE_KEY = 'muezzin-giris-tanisi';
const MAX_KAYIT = 5;

function oku(): GirisTaniKaydi[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function girisTanisiEkle(
  kayit: Omit<GirisTaniKaydi, 'ts' | 'ua' | 'mobilMi' | 'pwaMi' | 'cevrimici' | 'appVersion' | 'authDomain'>
): void {
  try {
    const mevcut = oku();
    const yeni: GirisTaniKaydi = {
      ...kayit,
      ts: Date.now(),
      ua: navigator.userAgent,
      mobilMi: /android|iphone|ipad|ipod/i.test(navigator.userAgent),
      pwaMi: window.matchMedia('(display-mode: standalone)').matches,
      cevrimici: navigator.onLine,
      appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'bilinmeyen',
      authDomain: window.location.hostname,
    };
    const guncellenmis = [...mevcut, yeni].slice(-MAX_KAYIT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(guncellenmis));
  } catch {
    // localStorage dolu/erişilemez olabilir (gizlilik modu) — giriş akışını
    // ASLA bloklamamalı, sessizce yoksay.
  }
}

/**
 * Kayıtları TEMİZLEMEDEN okur — "Tanı bilgisini kopyala" düğmesi için:
 * kullanıcı hiç giriş yapamıyorsa (kalıcı kilitlenme) tampon asla flush
 * edilmez, bu yüzden panoya kopyalama akışı kayıtları SİLMEMELİ (belki
 * sonradan giriş başarılı olur ve normal flush yolu çalışır).
 */
export function girisTanisiniOku(): GirisTaniKaydi[] {
  return oku();
}

/** Bekleyen kayıtları okuyup tamponu temizler — çağıran taraf bunları hemen flush etmelidir. */
export function girisTanisiniCekVeTemizle(): GirisTaniKaydi[] {
  const kayitlar = oku();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* yoksay */
  }
  return kayitlar;
}

// Redirect'in SESSİZ başarısızlığını tespit etmek için: `signInWithRedirect`
// çağrılmadan HEMEN ÖNCE yazılır (sessionStorage DEĞİL — d0fffba'nın dersi:
// bazı mobil proxy/veri-tasarrufu modlarında sessionStorage bayrağı redirect
// zincirini hayatta çıkaramıyordu). Google'dan dönüşte `getRedirectResult`
// ne hata fırlatır ne de bir kullanıcı döndürürse (3rd-party depolama/ITP
// engeli, `AuthGuard.tsx`'in kendi yorumunda tarif edilen tam senaryo), bu
// damganın varlığı "bekleyen bir redirect gerçekten vardı ama sonuçlanmadı"
// ayrımını sağlar — damgasız bir `null` sonucu (ör. login ekranının ilk
// açılışı) tamamen normaldir ve hataya sayılmamalıdır.
const REDIRECT_DAMGA_KEY = 'muezzin-redirect-baslatildi';

export function redirectBaslatildiIsaretle(): void {
  try {
    localStorage.setItem(REDIRECT_DAMGA_KEY, JSON.stringify({ ts: Date.now() }));
  } catch {
    /* yoksay */
  }
}

/** Damga varsa okuyup temizler (tek kullanımlık). */
export function redirectDamgasiniCekVeTemizle(): { ts: number } | null {
  try {
    const raw = localStorage.getItem(REDIRECT_DAMGA_KEY);
    localStorage.removeItem(REDIRECT_DAMGA_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.ts === 'number' ? parsed : null;
  } catch {
    return null;
  }
}
