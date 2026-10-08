import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `planServisi`'nin self-healing yazma yolunun (`haftalikPlanOlustur`) ve
 * admin'in elle atama yolunun (`vakitAtamasiniGuncelle`) birim testleri.
 *
 * Bu iki fonksiyon, planlama çekirdeğinin (bkz. planlamaCekirdegi.test.ts)
 * Firestore'a DOKUNAN tek istemci tarafı sarmalayıcılarıdır ve en riskli iki
 * davranışı taşırlar:
 *  1. Çevrimdışı koruma — `fromCache` okuma üzerine plan yazımı asla
 *     başlamamalı (yoksa self-healing, sunucudaki gerçek çizelgeyi ezer).
 *  2. İyimser eşzamanlılık — `haftaPlanlari.sonGuncelleme` VE
 *     `bildirimler` parmak izi, okuma ile commit arasında değişmişse yazım
 *     geri alınmalı (çakışma) ve bir kez yeniden denenmeli.
 *
 * Firestore burada tamamen sahte (mock) bir modülle değiştirilir; planlama
 * çekirdeği, slot koruması, planHaftasi ve mazeret kuralları GERÇEK modüller
 * olarak çalışır — böylece test yalnızca "servis ⇄ Firestore" ara yüzünü
 * doğrular, iş kurallarını yeniden test etmez (onların kendi testleri var).
 */

