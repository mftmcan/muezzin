import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * `useAdminIzinlerStore` iki dinleyici kurar: `izinler` (ana liste) ve
 * `izin_detaylari` (yalnızca admin'in görebildiği `sebep` alanı, ayrı
 * koleksiyona taşınmıştı — FR-O3).
 *
 * İkincil dinleyicinin hatası ana listeyi engellememeli (bu KASITLI) — ama
 * ÖNCEDEN hiç yeniden de denenmiyordu. onSnapshot'ın hata callback'i dinleyiciyi
 * KALICI olarak sonlandırdığından tek bir geçici hata, admin'in oturumu boyunca
 * TÜM `sebep` sütununu sessizce boşaltıyordu — üstelik UI bunu "sebep
 * belirtilmedi" diye gösterdiğinden yanlış bilgi veriyordu.
 */

const { onSnapshotMock } = vi.hoisted(() => ({ onSnapshotMock: vi.fn() }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ({ __collection: path }),
  query: (c: { __collection: string }) => ({ __query: c.__collection }),
  onSnapshot: (...args: unknown[]) => onSnapshotMock(...args),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  getDoc: vi.fn(),
  updateDoc: vi.fn(),
  runTransaction: vi.fn(),
  deleteField: () => ({ __deleteField: true }),
}));

vi.mock('../../src/lib/firebase', () => ({ db: {}, auth: {} }));

vi.mock('../../src/lib/firestore-errors', () => ({
  handleFirestoreError: vi.fn(() => new Error('Bağlantı hatası')),
  OperationType: { LIST: 'LIST', GET: 'GET', UPDATE: 'UPDATE', DELETE: 'DELETE' },
}));

vi.mock('../../src/services/telemetryService', () => ({
  telemetryService: { logAudit: vi.fn() },
}));

vi.mock('../../src/services/planServisi', () => ({
  haftalikPlanOlustur: vi.fn(),
}));

const { useAdminIzinlerStore } = await import('../../src/store/useAdminIzinlerStore');

type Cagri = { hedef: string; veri: (s: unknown) => void; hata: (e: unknown) => void };

/** onSnapshot çağrılarını (hangi koleksiyona kurulduklarıyla birlikte) çözer. */
function cagrilar(): Cagri[] {
  return onSnapshotMock.mock.calls.map((c) => {
    const kaynak = c[0] as { __collection?: string; __query?: string };
    return {
      hedef: kaynak.__collection ?? kaynak.__query ?? '?',
      veri: c[1] as (s: unknown) => void,
      hata: c[2] as (e: unknown) => void,
    };
  });
}

function detayCagrilari() {
  return cagrilar().filter((c) => c.hedef === 'izin_detaylari');
}

function snapshotIle(kayitlar: Record<string, Record<string, unknown>>) {
  return { docs: Object.entries(kayitlar).map(([id, data]) => ({ id, data: () => data })) };
}

let temizle: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  onSnapshotMock.mockReset();
  onSnapshotMock.mockReturnValue(() => {});
  useAdminIzinlerStore.setState({
    izinler: [],
    loading: true,
    error: null,
    detaylarHatasi: false,
    initialized: false,
    initializing: false,
  });
});

afterEach(() => {
  temizle?.();
  temizle = null;
  vi.useRealTimers();
});

describe('useAdminIzinlerStore — izin_detaylari dinleyicisi', () => {
  it('her iki dinleyiciyi de kurar ve sebep alanını birleştirir', () => {
    temizle = useAdminIzinlerStore.getState().init();
    const [izinler, detaylar] = [cagrilar()[0], detayCagrilari()[0]];

    expect(izinler.hedef).toBe('izinler');
    expect(detaylar).toBeDefined();

    izinler.veri(snapshotIle({ i1: { uid: 'u1', durum: 'onay_bekliyor' } }));
    detaylar.veri(snapshotIle({ i1: { sebep: 'Sağlık' } }));

    expect(useAdminIzinlerStore.getState().izinler[0].sebep).toBe('Sağlık');
    expect(useAdminIzinlerStore.getState().detaylarHatasi).toBe(false);
  });

  it('detay dinleyicisi hata verirse ANA liste bozulmaz (kasıtlı davranış korunur)', () => {
    temizle = useAdminIzinlerStore.getState().init();
    const izinler = cagrilar()[0];

    izinler.veri(snapshotIle({ i1: { uid: 'u1', durum: 'onay_bekliyor' } }));
    detayCagrilari()[0].hata(new Error('unavailable'));

    const state = useAdminIzinlerStore.getState();
    expect(state.izinler).toHaveLength(1);
    expect(state.error).toBeNull();
    expect(state.loading).toBe(false);
  });

  it('detay hatasını görünür kılar ve 15 sn sonra YENİDEN abone olur', () => {
    temizle = useAdminIzinlerStore.getState().init();
    expect(detayCagrilari()).toHaveLength(1);

    detayCagrilari()[0].hata(new Error('unavailable'));
    expect(useAdminIzinlerStore.getState().detaylarHatasi).toBe(true);

    vi.advanceTimersByTime(15000);
    expect(detayCagrilari()).toHaveLength(2);

    // Yeniden abonelik başarılı olunca hata bayrağı temizlenir.
    detayCagrilari()[1].veri(snapshotIle({ i1: { sebep: 'Sağlık' } }));
    expect(useAdminIzinlerStore.getState().detaylarHatasi).toBe(false);
  });

  it('yeniden deneme sayısı sınırlıdır (sonsuz döngü yok)', () => {
    temizle = useAdminIzinlerStore.getState().init();

    for (let i = 0; i < 12; i++) {
      const sonuncu = detayCagrilari().at(-1)!;
      sonuncu.hata(new Error('permission-denied'));
      vi.advanceTimersByTime(15000);
    }

    // 1 ilk abonelik + en fazla 5 yeniden deneme.
    expect(detayCagrilari().length).toBeLessThanOrEqual(6);
    expect(useAdminIzinlerStore.getState().detaylarHatasi).toBe(true);
  });

  it('temizlikten sonra bekleyen yeniden deneme yeni dinleyici kurmaz', () => {
    temizle = useAdminIzinlerStore.getState().init();
    detayCagrilari()[0].hata(new Error('unavailable'));

    temizle();
    temizle = null;

    vi.advanceTimersByTime(60000);
    expect(detayCagrilari()).toHaveLength(1);
  });

  it('ana dinleyici basarili snapshot sonrasinda koparsa tek abonelik ciftiyle yeniden kurulur', () => {
    temizle = useAdminIzinlerStore.getState().init();
    const ana = cagrilar().find((c) => c.hedef === 'izinler')!;
    const detay = detayCagrilari()[0];

    ana.veri(snapshotIle({ i1: { uid: 'u1', durum: 'onay_bekliyor' } }));
    expect(useAdminIzinlerStore.getState().initialized).toBe(true);

    // Detay retry'si beklerken ana dinleyici de koparsa eski detay timer'ı
    // iptal edilmeli; aksi halde ana retry ile birlikte iki detay aboneliği
    // daha açılır ve Spark okuma maliyeti katlanır.
    detay.hata(new Error('unavailable'));
    ana.hata(new Error('unavailable'));
    expect(useAdminIzinlerStore.getState().initialized).toBe(false);

    vi.advanceTimersByTime(15000);
    expect(cagrilar().filter((c) => c.hedef === 'izinler')).toHaveLength(2);
    expect(detayCagrilari()).toHaveLength(2);
  });
});
