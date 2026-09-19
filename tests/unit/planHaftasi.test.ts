import { describe, it, expect } from 'vitest';
import { haftaGunleri, bildirimlerParmakIzi, bildirimleriSlotlaraAyir, slotVerileri } from '../../src/lib/planHaftasi';
import { getHaftaIdFromDate } from '../../src/lib/dateUtils';

/**
 * `src/lib/planHaftasi.ts`, haftalık plan üretiminin (planServisi.ts) saf
 * yardımcılarıdır. İkisi doğrudan riskli davranış taşır:
 *
 *  - `haftaGunleri` — `mazeretSonBasvuru` damgasının HANGİ günlere yazılacağını
 *    belirler. Ay/yıl/artık-yıl sınırında bir gün kayması, o gün için damga
 *    üretilmemesi (kural tarafında FAIL-CLOSED → mazeret penceresi kapalı)
 *    anlamına gelirdi.
 *  - `bildirimlerParmakIzi` — iyimser eşzamanlılık denetiminin ikinci yarısı.
 *    `haftaPlanlari.sonGuncelleme` kontrolü, T1 (okuma) ile T2 (commit)
 *    arasında bildirilen bir mazereti GÖRMÜYORDU; parmak izi bunu yakalar.
 */

/** Test içi sahte belge üreticileri — gerçek Firestore snapshot'ına gerek yok. */
const parmakIziDoc = (id: string, sonGuncelleme?: number | null) => {
  const damga = typeof sonGuncelleme === 'number' ? { toMillis: () => sonGuncelleme } : (sonGuncelleme ?? undefined);
  return { id, data: () => ({ sonGuncelleme: damga }) };
};

const slotDoc = (tarih: string, vakit: string, ekstra: Record<string, unknown> = {}) => ({
  data: () => ({ tarih, vakit, ...ekstra }),
});

describe('haftaGunleri', () => {
  it('normal bir haftada Pazartesi→Pazar 7 ardışık gün üretir', () => {
    expect(haftaGunleri('W2026-09-07')).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
    ]);
  });

  it('her zaman tam 7 gün ve YYYY-MM-DD biçiminde döner', () => {
    const gunler = haftaGunleri('W2026-09-07');
    expect(gunler).toHaveLength(7);
    gunler.forEach((gun) => expect(gun).toMatch(/^\d{4}-\d{2}-\d{2}$/));
  });

  it('AY sınırını aşan hafta (Eylül → Ekim) doğru taşar', () => {
    expect(haftaGunleri('W2026-09-28')).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
  });

  it('ARTIK YIL: 2028 Şubat 29 günü atlanmaz', () => {
    expect(haftaGunleri('W2028-02-28')).toEqual([
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
      '2028-03-02',
      '2028-03-03',
      '2028-03-04',
      '2028-03-05',
    ]);
  });

  it("ARTIK OLMAYAN yıl: 2026 Şubat 28'den doğrudan Mart 1'e geçer", () => {
    expect(haftaGunleri('W2026-02-23')).toEqual([
      '2026-02-23',
      '2026-02-24',
      '2026-02-25',
      '2026-02-26',
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
    ]);
  });

  it('YIL sınırını aşan hafta (2025 → 2026) doğru taşar', () => {
    expect(haftaGunleri('W2025-12-29')).toEqual([
      '2025-12-29',
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
    ]);
  });

  it('ay/gün alanları tek haneliyken sıfırla doldurulur', () => {
    expect(haftaGunleri('W2026-01-05')[0]).toBe('2026-01-05');
    expect(haftaGunleri('W2026-08-31')).toContain('2026-09-01');
  });

  // Round-trip invariantı: bu kod tabanında hafta tanımı İKİ bağımsız yerde
  // uygulanıyor — burada (elle Date aritmetiği) ve dateUtils.ts'te (date-fns
  // `startOfWeek(weekStartsOn: 1)`). İkisi ayrışırsa plan, bildirim ve
  // mazeret damgaları farklı haftalara düşerdi.
  describe('getHaftaIdFromDate ile round-trip tutarlılığı', () => {
    const haftaIdler = [
      'W2026-09-07',
      'W2026-09-28',
      'W2028-02-28',
      'W2025-12-29',
      'W2026-02-23',
      'W2026-01-05',
      'W2026-08-31',
      'W2027-03-29',
    ];

    it.each(haftaIdler)('%s: ilk gün aynı haftaId üretir', (haftaId) => {
      expect(getHaftaIdFromDate(haftaGunleri(haftaId)[0])).toBe(haftaId);
    });

    it.each(haftaIdler)('%s: haftanın YEDİ günü de aynı haftaId üretir', (haftaId) => {
      haftaGunleri(haftaId).forEach((gun) => {
        expect(getHaftaIdFromDate(gun)).toBe(haftaId);
      });
    });
  });
});