const fstore = vi.hoisted(() => {
  interface Kayit {
    id: string;
    data: Record<string, unknown>;
  }
  interface BatchIslem {
    op: 'set' | 'delete' | 'update';
    yol: string;
    veri?: unknown;
    merge?: boolean;
  }

  const state = {
    aktifHaftaId: '',
    oncekiHaftaId: '',
    muezzinler: [] as Kayit[],
    izinler: [] as Array<Record<string, unknown>>,
    bildirimler: [] as Kayit[],
    adminUyarilari: [] as Array<Record<string, unknown>>,
    planVar: false,
    planFromCache: false,
    planGunler: {} as Record<string, unknown>,
    planSonGuncellemeMs: 111111,
    /** null değilse: 2. (taze kontrol) plan okuması bu değeri döndürür. */
    planTazeFarkliMs: null as number | null,
    oncekiPlanGunler: null as Record<string, unknown> | null,
    vakitlerVar: false,
    /** Her 'bildirimler' sorgusunda çağrılır — parmak izi yarış testleri için. */
    bildirimlerKanca: null as null | ((okumaSayisi: number) => Kayit[]),
  };

  let bildirimOkumaSayisi = 0;
  let planOkumaSayisi = 0;
  let otoIdSayaci = 0;
  const batchler: Array<{ islemler: BatchIslem[]; commitSayisi: number }> = [];
  const transactionIslemleri: BatchIslem[] = [];

  function sifirla() {
    state.aktifHaftaId = '';
    state.oncekiHaftaId = '';
    state.muezzinler = [];
    state.izinler = [];
    state.bildirimler = [];
    state.adminUyarilari = [];
    state.planVar = false;
    state.planFromCache = false;
    state.planGunler = {};
    state.planSonGuncellemeMs = 111111;
    state.planTazeFarkliMs = null;
    state.oncekiPlanGunler = null;
    state.vakitlerVar = false;
    state.bildirimlerKanca = null;
    bildirimOkumaSayisi = 0;
    planOkumaSayisi = 0;
    batchler.length = 0;
    transactionIslemleri.length = 0;
  }

  const Timestamp = {
    now: () => ({ _sahte: 'timestamp-now' }),
    fromDate: (d: Date) => ({ _sahte: 'timestamp-fromDate', ms: d.getTime() }),
  };

  /** `vakitler/9148_YYYY-MM` belgesi için ayın tüm günlerine örnek vakitler. */
  function ayVakitleri(ay: string) {
    const [y, m] = ay.split('-').map(Number);
    const gunSayisi = new Date(y, m, 0).getDate();
    const gunler: Record<string, Record<string, string>> = {};
    for (let d = 1; d <= gunSayisi; d++) {
      gunler[`${ay}-${String(d).padStart(2, '0')}`] = {
        sabah: '05:30',
        ogle: '12:30',
        ikindi: '15:30',
        aksam: '18:30',
        yatsi: '20:30',
      };
    }
    return gunler;
  }

  async function getDocs(q: { col: { path: string } }) {
    const yol = q.col.path;
    const liste = (kayitlar: Kayit[]) => ({
      docs: kayitlar.map((k) => ({
        id: k.id,
        exists: () => true,
        data: () => k.data,
        ref: { path: `${yol}/${k.id}` },
        metadata: { fromCache: false },
      })),
      empty: kayitlar.length === 0,
    });
    if (yol === 'muezzins') return liste(state.muezzinler);
    if (yol === 'izinler') {
      return {
        docs: state.izinler.map((d) => ({ data: () => d })),
        empty: state.izinler.length === 0,
      };
    }
    if (yol === 'bildirimler') {
      bildirimOkumaSayisi += 1;
      const kaynak = state.bildirimlerKanca ? state.bildirimlerKanca(bildirimOkumaSayisi) : state.bildirimler;
      return liste(kaynak);
    }
    if (yol === 'adminUyarilari') {
      return {
        docs: state.adminUyarilari.map((d) => ({ data: () => d })),
        empty: state.adminUyarilari.length === 0,
      };
    }
    throw new Error(`sahte getDocs: beklenmeyen koleksiyon: ${yol}`);
  }

  async function getDoc(ref: { path: string }) {
    const yol = ref.path;
    const yok = () => ({ exists: () => false, data: () => undefined, metadata: { fromCache: false } });
    if (yol === 'settings/system') {
      return { exists: () => true, data: () => ({ ilceId: '9148' }), metadata: { fromCache: false } };
    }
    if (yol.startsWith('vakitler/')) {
      if (!state.vakitlerVar) return yok();
      const ay = yol.split('/')[1].split('_')[1];
      return { exists: () => true, data: () => ({ gunler: ayVakitleri(ay) }), metadata: { fromCache: false } };
    }
    if (yol.startsWith('haftaPlanlari/')) {
      const id = yol.split('/')[1];
      if (state.oncekiHaftaId && id === state.oncekiHaftaId && state.oncekiPlanGunler) {
        return { exists: () => true, data: () => ({ gunler: state.oncekiPlanGunler }), metadata: { fromCache: false } };
      }
      if (id !== state.aktifHaftaId) return yok();
      planOkumaSayisi += 1;
      // Çift sayılı okumalar "taze kontrol" okumalarıdır (her denemede:
      // 1. okuma başlangıç, 2. okuma commit öncesi taze kontrol) — fark
      // yalnızca bunlarda döner ki çakışma her denemede tutarlı biçimde
      // tetiklensin.
      const taze = planOkumaSayisi % 2 === 0 && state.planTazeFarkliMs !== null ? state.planTazeFarkliMs : state.planSonGuncellemeMs;
      return {
        exists: () => state.planVar,
        data: () =>
          state.planVar
            ? {
                gunler: state.planGunler,
                sonGuncelleme: { toMillis: () => taze },
                olusturmaTarihi: { _sahte: 'eski' },
                durum: 'yayinda',
              }
            : undefined,
        metadata: { fromCache: state.planFromCache },
      };
    }
    throw new Error(`sahte getDoc: beklenmeyen belge: ${yol}`);
  }

  function writeBatch() {
    const kayit = { islemler: [] as BatchIslem[], commitSayisi: 0 };
    batchler.push(kayit);
    return {
      set: (ref: { path: string }, veri: unknown, secenekler?: { merge?: boolean }) => {
        kayit.islemler.push({ op: 'set', yol: ref.path, veri, merge: secenekler?.merge === true });
      },
      delete: (ref: { path: string }) => {
        kayit.islemler.push({ op: 'delete', yol: ref.path });
      },
      update: (ref: { path: string }, veri: unknown) => {
        kayit.islemler.push({ op: 'update', yol: ref.path, veri });
      },
      commit: async () => {
        kayit.commitSayisi += 1;
      },
    };
  }

  const transaction = {
    get: async (ref: { path: string }) => {
      const yol = ref.path;
      if (yol.startsWith('bildirimler/')) {
        const id = yol.slice('bildirimler/'.length);
        const kayit = state.bildirimler.find((k) => k.id === id);
        return {
          id,
          exists: () => !!kayit,
          data: () => kayit?.data,
          ref: { path: yol },
          metadata: { fromCache: false },
        };
      }
      if (yol.startsWith('haftaPlanlari/')) {
        return {
          exists: () => state.planVar,
          data: () => (state.planVar ? { gunler: state.planGunler } : undefined),
          ref: { path: yol },
          metadata: { fromCache: false },
        };
      }
      throw new Error(`sahte transaction.get: beklenmeyen yol: ${yol}`);
    },
    set: (ref: { path: string }, veri: unknown, secenekler?: { merge?: boolean }) => {
      transactionIslemleri.push({ op: 'set', yol: ref.path, veri, merge: secenekler?.merge === true });
    },
    delete: (ref: { path: string }) => {
      transactionIslemleri.push({ op: 'delete', yol: ref.path });
    },
    update: (ref: { path: string }, veri: unknown) => {
      transactionIslemleri.push({ op: 'update', yol: ref.path, veri });
    },
  };

  const modul = {
    Timestamp,
    collection: (_db: unknown, ad: string) => ({ path: ad }),
    doc: (...args: unknown[]) => {
      if (args.length === 1) {
        otoIdSayaci += 1;
        const col = args[0] as { path: string };
        return { path: `${col.path}/oto-${otoIdSayaci}` };
      }
      const segs = args.slice(1) as string[];
      return { path: segs.join('/') };
    },
    query: (col: unknown, ...kosullar: unknown[]) => ({ col, kosullar }),
    where: (alan: string, op: string, deger: unknown) => ({ alan, op, deger }),
    limit: (n: number) => ({ n }),
    getDocs,
    getDoc,
    writeBatch,
    runTransaction: async (_db: unknown, cb: (t: typeof transaction) => Promise<unknown>) => cb(transaction),
    QueryDocumentSnapshot: undefined,
    DocumentSnapshot: undefined,
    DocumentData: undefined,
  };

  return {
    state,
    sifirla,
    batchler,
    transactionIslemleri,
    modul,
    bildirimOkumaSayisi: () => bildirimOkumaSayisi,
  };
});

