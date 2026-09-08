import { db, auth } from '../lib/firebase';
import {
  collection,
  addDoc,
  Timestamp,
  writeBatch,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  type FirestoreError,
} from 'firebase/firestore';
import { useAuthStore } from '../store/useAuthStore';

export interface TelemetryEvent {
  eventType: 'page_view' | 'click' | 'error' | 'performance';
  eventName: string;
  metadata?: Record<string, unknown>;
}

/** Breadcrumb kırıntısı — kullanıcının son eylemlerinin izi */
export interface Breadcrumb {
  action: string;
  category: 'navigation' | 'user_action' | 'network' | 'system';
  data?: Record<string, unknown>;
  timestamp: number; // performance.now()
  wallTime: string; // ISO tarih
}

/** Hata anındaki uygulama durum fotoğrafı */
export interface StateSnapshot {
  authUid: string | null;
  authRole: string | null;
  currentPath: string;
  theme: string | null;
  gpsEnabled: boolean;
  isOnline: boolean;
  swVersion: string | null;
  swState: string | null;
  appVersion: string;
  buildTimestamp: string;
  networkType: string;
  networkRtt: number | null;
  memoryUsedMb: number | null;
}

/** Genişletilmiş hata logu — Firestore'a yazılan tam kayıt */
export interface EnrichedErrorLog {
  errorMessage: string;
  errorStack: string;
  componentStack: string;
  userId: string;
  device: {
    os: string;
    browser: string;
    screenSize: string;
    pwaMode: boolean;
    language: string;
  };
  breadcrumbs: Breadcrumb[];
  stateSnapshot: StateSnapshot;
  timestamp: Timestamp;
}

/** Network Information API — deneysel, TS'in lib.dom.d.ts'inde yok. */
interface NetworkInformationLike {
  effectiveType?: string;
  type?: string;
  rtt?: number;
}

/** performance.memory — yalnızca Chromium, TS'in lib.dom.d.ts'inde yok. */
interface PerformanceMemoryLike {
  usedJSHeapSize: number;
}

/** navigator.userAgentData — deneysel Client Hints API, TS'in lib.dom.d.ts'inde yok. */
interface NavigatorUADataLike {
  platform?: string;
}

/** Kuyruğa alınmış, henüz Firestore'a yazılmamış olay. */
type QueuedTelemetryEvent = {
  eventType: TelemetryEvent['eventType'];
  eventName: string;
  userId: string;
  metadata: Record<string, unknown>;
  timestamp: Timestamp;
};

/** localStorage yedeğinden geri okunan olay — JSON serileştirme Timestamp
 *  sınıfını sıradan {seconds,nanoseconds} nesnesine indirger. */
type BackedUpTelemetryEvent = Omit<QueuedTelemetryEvent, 'timestamp'> & {
  timestamp?: { seconds: number; nanoseconds: number } | null;
};

// ─── Breadcrumb Halka Tamponu ─────────────────────────────────────────────────
const MAX_BREADCRUMBS = 25;
const breadcrumbBuffer: Breadcrumb[] = [];

function pushBreadcrumb(crumb: Omit<Breadcrumb, 'timestamp' | 'wallTime'>) {
  breadcrumbBuffer.push({
    ...crumb,
    timestamp: Math.round(performance.now()),
    wallTime: new Date().toISOString(),
  });
  if (breadcrumbBuffer.length > MAX_BREADCRUMBS) {
    breadcrumbBuffer.shift(); // Halka: en eski kırıntıyı at
  }
}

function getBreadcrumbs(): Breadcrumb[] {
  return [...breadcrumbBuffer];
}

// ─── PWA Service Worker Sürümü ───────────────────────────────────────────────
async function getSwInfo(): Promise<{ version: string | null; state: string | null }> {
  try {
    if (!('serviceWorker' in navigator)) return { version: null, state: null };
    const reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg) return { version: null, state: null };
    const sw = reg.active || reg.installing || reg.waiting;
    const state = reg.active ? 'active' : reg.installing ? 'installing' : reg.waiting ? 'waiting' : 'unknown';
    // SW scriptURL'den versiyon hash'ini çıkar (örn: /sw.js?v=abc123)
    const scriptUrl = sw?.scriptURL || '';
    const versionMatch = scriptUrl.match(/[?&]v=([^&]+)/);
    const version = versionMatch ? versionMatch[1] : scriptUrl.split('/').pop() || null;
    return { version, state };
  } catch {
    return { version: null, state: null };
  }
}

