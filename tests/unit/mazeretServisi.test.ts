import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `mazeretServisi`'nin birim testleri — mazeret penceresinin (Cuma / 1 saat)
 * İSTEMCİ tarafı uygulama noktası. İş kurallarının kendisi
 * (`mazeretKurallari.ts`) ve SUNUCU tarafı zorlayıcısı (`firestore.rules`)
 * kendi testlerine sahip; burada doğrulanan şey servis ⇄ Firestore ara yüzü:
 *  - `mazeretZamanKontrolYap`: settings/vakitler okuma yolları, ezanSaati
 *    kısayolu, sabah için önceki gün yatsısı, fail-closed davranış.
 *  - `mazeretBildir`: kimlik/durum kapıları, yedek yolundaki atomik batch
 *    (bildirim + mazeret_detaylari), asil yolundaki transaction ve
 *    "1000 ifade tavanı" çözümü gereği yedek belgesine DOKUNULMAMASI.
 *  - `kriziBaslat`: admin manuel yedek terfisi + plan senkronu + alarm dedup.
 *
 * Firestore, auth ve telemetri tamamen sahte; mazeret kuralları ve tarih
 * yardımcıları GERÇEK modüller olarak çalışır.
 */

const fstore = vi.hoisted(() => {
  interface Islem {
    op: 'set' | 'update' | 'delete' | 'add';
    yol: string;
    veri?: unknown;
  }
  interface SorguKosulu {
    alan: string;
    op: string;
    deger: unknown;
  }

  const state = {
    kullanici: null as null | { uid: string; displayName?: string; email?: string },
    /** Tam belge yolu → belge verisi (ör. 'bildirimler/W_x_asil'). */
    belgeler: {} as Record<string, Record<string, unknown>>,
    /** Koleksiyon yolu → sorgulanabilir belge listesi ({id, data}). */
    sorgular: {} as Record<string, Array<{ id: string; data: Record<string, unknown> }>>,
  };

  const islemler: Islem[] = [];
  const transactionIslemleri: Islem[] = [];
  const batchIslemleri: Islem[] = [];
  const okunanYollar: string[] = [];
  let batchCommitSayisi = 0;
  let otoIdSayaci = 0;

  function sifirla() {
    state.kullanici = null;
    state.belgeler = { 'settings/system': { ilceId: '9148' } };
    state.sorgular = {};
    islemler.length = 0;
    transactionIslemleri.length = 0;
    batchIslemleri.length = 0;
    okunanYollar.length = 0;
    batchCommitSayisi = 0;
  }

  const serverTimestamp = () => ({ _sahte: 'server-now' });

  function belgeSnap(yol: string) {
    const varMi = yol in state.belgeler;
    return {
      id: yol.split('/').slice(1).join('/'),
      exists: () => varMi,
      data: () => (varMi ? state.belgeler[yol] : undefined),
      ref: { path: yol },
      metadata: { fromCache: false },
    };
  }

  async function getDoc(ref: { path: string }) {
    okunanYollar.push(ref.path);
    return belgeSnap(ref.path);
  }

  async function getDocs(q: { col: { path: string }; kosullar: SorguKosulu[] }) {
    const liste = state.sorgular[q.col.path] ?? [];
    const docs = liste
      .filter((k) => q.kosullar.every((kosul) => k.data[kosul.alan] === kosul.deger))
      .map((k) => ({
        id: k.id,
        exists: () => true,
        data: () => k.data,
        ref: { path: `${q.col.path}/${k.id}` },
        metadata: { fromCache: false },
      }));
    return { docs, empty: docs.length === 0 };
  }

  const transaction = {
    get: async (ref: { path: string }) => {
      okunanYollar.push(ref.path);
      return belgeSnap(ref.path);
    },
    set: (ref: { path: string }, veri: unknown) => transactionIslemleri.push({ op: 'set', yol: ref.path, veri }),
    update: (ref: { path: string }, veri: unknown) => transactionIslemleri.push({ op: 'update', yol: ref.path, veri }),
    delete: (ref: { path: string }) => transactionIslemleri.push({ op: 'delete', yol: ref.path }),
  };

  const modul = {
    serverTimestamp,
    collection: (_db: unknown, ad: string) => ({ path: ad }),
    doc: (...args: unknown[]) => {
      if (args.length === 1) {
        otoIdSayaci += 1;
        const col = args[0] as { path: string };
        return { path: `${col.path}/oto-${otoIdSayaci}` };
      }
      return { path: (args.slice(1) as string[]).join('/') };
    },
    query: (col: unknown, ...kosullar: SorguKosulu[]) => ({ col, kosullar }),
    where: (alan: string, op: string, deger: unknown) => ({ alan, op, deger }),
    getDoc,
    getDocs,
    runTransaction: async (_db: unknown, cb: (t: typeof transaction) => Promise<unknown>) => cb(transaction),
    writeBatch: () => ({
      set: (ref: { path: string }, veri: unknown) => batchIslemleri.push({ op: 'set', yol: ref.path, veri }),
      update: (ref: { path: string }, veri: unknown) => batchIslemleri.push({ op: 'update', yol: ref.path, veri }),
      delete: (ref: { path: string }) => batchIslemleri.push({ op: 'delete', yol: ref.path }),
      commit: async () => {
        batchCommitSayisi += 1;
      },
    }),
    addDoc: async (colRef: { path: string }, veri: unknown) => {
      islemler.push({ op: 'add', yol: colRef.path, veri });
      return { id: `oto-${otoIdSayaci++}` };
    },
    setDoc: async (ref: { path: string }, veri: unknown) => islemler.push({ op: 'set', yol: ref.path, veri }),
    updateDoc: async (ref: { path: string }, veri: unknown) => islemler.push({ op: 'update', yol: ref.path, veri }),
    deleteDoc: async (ref: { path: string }) => islemler.push({ op: 'delete', yol: ref.path }),
    DocumentSnapshot: undefined,
    DocumentData: undefined,
  };

  return {
    state,
    sifirla,
    islemler,
    transactionIslemleri,
    batchIslemleri,
    okunanYollar,
    batchCommitSayisi: () => batchCommitSayisi,
    modul,
  };
});

