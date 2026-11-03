import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Paylaşılan cihaz (cami ofisi tableti) senaryosu: kullanıcı A açık çıkış
 * YAPMADAN sekmeyi kapatırsa olayları kuyrukta/localStorage yedeğinde kalır.
 * `isValidTelemetryLog` `data.userId == request.auth.uid` şart koştuğundan,
 * A'nın tek bir olayı B'nin batch'ine karışırsa TÜM batch reddedilir ve
 * `flushEvents`'in catch bloğu kirli kuyruğu geri koyup sonsuza dek yeniden
 * dener — B'nin hiçbir telemetrisi yazılamaz. Bu test, gönderim anında
 * yabancı olayların elendiğini doğrular.
 */

const { authMock, addDocMock, batchSetMock, commitMock } = vi.hoisted(() => ({
  authMock: { currentUser: null as { uid: string } | null },
  addDocMock: vi.fn(async (_collection: unknown, _payload: unknown) => ({ id: 'x' })),
  batchSetMock: vi.fn(),
  commitMock: vi.fn(async () => {}),
}));

vi.mock('../../src/lib/firebase', () => ({ db: {}, auth: authMock }));

vi.mock('../../src/store/useAuthStore', () => ({
  useAuthStore: { getState: () => ({ role: 'muezzin' }) },
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ name }),
  doc: () => ({ id: 'x' }),
  addDoc: addDocMock,
  getDocs: vi.fn(async () => ({ docs: [] })),
  writeBatch: () => ({ set: batchSetMock, commit: commitMock }),
  onSnapshot: vi.fn(() => () => {}),
  orderBy: vi.fn(),
  query: vi.fn(),
  limit: vi.fn(),
  Timestamp: { now: () => ({ seconds: 1, nanoseconds: 0 }) },
  serverTimestamp: () => ({ __serverTimestamp: true }),
}));

// jsdom'da yok — getDeviceMetadata (PWA modu tespiti) çağırıyor.
if (!window.matchMedia) {
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

const { telemetryService } = await import('../../src/services/telemetryService');

type YazilanOlay = { userId: string; eventName: string };
const yazilanOlaylar = () => batchSetMock.mock.calls.map((c) => c[1] as YazilanOlay);

beforeEach(() => {
  addDocMock.mockClear();
  batchSetMock.mockClear();
  commitMock.mockClear();
  telemetryService.clearBreadcrumbs();
  telemetryService.clearQueue();
  authMock.currentUser = null;
  telemetryService.setConsent(true);
});

describe('telemetryService kuyruk izolasyonu', () => {
  it('atomik işlem için sunucu zamanlı ve oturum sahibine bağlı audit kaydı hazırlar', () => {
    authMock.currentUser = { uid: 'adminA', displayName: 'Yönetici A' } as never;

    const audit = telemetryService.auditKaydiHazirla('Duyuru Yayınlama', 'Başlık', 'Açıklama');

    expect(audit.data).toMatchObject({
      actionType: 'Duyuru Yayınlama',
      targetName: 'Başlık',
      details: 'Açıklama',
      userId: 'adminA',
      userDisplayName: 'Yönetici A',
      timestamp: { __serverTimestamp: true },
    });
  });

  it('oturum yokken atomik audit hazırlamayı fail-closed reddeder', () => {
    expect(() => telemetryService.auditKaydiHazirla('Silme', 'Hedef', 'Açıklama')).toThrow('doğrulanmış kullanıcı');
  });

  it('kullanıcı rızayı kapattığında yeni analitik olay üretmez', () => {
    authMock.currentUser = { uid: 'kullaniciA' };
    telemetryService.setConsent(false);
    telemetryService.logEvent({ eventType: 'page_view', eventName: 'IZINSIZ_SAYFA' });

    expect(telemetryService.getConsentState()).toBe(false);
    expect(batchSetMock).not.toHaveBeenCalled();
  });

  it('hata kaydında yalnızca son 5 breadcrumb ve sınırlı veri özeti taşır', async () => {
    authMock.currentUser = { uid: 'kullaniciA' };

    for (let i = 0; i < 7; i++) {
      telemetryService.addBreadcrumb(`Eylem ${i}`, 'user_action', {
        sira: i,
        uzunDeger: 'x'.repeat(700),
      });
    }

    await telemetryService.logError(new Error('Örnek hata'));

    expect(addDocMock).toHaveBeenCalledTimes(1);
    const payload = addDocMock.mock.calls[0]?.[1] as {
      breadcrumbs: Array<{ action: string; data?: unknown; dataSummary?: string }>;
    };
    expect(payload.breadcrumbs.map((crumb) => crumb.action)).toEqual(['Eylem 2', 'Eylem 3', 'Eylem 4', 'Eylem 5', 'Eylem 6']);
    expect(payload.breadcrumbs.every((crumb) => crumb.data === undefined)).toBe(true);
    expect(payload.breadcrumbs.every((crumb) => (crumb.dataSummary?.length ?? 0) <= 500)).toBe(true);
  });

  it("önceki kullanıcının kuyrukta kalan olaylarını yeni kullanıcının batch'ine karıştırmaz", () => {
    // Kullanıcı A bir olay üretir (çıkış YAPMADAN sekme kapanır senaryosu:
    // olay kuyrukta kalır, BATCH_SIZE'a ulaşmadığı için gönderilmemiştir).
    authMock.currentUser = { uid: 'kullaniciA' };
    telemetryService.logEvent({ eventType: 'page_view', eventName: 'A_SAYFA' });

    // Kullanıcı B giriş yapar ve BATCH_SIZE (5) olay üretir → flush tetiklenir.
    authMock.currentUser = { uid: 'kullaniciB' };
    for (let i = 0; i < 5; i++) {
      telemetryService.logEvent({ eventType: 'page_view', eventName: `B_SAYFA_${i}` });
    }

    expect(commitMock).toHaveBeenCalledTimes(1);
    // BATCH_SIZE (5) sayımına A'nın olayı da dahil olduğundan bu batch'te
    // B'nin 4 olayı yazılır; A'nın olayı gönderim anında elenir (5. B olayı
    // kuyrukta kalıp bir sonraki flush'a gider).
    const olaylar = yazilanOlaylar();
    expect(olaylar).toHaveLength(4);
    expect(olaylar.every((o) => o.userId === 'kullaniciB')).toBe(true);
    expect(olaylar.some((o) => o.eventName === 'A_SAYFA')).toBe(false);
  });

  it("yabancı olay geri kuyruğa KONULMAZ — sonraki batch'leri de zehirlemez", () => {
    authMock.currentUser = { uid: 'kullaniciA' };
    telemetryService.logEvent({ eventType: 'click', eventName: 'A_TIKLAMA' });

    authMock.currentUser = { uid: 'kullaniciB' };
    for (let i = 0; i < 10; i++) {
      telemetryService.logEvent({ eventType: 'click', eventName: `B_TIKLAMA_${i}` });
    }

    // İki ayrı batch yazıldı (ilki A'nın atılan olayı yüzünden 4, ikincisi 5)
    // ve hiçbirinde A'nın olayı yok — yani A'nın olayı geri kuyruğa
    // konulmadı, ikinci batch'i de zehirlemedi.
    expect(commitMock).toHaveBeenCalledTimes(2);
    const olaylar = yazilanOlaylar();
    expect(olaylar).toHaveLength(9);
    expect(olaylar.some((o) => o.userId === 'kullaniciA')).toBe(false);
  });
});
