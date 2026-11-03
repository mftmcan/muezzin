import { beforeEach, describe, expect, it, vi } from 'vitest';

const { batchSetMock, batchDeleteMock, commitMock, auditHazirlaMock } = vi.hoisted(() => ({
  batchSetMock: vi.fn(),
  batchDeleteMock: vi.fn(),
  commitMock: vi.fn(async () => {}),
  auditHazirlaMock: vi.fn(() => ({ ref: { path: 'audit_logs/audit-1' }, data: { actionType: 'audit' } })),
}));

vi.mock('../../src/lib/firebase', () => ({ db: {} }));

vi.mock('../../src/services/telemetryService', () => ({
  telemetryService: { auditKaydiHazirla: auditHazirlaMock },
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ path: name }),
  doc: (...args: unknown[]) => ({
    path: args
      .map((arg) => (typeof arg === 'string' ? arg : (arg as { path?: string })?.path))
      .filter(Boolean)
      .join('/'),
  }),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  Timestamp: { now: () => ({ seconds: 1, nanoseconds: 0 }) },
  writeBatch: () => ({ set: batchSetMock, delete: batchDeleteMock, commit: commitMock }),
}));

const { duyuruYayinla, duyuruSil } = await import('../../src/services/duyuruServisi');

beforeEach(() => {
  batchSetMock.mockClear();
  batchDeleteMock.mockClear();
  commitMock.mockClear();
  auditHazirlaMock.mockClear();
});

describe('duyuruServisi — atomik denetim izi', () => {
  it('duyuru ve audit kaydını aynı batch içinde yayınlar', async () => {
    await duyuruYayinla({ baslik: 'Bakım', icerik: 'Kısa kesinti', tip: 'bilgi' });

    expect(auditHazirlaMock).toHaveBeenCalledWith('Duyuru Yayınlama', 'Bakım', expect.stringContaining('BİLGİ'));
    expect(batchSetMock).toHaveBeenCalledTimes(2);
    expect(commitMock).toHaveBeenCalledTimes(1);
  });

  it('duyuru silme ve audit kaydını aynı batch içinde tamamlar', async () => {
    await duyuruSil('duyuru-1', 'Eski duyuru');

    expect(batchDeleteMock).toHaveBeenCalledTimes(1);
    expect(batchSetMock).toHaveBeenCalledTimes(1);
    expect(commitMock).toHaveBeenCalledTimes(1);
  });
});
