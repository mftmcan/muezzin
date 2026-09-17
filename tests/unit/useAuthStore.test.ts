import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * `useAuthStore`'un ÜÇÜNCÜ durumu: `rolDogrulanamadi`.
 *
 * Önceden yalnızca iki durum vardı — "yükleniyor" ve "rol belli". Rol hiç
 * gelmediğinde (6 sn'lik `snapshotFailsafe` ya da `onSnapshot`'ın hata
 * callback'i) store `loading:false, initialized:true` yazıyor ama `isAdmin`'e
 * dokunmuyordu; varsayılan `false` kaldığı için tüketiciler "rolü bilmiyoruz"
 * ile "admin değil"i AYIRT EDEMİYORDU. `AdminPanel.tsx`'teki
 * `!authLoading && isAdmin === false` yönlendirmesi bu yüzden GERÇEK bir
 * admini de ana ekrana atıyordu (yavaş bağlantı / soğuk Firestore
 * bağlantısı).
 *
 * Bu testler o ayrımı ve ondan çıkış yolunu (`rolTekrarDene`) sabitler.
 */

const { onAuthStateChangedMock, onSnapshotMock, getDocMock, getDocFromServerMock } = vi.hoisted(() => ({
  onAuthStateChangedMock: vi.fn(),
  onSnapshotMock: vi.fn(),
  getDocMock: vi.fn(),
  getDocFromServerMock: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (...args: unknown[]) => onAuthStateChangedMock(...args),
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  onSnapshot: (...args: unknown[]) => onSnapshotMock(...args),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  getDocFromServer: (...args: unknown[]) => getDocFromServerMock(...args),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
}));

vi.mock('../../src/lib/firebase', () => ({ db: {}, auth: {} }));

vi.mock('../../src/lib/firestore-errors', () => ({
  handleFirestoreError: vi.fn(() => new Error('Bağlantı hatası')),
  OperationType: { LIST: 'LIST', GET: 'GET', UPDATE: 'UPDATE', WRITE: 'WRITE' },
}));

const SAHTE_KULLANICI = { uid: 'admin-1', email: 'admin@example.test', displayName: 'Admin', photoURL: '' };

/**
 * Store modülü `_authInitStarted` adında MODÜL DÜZEYİNDE bir kilit tutuyor
 * (init'in iki kez çalışmasını önlemek için) — bu yüzden her test taze bir
 * modül örneği almalı, yoksa ikinci testte `init()` hemen no-op döner.
 */
async function tazeStore() {
  vi.resetModules();
  const { useAuthStore } = await import('../../src/store/useAuthStore');
  const temizle = useAuthStore.getState().init();
  // init() -> onAuthStateChanged(auth, handleAuthStateChange)
  const authCallback = onAuthStateChangedMock.mock.calls.at(-1)![1] as (u: unknown) => void;
  return { useAuthStore, temizle, authCallback };
}

/** En son kurulan onSnapshot dinleyicisinin (veri, hata) callback'leri. */
function sonDinleyici() {
  const cagri = onSnapshotMock.mock.calls.at(-1)!;
  return {
    veri: cagri[1] as (snap: unknown) => Promise<void> | void,
    hata: cagri[2] as (err: unknown) => void,
  };
}

function belge(data: Record<string, unknown> | null) {
  return { exists: () => data !== null, data: () => data };
}

let temizle: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  onAuthStateChangedMock.mockReset();
  onAuthStateChangedMock.mockReturnValue(() => {});
  onSnapshotMock.mockReset();
  onSnapshotMock.mockReturnValue(() => {});
  getDocMock.mockReset();
  // config/bootstrap — süper-admin listesi boş (sıradan admin senaryosu).
  getDocMock.mockResolvedValue(belge({ superAdminEmails: [] }));
  getDocFromServerMock.mockReset();
});

afterEach(() => {
  temizle?.();
  temizle = null;
  vi.useRealTimers();
});

