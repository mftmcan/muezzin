import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  batchSet: vi.fn(),
  batchUpdate: vi.fn(),
  batchCommit: vi.fn(async () => {}),
  auditHazirla: vi.fn(() => ({ ref: { path: 'audit_logs/audit-1' }, data: { actionType: 'audit' } })),
  onSnapshot: vi.fn(),
}));

vi.mock('../../src/lib/firebase', () => ({ db: {}, auth: { currentUser: null } }));

vi.mock('../../src/services/telemetryService', () => ({
  telemetryService: { auditKaydiHazirla: mocks.auditHazirla },
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ({ path }),
  doc: (...args: unknown[]) => ({
    path: args
      .map((arg) => (typeof arg === 'string' ? arg : (arg as { path?: string })?.path))
      .filter(Boolean)
      .join('/'),
  }),
  onSnapshot: mocks.onSnapshot,
  orderBy: vi.fn(),
  query: vi.fn(),
  writeBatch: () => ({ set: mocks.batchSet, update: mocks.batchUpdate, commit: mocks.batchCommit }),
}));

const { useSystemSettingsStore } = await import('../../src/store/useSystemSettingsStore');
const { useKrizAlarmlariStore } = await import('../../src/store/useKrizAlarmlariStore');

beforeEach(() => {
  vi.clearAllMocks();
  useSystemSettingsStore.setState({
    settings: { ilceId: '9148', ilceAdi: 'Ceyhan', hicriDuzeltme: 0 },
    loading: false,
    initialized: true,
  });
});

describe('yönetim storeları — atomik denetim izi', () => {
  it('sistem ayarı ve audit kaydını aynı batch içinde yazar', async () => {
    await useSystemSettingsStore.getState().updateSettings({ hicriDuzeltme: 1 });

    expect(mocks.auditHazirla).toHaveBeenCalledWith(
      'Dizge Ayarı Güncelleme',
      'Vakit Bölgesi',
      expect.stringContaining('Hicri Düzeltme: 1')
    );
    expect(mocks.batchSet).toHaveBeenCalledTimes(2);
    expect(mocks.batchCommit).toHaveBeenCalledTimes(1);
    expect(globalThis.__hicriOffset).toBe(1);
  });

  it('kriz alarmı çözümü ve audit kaydını aynı batch içinde tamamlar', async () => {
    await useKrizAlarmlariStore.getState().alarmCoz('alarm-1', 'Kriz Alarmı Çözme', 'Alarm çözüldü.');

    expect(mocks.batchUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.batchSet).toHaveBeenCalledTimes(1);
    expect(mocks.batchCommit).toHaveBeenCalledTimes(1);
  });

  it('kriz alarmı dinleyicisi ilk snapshot sonrasında koparsa yeniden abone olur', () => {
    vi.useFakeTimers();
    let veri: ((snapshot: { docs: unknown[] }) => void) | undefined;
    let hata: ((error: Error) => void) | undefined;
    mocks.onSnapshot.mockImplementation((_query: unknown, onData: typeof veri, onError: typeof hata) => {
      veri = onData;
      hata = onError;
      return () => {};
    });
    useKrizAlarmlariStore.setState({ initialized: false, initializing: false, loading: true, error: null });

    useKrizAlarmlariStore.getState().init();
    veri?.({ docs: [] });
    expect(useKrizAlarmlariStore.getState().initialized).toBe(true);

    hata?.(new Error('unavailable'));
    expect(useKrizAlarmlariStore.getState().initialized).toBe(false);
    vi.advanceTimersByTime(15000);
    expect(mocks.onSnapshot).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