vi.mock('firebase/firestore', () => fstore.modul);
vi.mock('../../src/lib/firebase', () => ({ db: {}, auth: {} }));
vi.mock('../../src/lib/firestore-errors', () => ({
  handleFirestoreError: (err: unknown) => err,
  OperationType: { GET: 'GET', WRITE: 'WRITE' },
}));
vi.mock('../../src/services/telemetryService', () => ({
  telemetryService: { logAudit: vi.fn() },
}));

import { haftalikPlanOlustur, vakitAtamasiniGuncelle } from '../../src/services/planServisi';
import { telemetryService } from '../../src/services/telemetryService';

function muezzinKayit(id: string, ek: Record<string, unknown> = {}): { id: string; data: Record<string, unknown> } {
  return { id, data: { displayName: id, role: 'muezzin', aktif: true, ...ek } };
}

/**
 * Bugünden en az `haftaIleride` hafta ileride bir PAZARTESİ'nin haftaId'si
 * ve o haftanın günleri. Gelecek hafta kullanılır ki `gunIzinliSeti`'nin
 * "yalnızca bugünden sonraki günler izin filtresine girer" kuralı test
 * saatinden bağımsız çalışsın.
 */
function gelecekHafta(haftaIleride = 3) {
  const d = new Date();
  d.setDate(d.getDate() + 7 * haftaIleride);
  const gun = d.getDay();
  d.setDate(d.getDate() + (gun === 1 ? 0 : gun === 0 ? 1 : 8 - gun));
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const gunler = Array.from({ length: 7 }, (_, i) => {
    const g = new Date(d);
    g.setDate(d.getDate() + i);
    return iso(g);
  });
  return { haftaId: `W${iso(d)}`, gunler };
}