vi.mock('firebase/firestore', () => fstore.modul);
vi.mock('../../src/lib/firebase', () => ({
  db: {},
  auth: {
    get currentUser() {
      return fstore.state.kullanici;
    },
  },
}));
vi.mock('../../src/lib/firestore-errors', () => ({
  handleFirestoreError: (err: unknown) => err,
  OperationType: { GET: 'GET', WRITE: 'WRITE', UPDATE: 'UPDATE', DELETE: 'DELETE' },
}));
vi.mock('../../src/services/telemetryService', () => ({
  telemetryService: { logEvent: vi.fn(), logError: vi.fn(), logAudit: vi.fn() },
}));

import { mazeretZamanKontrolYap, mazeretBildir, kriziBaslat, mazeretKaydiSil } from '../../src/services/mazeretServisi';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** En az bir hafta ileride, haftanın hedef gününe (0=Pazar..6=Cmt) denk gelen tarih. */
function gelecekGun(hedef: number): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  while (d.getDay() !== hedef) d.setDate(d.getDate() + 1);
  return iso(d);
}

/** Dünden geriye doğru Cuma olmayan ilk gün (geçmiş, penceresi kesin kapalı). */
function gecmisCumaOlmayanGun(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 5) d.setDate(d.getDate() - 1);
  return iso(d);
}

/** Bir ayın tüm günlerine örnek vakit verisi yazar (sabah öncesi günler dahil kullanılabilir). */
function ayVakitleriEkle(ay: string) {
  const [y, m] = ay.split('-').map(Number);
  const gunler: Record<string, Record<string, string>> = {};
  for (let gun = 1; gun <= new Date(y, m, 0).getDate(); gun++) {
    gunler[`${ay}-${String(gun).padStart(2, '0')}`] = { sabah: '05:30', ogle: '12:30', ikindi: '15:30', aksam: '18:30', yatsi: '20:30' };
  }
  fstore.state.belgeler[`vakitler/9148_${ay}`] = { gunler };
}

function ayAdi(tarih: string) {
  return tarih.slice(0, 7);
}

beforeEach(() => {
  fstore.sifirla();
});

