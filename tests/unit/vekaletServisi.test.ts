import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `vekaletServisi`'nin birim testleri — görev devrinin (vekalet) İSTEMCİ
 * tarafı uygulama noktası. `vekaletServisi.ts`, `mazeretZamanKontrolYap`'ı
 * mazeretServisi'den İÇE aktarır — o modül burada GERÇEK çalışır (Firestore
 * tarafı aynı sahte modüle düşer), böylece iki servis arasındaki pencere
 * sözleşmesi de dolaylı doğrulanır.
 *
 * Doğrulanan kritik davranışlar:
 *  - `vekaletTeklifEt`: Cuma/1-saat penceresi devri de kapatır (mazeret
 *    engeli bu yoldan atlatılamaz), deterministik talep ID, reddedilen
 *    talebin silinip yeniden oluşturulması (O7 kilidi çözümü).
 *  - `vekaletKabulEt`: kabul anında İKİNCİ pencere kontrolü (K4), alıcı
 *    kimlik/durum kapıları, "iki kabul yarışı" erken reddi (niyet bayrağı),
 *    bayat bayrağin geçerli SAYILMAMASI (48 saat aşımı), kabul yazımının
 *    dar olması ("1000 ifade tavanı" çözümü — uid flip'i YOK, sadece
 *    talep + niyet bayrağı).
 *  - `vekaletReddet`: tek alan güncellemesi.
 *
 * Firestore/auth/telemetri sahte; mazeret kuralları, slot koruması ve tarih
 * yardımcıları GERÇEK modüller.
 */