describe('useAuthStore — rol doğrulanamadı durumu', () => {
  it('snapshot 6 sn içinde gelmezse rolDogrulanamadi true olur, isAdmin false KALIR', async () => {
    const s = await tazeStore();
    temizle = s.temizle;
    s.authCallback(SAHTE_KULLANICI);

    expect(s.useAuthStore.getState().loading).toBe(true);
    expect(s.useAuthStore.getState().rolDogrulanamadi).toBe(false);

    await vi.advanceTimersByTimeAsync(6000);

    const durum = s.useAuthStore.getState();
    expect(durum.loading).toBe(false);
    expect(durum.initialized).toBe(true);
    // ASIL İDDİA: "bilmiyoruz" ayrı bir durum...
    expect(durum.rolDogrulanamadi).toBe(true);
    // ...ama yetki VERMİYOR — fail-closed.
    expect(durum.isAdmin).toBe(false);
    expect(durum.isSuperAdmin).toBe(false);
    expect(durum.role).toBeNull();
  });

  it('onSnapshot hata callback’i de rolDogrulanamadi true yapar (dinleyici kalıcı olarak ölür)', async () => {
    const s = await tazeStore();
    temizle = s.temizle;
    s.authCallback(SAHTE_KULLANICI);

    sonDinleyici().hata(new Error('permission-denied'));

    const durum = s.useAuthStore.getState();
    expect(durum.rolDogrulanamadi).toBe(true);
    expect(durum.loading).toBe(false);
    expect(durum.isAdmin).toBe(false);
  });

  it('rol gerçekten geldiğinde bayrak temizlenir ve isAdmin türetilir', async () => {
    const s = await tazeStore();
    temizle = s.temizle;
    s.authCallback(SAHTE_KULLANICI);

    await sonDinleyici().veri(belge({ role: 'admin', aktif: true, onayBekliyor: false }));

    const durum = s.useAuthStore.getState();
    expect(durum.rolDogrulanamadi).toBe(false);
    expect(durum.isAdmin).toBe(true);
    expect(durum.role).toBe('admin');
    expect(durum.loading).toBe(false);
  });

  it('failsafe tetiklendikten SONRA geç gelen snapshot bayrağı temizler', async () => {
    const s = await tazeStore();
    temizle = s.temizle;
    s.authCallback(SAHTE_KULLANICI);

    await vi.advanceTimersByTimeAsync(6000);
    expect(s.useAuthStore.getState().rolDogrulanamadi).toBe(true);

    // Canlı dinleyici failsafe yolunda ÖLMEZ — geç de olsa gelirse durum düzelir.
    await sonDinleyici().veri(belge({ role: 'admin', aktif: true, onayBekliyor: false }));

    expect(s.useAuthStore.getState().rolDogrulanamadi).toBe(false);
    expect(s.useAuthStore.getState().isAdmin).toBe(true);
  });

  describe('rolTekrarDene()', () => {
    it('sunucudan rolü çekip bayrağı temizler (ikinci bir onSnapshot AÇMAZ)', async () => {
      const s = await tazeStore();
      temizle = s.temizle;
      s.authCallback(SAHTE_KULLANICI);
      await vi.advanceTimersByTimeAsync(6000);
      expect(s.useAuthStore.getState().rolDogrulanamadi).toBe(true);

      const dinleyiciSayisi = onSnapshotMock.mock.calls.length;
      getDocFromServerMock.mockResolvedValue(belge({ role: 'admin', aktif: true, onayBekliyor: false }));

      await s.useAuthStore.getState().rolTekrarDene();

      const durum = s.useAuthStore.getState();
      expect(durum.rolDogrulanamadi).toBe(false);
      expect(durum.isAdmin).toBe(true);
      expect(durum.rolDogrulaniyor).toBe(false);
      // Canlı dinleyici zaten ayakta — ikincisi açılmamalı.
      expect(onSnapshotMock.mock.calls.length).toBe(dinleyiciSayisi);
    });

    it('tekrar deneme de başarısız olursa bayrak true KALIR (sessizce "admin değil"e düşmez)', async () => {
      const s = await tazeStore();
      temizle = s.temizle;
      s.authCallback(SAHTE_KULLANICI);
      await vi.advanceTimersByTimeAsync(6000);

      getDocFromServerMock.mockRejectedValue(new Error('unavailable'));

      await s.useAuthStore.getState().rolTekrarDene();

      const durum = s.useAuthStore.getState();
      expect(durum.rolDogrulanamadi).toBe(true);
      expect(durum.rolDogrulaniyor).toBe(false);
      expect(durum.isAdmin).toBe(false);
    });

    it('devre dışı hesap tespit edilirse belirsizlik biter, disabledReason dolar', async () => {
      const s = await tazeStore();
      temizle = s.temizle;
      s.authCallback(SAHTE_KULLANICI);
      await vi.advanceTimersByTimeAsync(6000);

      getDocFromServerMock.mockResolvedValue(belge({ role: 'admin', aktif: false }));

      await s.useAuthStore.getState().rolTekrarDene();

      const durum = s.useAuthStore.getState();
      expect(durum.rolDogrulanamadi).toBe(false);
      expect(durum.disabledReason).toBeTruthy();
      expect(durum.isAdmin).toBe(false);
    });
  });

  it('çıkış yapıldığında (user null) bayrak temizlenir', async () => {
    const s = await tazeStore();
    temizle = s.temizle;
    s.authCallback(SAHTE_KULLANICI);
    await vi.advanceTimersByTimeAsync(6000);
    expect(s.useAuthStore.getState().rolDogrulanamadi).toBe(true);

    s.authCallback(null);

    expect(s.useAuthStore.getState().rolDogrulanamadi).toBe(false);
    expect(s.useAuthStore.getState().user).toBeNull();
  });
});