describe('mazeretZamanKontrolYap', () => {
  it('ezan saati verilince Firestore hiç okumadan pencereyi hesaplar', async () => {
    const durum = await mazeretZamanKontrolYap(gelecekGun(2), 'ogle', '23:59');
    expect(durum.kapali).toBe(false);
    expect(fstore.okunanYollar.length).toBe(0);
  });

  it('Cuma günleri hangi saat verilirse verilsin kapalıdır', async () => {
    const durum = await mazeretZamanKontrolYap(gelecekGun(5), 'ogle', '23:59');
    expect(durum.kapali).toBe(true);
    expect(durum.sebep).toContain('Cuma');
  });

  it('ezan verisi yoksa pencere KAPALI sayılır (fail-closed)', async () => {
    const tarih = gelecekGun(2);
    const durum = await mazeretZamanKontrolYap(tarih, 'ogle');
    expect(durum.kapali).toBe(true);
    expect(durum.sebep).toContain('bilinmediği');
  });

  it('ezan saatini vakitler koleksiyonundan taze okur', async () => {
    const tarih = gelecekGun(2);
    ayVakitleriEkle(ayAdi(tarih));
    const durum = await mazeretZamanKontrolYap(tarih, 'ogle');
    expect(durum.kapali).toBe(false);
    expect(fstore.okunanYollar).toContain(`vakitler/9148_${ayAdi(tarih)}`);
  });

  it('sabah vakti ÖNCEKİ GÜNÜN yatsısına göre hesaplanır — veri varsa açık', async () => {
    const tarih = gelecekGun(2);
    ayVakitleriEkle(ayAdi(tarih));
    // Ay sınırı güvenliği: önceki gün başka aya düşerse o ay da okunmalı.
    const [y, m, d] = tarih.split('-').map(Number);
    const onceki = iso(new Date(y, m - 1, d - 1));
    if (ayAdi(onceki) !== ayAdi(tarih)) ayVakitleriEkle(ayAdi(onceki));
    const durum = await mazeretZamanKontrolYap(tarih, 'sabah');
    expect(durum.kapali).toBe(false);
  });

  it('sabah için önceki gün yatsısı yoksa fail-closed kapalıdır', async () => {
    const tarih = gelecekGun(2);
    const durum = await mazeretZamanKontrolYap(tarih, 'sabah');
    expect(durum.kapali).toBe(true);
    expect(durum.sebep).toContain('bilinmediği');
  });

  it('ezana 1 saatten az kaldıysa (pencere geçtiyse) kapalıdır', async () => {
    const durum = await mazeretZamanKontrolYap(gecmisCumaOlmayanGun(), 'ogle', '01:00');
    expect(durum.kapali).toBe(true);
    expect(durum.sebep).toContain('1 saatten az');
  });
});

