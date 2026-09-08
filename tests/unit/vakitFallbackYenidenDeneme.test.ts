import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * `useVakitStore`: birincil `vakitler/<ilce>_<yil-ay>` belgesi yoksa API
 * fallback'i devreye girer. Bu kilit ÖNCEDEN fetch'ten ÖNCE `true`'ya
 * çekiliyordu — tek bir başarısız API çağrısı (ağ kesintisi / API kapalı)
 * bayrağı KALICI olarak kilitliyor ve kullanıcı gece yarısı yeniden aboneliğe
 * kadar (saatlerce) boş vakit ekranında kalıyordu.
 *
 * Sözleşme:
 *  1. Başarısız bir fallback, kilidi KALICI hale getirmez — sonraki snapshot
 *     yeniden dener.
 *  2. Eşzamanlı/çift "belge yok" snapshot'ı (persistentLocalCache: önce
 *     önbellek, sonra sunucu) yine TEK bir API çağrısı üretir (HS-O6).
 *  3. Başarılı bir fallback'ten sonra tekrar çağrılmaz.
 *  4. Başarısızlıkta sınırlı sayıda, zamanlayıcıyla yeniden denenir.
 */

const { onSnapshotMock, aylikVakitleriCekMock, setDocMock } = vi.hoisted(() => ({
  onSnapshotMock: vi.fn(),
  aylikVakitleriCekMock: vi.fn(),
  setDocMock: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  onSnapshot: (...args: unknown[]) => onSnapshotMock(...args),
  setDoc: (...args: unknown[]) => setDocMock(...args),
  Timestamp: { now: () => ({ seconds: 0, nanoseconds: 0 }) },
}));

vi.mock('../../src/lib/firebase', () => ({ db: {}, auth: {} }));

vi.mock('../../src/services/ezanVaktiServisi', () => ({
  aylikVakitleriCek: (...args: unknown[]) => aylikVakitleriCekMock(...args),
  aylikVakitleriGrupla: () => ({}),
}));

vi.mock('../../src/store/useSystemSettingsStore', () => ({
  useSystemSettingsStore: {
    getState: () => ({ settings: { ilceId: '9541', ilceAdi: 'TEST' } }),
    subscribe: () => () => {},
  },
}));

vi.mock('../../src/store/useAuthStore', () => ({
  useAuthStore: { getState: () => ({ isAdmin: false }) },
}));

vi.mock('../../src/lib/firestore-errors', () => ({
  handleFirestoreError: vi.fn(),
  OperationType: { GET: 'GET', LIST: 'LIST' },
}));

const { useVakitStore } = await import('../../src/store/useVakitStore');

const yokSnapshot = { exists: () => false, data: () => ({}) };

/** Bu ayın belgesine kurulan onSnapshot'ın veri callback'i. */
function buAyCallback() {
  return onSnapshotMock.mock.calls[0][1] as (s: typeof yokSnapshot) => void;
}

let temizle: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  onSnapshotMock.mockReset();
  aylikVakitleriCekMock.mockReset();
  setDocMock.mockReset();
  onSnapshotMock.mockReturnValue(() => {});
  useVakitStore.setState({
    bugunVakitler: null,
    yarinVakitler: null,
    loading: true,
    initializing: false,
    initialized: false,
    currentMonthData: null,
    nextMonthData: null,
  });
});

afterEach(() => {
  temizle?.();
  temizle = null;
  vi.useRealTimers();
});

describe('useVakitStore — fallback kilidi', () => {
  it('başarısız fallback kilidi KALICI hale getirmez (sonraki snapshot yeniden dener)', async () => {
    aylikVakitleriCekMock.mockRejectedValue(new Error('API down'));
    temizle = useVakitStore.getState().init();
    const cb = buAyCallback();

    cb(yokSnapshot);
    await vi.advanceTimersByTimeAsync(0);
    expect(aylikVakitleriCekMock).toHaveBeenCalledTimes(1);

    // Yeni bir "belge yok" snapshot'ı (ör. sunucu senkronu) YENİDEN denemeli.
    cb(yokSnapshot);
    await vi.advanceTimersByTimeAsync(0);
    expect(aylikVakitleriCekMock).toHaveBeenCalledTimes(2);
  });

  it('uçuştaki bir fallback varken ikinci snapshot çift çağrı ÜRETMEZ (HS-O6)', async () => {
    let cozucu: ((v: unknown) => void) | null = null;
    aylikVakitleriCekMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          cozucu = resolve;
        })
    );
    temizle = useVakitStore.getState().init();
    const cb = buAyCallback();

    cb(yokSnapshot);
    cb(yokSnapshot);
    await vi.advanceTimersByTimeAsync(0);
    expect(aylikVakitleriCekMock).toHaveBeenCalledTimes(1);

    cozucu!({ gunler: {} });
    await vi.advanceTimersByTimeAsync(0);
  });

  it('başarılı fallback sonrası tekrar çağrılmaz', async () => {
    aylikVakitleriCekMock.mockResolvedValue({ gunler: {} });
    temizle = useVakitStore.getState().init();
    const cb = buAyCallback();

    cb(yokSnapshot);
    await vi.advanceTimersByTimeAsync(0);
    expect(aylikVakitleriCekMock).toHaveBeenCalledTimes(1);

    cb(yokSnapshot);
    await vi.advanceTimersByTimeAsync(0);
    expect(aylikVakitleriCekMock).toHaveBeenCalledTimes(1);
  });

  it('başarısızlıkta zamanlayıcıyla, ama SINIRLI sayıda yeniden dener', async () => {
    aylikVakitleriCekMock.mockRejectedValue(new Error('API down'));
    temizle = useVakitStore.getState().init();
    const cb = buAyCallback();

    cb(yokSnapshot);
    await vi.advanceTimersByTimeAsync(0);
    expect(aylikVakitleriCekMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15000);
    expect(aylikVakitleriCekMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(15000);
    expect(aylikVakitleriCekMock).toHaveBeenCalledTimes(3);

    // Üst sınıra ulaşıldı — zamanlayıcı artık yeni deneme kurmaz.
    await vi.advanceTimersByTimeAsync(60000);
    expect(aylikVakitleriCekMock).toHaveBeenCalledTimes(3);
  });

  it('abonelik temizlendikten sonra bekleyen yeniden deneme çalışmaz', async () => {
    aylikVakitleriCekMock.mockRejectedValue(new Error('API down'));
    temizle = useVakitStore.getState().init();
    const cb = buAyCallback();

    cb(yokSnapshot);
    await vi.advanceTimersByTimeAsync(0);
    expect(aylikVakitleriCekMock).toHaveBeenCalledTimes(1);

    temizle();
    temizle = null;

    await vi.advanceTimersByTimeAsync(60000);
    expect(aylikVakitleriCekMock).toHaveBeenCalledTimes(1);
  });
});
