import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * `useMazeretGecmisi`'nin iki kritik sözleşmesi (bkz. kod denetimi):
 *
 *  1. SORGU SINIRLI OLMALI — `durum == 'reddedildi'` tek başına, koleksiyon
 *     yıllar içinde büyüdükçe sınırsızca büyüyen bir canlı dinleyici üretir.
 *     Artık ayrıca bir `tarih >= <N ay önce>` alt sınırı vardır.
 *  2. SATIR BAŞINA `mazeret_detaylari` FAN-OUT'U güvenli olmalı — her snapshot
 *     her satır için yeniden okuma YAPMAMALI (kayıtlar değişmez, önbelleklenir)
 *     ve unmount sonrası çözülen bir okuma state'e DOKUNMAMALIDIR.
 */

const { onSnapshotMock, getDocMock, whereMock, queryMock, unsubscribeMock } = vi.hoisted(() => ({
  onSnapshotMock: vi.fn(),
  getDocMock: vi.fn(),
  whereMock: vi.fn(),
  queryMock: vi.fn(),
  unsubscribeMock: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ({ __collection: path }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  onSnapshot: (...args: unknown[]) => onSnapshotMock(...args),
  query: (...args: unknown[]) => queryMock(...args),
  where: (alan: string, op: string, deger: unknown) => whereMock(alan, op, deger),
}));

vi.mock('../../src/lib/firebase', () => ({ db: {}, auth: {} }));

vi.mock('../../src/lib/firestore-errors', () => ({
  handleFirestoreError: vi.fn(),
  OperationType: { LIST: 'LIST', GET: 'GET' },
}));

const { useMazeretGecmisi } = await import('../../src/hooks/admin/useMazeretGecmisi');

type Kisit = { alan: string; op: string; deger: unknown };

function snapshotIle(satirlar: { id: string; tarih: string }[]) {
  return {
    docs: satirlar.map((s) => ({
      id: s.id,
      data: () => ({ tarih: s.tarih, durum: 'reddedildi', uid: 'u1', vakit: 'sabah' }),
    })),
  };
}

/** onSnapshot'a verilen veri callback'i (2. argüman). */
function veriCallback() {
  return onSnapshotMock.mock.calls[0][1] as (s: ReturnType<typeof snapshotIle>) => void;
}

function kisitlar(): Kisit[] {
  return queryMock.mock.calls[0].slice(1) as Kisit[];
}

/** Çözümü test tarafından tetiklenen bir `getDoc` sözü üretir. */
function ertelenmisGetDoc() {
  const cozucular: ((v: unknown) => void)[] = [];
  getDocMock.mockImplementation(() => new Promise((resolve) => cozucular.push(resolve)));
  return {
    hepsiniCoz: (retSebebi: string | null) => {
      const kopya = [...cozucular];
      cozucular.length = 0;
      kopya.forEach((c) => c({ exists: () => retSebebi !== null, data: () => ({ retSebebi }) }));
    },
    bekleyenSayisi: () => cozucular.length,
  };
}

beforeEach(() => {
  onSnapshotMock.mockReset();
  getDocMock.mockReset();
  unsubscribeMock.mockReset();
  whereMock.mockReset();
  queryMock.mockReset();
  whereMock.mockImplementation((alan: string, op: string, deger: unknown) => ({ alan, op, deger }));
  queryMock.mockImplementation((...args: unknown[]) => ({ __query: args }));
  onSnapshotMock.mockReturnValue(unsubscribeMock);
  getDocMock.mockResolvedValue({ exists: () => false, data: () => ({}) });
});

describe('useMazeretGecmisi — sorgu sınırı', () => {
  it('durum filtresine EK OLARAK bir tarih alt sınırı uygular', () => {
    const { result } = renderHook(() => useMazeretGecmisi());

    const k = kisitlar();
    expect(k).toContainEqual({ alan: 'durum', op: '==', deger: 'reddedildi' });

    const tarihKisiti = k.find((x) => x.alan === 'tarih');
    expect(tarihKisiti, 'tarih alt sınırı olmadan sorgu sınırsızca büyür').toBeDefined();
    expect(tarihKisiti!.op).toBe('>=');
    expect(tarihKisiti!.deger).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(tarihKisiti!.deger).toBe(result.current.baslangicTarihi);
  });

  it('alt sınır, yapılandırılan ay sayısı kadar geriye gider', () => {
    const { result } = renderHook(() => useMazeretGecmisi());
    const ay = result.current.arsivAySayisi;
    expect(ay).toBeGreaterThan(0);

    const beklenen = new Date();
    beklenen.setMonth(beklenen.getMonth() - ay);
    const [yil, aySayi] = result.current.baslangicTarihi.split('-').map(Number);
    expect(yil).toBe(beklenen.getFullYear());
    expect(aySayi).toBe(beklenen.getMonth() + 1);
  });

  it('yeniden render sorgu penceresini kaydırmaz / dinleyiciyi yeniden kurmaz', () => {
    const { rerender } = renderHook(() => useMazeretGecmisi());
    rerender();
    rerender();
    expect(onSnapshotMock).toHaveBeenCalledTimes(1);
  });
});

describe('useMazeretGecmisi — mazeret_detaylari fan-out', () => {
  it('aynı satır için ikinci bir snapshot yeni okuma YAPMAZ (önbellek)', async () => {
    const { result } = renderHook(() => useMazeretGecmisi());
    const cb = veriCallback();

    await act(async () => {
      cb(
        snapshotIle([
          { id: 'a', tarih: '2026-05-01' },
          { id: 'b', tarih: '2026-04-01' },
        ])
      );
    });

    await waitFor(() => expect(result.current.gecmis[0].retSebebi).toBeDefined());
    expect(getDocMock).toHaveBeenCalledTimes(2);

    // Aynı iki satır + bir yeni satır: yalnızca YENİ satır için okuma olmalı.
    await act(async () => {
      cb(
        snapshotIle([
          { id: 'a', tarih: '2026-05-01' },
          { id: 'b', tarih: '2026-04-01' },
          { id: 'c', tarih: '2026-03-01' },
        ])
      );
    });

    await waitFor(() => expect(result.current.gecmis).toHaveLength(3));
    expect(getDocMock).toHaveBeenCalledTimes(3);
  });

  it('çözülen detaylar satırlara işlenir', async () => {
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ retSebebi: 'Rapor' }) });
    const { result } = renderHook(() => useMazeretGecmisi());

    await act(async () => {
      veriCallback()(snapshotIle([{ id: 'a', tarih: '2026-05-01' }]));
    });

    await waitFor(() => expect(result.current.gecmis[0].retSebebi).toBe('Rapor'));
  });

  it('BAŞARISIZ bir detay okuması önbelleklenmez (sonraki snapshot yeniden dener)', async () => {
    getDocMock.mockRejectedValueOnce(new Error('unavailable'));
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ retSebebi: 'Rapor' }) });

    const { result } = renderHook(() => useMazeretGecmisi());
    const cb = veriCallback();

    await act(async () => {
      cb(snapshotIle([{ id: 'a', tarih: '2026-05-01' }]));
    });
    expect(getDocMock).toHaveBeenCalledTimes(1);
    expect(result.current.gecmis[0].retSebebi).toBeUndefined();

    await act(async () => {
      cb(snapshotIle([{ id: 'a', tarih: '2026-05-01' }]));
    });
    await waitFor(() => expect(result.current.gecmis[0].retSebebi).toBe('Rapor'));
    expect(getDocMock).toHaveBeenCalledTimes(2);
  });

  it("unmount sonrası çözülen fan-out state'e dokunmaz ve dinleyici kapatılır", async () => {
    const ertelenmis = ertelenmisGetDoc();
    const { result, unmount } = renderHook(() => useMazeretGecmisi());

    act(() => {
      veriCallback()(snapshotIle([{ id: 'a', tarih: '2026-05-01' }]));
    });
    expect(ertelenmis.bekleyenSayisi()).toBe(1);
    const unmountOncesi = result.current.gecmis;

    unmount();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);

    // Uçuştaki okuma unmount SONRASI çözülür — hiçbir güncelleme/hata olmamalı.
    await act(async () => {
      ertelenmis.hepsiniCoz('Geç gelen sebep');
      await Promise.resolve();
    });

    expect(result.current.gecmis).toBe(unmountOncesi);
    expect(result.current.gecmis[0].retSebebi).toBeUndefined();
  });

  it("bayat bir fan-out, daha yeni snapshot'ın satırlarını geri getirmez", async () => {
    const ertelenmis = ertelenmisGetDoc();
    const { result } = renderHook(() => useMazeretGecmisi());
    const cb = veriCallback();

    // 1. snapshot: iki satır, fan-out uçuşta.
    act(() =>
      cb(
        snapshotIle([
          { id: 'a', tarih: '2026-05-01' },
          { id: 'b', tarih: '2026-04-01' },
        ])
      )
    );
    expect(ertelenmis.bekleyenSayisi()).toBe(2);

    // 2. snapshot: 'b' silindi (admin arşivden kaldırdı). 'a' hâlâ uçuşta
    // olduğundan İKİNCİ bir okuma başlatılmamalı.
    act(() => cb(snapshotIle([{ id: 'a', tarih: '2026-05-01' }])));
    expect(result.current.gecmis.map((g) => g.id)).toEqual(['a']);
    expect(ertelenmis.bekleyenSayisi()).toBe(2);

    // 1. snapshot'ın fan-out'u ŞİMDİ çözülüyor — silinen satırı diriltmemeli,
    // ama hayatta kalan satırın detayını yine de işlemeli.
    await act(async () => {
      ertelenmis.hepsiniCoz('Rapor');
      await Promise.resolve();
    });

    expect(result.current.gecmis.map((g) => g.id)).toEqual(['a']);
    expect(result.current.gecmis[0].retSebebi).toBe('Rapor');
  });
});