function islemVerisi(i: { veri?: unknown }): Record<string, unknown> {
  return i.veri as Record<string, unknown>;
}

beforeEach(() => {
  fstore.sifirla();
  vi.clearAllMocks();
});

describe('haftalikPlanOlustur (self-healing yazma yolu)', () => {
  it('plan okuması önbellekten geliyorsa (fromCache) yazmayı hiç başlatmaz', async () => {
    const { haftaId } = gelecekHafta();
    fstore.state.aktifHaftaId = haftaId;
    fstore.state.planFromCache = true;
    fstore.state.muezzinler = [muezzinKayit('a'), muezzinKayit('b')];

    await expect(haftalikPlanOlustur(haftaId)).rejects.toThrow('Bağlantı yok');
    // Hiçbir batch oluşturulmamış olmalı — yoksa offline yazım sunucudaki
    // gerçek çizelgeyi bozardı (bkz. planSelfHealing.ts gerekçesi).
    expect(fstore.batchler.length).toBe(0);
  });

  it('atanabilir müezzin yoksa hata fırlatır', async () => {
    const { haftaId } = gelecekHafta();
    fstore.state.aktifHaftaId = haftaId;
    fstore.state.muezzinler = [{ id: 'a', data: { displayName: 'a', role: 'admin', aktif: true } }];

    await expect(haftalikPlanOlustur(haftaId)).rejects.toThrow('en az 1 aktif müezzin');
    expect(fstore.batchler.length).toBe(0);
  });

  it('mutlu yol: gün başına bir batch + sonda plan belgesi, deterministik bildirim IDleri', async () => {
    const { haftaId, gunler } = gelecekHafta();
    fstore.state.aktifHaftaId = haftaId;
    fstore.state.muezzinler = [muezzinKayit('a'), muezzinKayit('b')];

    await haftalikPlanOlustur(haftaId);

    // 7 gün batch'i + 1 son batch (plan belgesi).
    expect(fstore.batchler.length).toBe(8);
    expect(fstore.batchler.every((b) => b.commitSayisi === 1)).toBe(true);

    const bildirimSetleri = fstore.batchler.flatMap((b) => b.islemler).filter((i) => i.op === 'set' && i.yol.startsWith('bildirimler/'));
    expect(bildirimSetleri.length).toBeGreaterThan(0);

    const desen = new RegExp(`^bildirimler/${haftaId}_\\d{4}-\\d{2}-\\d{2}_(sabah|ogle|ikindi|aksam|yatsi)_(asil|yedek)$`);
    for (const set of bildirimSetleri) {
      expect(set.yol).toMatch(desen);
      const veri = islemVerisi(set);
      expect(veri['durum']).toBe('bekliyor');
      expect(veri['pendingAck']).toBe(true);
      expect(veri['uid']).not.toBe('Sistem');
      // manuelAtama yalnız elle atamada yazılır — self-healing yazmaz.
      expect(veri['manuelAtama']).toBeUndefined();
    }

    // cumaMi bayrağı yalnızca o haftanın Cuma günü için true.
    const cuma = gunler.find((g) => new Date(Number(g.slice(0, 4)), Number(g.slice(5, 7)) - 1, Number(g.slice(8, 10))).getDay() === 5);
    expect(cuma).toBeDefined();
    const cumaSetleri = bildirimSetleri.filter((s) => islemVerisi(s)['tarih'] === cuma);
    const digerSetleri = bildirimSetleri.filter((s) => islemVerisi(s)['tarih'] !== cuma);
    expect(cumaSetleri.length).toBeGreaterThan(0);
    expect(cumaSetleri.every((s) => islemVerisi(s)['cumaMi'] === true)).toBe(true);
    expect(digerSetleri.every((s) => islemVerisi(s)['cumaMi'] === false)).toBe(true);

    // Son batch plan belgesini merge ile yazar ve 7 günü kapsar.
    const sonBatch = fstore.batchler[fstore.batchler.length - 1];
    const planSet = sonBatch.islemler.find((i) => i.op === 'set' && i.yol === `haftaPlanlari/${haftaId}`);
    expect(planSet).toBeDefined();
    expect(planSet?.merge).toBe(true);
    const planVerisi = islemVerisi(planSet!);
    expect(planVerisi['durum']).toBe('yayinda');
    expect(Object.keys(planVerisi['gunler'] as Record<string, unknown>).sort()).toEqual([...gunler].sort());
  });

  it('korunan slot (onaylanmış bildirim) silinmez, taze hesaplamaya girmez, ataması korunur', async () => {
    const { haftaId, gunler } = gelecekHafta();
    const gun = gunler[0];
    fstore.state.aktifHaftaId = haftaId;
    fstore.state.muezzinler = [muezzinKayit('a'), muezzinKayit('b')];
    const korunacakId = `${haftaId}_${gun}_ogle_asil`;
    fstore.state.bildirimler = [
      {
        id: korunacakId,
        data: {
          haftaId,
          tarih: gun,
          vakit: 'ogle',
          uid: 'a',
          tip: 'asil',
          durum: 'onaylandi',
          sonGuncelleme: { toMillis: () => 500 },
        },
      },
    ];
    fstore.state.planVar = true;
    fstore.state.planGunler = { [gun]: { ogle: { asil: 'a', yedek: 'b' } } };

    await haftalikPlanOlustur(haftaId);

    const tumIslemler = fstore.batchler.flatMap((b) => b.islemler);
    expect(tumIslemler.some((i) => i.op === 'delete' && i.yol === `bildirimler/${korunacakId}`)).toBe(false);
    expect(tumIslemler.some((i) => i.yol === `bildirimler/${korunacakId}`)).toBe(false);
    expect(tumIslemler.some((i) => i.yol === `bildirimler/${haftaId}_${gun}_ogle_yedek`)).toBe(false);

    const sonBatch = fstore.batchler[fstore.batchler.length - 1];
    const planSet = sonBatch.islemler.find((i) => i.op === 'set' && i.yol === `haftaPlanlari/${haftaId}`);
    const gunlerVerisi = islemVerisi(planSet!)['gunler'] as Record<string, Record<string, { asil: string }>>;
    expect(gunlerVerisi[gun]['ogle'].asil).toBe('a');
  });

  it('hiç kimsenin müsait olmadığı gün için admin uyarısı açar', async () => {
    const { haftaId, gunler } = gelecekHafta();
    const bosGun = gunler[2];
    fstore.state.aktifHaftaId = haftaId;
    fstore.state.muezzinler = [muezzinKayit('a'), muezzinKayit('b')];
    fstore.state.izinler = [
      { uid: 'a', baslangic: bosGun, bitis: bosGun },
      { uid: 'b', baslangic: bosGun, bitis: bosGun },
    ];

    await haftalikPlanOlustur(haftaId);

    const sonBatch = fstore.batchler[fstore.batchler.length - 1];
    const uyariSetleri = sonBatch.islemler.filter((i) => i.op === 'set' && i.yol.startsWith('adminUyarilari/'));
    expect(uyariSetleri.length).toBeGreaterThan(0);
    const uyari = uyariSetleri.map((u) => islemVerisi(u)).find((v) => v['tip'] === 'planOlusturulamadi');
    expect(uyari).toBeDefined();
    expect(uyari!['tarih']).toBe(bosGun);
    expect(String(uyari!['mesaj'])).toContain(bosGun);
    expect(uyari!['cozuldu']).toBe(false);
  });

  it('aynı gün için zaten çözülmemiş uyarı varsa yenisini AÇMAZ (dedup)', async () => {
    const { haftaId, gunler } = gelecekHafta();
    const bosGun = gunler[2];
    fstore.state.aktifHaftaId = haftaId;
    fstore.state.muezzinler = [muezzinKayit('a'), muezzinKayit('b')];
    fstore.state.izinler = [
      { uid: 'a', baslangic: bosGun, bitis: bosGun },
      { uid: 'b', baslangic: bosGun, bitis: bosGun },
    ];
    fstore.state.adminUyarilari = [{ tip: 'planOlusturulamadi', tarih: bosGun, cozuldu: false }];

    await haftalikPlanOlustur(haftaId);

    const sonBatch = fstore.batchler[fstore.batchler.length - 1];
    expect(sonBatch.islemler.some((i) => i.op === 'set' && i.yol.startsWith('adminUyarilari/'))).toBe(false);
  });

  it('ezan verisi VARSA bildirimlere mazeretSonBasvuru damgası yazar', async () => {
    const { haftaId } = gelecekHafta();
    fstore.state.aktifHaftaId = haftaId;
    fstore.state.muezzinler = [muezzinKayit('a'), muezzinKayit('b')];
    fstore.state.vakitlerVar = true;

    await haftalikPlanOlustur(haftaId);

    const damgaliSetler = fstore.batchler
      .flatMap((b) => b.islemler)
      .filter((i) => i.op === 'set' && i.yol.startsWith('bildirimler/') && islemVerisi(i)['mazeretSonBasvuru'] !== undefined);
    expect(damgaliSetler.length).toBeGreaterThan(0);
  });

  it('ezan verisi YOKSA hiçbir bildirime mazeretSonBasvuru yazmaz (fail-closed)', async () => {
    const { haftaId } = gelecekHafta();
    fstore.state.aktifHaftaId = haftaId;
    fstore.state.muezzinler = [muezzinKayit('a'), muezzinKayit('b')];

    await haftalikPlanOlustur(haftaId);

    const damgaliSetler = fstore.batchler
      .flatMap((b) => b.islemler)
      .filter((i) => i.op === 'set' && i.yol.startsWith('bildirimler/') && islemVerisi(i)['mazeretSonBasvuru'] !== undefined);
    expect(damgaliSetler.length).toBe(0);
  });

  it('commit öncesi plan belgesi değiştiyse (sonGuncelleme) çakışma fırlatır ve yazmaz', async () => {
    const { haftaId } = gelecekHafta();
    fstore.state.aktifHaftaId = haftaId;
    fstore.state.muezzinler = [muezzinKayit('a'), muezzinKayit('b')];
    fstore.state.planVar = true;
    fstore.state.planTazeFarkliMs = 999999;

    await expect(haftalikPlanOlustur(haftaId)).rejects.toThrow('Plan bu sırada');
    expect(fstore.batchler.length).toBe(0);
  });

  it('bildirimler parmak izi her okumada değişiyorsa çakışma kalıcıdır — yeniden deneme tükenince hata verir', async () => {
    const { haftaId } = gelecekHafta();
    fstore.state.aktifHaftaId = haftaId;
    fstore.state.muezzinler = [muezzinKayit('a'), muezzinKayit('b')];
    // Her okuma farklı bir "yeni belge" döndürür → parmak izi hiç eşleşmez.
    fstore.state.bildirimlerKanca = (n) => [
      ...fstore.state.bildirimler,
      { id: `yariscı-${n}`, data: { sonGuncelleme: { toMillis: () => 5000 + n } } },
    ];

    await expect(haftalikPlanOlustur(haftaId)).rejects.toThrow('bildirimler bu sırada');
    // Varsayılan denemeSayisi=1 → 2 deneme × 2 okuma = 4 bildirim sorgusu.
    expect(fstore.bildirimOkumaSayisi()).toBe(4);
    expect(fstore.batchler.length).toBe(0);
  });

  it('geçici parmak izi çakışması tek yeniden denemede toparlanır', async () => {
    const { haftaId } = gelecekHafta();
    fstore.state.aktifHaftaId = haftaId;
    fstore.state.muezzinler = [muezzinKayit('a'), muezzinKayit('b')];
    // Yalnız İLK taze kontrol (2. okuma) farklı döner; yeniden denemede
    // (3. ve 4. okumalar) okunan liste okunduğu gibi kalır → yazar.
    fstore.state.bildirimlerKanca = (n) =>
      n === 2
        ? [...fstore.state.bildirimler, { id: 'gecici', data: { sonGuncelleme: { toMillis: () => 7777 } } }]
        : fstore.state.bildirimler;

    await expect(haftalikPlanOlustur(haftaId)).resolves.toBeUndefined();
    expect(fstore.bildirimOkumaSayisi()).toBe(4);
    const sonBatch = fstore.batchler[fstore.batchler.length - 1];
    expect(sonBatch.islemler.some((i) => i.op === 'set' && i.yol === `haftaPlanlari/${haftaId}`)).toBe(true);
  });
});

