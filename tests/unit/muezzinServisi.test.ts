import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  batchUpdate: vi.fn(),
  batchSet: vi.fn(),
  batchDelete: vi.fn(),
  batchCommit: vi.fn(async () => {}),
  auditHazirla: vi.fn(() => ({ ref: { path: 'audit_logs/audit-1' }, data: { actionType: 'audit' } })),
  planOlustur: vi.fn(async () => ({ success: true })),
}));

vi.mock('../../src/lib/firebase', () => ({ db: {} }));

vi.mock('../../src/services/telemetryService', () => ({
  telemetryService: { auditKaydiHazirla: mocks.auditHazirla },
}));

vi.mock('../../src/services/planServisi', () => ({
  haftalikPlanOlustur: mocks.planOlustur,
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ path: name }),
  deleteField: () => ({ __deleteField: true }),
  doc: (...args: unknown[]) => ({
    path: args
      .map((arg) => (typeof arg === 'string' ? arg : (arg as { path?: string })?.path))
      .filter(Boolean)
      .join('/'),
  }),
  getDocsFromServer: vi.fn(),
  onSnapshot: vi.fn(),
  query: vi.fn(),
  runTransaction: vi.fn(),
  Timestamp: { now: () => ({ seconds: 1, nanoseconds: 0 }) },
  where: vi.fn(),
  writeBatch: () => ({
    update: mocks.batchUpdate,
    set: mocks.batchSet,
    delete: mocks.batchDelete,
    commit: mocks.batchCommit,
  }),
}));

const { davetSil, kendiAdiniGuncelle, personelKaydet, personelOnayla } = await import('../../src/services/muezzinServisi');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('muezzinServisi — atomik denetim izi', () => {
  it('kendi profil güncellemesini audit ile aynı batch içinde tamamlar', async () => {
    await kendiAdiniGuncelle('muezzin-1', 'Yeni Ad');

    expect(mocks.auditHazirla).toHaveBeenCalledWith('Profil Güncelleme', 'muezzin-1', expect.stringContaining('Yeni Ad'));
    expect(mocks.batchUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.batchSet).toHaveBeenCalledTimes(1);
    expect(mocks.batchCommit).toHaveBeenCalledTimes(1);
  });

  it('daveti silme ve audit kaydını tek batch olarak commit eder', async () => {
    await davetSil('user@example.test');

    expect(mocks.batchDelete).toHaveBeenCalledTimes(1);
    expect(mocks.batchSet).toHaveBeenCalledTimes(1);
    expect(mocks.batchCommit).toHaveBeenCalledTimes(1);
  });

  it('yeni personel daveti ile audit kaydını atomik oluşturur', async () => {
    await personelKaydet({
      editingUser: null,
      muezzinler: [],
      fullName: 'Yeni Personel',
      role: 'muezzin',
      haftalikIzinGunu: 2,
      email: 'USER@EXAMPLE.TEST',
    });

    expect(mocks.auditHazirla).toHaveBeenCalledWith('Personel Daveti', 'user@example.test', expect.stringContaining('Yeni Personel'));
    expect(mocks.batchSet).toHaveBeenCalledTimes(2);
    expect(mocks.batchCommit).toHaveBeenCalledTimes(1);
  });

  it('personel onayı, davet temizliği ve audit kaydını tek batch içinde yazar', async () => {
    await personelOnayla({
      id: 'muezzin-2',
      displayName: 'Bekleyen Personel',
      email: 'waiting@example.test',
      role: 'muezzin',
      aktif: false,
    } as never);

    expect(mocks.batchUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.batchDelete).toHaveBeenCalledTimes(1);
    expect(mocks.batchSet).toHaveBeenCalledTimes(1);
    expect(mocks.batchCommit).toHaveBeenCalledTimes(1);
    expect(mocks.planOlustur).toHaveBeenCalledTimes(3);
  });
});