const fstore = vi.hoisted(() => {
  const state = {
    kullanici: null as null | { uid: string; displayName?: string; email?: string },
    /** Tam belge yolu → belge verisi. */
    belgeler: {} as Record<string, Record<string, unknown>>,
  };

  const islemler: Array<{ op: 'set' | 'update' | 'delete'; yol: string; veri?: unknown }> = [];
  const transactionIslemleri: Array<{ op: 'set' | 'update' | 'delete'; yol: string; veri?: unknown }> = [];
  const okunanYollar: string[] = [];

  function sifirla() {
    state.kullanici = null;
    state.belgeler = { 'settings/system': { ilceId: '9148' } };
    islemler.length = 0;
    transactionIslemleri.length = 0;
    okunanYollar.length = 0;
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
    doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
    query: (col: unknown, ...kosullar: unknown[]) => ({ col, kosullar }),
    where: (alan: string, op: string, deger: unknown) => ({ alan, op, deger }),
    getDoc: async (ref: { path: string }) => {
      okunanYollar.push(ref.path);
      return belgeSnap(ref.path);
    },
    getDocs: async () => ({ docs: [], empty: true }),
    runTransaction: async (_db: unknown, cb: (t: typeof transaction) => Promise<unknown>) => cb(transaction),
    setDoc: async (ref: { path: string }, veri: unknown) => islemler.push({ op: 'set', yol: ref.path, veri }),
    updateDoc: async (ref: { path: string }, veri: unknown) => islemler.push({ op: 'update', yol: ref.path, veri }),
    deleteDoc: async (ref: { path: string }) => islemler.push({ op: 'delete', yol: ref.path }),
  };

  return { state, sifirla, islemler, transactionIslemleri, okunanYollar, modul };
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

import { vekaletTeklifEt, vekaletKabulEt, vekaletReddet } from '../../src/services/vekaletServisi';
import { Vakit } from '../../src/types';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** En az bir hafta ileride, haftanın hedef gününe (2=Salı, 5=Cuma) denk gelen tarih. */
function gelecekGun(hedef: number): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  while (d.getDay() !== hedef) d.setDate(d.getDate() + 1);
  return iso(d);
}

/** Kabul anındaki pencere kontrolü vakitler'i taze okur — ay verisini hazırlar. */
function ayVakitleriEkle(ay: string) {
  const [y, m] = ay.split('-').map(Number);
  const gunler: Record<string, Record<string, string>> = {};
  for (let gun = 1; gun <= new Date(y, m, 0).getDate(); gun++) {
    gunler[`${ay}-${String(gun).padStart(2, '0')}`] = { sabah: '05:30', ogle: '12:30', ikindi: '15:30', aksam: '18:30', yatsi: '20:30' };
  }
  fstore.state.belgeler[`vakitler/9148_${ay}`] = { gunler };
}

const HAFTA = 'W2126-01-05';
const TARIH = gelecekGun(2);
const VAKIT: Vakit = 'ogle';
const TALEP_ID = `${HAFTA}_${TARIH}_${VAKIT}_asil_b`;

function talepEkle(ek: Record<string, unknown> = {}) {
  fstore.state.belgeler[`vekalet_talepleri/${TALEP_ID}`] = {
    bildirimId: `${HAFTA}_${TARIH}_${VAKIT}_asil`,
    haftaId: HAFTA,
    gonderenUid: 'a',
    aliciUid: 'b',
    tarih: TARIH,
    vakit: VAKIT,
    saat: '12:30',
    tip: 'asil',
    durum: 'beklemede',
    ...ek,
  };
}

function bildirimEkle(ek: Record<string, unknown> = {}) {
  fstore.state.belgeler[`bildirimler/${HAFTA}_${TARIH}_${VAKIT}_asil`] = {
    haftaId: HAFTA,
    tarih: TARIH,
    vakit: VAKIT,
    uid: 'a',
    tip: 'asil',
    durum: 'bekliyor',
    ...ek,
  };
}

beforeEach(() => {
  fstore.sifirla();
});

describe('vekaletTeklifEt', () => {
  it('oturum yoksa hata verir', async () => {
    await expect(vekaletTeklifEt('b1', HAFTA, TARIH, VAKIT, '12:30', 'asil', 'b', 'Mehmet')).rejects.toThrow('Oturum açmış');
  });

  it('Cuma günleri vekalet teklifi de KAPALIDIR — mazeret engeli bu yoldan atlatılamaz', async () => {
    fstore.state.kullanici = { uid: 'a', displayName: 'Ahmet' };
    const cuma = gelecekGun(5);
    await expect(vekaletTeklifEt('b1', `W${cuma}`, cuma, VAKIT, '12:30', 'asil', 'b', 'Mehmet')).rejects.toThrow('Cuma');
  });

  it('deterministik talep ID ile beklemede kaydeder; önceki talep yoksa silme olmaz', async () => {
    fstore.state.kullanici = { uid: 'a', displayName: 'Ahmet' };
    await vekaletTeklifEt('b1', HAFTA, TARIH, VAKIT, '23:59', 'asil', 'b', 'Mehmet');

    const set = fstore.islemler.find((i) => i.op === 'set' && i.yol === `vekalet_talepleri/${TALEP_ID}`);
    expect(set).toBeDefined();
    const veri = set!.veri as Record<string, unknown>;
    expect(veri['durum']).toBe('beklemede');
    expect(veri['gonderenUid']).toBe('a');
    expect(veri['aliciUid']).toBe('b');
    expect(fstore.islemler.some((i) => i.op === 'delete')).toBe(false);
  });

  it('daha önce REDDEDİLEN talep önce silinir — kilitlenmiş teklif yeniden gönderilebilir', async () => {
    fstore.state.kullanici = { uid: 'a', displayName: 'Ahmet' };
    talepEkle({ durum: 'reddedildi' });

    await vekaletTeklifEt('b1', HAFTA, TARIH, VAKIT, '23:59', 'asil', 'b', 'Mehmet');

    expect(fstore.islemler.find((i) => i.op === 'delete' && i.yol === `vekalet_talepleri/${TALEP_ID}`)).toBeDefined();
    expect(fstore.islemler.find((i) => i.op === 'set' && i.yol === `vekalet_talepleri/${TALEP_ID}`)).toBeDefined();
  });
});

describe('vekaletKabulEt', () => {
  beforeEach(() => {
    fstore.state.kullanici = { uid: 'b', displayName: 'Mehmet' };
    ayVakitleriEkle(TARIH.slice(0, 7));
  });

  it('talep bulunamazsa hata verir', async () => {
    await expect(vekaletKabulEt(TALEP_ID)).rejects.toThrow('Vekalet talebi bulunamadı');
  });

  it('pencere kapalıysa (Cuma) kabul REDDEDİLİR — kabul anındaki ikinci kontrol', async () => {
    const cuma = gelecekGun(5);
    const cumaTalepId = `W${cuma}_${cuma}_ogle_asil_b`;
    fstore.state.belgeler[`vekalet_talepleri/${cumaTalepId}`] = {
      bildirimId: 'x',
      tarih: cuma,
      vakit: VAKIT,
      aliciUid: 'b',
      durum: 'beklemede',
    };
    await expect(vekaletKabulEt(cumaTalepId)).rejects.toThrow('Cuma');
  });

  it('sonuçlandırılmış talep tekrar kabul edilemez', async () => {
    talepEkle({ durum: 'kabul_edildi' });
    await expect(vekaletKabulEt(TALEP_ID)).rejects.toThrow('zaten sonuçlandırılmış');
  });

  it('teklif yalnız alıcısı tarafından kabul edilebilir', async () => {
    talepEkle({ aliciUid: 'c' });
    await expect(vekaletKabulEt(TALEP_ID)).rejects.toThrow('size ait değil');
  });

  it('görev bildirimi zaten sonuçlanmışsa kabul reddedilir', async () => {
    talepEkle();
    bildirimEkle({ durum: 'reddedildi' });
    await expect(vekaletKabulEt(TALEP_ID)).rejects.toThrow('Bu görev zaten sonuçlandırılmış');
  });

  it('GEÇERLİ bir bekleyen devir bayrağı varsa ikinci kabul erken reddedilir', async () => {
    talepEkle();
    bildirimEkle({ vekaletDevriBekliyor: true, sonGuncelleme: { toMillis: () => Date.now() } });
    await expect(vekaletKabulEt(TALEP_ID)).rejects.toThrow('başka bir vekalet devri');
  });

  it('BAYAT (48 saatten eski) bayrak devir SAYILMAZ — kabul yazımı yapılır', async () => {
    talepEkle();
    bildirimEkle({
      vekaletDevriBekliyor: true,
      sonGuncelleme: { toMillis: () => Date.now() - 72 * 60 * 60 * 1000 },
    });

    await vekaletKabulEt(TALEP_ID);

    const talepGuncelleme = fstore.transactionIslemleri.find((i) => i.op === 'update' && i.yol === `vekalet_talepleri/${TALEP_ID}`);
    expect(talepGuncelleme).toBeDefined();
    expect((talepGuncelleme!.veri as Record<string, unknown>)['durum']).toBe('kabul_edildi');

    const bildirimYolu = `bildirimler/${HAFTA}_${TARIH}_${VAKIT}_asil`;
    const bayrakYazimi = fstore.transactionIslemleri.find((i) => i.op === 'update' && i.yol === bildirimYolu);
    expect(bayrakYazimi).toBeDefined();
    const bayrakVerisi = bayrakYazimi!.veri as Record<string, unknown>;
    expect(bayrakVerisi['vekaletDevriBekliyor']).toBe(true);
    // "1000 ifade tavanı" çözümü: istemci uid FLİP'İ YAPMAZ — yalnız niyet bayrağı.
    expect(bayrakVerisi['uid']).toBeUndefined();
  });
});

describe('vekaletReddet', () => {
  it('talebi reddedildi olarak günceller', async () => {
    await vekaletReddet(TALEP_ID);
    const guncelleme = fstore.islemler.find((i) => i.op === 'update' && i.yol === `vekalet_talepleri/${TALEP_ID}`);
    expect(guncelleme).toBeDefined();
    expect((guncelleme!.veri as Record<string, unknown>)['durum']).toBe('reddedildi');
  });
});