describe('mazeretBildir', () => {
  const HAFTA = 'W2126-01-05';
  const TARIH = gelecekGun(2);

  function asilBildirimi(ek: Record<string, unknown> = {}) {
    fstore.state.belgeler[`bildirimler/${HAFTA}_${TARIH}_ogle_asil`] = {
      haftaId: HAFTA,
      tarih: TARIH,
      vakit: 'ogle',
      uid: 'a',
      tip: 'asil',
      durum: 'bekliyor',
      ...ek,
    };
  }

  beforeEach(() => {
    fstore.state.kullanici = { uid: 'a', displayName: 'Ahmet' };
  });

  it('oturum yoksa hata verir', async () => {
    fstore.state.kullanici = null;
    await expect(mazeretBildir('W_x_asil', 'sebep', '23:59')).rejects.toThrow('Oturum bulunamadı');
  });

  it('başkasının görevine mazeret bildirilemez', async () => {
    asilBildirimi({ uid: 'b' });
    await expect(mazeretBildir(`${HAFTA}_${TARIH}_ogle_asil`, 'sebep', '23:59')).rejects.toThrow('Sadece kendi göreviniz');
  });

  it('beklemede olmayan göreve mazeret bildirilemez', async () => {
    asilBildirimi({ durum: 'onaylandi' });
    await expect(mazeretBildir(`${HAFTA}_${TARIH}_ogle_asil`, 'sebep', '23:59')).rejects.toThrow('bekleyen görevler');
  });

  it('Cuma günü mazeret reddedilir — sebep Cuma kuralını söyler', async () => {
    const cuma = gelecekGun(5);
    fstore.state.belgeler['bildirimler/W_cuma_asil'] = {
      haftaId: 'W_cuma',
      tarih: cuma,
      vakit: 'ogle',
      uid: 'a',
      tip: 'asil',
      durum: 'bekliyor',
    };
    await expect(mazeretBildir('W_cuma_asil', 'sebep', '23:59')).rejects.toThrow('Cuma');
  });

  it('yedek yolu: reddetme + mazeret detayı TEK atomik batch içinde', async () => {
    const id = `${HAFTA}_${TARIH}_ogle_yedek`;
    fstore.state.belgeler[`bildirimler/${id}`] = { haftaId: HAFTA, tarih: TARIH, vakit: 'ogle', uid: 'a', tip: 'yedek', durum: 'bekliyor' };

    await mazeretBildir(id, 'hastayım', '23:59');

    expect(fstore.batchCommitSayisi()).toBe(1);
    const guncelleme = fstore.batchIslemleri.find((i) => i.op === 'update' && i.yol === `bildirimler/${id}`);
    expect(guncelleme).toBeDefined();
    const veri = guncelleme!.veri as Record<string, unknown>;
    expect(veri['durum']).toBe('reddedildi');
    expect(veri['pendingAck']).toBe(false);
    expect(veri['devirSonucu']).toBe('alarm_bekliyor');
    // retSebebi bildirim belgesine YAZILMAZ — ayrı detay belgesine gider.
    expect(veri['retSebebi']).toBeUndefined();

    const detay = fstore.batchIslemleri.find((i) => i.op === 'set' && i.yol === `mazeret_detaylari/${id}`);
    expect(detay).toBeDefined();
    expect((detay!.veri as Record<string, unknown>)['retSebebi']).toBe('hastayım');
    // Yedek yolunda transaction hiç açılmaz.
    expect(fstore.transactionIslemleri.length).toBe(0);
  });

  it('asil yolu, uygun yedek varsa devirSonucu yedek_atandi yazar ve yedek belgesine DOKUNMAZ', async () => {
    asilBildirimi();
    const yedekId = `${HAFTA}_${TARIH}_ogle_yedek`;
    fstore.state.belgeler[`bildirimler/${yedekId}`] = { uid: 'b', tip: 'yedek', durum: 'bekliyor' };
    fstore.state.belgeler['muezzins/b'] = { role: 'muezzin', aktif: true };

    await mazeretBildir(`${HAFTA}_${TARIH}_ogle_asil`, 'hastayım', '23:59');

    const asilGuncelleme = fstore.transactionIslemleri.find(
      (i) => i.op === 'update' && i.yol === `bildirimler/${HAFTA}_${TARIH}_ogle_asil`
    );
    expect(asilGuncelleme).toBeDefined();
    expect((asilGuncelleme!.veri as Record<string, unknown>)['devirSonucu']).toBe('yedek_atandi');
    // "1000 ifade tavanı" kök neden çözümü: terfi istemcide YOK — yalnız cron.
    expect(fstore.transactionIslemleri.some((i) => i.yol === `bildirimler/${yedekId}`)).toBe(false);
    expect(fstore.transactionIslemleri.find((i) => i.op === 'set' && i.yol.startsWith('mazeret_detaylari/'))).toBeDefined();
  });

  it('yedek REDDEDİLMİŞSE müezzin belgesi okunmaz ve devirSonucu alarm_bekliyor olur', async () => {
    asilBildirimi();
    const yedekId = `${HAFTA}_${TARIH}_ogle_yedek`;
    fstore.state.belgeler[`bildirimler/${yedekId}`] = { uid: 'b', tip: 'yedek', durum: 'reddedildi' };

    await mazeretBildir(`${HAFTA}_${TARIH}_ogle_asil`, 'hastayım', '23:59');

    const asilGuncelleme = fstore.transactionIslemleri.find((i) => i.op === 'update');
    expect((asilGuncelleme!.veri as Record<string, unknown>)['devirSonucu']).toBe('alarm_bekliyor');
    expect(fstore.okunanYollar.some((y) => y === 'muezzins/b')).toBe(false);
  });

  it('yedek hiç yoksa devirSonucu alarm_bekliyor olur', async () => {
    asilBildirimi();
    await mazeretBildir(`${HAFTA}_${TARIH}_ogle_asil`, 'hastayım', '23:59');
    const asilGuncelleme = fstore.transactionIslemleri.find((i) => i.op === 'update');
    expect((asilGuncelleme!.veri as Record<string, unknown>)['devirSonucu']).toBe('alarm_bekliyor');
  });
});