describe('bildirimlerParmakIzi', () => {
  it('aynı belgeler farklı SIRADA verildiğinde AYNI parmak izini üretir', () => {
    const a = parmakIziDoc('W_2026-09-07_ogle_asil', 1000);
    const b = parmakIziDoc('W_2026-09-07_ogle_yedek', 2000);
    const c = parmakIziDoc('W_2026-09-08_sabah_asil', 3000);

    expect(bildirimlerParmakIzi([a, b, c])).toBe(bildirimlerParmakIzi([c, a, b]));
    expect(bildirimlerParmakIzi([a, b, c])).toBe(bildirimlerParmakIzi([b, c, a]));
  });

  it('bir belgenin sonGuncelleme damgası değişince FARKLI parmak izi üretir', () => {
    const once = [parmakIziDoc('a', 1000), parmakIziDoc('b', 2000)];
    // T1-T2 arasında mazeret bildirildi: yalnızca `b` güncellendi.
    const sonra = [parmakIziDoc('a', 1000), parmakIziDoc('b', 2001)];

    expect(bildirimlerParmakIzi(sonra)).not.toBe(bildirimlerParmakIzi(once));
  });

  it('bir belge EKLENİNCE farklı parmak izi üretir', () => {
    const once = [parmakIziDoc('a', 1000)];
    const sonra = [parmakIziDoc('a', 1000), parmakIziDoc('b', 2000)];

    expect(bildirimlerParmakIzi(sonra)).not.toBe(bildirimlerParmakIzi(once));
  });

  it('bir belge ÇIKARILINCA farklı parmak izi üretir', () => {
    const once = [parmakIziDoc('a', 1000), parmakIziDoc('b', 2000)];
    const sonra = [parmakIziDoc('a', 1000)];

    expect(bildirimlerParmakIzi(sonra)).not.toBe(bildirimlerParmakIzi(once));
  });

  it('sonGuncelleme alanı eksik/null olan belgeler için "null" sentineli kullanılır', () => {
    expect(bildirimlerParmakIzi([parmakIziDoc('a')])).toBe('a:null');
    expect(bildirimlerParmakIzi([parmakIziDoc('a', null)])).toBe('a:null');
    // Sentinel tutarlı: eksik ile null aynı görünür, ikisi de deterministiktir.
    expect(bildirimlerParmakIzi([parmakIziDoc('a')])).toBe(bildirimlerParmakIzi([parmakIziDoc('a', null)]));
  });

  it('damgasız bir belge damga kazanınca çakışma tespit edilir', () => {
    expect(bildirimlerParmakIzi([parmakIziDoc('a', 1500)])).not.toBe(bildirimlerParmakIzi([parmakIziDoc('a')]));
  });

  it('boş liste boş bir parmak izi üretir ve kendisiyle tutarlıdır', () => {
    expect(bildirimlerParmakIzi([])).toBe('');
    expect(bildirimlerParmakIzi([])).toBe(bildirimlerParmakIzi([]));
  });

  it('aynı girdi için deterministiktir (tekrar çağrı aynı sonucu verir)', () => {
    const docs = [parmakIziDoc('b', 2000), parmakIziDoc('a', 1000)];
    expect(bildirimlerParmakIzi(docs)).toBe(bildirimlerParmakIzi(docs));
  });

  it('belge id değişince (aynı damga) farklı parmak izi üretir', () => {
    expect(bildirimlerParmakIzi([parmakIziDoc('a', 1000)])).not.toBe(bildirimlerParmakIzi([parmakIziDoc('b', 1000)]));
  });
});

