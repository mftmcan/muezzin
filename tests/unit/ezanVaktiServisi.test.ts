import { describe, it, expect, vi, afterEach } from 'vitest';
import { aylikVakitleriCek } from '../../src/services/ezanVaktiServisi';

function emushafGunu(tarihDDMMYYYY: string) {
  return {
    MiladiTarihKisa: tarihDDMMYYYY,
    Imsak: '04:37',
    Gunes: '06:00',
    Ogle: '12:42',
    Ikindi: '16:21',
    Aksam: '19:13',
    Yatsi: '20:31',
  };
}

function aladhanGunu(tarihDDMMYYYY: string) {
  const timings = {
    Fajr: '04:37 (+03)',
    Sunrise: '06:00 (+03)',
    Dhuhr: '12:42 (+03)',
    Asr: '16:21 (+03)',
    Maghrib: '19:13 (+03)',
    Isha: '20:31 (+03)',
  };
  return { date: { gregorian: { date: tarihDDMMYYYY } }, timings };
}

describe('aylikVakitleriCek', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('emushaf istenen ayı kapsıyorsa emushaf verisini kullanır (kaynakApi=diyanet)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toContain('emushaf.net');
        return {
          ok: true,
          json: async () => [emushafGunu('01.09.2026'), emushafGunu('02.09.2026')],
        } as Response;
      })
    );

    const sonuc = await aylikVakitleriCek(2026, 9, '9148', 'Ceyhan');

    expect(sonuc.kaynakApi).toBe('diyanet');
    expect(sonuc.gunler['2026-09-01']).toBeDefined();
  });

  it("emushaf ay sınırında yanlış/eksik ayı döndürürse (2026-08-31 -> 2026-09-01 arızası) Aladhan'a düşer", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes('emushaf.net')) {
        // Rolling window henüz Eylül'e geçmemiş — yalnızca Ağustos günleri dönüyor.
        return {
          ok: true,
          json: async () => [emushafGunu('30.08.2026'), emushafGunu('31.08.2026')],
        } as Response;
      }
      expect(url).toContain('aladhan.com');
      expect(url).toContain('/2026/9');
      return {
        ok: true,
        json: async () => ({ data: [aladhanGunu('01-09-2026')] }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const sonuc = await aylikVakitleriCek(2026, 9, '9148', 'Ceyhan');

    expect(sonuc.kaynakApi).toBe('aladhan');
    expect(sonuc.gunler['2026-09-01']).toBeDefined();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("emushaf HTTP hatası verirse Aladhan'a düşer (mevcut davranış korunur)", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('emushaf.net')) {
          return { ok: false } as Response;
        }
        return {
          ok: true,
          json: async () => ({ data: [aladhanGunu('01-09-2026')] }),
        } as Response;
      })
    );

    const sonuc = await aylikVakitleriCek(2026, 9, '9148', 'Ceyhan');
    expect(sonuc.kaynakApi).toBe('aladhan');
  });

  it("emushaf boş dizi döndürürse Aladhan'a düşer (mevcut davranış korunur)", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('emushaf.net')) {
          return { ok: true, json: async () => [] } as Response;
        }
        return {
          ok: true,
          json: async () => ({ data: [aladhanGunu('01-09-2026')] }),
        } as Response;
      })
    );

    const sonuc = await aylikVakitleriCek(2026, 9, '9148', 'Ceyhan');
    expect(sonuc.kaynakApi).toBe('aladhan');
  });
});