describe('kriziBaslat (admin manuel yedek terfisi)', () => {
  const TARIH = gelecekGun(2);

  function planEkle(haftaId: string) {
    fstore.state.belgeler[`haftaPlanlari/${haftaId}`] = { gunler: {} };
  }

  it('uygun yedeği asile terfi ettirir, planı senkronlar ve yedeği Sistem yapar', async () => {
    const { getHaftaIdFromDate } = await import('../../src/lib/dateUtils');
    const haftaId = getHaftaIdFromDate(TARIH);
    planEkle(haftaId);
    fstore.state.sorgular['bildirimler'] = [
      { id: 'W_yedek', data: { uid: 'b', tip: 'yedek', durum: 'bekliyor', tarih: TARIH, vakit: 'ogle' } },
    ];
    fstore.state.belgeler['muezzins/b'] = { role: 'muezzin', aktif: true };
    fstore.state.belgeler['bildirimler/W_yedek'] = { uid: 'b', tip: 'yedek', durum: 'bekliyor', tarih: TARIH, vakit: 'ogle' };

    await expect(kriziBaslat(TARIH, 'ogle', ['a'])).resolves.toBe(true);

    const terfi = fstore.transactionIslemleri.find((i) => i.op === 'update' && i.yol === 'bildirimler/W_yedek');
    expect(terfi).toBeDefined();
    const terfiVerisi = terfi!.veri as Record<string, unknown>;
    expect(terfiVerisi['tip']).toBe('asil');
    expect(terfiVerisi['pendingAck']).toBe(true);

    const planGuncelleme = fstore.transactionIslemleri.find((i) => i.op === 'update' && i.yol === `haftaPlanlari/${haftaId}`);
    expect(planGuncelleme).toBeDefined();
    const planVerisi = planGuncelleme!.veri as Record<string, unknown>;
    expect(planVerisi[`gunler.${TARIH}.ogle.asil`]).toBe('b');
    expect(planVerisi[`gunler.${TARIH}.ogle.yedek`]).toBe('Sistem');
  });

  it('yedek yoksa admin alarmı açar ve false döner', async () => {
    fstore.state.sorgular['bildirimler'] = [];
    await expect(kriziBaslat(TARIH, 'ogle', ['a'])).resolves.toBe(false);
    const alarm = fstore.islemler.find((i) => i.op === 'add' && i.yol === 'adminUyarilari');
    expect(alarm).toBeDefined();
    expect((alarm!.veri as Record<string, unknown>)['tip']).toBe('zincirTukendi');
  });

  it('aynı tarih/vakit için çözülmemiş alarm VARSA yenisini açmaz (dedup)', async () => {
    fstore.state.sorgular['bildirimler'] = [];
    fstore.state.sorgular['adminUyarilari'] = [{ id: 'u1', data: { tarih: TARIH, vakit: 'ogle', cozuldu: false } }];
    await expect(kriziBaslat(TARIH, 'ogle', ['a'])).resolves.toBe(false);
    expect(fstore.islemler.some((i) => i.op === 'add')).toBe(false);
  });

  it('yedek pasifse terfi yerine alarm açar', async () => {
    fstore.state.sorgular['bildirimler'] = [
      { id: 'W_yedek', data: { uid: 'b', tip: 'yedek', durum: 'bekliyor', tarih: TARIH, vakit: 'ogle' } },
    ];
    fstore.state.belgeler['muezzins/b'] = { role: 'muezzin', aktif: false };
    await expect(kriziBaslat(TARIH, 'ogle', ['a'])).resolves.toBe(false);
    expect(fstore.islemler.some((i) => i.op === 'add' && i.yol === 'adminUyarilari')).toBe(true);
  });
});

describe('mazeretKaydiSil', () => {
  it('belgeyi silme yoluna deleteDoc yazar', async () => {
    await mazeretKaydiSil('W_eski_asil');
    expect(fstore.islemler).toContainEqual({ op: 'delete', yol: 'bildirimler/W_eski_asil' });
  });
});