describe('vakitAtamasiniGuncelle (admin elle atama)', () => {
  const params = {
    haftaId: 'W2026-11-02',
    tarih: '2026-11-03',
    vakit: 'ogle' as const,
    asilUid: 'a',
    yedekUid: 'b',
    asilAdi: 'Ahmet',
    yedekAdi: 'Mehmet',
  };

  it('korunan slotta yazım yapmadan protected döner', async () => {
    const id = `${params.haftaId}_${params.tarih}_${params.vakit}_asil`;
    fstore.state.bildirimler = [
      {
        id,
        data: { uid: 'a', tip: 'asil', durum: 'onaylandi', sonGuncelleme: { toMillis: () => 500 } },
      },
    ];

    await expect(vakitAtamasiniGuncelle(params)).resolves.toBe('protected');
    expect(fstore.transactionIslemleri.length).toBe(0);
    expect(telemetryService.logAudit).not.toHaveBeenCalled();
  });

  it('korunmayan slotta bildirimleri yazar, planı günceller ve denetim izi bırakır', async () => {
    await expect(vakitAtamasiniGuncelle(params)).resolves.toBe('updated');

    const setler = fstore.transactionIslemleri.filter((i) => i.op === 'set');
    const asilSet = setler.find((s) => s.yol === `bildirimler/${params.haftaId}_${params.tarih}_${params.vakit}_asil`);
    const yedekSet = setler.find((s) => s.yol === `bildirimler/${params.haftaId}_${params.tarih}_${params.vakit}_yedek`);
    expect(asilSet).toBeDefined();
    expect(yedekSet).toBeDefined();
    expect(islemVerisi(asilSet!)['manuelAtama']).toBe(true);
    expect(islemVerisi(asilSet!)['pendingAck']).toBe(true);
    expect(islemVerisi(asilSet!)['uid']).toBe('a');
    expect(islemVerisi(yedekSet!)['uid']).toBe('b');

    const planGuncelleme = fstore.transactionIslemleri.find((i) => i.op === 'update' && i.yol === `haftaPlanlari/${params.haftaId}`);
    expect(planGuncelleme).toBeDefined();
    const guncellemeVerisi = islemVerisi(planGuncelleme!);
    expect(guncellemeVerisi[`gunler.${params.tarih}.${params.vakit}`]).toEqual({ asil: 'a', yedek: 'b' });

    expect(telemetryService.logAudit).toHaveBeenCalledTimes(1);
  });

  it("'Sistem' birime bildirim yazmaz — yalnız gerçek kişiler belge alır", async () => {
    await expect(vakitAtamasiniGuncelle({ ...params, asilUid: 'Sistem', yedekUid: 'Sistem' })).resolves.toBe('updated');

    const setler = fstore.transactionIslemleri.filter((i) => i.op === 'set');
    expect(setler.length).toBe(0);
    expect(fstore.transactionIslemleri.some((i) => i.op === 'update' && i.yol === `haftaPlanlari/${params.haftaId}`)).toBe(true);
    expect(telemetryService.logAudit).toHaveBeenCalledTimes(1);
  });
});