// ─── Ağ Durumu ───────────────────────────────────────────────────────────────
function getNetworkInfo(): { type: string; rtt: number | null } {
  const nav = navigator as Navigator & Record<'connection' | 'mozConnection' | 'webkitConnection', NetworkInformationLike | undefined>;
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
  if (!conn) return { type: navigator.onLine ? 'online' : 'offline', rtt: null };
  return {
    type: conn.effectiveType || conn.type || (navigator.onLine ? 'online' : 'offline'),
    rtt: typeof conn.rtt === 'number' ? conn.rtt : null,
  };
}

// ─── Bellek Kullanımı ─────────────────────────────────────────────────────────
function getMemoryMb(): number | null {
  try {
    const mem = (performance as Performance & { memory?: PerformanceMemoryLike }).memory;
    if (!mem) return null;
    return Math.round(mem.usedJSHeapSize / 1024 / 1024);
  } catch {
    return null;
  }
}

// ─── Durum Fotoğrafı ─────────────────────────────────────────────────────────
async function captureStateSnapshot(): Promise<StateSnapshot> {
  const user = auth.currentUser;
  const swInfo = await getSwInfo();
  const net = getNetworkInfo();

  // Döngüsel bağımlılıkları (circular dependency) önlemek için store'lara gitmek yerine
  // doğrudan tarayıcının yerel hafızasından senkron ve hızlı okuma yapıyoruz.
  let theme: string | null = null;
  let gpsEnabled = false;

  try {
    const themeStoreRaw = localStorage.getItem('muezzin-theme-storage');
    if (themeStoreRaw) {
      theme = JSON.parse(themeStoreRaw).state?.theme || null;
    }
  } catch {
    /* yoksay */
  }

  try {
    const gpsStoreRaw = localStorage.getItem('muezzin-gps-vakit-storage');
    if (gpsStoreRaw) {
      gpsEnabled = JSON.parse(gpsStoreRaw).state?.gpsEnabled || false;
    }
  } catch {
    /* yoksay */
  }

  // NOT: Bu uygulama Firebase Auth custom claims KULLANMIYOR — rol bilgisi
  // Firestore'daki muezzins/{uid}.role alanında tutuluyor ve useAuthStore
  // tarafından oraya abone olunarak okunuyor. Önceki sürüm burada
  // getIdTokenResult().claims['role'] okuyordu; bu alan hiçbir zaman
  // set edilmediğinden authRole daima null geliyordu.
  const authRole = useAuthStore.getState().role;

  return {
    authUid: user ? user.uid : null,
    authRole,
    currentPath: typeof window !== 'undefined' ? window.location.pathname : '/',
    theme,
    gpsEnabled,
    isOnline: navigator.onLine,
    swVersion: swInfo.version,
    swState: swInfo.state,
    appVersion: __APP_VERSION__,
    buildTimestamp: __BUILD_TIMESTAMP__,
    networkType: net.type,
    networkRtt: net.rtt,
    memoryUsedMb: getMemoryMb(),
  };
}

// ─── TelemetryService Sınıfı ─────────────────────────────────────────────────
class TelemetryService {
  private isEnabled: boolean = true;
  private eventQueue: QueuedTelemetryEvent[] = [];
  private flushTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly BATCH_SIZE = 5;
  private readonly FLUSH_INTERVAL_MS = 10000; // 10 saniye

  // logError() önceden dedup/rate-limit'siz, addDoc ile anında ve batch dışı
  // yazıyordu — render döngüsünde tekrarlayan bir hata Spark'ın 20K/gün
  // yazma kotasını tek bir kullanıcı sekmesinde tüketebilirdi (bkz. premium
  // denetim, bölüm 7/17). Aynı imzalı hata oturum başına en fazla
  // ERROR_WRITES_PER_SIGNATURE kez, dizge genelinde dakikada en fazla
  // MAX_ERROR_WRITES_PER_MINUTE kez Firestore'a yazılır.
  private errorSignatureCounts = new Map<string, number>();
  private readonly MAX_ERROR_WRITES_PER_SIGNATURE = 3;
  private errorWriteTimestamps: number[] = [];
  private readonly MAX_ERROR_WRITES_PER_MINUTE = 5;
  private readonly ERROR_RATE_WINDOW_MS = 60000;
  private suppressedErrorCount = 0;

