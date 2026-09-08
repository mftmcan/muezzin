import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { zamanAsimiIle, IslemZamanAsimi } from '../../src/lib/timeoutUtils';

describe('zamanAsimiIle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('promise süre dolmadan çözülürse değeri döner', async () => {
    const p = new Promise<string>((resolve) => setTimeout(() => resolve('tamam'), 100));
    const sonuc = zamanAsimiIle(p, 1000);
    await vi.advanceTimersByTimeAsync(100);
    await expect(sonuc).resolves.toBe('tamam');
  });

  it('promise süre dolmadan reddedilirse orijinal hatayı fırlatır', async () => {
    const p = new Promise<string>((_, reject) => setTimeout(() => reject(new Error('gerçek hata')), 100));
    const sonuc = zamanAsimiIle(p, 1000);
    const beklenen = expect(sonuc).rejects.toThrow('gerçek hata');
    await vi.advanceTimersByTimeAsync(100);
    await beklenen;
  });

  it('promise süre içinde hiç sonuçlanmazsa IslemZamanAsimi fırlatır', async () => {
    const hicSonuclanmayanPromise = new Promise<string>(() => {});
    const sonuc = zamanAsimiIle(hicSonuclanmayanPromise, 1000);
    // Reject'i yakalamadan bekletirsek unhandled rejection uyarısı almamak için
    // önce assertion'ı kur, sonra zamanlayıcıyı ilerlet.
    const beklenen = expect(sonuc).rejects.toThrow(IslemZamanAsimi);
    await vi.advanceTimersByTimeAsync(1000);
    await beklenen;
  });

  it('zaman aşımı sonrası orijinal promise çözülse bile zaten reddedilmiş sonucu değiştirmez', async () => {
    let resolveGec: (v: string) => void = () => {};
    const gecKalanPromise = new Promise<string>((resolve) => {
      resolveGec = resolve;
    });
    const sonuc = zamanAsimiIle(gecKalanPromise, 1000);
    const beklenen = expect(sonuc).rejects.toThrow(IslemZamanAsimi);
    await vi.advanceTimersByTimeAsync(1000);
    resolveGec('artik-cok-gec');
    await beklenen;
  });
});