describe('bildirimleriSlotlaraAyir', () => {
  it('boş dizi → boş sonuç', () => {
    expect(bildirimleriSlotlaraAyir([])).toEqual({});
  });

  it('tek belge tek slota düşer', () => {
    const d = slotDoc('2026-09-07', 'ogle');
    const sonuc = bildirimleriSlotlaraAyir([d]);

    expect(Object.keys(sonuc)).toEqual(['2026-09-07_ogle']);
    expect(sonuc['2026-09-07_ogle']).toEqual([d]);
  });

  it('aynı tarih_vakit içindeki asil + yedek AYNI slotta gruplanır', () => {
    const asil = slotDoc('2026-09-07', 'ogle', { tip: 'asil' });
    const yedek = slotDoc('2026-09-07', 'ogle', { tip: 'yedek' });
    const sonuc = bildirimleriSlotlaraAyir([asil, yedek]);

    expect(Object.keys(sonuc)).toEqual(['2026-09-07_ogle']);
    expect(sonuc['2026-09-07_ogle']).toEqual([asil, yedek]);
  });

  it('farklı tarih/vakit kombinasyonları ayrı slotlara düşer', () => {
    const a = slotDoc('2026-09-07', 'sabah');
    const b = slotDoc('2026-09-07', 'ogle');
    const c = slotDoc('2026-09-08', 'sabah');
    const sonuc = bildirimleriSlotlaraAyir([a, b, c]);

    expect(Object.keys(sonuc).sort()).toEqual(['2026-09-07_ogle', '2026-09-07_sabah', '2026-09-08_sabah']);
    expect(sonuc['2026-09-07_sabah']).toEqual([a]);
    expect(sonuc['2026-09-07_ogle']).toEqual([b]);
    expect(sonuc['2026-09-08_sabah']).toEqual([c]);
  });

  it('bir slot içindeki giriş sırası korunur', () => {
    const ilk = slotDoc('2026-09-07', 'ogle', { uid: 'u1' });
    const ikinci = slotDoc('2026-09-07', 'ogle', { uid: 'u2' });
    const ucuncu = slotDoc('2026-09-07', 'ogle', { uid: 'u3' });

    expect(bildirimleriSlotlaraAyir([ilk, ikinci, ucuncu])['2026-09-07_ogle']).toEqual([ilk, ikinci, ucuncu]);
  });

  it('slot anahtarı `tarih_vakit` biçimindedir (planServisi bu anahtarla okur)', () => {
    const sonuc = bildirimleriSlotlaraAyir([slotDoc('2026-12-31', 'yatsi')]);
    expect(sonuc).toHaveProperty('2026-12-31_yatsi');
  });
});

describe('slotVerileri', () => {
  it('boş dizi → boş sonuç', () => {
    expect(slotVerileri([])).toEqual([]);
  });

  it('var olmayan belgelerin (data() === undefined) sonucu ELENİR', () => {
    const varOlan = { data: () => ({ uid: 'u1', tip: 'asil' }) };
    const varOlmayan = { data: () => undefined };

    expect(slotVerileri([varOlan, varOlmayan])).toEqual([{ uid: 'u1', tip: 'asil' }]);
  });

  it('tüm belgeler yoksa boş dizi döner', () => {
    expect(slotVerileri([{ data: () => undefined }, { data: () => undefined }])).toEqual([]);
  });

  it('var olan belgelerin düz verisi ve sırası korunur', () => {
    const a = { data: () => ({ uid: 'u1', tip: 'asil' as const }) };
    const b = { data: () => ({ uid: 'u2', tip: 'yedek' as const }) };

    expect(slotVerileri([a, b])).toEqual([
      { uid: 'u1', tip: 'asil' },
      { uid: 'u2', tip: 'yedek' },
    ]);
  });
});