  constructor() {
    const savedConsent = localStorage.getItem('muezzin-telemetry-consent');
    this.isEnabled = savedConsent !== 'false';

    if (typeof window !== 'undefined') {
      // Bir önceki oturumdan kalan yedeği kurtar ve gönder
      this.restoreBackupQueue();

      window.addEventListener('beforeunload', () => {
        this.backupQueueToLocalStorage();
      });
      window.addEventListener('pagehide', () => {
        this.backupQueueToLocalStorage();
      });

      // PWA: Sayfa arka plana geçtiğinde olayları hemen gönder
      window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.flushEvents();
        }
      });

      // Global runtime hata yakalayıcısı
      window.addEventListener('error', (event) => {
        if (event.message?.includes('ResizeObserver')) return;
        const error = event.error || new Error(event.message || 'Bilinmeyen Çalışma Zamanı Hatası');
        pushBreadcrumb({
          action: `Runtime Exception: ${event.message?.slice(0, 80)}`,
          category: 'system',
          data: { file: event.filename, line: event.lineno, col: event.colno },
        });
        this.logError(error, `Global Runtime Exception: ${event.filename || 'Bilinmeyen Dosya'}:${event.lineno || 0}:${event.colno || 0}`);
      });

      // İşlenmemiş promise reddi yakalayıcısı
      window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        if (reason?.message?.includes('ResizeObserver')) return;
        const error =
          reason instanceof Error
            ? reason
            : new Error(typeof reason === 'string' ? reason : JSON.stringify(reason) || 'Unhandled Promise Rejection');
        pushBreadcrumb({
          action: `Unhandled Rejection: ${error.message.slice(0, 80)}`,
          category: 'system',
        });
        this.logError(error, 'Global Unhandled Promise Rejection');
      });

      // Çevrimiçi/çevrimdışı durum değişikliklerini breadcrumb olarak kaydet.
      // Önceden 'online' yalnızca breadcrumb kaydediyor, flushEvents()'i hiç
      // tetiklemiyordu — bir flush denemesi gerçek bir hatayla (yalnızca düz
      // offline değil) başarısız olup kullanıcı sayfada gezinmiyorsa (yeni
      // logEvent tetiklenmiyorsa), kuyruk bağlantı geri geldiğinde bile
      // kendiliğinden boşalmıyordu (bkz. flushEvents'in catch bloğu — beşinci
      // denetim turu).
      window.addEventListener('online', () => {
        pushBreadcrumb({ action: 'Ağ Bağlantısı Sağlandı', category: 'network' });
        this.flushEvents();
      });
      window.addEventListener('offline', () => {
        pushBreadcrumb({ action: 'Ağ Bağlantısı Kesildi', category: 'network' });
      });
    }
  }

  private backupQueueToLocalStorage() {
    if (!this.isEnabled || this.eventQueue.length === 0) return;
    try {
      localStorage.setItem('muezzin-telemetry-backup', JSON.stringify(this.eventQueue));
      this.eventQueue = []; // Mükerrer yazmaları önlemek için kuyruğu boşalt
    } catch (err) {
      console.warn('Telemetry kuyruk yedeği başarısız oldu:', err);
    }
  }

  private restoreBackupQueue() {
    if (!this.isEnabled) return;
    try {
      const saved = localStorage.getItem('muezzin-telemetry-backup');
      if (saved) {
        localStorage.removeItem('muezzin-telemetry-backup');
        const restored = JSON.parse(saved) as BackedUpTelemetryEvent[];
        if (Array.isArray(restored) && restored.length > 0) {
          // Bu kurtarma, oturum açılmadan (constructor'da) çalıştığından
          // `auth.currentUser` genelde henüz null'dur; o durumda filtreleme
          // yapılamaz — asıl koruma `flushEvents`'te, gönderim ANINDA
          // uygulanır (bkz. oradaki yorum). Kullanıcı zaten belliyse burada
          // da erken elenir.
          const aktifUid = auth.currentUser?.uid;
          const kullanilabilir = aktifUid ? restored.filter((evt) => evt.userId === aktifUid) : restored;
          const restoredEvents: QueuedTelemetryEvent[] = kullanilabilir.map((evt) => {
            let timestampVal = Timestamp.now();
            if (evt.timestamp) {
              if (typeof evt.timestamp.seconds === 'number' && typeof evt.timestamp.nanoseconds === 'number') {
                timestampVal = new Timestamp(evt.timestamp.seconds, evt.timestamp.nanoseconds);
              }
            }
            return {
              ...evt,
              timestamp: timestampVal,
            };
          });
          this.eventQueue = [...restoredEvents, ...this.eventQueue];
          this.flushEvents();
        }
      }
    } catch (err) {
      console.warn('Telemetry kuyruk kurtarma başarısız oldu:', err);
    }
  }

  /** Kullanıcı rızasını günceller (KVKK / GDPR) */
  setConsent(consent: boolean) {
    this.isEnabled = consent;
    localStorage.setItem('muezzin-telemetry-consent', consent ? 'true' : 'false');
    this.logEvent({
      eventType: 'performance',
      eventName: consent ? 'TELEMETRY_ENABLED' : 'TELEMETRY_DISABLED',
      metadata: { consentState: consent },
    });
  }

  getConsentState(): boolean {
    return this.isEnabled;
  }

  /**
   * Bir breadcrumb kırıntısı ekle (dışarıdan çağrılabilir)
   */
  addBreadcrumb(action: string, category: Breadcrumb['category'], data?: Breadcrumb['data']) {
    pushBreadcrumb({ action, category, data });
  }

  /**
   * Breadcrumb halka tamponunu boşaltır — `performLogout`'un çağırması
   * gerekir. Tampon modül-seviyesinde (kullanıcı bazlı değil, sekme/cihaz
   * ömrü boyunca) kalıcı olduğundan, çıkış yapılmadan temizlenmezse paylaşılan
   * bir cihazda (ör. cami ofisi tableti) sonraki kullanıcının ilk hatası,
   * önceki kullanıcının eylemlerini breadcrumb olarak taşır — hata ayıklarken
   * yanlış kullanıcıya atfedilen bir eylem izi oluşur (bkz. mimari denetim).
   */
  clearBreadcrumbs() {
    breadcrumbBuffer.length = 0;
  }

  /**
   * Bekleyen (henüz Firestore'a yazılmamış) olay kuyruğunu ve varsa
   * localStorage yedeğini temizler — `performLogout`'un çağırması gerekir.
   * `eventQueue` (breadcrumbBuffer gibi) modül-seviyesinde, kullanıcı bazlı
   * DEĞİL tutulur. Çıkışta temizlenmezse paylaşılan bir cihazda (ör. cami
   * ofisi tableti) önceki kullanıcının olayları sonraki kullanıcının auth
   * bağlamıyla yazılmaya çalışılır; `isValidTelemetryLog`'un
   * `data.userId == request.auth.uid` şartı TEK batch'teki TÜM olayları
   * (yeni kullanıcının meşru olayları dahil) reddeder ve `flushEvents`'in
   * catch bloğu kirli kuyruğu geri kuyruğa koyup yeniden dener — kirli olay
   * kuyruktan çıkmadığı sürece o oturum boyunca hiçbir telemetri/hata kaydı
   * Firestore'a yazılamaz (bkz. kod denetimi, kritik bulgu).
   */
  clearQueue() {
    this.eventQueue = [];
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }
    try {
      localStorage.removeItem('muezzin-telemetry-backup');
    } catch {
      /* yoksay */
    }
  }

  private getDeviceMetadata() {
    return {
      os:
        (navigator as Navigator & { userAgentData?: NavigatorUADataLike }).userAgentData?.platform || navigator.platform || 'Bilinmeyen OS',
      browser: this.getBrowserName(),
      screenSize: `${window.innerWidth}x${window.innerHeight}`,
      pwaMode: window.matchMedia('(display-mode: standalone)').matches,
      language: navigator.language,
    };
  }

  private getBrowserName(): string {
    const ua = navigator.userAgent;
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('OPR') || ua.includes('Opera')) return 'Opera';
    if (ua.includes('Edg')) return 'Edge';
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Safari')) return 'Safari';
    return 'Diğer/Mobil Tarayıcı';
  }

  private async flushEvents() {
    // Zamanlayıcı handle'ı HER İKİ erken çıkıştan (boş kuyruk, oturum yok)
    // ÖNCE temizlenir — önceden `!auth.currentUser` dalı bunun ÜSTÜNDEydi:
    // zamanlayıcı ateşlenip bu dala düşünce `flushTimeout` hâlâ (artık
    // ateşlenmiş, işe yaramaz) eski handle'ı tutuyordu; `logEvent()`'teki
    // `!this.flushTimeout` kontrolü bunu "hâlâ zamanlanmış" sanıp yeni bir
    // zamanlayıcı hiç kurmuyordu — kuyruk BATCH_SIZE'a ulaşmadıkça sayfa
    // kapanana kadar askıda kalabiliyordu (premium hata analizi HS-O7).
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    if (this.eventQueue.length === 0) return;
    if (!auth.currentUser) return;

    // Kuyrukta BAŞKA bir kullanıcıya ait olay kalmış olabilir: paylaşılan bir
    // cihazda (cami ofisi tableti) kullanıcı A açık çıkış yapmadan sekmeyi
    // kapatırsa `backupQueueToLocalStorage` A'nın olaylarını localStorage'a
    // yazar (`clearQueue` yalnızca `performLogout` yolunda çalışır) ve
    // constructor bunları sonraki oturumda geri yükler. `isValidTelemetryLog`
    // `data.userId == request.auth.uid` şart koştuğundan, TEK bir yabancı olay
    // TÜM batch'i (B'nin meşru olayları dahil) reddettirir; catch bloğu kirli
    // kuyruğu geri koyup ~10sn'de bir sonsuza dek yeniden dener — B'nin hiçbir
    // telemetri/hata kaydı o oturum boyunca yazılamaz (bkz. kod denetimi ve
    // `clearQueue`'nun docblock'u). Yabancı olaylar zaten hiçbir koşulda
    // gönderilemez (sahibi gitti), bu yüzden gönderim anında elenir/atılır.
    const aktifUid = auth.currentUser.uid;
    const eventsToFlush = this.eventQueue.filter((evt) => evt.userId === aktifUid);
    const yabanciOlaySayisi = this.eventQueue.length - eventsToFlush.length;
    this.eventQueue = [];
    if (yabanciOlaySayisi > 0) {
      console.warn(`Telemetry: başka kullanıcıya ait ${yabanciOlaySayisi} bayat olay atıldı.`);
    }
    if (eventsToFlush.length === 0) return;

    try {
      const batch = writeBatch(db);
      eventsToFlush.forEach((evt) => {
        const docRef = doc(collection(db, 'telemetry_logs'));
        batch.set(docRef, evt);
      });
      await batch.commit();
    } catch (err) {
      console.warn('Telemetry toplu log hatası:', err);
      // Hata durumunda olayları geri alıp kaybolmasını önleyelim
      this.eventQueue = [...eventsToFlush, ...this.eventQueue].slice(0, 50);
      // Önceden burada yeni bir flushTimeout kurulmuyordu — bir sonraki
      // otomatik deneme yalnızca YENİ bir logEvent() çağrısının (satır
      // ~391) zamanlayıcıyı yeniden kurmasına bağlıydı. Sayfada gezinme/
      // tıklama olmayan bir oturumda kuyruk süresiz askıda kalabiliyordu
      // (bkz. beşinci denetim turu). Kuyruk yeniden dolu kaldığından
      // burada da bir zamanlayıcı kurulur.
      if (this.eventQueue.length > 0 && !this.flushTimeout) {
        this.flushTimeout = setTimeout(() => this.flushEvents(), this.FLUSH_INTERVAL_MS);
      }
    }
  }

  /** Sayfa geçişlerini ve tıklamaları kuyruğa ekler ve toplu yazar */
  logEvent(event: TelemetryEvent) {
    if (!this.isEnabled) return;

    const currentUser = auth.currentUser;
    if (!currentUser) return;

    const eventData = {
      eventType: event.eventType,
      eventName: event.eventName,
      userId: currentUser.uid,
      metadata: {
        ...event.metadata,
        device: this.getDeviceMetadata(),
      },
      timestamp: Timestamp.now(),
    };

    this.eventQueue.push(eventData);

    if (this.eventQueue.length >= this.BATCH_SIZE) {
      this.flushEvents();
    } else if (!this.flushTimeout) {
      this.flushTimeout = setTimeout(() => this.flushEvents(), this.FLUSH_INTERVAL_MS);
    }
  }

  /**
   * Zenginleştirilmiş hata kaydı:
   * Stack trace + Breadcrumb izleri + Store durum fotoğrafı + PWA/SW sürümü + Ağ durumu
   */
  async logError(error: Error, componentStack?: string) {
    if (!this.isEnabled) return;
    if (!auth.currentUser) return;

    // İmza: mesaj + ilk stack satırı — aynı hatanın tekrarlarını (örn. bir
    // render döngüsünde saniyede onlarca kez fırlayan aynı istisna) ayırt
    // etmeden say. Uzunluk Map anahtarı için sorun değil.
    const signature = `${error.message}::${(error.stack || '').split('\n')[1] || ''}`.slice(0, 300);
    const signatureCount = this.errorSignatureCounts.get(signature) ?? 0;
    if (signatureCount >= this.MAX_ERROR_WRITES_PER_SIGNATURE) {
      this.suppressedErrorCount++;
      console.warn(`Hata günlüğü bastırıldı (imza kotası doldu): ${signature}`);
      return;
    }

    const now = Date.now();
    this.errorWriteTimestamps = this.errorWriteTimestamps.filter((ts) => now - ts < this.ERROR_RATE_WINDOW_MS);
    if (this.errorWriteTimestamps.length >= this.MAX_ERROR_WRITES_PER_MINUTE) {
      this.suppressedErrorCount++;
      console.warn('Hata günlüğü bastırıldı (dakikalık yazma kotası doldu).');
      return;
    }

    // Sayaçlar DENEME anında artırılır, yalnızca yazım BAŞARILI olduğunda
    // değil — aksi halde rate limiter tam da korunması gereken senaryoda
    // (yazım offline/permission-denied ile reddediliyor) hiç devreye
    // girmiyordu: her tekrar deneme tam state snapshot'ı ile yeniden
    // yazım deniyordu (premium hata analizi HS-O2).
    this.errorSignatureCounts.set(signature, signatureCount + 1);
    this.errorWriteTimestamps.push(now);

    try {
      const [stateSnapshot] = await Promise.all([captureStateSnapshot()]);
      const crumbs = getBreadcrumbs();

      // firestore.rules isValidErrorLog errorMessage<=2000, errorStack/
      // componentStack<=8000 karakter şartı koyuyor — istemci tarafında
      // kırpma yapılmıyordu, bu sınırları aşan bir payload TAMAMEN
      // reddediliyor ve dıştaki catch bloğu bunu yalnızca console.warn ile
      // yutuyordu. En ciddi çökmelerin (en uzun stack'lerin) tam da
      // loglanamayan tür olması riski vardı (bkz. beşinci denetim turu).
      const suppressedPrefix = this.suppressedErrorCount > 0 ? `[${this.suppressedErrorCount} bastırılmış hata sonrası] ` : '';
      const payload: EnrichedErrorLog = {
        errorMessage: (suppressedPrefix + error.message).slice(0, 2000),
        errorStack: (error.stack || '').slice(0, 8000),
        componentStack: (componentStack || '').slice(0, 8000),
        userId: auth.currentUser.uid,
        device: this.getDeviceMetadata(),
        breadcrumbs: crumbs,
        stateSnapshot,
        timestamp: Timestamp.now(),
      };

      await addDoc(collection(db, 'error_logs'), payload);
      this.suppressedErrorCount = 0;
    } catch (err) {
      console.warn('Hata günlüğü yazılamadı:', err);
    }
  }

  /** Yönetici işlem denetim izi */
  async logAudit(actionType: string, targetName: string, details: string) {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) return;

      pushBreadcrumb({
        action: `Admin: ${actionType} — ${targetName}`,
        category: 'user_action',
        data: { details },
      });
      await addDoc(collection(db, 'audit_logs'), {
        actionType,
        targetName,
        details,
        userId: currentUser.uid,
        userDisplayName: currentUser.displayName || currentUser.email || 'Bilinmeyen Admin',
        timestamp: Timestamp.now(),
      });
    } catch (err) {
      console.warn('Audit log write error:', err);
    }
  }
}

export const telemetryService = new TelemetryService();

/** Admin panelindeki en son 20 hata kaydını canlı dinler. */
export function errorLogsAbone(
  onData: (logs: (Partial<EnrichedErrorLog> & { id: string })[]) => void,
  onError: (error: FirestoreError) => void
): () => void {
  const q = query(collection(db, 'error_logs'), orderBy('timestamp', 'desc'), limit(20));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Partial<EnrichedErrorLog> & { id: string })),
    onError
  );
}

/** Tüm hata günlüklerini kalıcı olarak siler (Firestore'un 500'lük batch sınırına göre parçalar halinde). */
export async function errorLoglariniTemizle(): Promise<void> {
  const snap = await getDocs(collection(db, 'error_logs'));
  const CHUNK_SIZE = 400;
  for (let i = 0; i < snap.docs.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    snap.docs.slice(i, i + CHUNK_SIZE).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}
