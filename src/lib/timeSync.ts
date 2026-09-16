import { ref, onValue, getDatabase } from 'firebase/database';
import { app } from './firebase';

/**
 * Initializes the server time offset synchronization.
 * Firebase Realtime Database provides a special /.info/serverTimeOffset location
 * which estimates the client's clock skew with respect to the Firebase servers.
 * It is free and does not consume Firestore reads/writes.
 */
export function initTimeSync() {
  try {
    // If we're in a Node environment (like smoke tests), skip RTDB initialization
    if (typeof window === 'undefined') return;

    // EMÜLATÖR/E2E MODU — RTDB'ye HİÇ bağlanma.
    //
    // `firebase emulators:exec` yalnızca firestore+auth emülatörlerini
    // başlatıyor (bkz. package.json `test:*` script'leri ve
    // .github/workflows/test.yml); RTDB'nin emülatörü YOK. Bu yüzden
    // aşağıdaki `getDatabase(app)` emülatör modunda bile GERÇEK production
    // RTDB'sine bağlanıyordu — yani her e2e sayfa yüklemesi canlı bir
    // Firebase servisine ağ bağlantısı açıyordu.
    //
    // Bu yalnızca "gereksiz ağ trafiği" değil, gerçek bir test bozucuydu:
    // `getTurkeyNow()` (dateUtils.ts) bu offset'i HER okumada ekler, yani
    // gelen gerçek sunucu offset'i `page.clock.setFixedTime` ile dondurulmuş
    // saati/tarihi sessizce geçersiz kılıyordu. İki ayrı testte iki ayrı
    // bantajla (visual.spec.ts'te `__timeOffset`'i salt-okunur 0'a sabitleme,
    // mazeret-flow.spec.ts'te RTDB host'una giden istek/WebSocket'i abort
    // etme) örtülmüştü; kök neden burasıydı ve her yeni saat-bağımlı test
    // aynı tuzağa yeniden düşüyordu.
    //
    // PRODUCTION DAVRANIŞI DEĞİŞMEZ: `VITE_USE_EMULATOR` yalnızca test/yerel
    // emülatör modunda '1'dir (playwright.config.ts `webServer.env`;
    // .env.example'da belgeli) — production build'de tanımsız olduğundan bu
    // dal hiç çalışmaz ve saat senkronu eskisi gibi kurulur.
    //
    // Erken dönüş `globalThis.__timeOffset`'i HİÇ yazmaz; `dateUtils.ts`
    // zaten `undefined` durumunda 0 kabul ediyor (`!== undefined` kontrolü),
    // yani emülatör modunda offset kalıcı olarak 0'dır.
    if (import.meta.env.VITE_USE_EMULATOR === '1') return;

    const db = getDatabase(app);
    const offsetRef = ref(db, '.info/serverTimeOffset');

    onValue(offsetRef, (snap) => {
      const offset = snap.val() || 0;
      // Store in globalThis so it can be synchronously accessed by dateUtils
      // without needing React state or store subscriptions (avoids re-renders).
      globalThis.__timeOffset = offset;
    });
  } catch (err) {
    console.warn('Time synchronization failed to initialize:', err);
  }
}
