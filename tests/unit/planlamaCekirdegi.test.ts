import { describe, it, expect, vi } from 'vitest';
import {
  haftalikPlanUret,
  tekKisiliGunleriBul,
  kapsamsizGunleriBul,
  nobeteAtanabilirMi,
  oncekiHaftaninArdArdaYedekSayilariniHesapla,
  gunIzinliUidler,
  VAKITLER,
  MuezzinAday,
  OnayliIzin,
} from '../../src/lib/planlamaCekirdegi';
import { Muezzin, Vakit } from '../../src/types';

function muezzin(id: string, overrides: Partial<Muezzin> = {}): MuezzinAday {
  return {
    id,
    displayName: id,
    photoURL: '',
    role: 'muezzin',
    aktif: true,
    fcmToken: null,
    aylikVakitSayisi: 0,
    ...overrides,
  };
}

// 2026-08-03 Pazartesi .. 2026-08-09 Pazar (isFriday testleri için 2026-08-07 Cuma içerir)
const HAFTA_GUNLERI = [
  '2026-08-03', // Pazartesi
  '2026-08-04', // Salı
  '2026-08-05', // Çarşamba
  '2026-08-06', // Perşembe
  '2026-08-07', // Cuma
  '2026-08-08', // Cumartesi
  '2026-08-09', // Pazar
];

describe('haftalikPlanUret', () => {
  it('onaylı izindeki personeli o gün hiçbir vakte atamaz', () => {
    const muezzinler = [muezzin('a'), muezzin('b'), muezzin('c')];
    const onayliIzinler: OnayliIzin[] = [{ uid: 'a', baslangic: '2026-08-03', bitis: '2026-08-03' }];

    const plan = haftalikPlanUret(['2026-08-03'], muezzinler, onayliIzinler);

    for (const vakit of VAKITLER) {
      expect(plan['2026-08-03'][vakit].asil).not.toBe('a');
      expect(plan['2026-08-03'][vakit].yedek).not.toBe('a');
    }
  });

  it('sabit haftalık izin gününde olan personeli o gün atamaz', () => {
    // 2026-08-03 Pazartesi -> gunIndex 0, haftalikIzinGunu 1 olan kişi Pazartesi izinlidir.
    const muezzinler = [muezzin('a', { haftalikIzinGunu: 1 }), muezzin('b'), muezzin('c')];

    const plan = haftalikPlanUret(['2026-08-03'], muezzinler, []);

    for (const vakit of VAKITLER) {
      expect(plan['2026-08-03'][vakit].asil).not.toBe('a');
      expect(plan['2026-08-03'][vakit].yedek).not.toBe('a');
    }
  });

  it('tek müsait personel varsa asil olarak atar, yedeği Sistem bırakır', () => {
    const muezzinler = [muezzin('a'), muezzin('b', { haftalikIzinGunu: 1 }), muezzin('c', { haftalikIzinGunu: 1 })];

    const plan = haftalikPlanUret(['2026-08-03'], muezzinler, []);

    for (const vakit of VAKITLER) {
      expect(plan['2026-08-03'][vakit]).toEqual({ asil: 'a', yedek: 'Sistem' });
    }
  });

  it('hiç müsait personel yoksa tüm vakitleri Sistem/Sistem olarak bırakır', () => {
    const muezzinler = [muezzin('a', { haftalikIzinGunu: 1 }), muezzin('b', { haftalikIzinGunu: 1 })];

    const plan = haftalikPlanUret(['2026-08-03'], muezzinler, []);

    for (const vakit of VAKITLER) {
      expect(plan['2026-08-03'][vakit]).toEqual({ asil: 'Sistem', yedek: 'Sistem' });
    }
  });

  it('bir günün tüm vakitlerine aynı asil/yedek ikilisini atar (günlük tek atama)', () => {
    const muezzinler = [muezzin('a'), muezzin('b'), muezzin('c'), muezzin('d')];

    const plan = haftalikPlanUret(['2026-08-03'], muezzinler, []);
    const gunAtamalari = VAKITLER.map((vakit) => plan['2026-08-03'][vakit]);

    expect(new Set(gunAtamalari.map((a) => `${a.asil}-${a.yedek}`)).size).toBe(1);
  });

  it('korunmuş atama verildiğinde o vakit için taze hesaplama atlanır ama yük dengesine dahil edilir', () => {
    const muezzinler = [muezzin('a'), muezzin('b'), muezzin('c'), muezzin('d')];
    const korunmusAtama = vi.fn((gun: string, vakit: Vakit) => (vakit === 'sabah' ? { asil: 'd', yedek: 'c' } : null));

    const plan = haftalikPlanUret(['2026-08-03'], muezzinler, [], korunmusAtama);

    expect(plan['2026-08-03'].sabah).toEqual({ asil: 'd', yedek: 'c' });
    // Diğer vakitler taze hesaplanan günlük ikili ile aynı olmalı ve d/c'den farklı olabilir.
    const ogle = plan['2026-08-03'].ogle;
    expect(ogle).toEqual(plan['2026-08-03'].ikindi);
  });

  it('asilYukSayilmasin işaretli korunmuş atama, mazeret bildiren kişiyi haftalık yükten VE SOS bloğundan muaf tutar (PL-O5 regresyonu)', () => {
    // 'a' Pazartesi mazeret bildirdi (reddedildi) — bildirim belgesi hâlâ
    // 'a' uid'ini taşıyor (bkz. planServisi.ts korunmusAtama), ama
    // mazeretDevirleriniIsle.ts bir yedeği terfi ettirene kadar geçen
    // pencerede 'a' bu görevi YAPMAYACAK. Eski davranışta 'a' bu günü
    // fiilen yapmış gibi haftalık yüke +1 giriyordu — bu da Salı günü
    // 'b'nin (gerçekten yedek kalmış, +0.5 yük) daha az yüklü görünüp
    // asil seçilmesine yol açardı. Düzeltmeyle 'a' hiç yük almadığından
    // (0 < 0.5) Salı günü yine 'a' en az yüklü kabul edilir.
    const muezzinler = [muezzin('a'), muezzin('b')];
    const korunmusAtama = (gun: string) => (gun === '2026-08-03' ? { asil: 'a', yedek: 'b', asilYukSayilmasin: true } : null);

    const plan = haftalikPlanUret(['2026-08-03', '2026-08-04'], muezzinler, [], korunmusAtama);

    expect(plan['2026-08-03'].sabah).toEqual({ asil: 'a', yedek: 'b' });
    expect(plan['2026-08-04'].sabah.asil).toBe('a');
  });

  it('yedekYukSayilmasin işaretli korunmuş atama, yedek tarafı için de aynı şekilde çalışır (PL-O5 regresyonu)', () => {
    const muezzinler = [muezzin('a'), muezzin('b'), muezzin('c'), muezzin('d')];
    const korunmusAtama = (gun: string) => (gun === '2026-08-03' ? { asil: 'a', yedek: 'b', yedekYukSayilmasin: true } : null);

    const plan = haftalikPlanUret(['2026-08-03'], muezzinler, [], korunmusAtama);

    expect(plan['2026-08-03'].sabah).toEqual({ asil: 'a', yedek: 'b' });
  });

  it('art arda yedek sayacı, korunmuş atama bir günün vakitlerini böldüğünde günün SADECE son vaktine değil tüm güne bakar (mantık denetimi regresyonu)', () => {
    // 2 kişilik kadro: 'a' iki gün üst üste, günün ÇOĞUNDA asil ama SADECE
    // yatsıda yedek kalıyor (korunmusAtama ile zorlanıyor). Eski hatalı kod
    // yalnızca günün SON vaktine (yatsı) bakıp 'a'yı iki gün de "o gün
    // sadece yedek kaldı" sayıp streak'ini 2'ye (ARD_ARDA_YEDEK_ESIGI)
    // çıkarıyordu — oysa 'a' o günlerin çoğunda fiilen asildi. Ağırlıklı
    // haftalık yük bilinçli olarak iki günün sonunda TAM EŞİT olacak
    // şekilde kurgulandı (a: 2 asil+3 yedek gün1, 3 asil+2 yedek gün2 =
    // 3.5+4.0 = 7.5; b tam tersi = 4.0+3.5 = 7.5) — böylece 3. günün
    // sonucunu yalnızca streak kilidi (varsa) ya da id-hash belirler.
    const muezzinler = [muezzin('a'), muezzin('b')];
    const forced: Record<string, Partial<Record<Vakit, { asil: string; yedek: string }>>> = {
      '2026-08-03': {
        sabah: { asil: 'a', yedek: 'b' },
        ogle: { asil: 'a', yedek: 'b' },
        ikindi: { asil: 'b', yedek: 'a' },
        aksam: { asil: 'b', yedek: 'a' },
        yatsi: { asil: 'b', yedek: 'a' }, // 'a' bu günün SON vaktinde yedek
      },
      '2026-08-04': {
        sabah: { asil: 'a', yedek: 'b' },
        ogle: { asil: 'a', yedek: 'b' },
        ikindi: { asil: 'a', yedek: 'b' },
        aksam: { asil: 'b', yedek: 'a' },
        yatsi: { asil: 'b', yedek: 'a' }, // 'a' yine SON vakitte yedek
      },
    };
    const korunmusAtama = (gun: string, vakit: Vakit) => forced[gun]?.[vakit] ?? null;

    const plan = haftalikPlanUret(['2026-08-03', '2026-08-04', '2026-08-05'], muezzinler, [], korunmusAtama);

    // 3. gün (korunmusAtama yok, taze hesaplama): ağırlıklı yükler eşit
    // olduğundan eski koddaki hatalı streak kilidi devrede olsaydı 'a'
    // yanlışlıkla yedek yarışından çıkarılıp 'b' asil olurdu. Doğru
    // davranışta streak her iki günün sonunda da sıfırlanır (ikisi de o
    // gün asil olmuştu), karar id-hash kademesine düşer ve 'a' asil olur.
    expect(plan['2026-08-05'].sabah).toEqual({ asil: 'a', yedek: 'b' });
  });

  it('haftalık yükü, iki müsait kişi arasında dengeli biçimde dağıtır', () => {
    const muezzinler = [muezzin('a'), muezzin('b')];

    const plan = haftalikPlanUret(HAFTA_GUNLERI, muezzinler, []);

    const yukler: Record<string, number> = { a: 0, b: 0 };
    for (const gun of HAFTA_GUNLERI) {
      for (const vakit of VAKITLER) {
        const atama = plan[gun][vakit];
        if (atama.asil !== 'Sistem') yukler[atama.asil] += 1;
        if (atama.yedek !== 'Sistem') yukler[atama.yedek] += 1;
      }
    }

    expect(Math.abs(yukler.a - yukler.b)).toBeLessThanOrEqual(1);
  });

  it('bir önceki günün ekibini SOS kuralıyla arka sıraya atarak art arda aynı ikiliyi seçmekten kaçınır', () => {
    const muezzinler = [muezzin('a'), muezzin('b'), muezzin('c'), muezzin('d')];

    const plan = haftalikPlanUret(['2026-08-03', '2026-08-04'], muezzinler, []);

    const gun1Ekip = new Set([plan['2026-08-03'].sabah.asil, plan['2026-08-03'].sabah.yedek]);
    const gun2Ekip = new Set([plan['2026-08-04'].sabah.asil, plan['2026-08-04'].sabah.yedek]);

    // 4 müsait kişiden 2'si dünkü ekipte olduğu için bugün en az bir farklı kişi seçilmeli.
    const kesisim = [...gun1Ekip].filter((uid) => gun2Ekip.has(uid));
    expect(kesisim.length).toBeLessThan(2);
  });

  it('oncekiHaftaSonEkibi parametresi, yeni haftanın ilk gününde SOS kuralını tetikler', () => {
    // Önceki turdaki denetimde bulunan gerçek hata: her hafta ayrı bir
    // haftalikPlanUret() çağrısıyla üretildiği için dinlenme kuralı hafta
    // sınırında sıfırlanıyordu (Pazar ekibi Pazartesi tekrar seçilebiliyordu).
    const muezzinler = [muezzin('a'), muezzin('b'), muezzin('c'), muezzin('d')];

    const plan = haftalikPlanUret(['2026-08-03'], muezzinler, [], undefined, ['a', 'b']);

    const gun1Ekip = new Set([plan['2026-08-03'].sabah.asil, plan['2026-08-03'].sabah.yedek]);
    const kesisim = [...gun1Ekip].filter((uid) => ['a', 'b'].includes(uid));
    expect(kesisim.length).toBeLessThan(2);
  });

  it('SOS kuralı SADECE dünkü ASİLİ engeller — dünkü yedek bugün asil olabilir (PL-K1 regresyonu)', () => {
    // 3 kişilik kadroda dünkü hem asil hem yedek engellenseydi geriye tek
    // aday kalır ve o kişi Cuma/aylık adalete bakılmaksızın zorunlu asil
    // olurdu (premium hata analizi PL-K1). Burada 'b' dünkü yedek — bugün
    // asil olabilmeli (yalnızca dünkü asil 'a' engellenir).
    const muezzinler = [muezzin('aaa'), muezzin('bbb'), muezzin('ccc')];

    const plan = haftalikPlanUret(['2026-08-03'], muezzinler, [], undefined, ['aaa']);

    expect(plan['2026-08-03'].sabah.asil).not.toBe('aaa');
    expect(['bbb', 'ccc']).toContain(plan['2026-08-03'].sabah.asil);
  });

  it('3 kişilik kadroda 4 hafta sonunda Cuma görevleri tek kişide toplanmaz (PL-K1 adalet regresyonu)', () => {
    // Ölçülen kök hata: eski SOS (dünkü asil+yedek birlikte engellenir) 3
    // kişilik kadroda geriye her zaman tek aday bırakıyordu, bu da Cuma
    // adalet kademesinin asil seçimine hiç karışamamasına yol açıyordu —
    // simülasyonda 4 haftanın 4 Cuma'sı da aynı kişiye çıkmıştı.
    let muezzinler: MuezzinAday[] = [muezzin('aaa'), muezzin('bbb'), muezzin('ccc')];
    const haftalar = [
      ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'],
      ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'],
      ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'],
      ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'],
    ];
    const cumaAsilSayisi: Record<string, number> = { aaa: 0, bbb: 0, ccc: 0 };
    let oncekiHaftaSonEkibi: string[] = [];
    let oncekiGunPlan: Record<string, Record<Vakit, { asil: string; yedek: string }>> | undefined;

    for (const gunler of haftalar) {
      const oncekiArdArdaYedekSayilari = oncekiHaftaninArdArdaYedekSayilariniHesapla(
        oncekiGunPlan,
        muezzinler.map((m) => m.id)
      );
      const plan = haftalikPlanUret(gunler, muezzinler, [], undefined, oncekiHaftaSonEkibi, oncekiArdArdaYedekSayilari);

      const haftaAsilKredi: Record<string, number> = { aaa: 0, bbb: 0, ccc: 0 };
      const haftaYedekKredi: Record<string, number> = { aaa: 0, bbb: 0, ccc: 0 };
      for (const gun of gunler) {
        for (const vakit of VAKITLER) {
          const atama = plan[gun][vakit];
          if (atama.asil !== 'Sistem') haftaAsilKredi[atama.asil]++;
          if (atama.yedek !== 'Sistem') haftaYedekKredi[atama.yedek]++;
        }
      }
      const cumaGun = gunler[4]; // Perşembe'den sonraki gün = Cuma (2026-08-03 Pazartesi tabanlı)
      const cumaAtama = plan[cumaGun].ogle;
      if (cumaAtama.asil !== 'Sistem') cumaAsilSayisi[cumaAtama.asil]++;

      muezzinler = muezzinler.map((m) => ({
        ...m,
        aylikVakitSayisi: (m.aylikVakitSayisi || 0) + haftaAsilKredi[m.id],
        aylikYedekSayisi: (m.aylikYedekSayisi || 0) + haftaYedekKredi[m.id],
        aylikCumaSayisi: (m.aylikCumaSayisi || 0) + (cumaAtama.asil === m.id ? 1 : 0),
      }));

      const sonGun = gunler[6];
      const sonVakitAtama = plan[sonGun].yatsi;
      oncekiHaftaSonEkibi = [sonVakitAtama.asil].filter((uid) => uid !== 'Sistem');
      oncekiGunPlan = plan;
    }

    // Eski hatalı davranış: {aaa:4, bbb:0, ccc:0}. Adaletli davranış: her
    // kişi en fazla 2 kez Cuma yapmış olmalı (4 hafta / 3 kişi ≈ 1.33/kişi).
    expect(Object.values(cumaAsilSayisi).every((n) => n <= 2)).toBe(true);
  });

  it('sabit haftalık izin günü olan 3 kişilik kadroda Cuma görevi tek kişide toplanmaz (tier sırası regresyonu)', () => {
    // ÖLÇÜLEN KÖK HATA: tie-breaker'da "art arda yedek kilidi kırıcı" kademesi
    // "Cuma adaleti" kademesinden ÖNCE çalışıyordu. Kadroda TEK bir kişinin
    // sabit haftalık izin günü olması, bir kişinin her Çarşamba+Perşembe yedek
    // kalıp Cuma'ya tam olarak streak=2 ile girmesine yol açıyor; kilit kırıcı
    // her Cuma tetiklenip o kişiyi asile terfi ettiriyor ve Cuma adaleti
    // kademesi HİÇ çalışamıyordu. 26 haftalık simülasyonda ölçülen sonuç:
    // Cuma dağılımı {aaa:0, bbb:26, ccc:0} (26 Cuma'nın 26'sı aynı kişide).
    // Doğru sırada (Cuma adaleti önce) aynı simülasyon {8,9,9} veriyor.
    //
    // Bu test 8 haftalık kısaltılmış hâli: kimse 8 Cuma'nın yarısından
    // fazlasını yapmamalı ve HERKES en az bir Cuma yapmış olmalı.
    let muezzinler: MuezzinAday[] = [
      muezzin('aaa', { haftalikIzinGunu: 1 }), // Pazartesi sabit izinli
      muezzin('bbb'),
      muezzin('ccc'),
    ];
    const cumaAsilSayisi: Record<string, number> = { aaa: 0, bbb: 0, ccc: 0 };
    let oncekiHaftaSonEkibi: string[] = [];
    let oncekiGunPlan: Record<string, Record<Vakit, { asil: string; yedek: string }>> | undefined;

    for (let h = 0; h < 8; h++) {
      const gunler: string[] = [];
      for (let i = 0; i < 7; i++) {
        const gun = new Date(2026, 7, 3);
        gun.setDate(gun.getDate() + h * 7 + i);
        gunler.push(`${gun.getFullYear()}-${String(gun.getMonth() + 1).padStart(2, '0')}-${String(gun.getDate()).padStart(2, '0')}`);
      }
      const oncekiArdArda = oncekiHaftaninArdArdaYedekSayilariniHesapla(
        oncekiGunPlan,
        muezzinler.map((m) => m.id)
      );
      const plan = haftalikPlanUret(gunler, muezzinler, [], undefined, oncekiHaftaSonEkibi, oncekiArdArda);

      const haftaAsil: Record<string, number> = { aaa: 0, bbb: 0, ccc: 0 };
      const haftaYedek: Record<string, number> = { aaa: 0, bbb: 0, ccc: 0 };
      for (const gun of gunler) {
        for (const vakit of VAKITLER) {
          const atama = plan[gun][vakit];
          if (atama.asil !== 'Sistem') haftaAsil[atama.asil]++;
          if (atama.yedek !== 'Sistem') haftaYedek[atama.yedek]++;
        }
      }
      const cumaAtama = plan[gunler[4]].ogle; // gunler[4] = Cuma
      if (cumaAtama.asil !== 'Sistem') cumaAsilSayisi[cumaAtama.asil]++;

      muezzinler = muezzinler.map((m) => ({
        ...m,
        aylikVakitSayisi: (m.aylikVakitSayisi || 0) + haftaAsil[m.id],
        aylikYedekSayisi: (m.aylikYedekSayisi || 0) + haftaYedek[m.id],
        aylikCumaSayisi: (m.aylikCumaSayisi || 0) + (cumaAtama.asil === m.id ? 1 : 0),
      }));
      oncekiHaftaSonEkibi = [plan[gunler[6]].yatsi.asil].filter((uid) => uid !== 'Sistem');
      oncekiGunPlan = plan;
    }

    // Eski (hatalı) sırada: {aaa:0, bbb:8, ccc:0}.
    expect(Math.max(...Object.values(cumaAsilSayisi))).toBeLessThanOrEqual(4);
    expect(Object.values(cumaAsilSayisi).every((n) => n > 0)).toBe(true);
  });

  it('Cuma yükü haftalık birikime TAM OLARAK 1.5 kat işlenir (tek uygulama — PL-O3 / çift ağırlık regresyonu)', () => {
    // Cuma ağırlığı ARTIK TEK yerde uygulanır: gün planı üretilirken o günün
    // KENDİ yük katkısında (cumaCarpani). tieBreaker.ts tier 2'deki eski
    // "buHaftakiYukler * 1.5" mekanizması kaldırıldı — o, tieBreakerSirala
    // günün yükü birikime işlenmeden ÖNCE çağrıldığı için Cuma günü
    // Pazartesi–Perşembe birikimini (Cuma'lıkla ilgisiz bir büyüklüğü)
    // ölçekliyordu.
    //
    // Kurgu (4 kişi, SOS/streak karışmasın diye Cuma ve Cumartesi zorlanıyor):
    //   Cuma  2026-08-07: asil=ccc, yedek=aaa (zorlanmış)
    //   Cmt   2026-08-08: asil=aaa, yedek=bbb (zorlanmış — Pazar SOS'u yalnız
    //                     aaa'yı bloklasın diye)
    //   Pazar 2026-08-09: TAZE hesap. Adaylar bbb, ccc, ddd.
    // Haftalık yükler (5 vakit): ccc = 5*1*1.5 = 7.5 ; bbb = 5*0.5 = 2.5 ;
    //                            ddd = 0.
    // ccc'nin ağırlıklı toplamı 7.5; aylık sayaçlarla bbb ve ddd'yi ccc'nin
    // İKİ YANINA yerleştirip ccc'nin yükünü (6.5, 8) aralığına hapsediyoruz:
    //   - Çarpan hiç uygulanmasaydı ccc = 5.0  -> ilk sırada olurdu.
    //   - Çarpan iki kez uygulansaydı ccc = 11.25 -> son sırada olurdu.
    // Yalnızca TEK uygulama (7.5) aşağıdaki iki beklentiyi birlikte sağlar.
    const forced: Record<string, { asil: string; yedek: string }> = {
      '2026-08-07': { asil: 'ccc', yedek: 'aaa' },
      '2026-08-08': { asil: 'aaa', yedek: 'bbb' },
    };
    const korunmusAtama = (gun: string) => forced[gun] ?? null;
    const gunler = ['2026-08-07', '2026-08-08', '2026-08-09'];

    // (1) ddd'nin aylık yükü 6 -> ddd(6) < bbb(4+2.5=6.5) < ccc(7.5)
    const planA = haftalikPlanUret(
      gunler,
      [muezzin('aaa'), muezzin('bbb', { aylikVakitSayisi: 4 }), muezzin('ccc'), muezzin('ddd', { aylikVakitSayisi: 6 })],
      [],
      korunmusAtama
    );
    expect(planA['2026-08-09'].sabah.asil).toBe('ddd');

    // (2) ddd'nin aylık yükü 8 -> ccc(7.5) < ddd(8); bbb hâlâ 6.5 ama SOS'suz
    //     en düşük ccc değil... bbb 6.5 < ccc 7.5, bu yüzden bbb'yi de yukarı
    //     alıyoruz: aylik 6 -> bbb = 8.5. Sıra: ccc(7.5) < ddd(8) < bbb(8.5).
    const planB = haftalikPlanUret(
      gunler,
      [muezzin('aaa'), muezzin('bbb', { aylikVakitSayisi: 6 }), muezzin('ccc'), muezzin('ddd', { aylikVakitSayisi: 8 })],
      [],
      korunmusAtama
    );
    expect(planB['2026-08-09'].sabah.asil).toBe('ccc');
  });

  it('oncekiHaftaSonEkibi verilmezse (varsayılan boş dizi) SOS kısıtlaması uygulanmaz', () => {
    const muezzinler = [muezzin('a'), muezzin('b'), muezzin('c'), muezzin('d')];

    // Aynı girdiyle, oncekiHaftaSonEkibi olmadan çağrı — mevcut (geriye dönük
    // uyumlu) davranışın bozulmadığını doğrular.
    const planA = haftalikPlanUret(['2026-08-03'], muezzinler, []);
    const planB = haftalikPlanUret(['2026-08-03'], muezzinler, [], undefined, []);

    expect(planA['2026-08-03']).toEqual(planB['2026-08-03']);
  });

  it('yedek olmak asil olmaktan daha az yük sayılır (0.5 kat) — bir sonraki gün tekrar asil seçilmeyi kolaylaştırır', () => {
    const muezzinler = [muezzin('a'), muezzin('b')];

    const plan = haftalikPlanUret(['2026-08-03', '2026-08-04'], muezzinler, []);
    const gun1 = plan['2026-08-03'].sabah;
    const gun2 = plan['2026-08-04'].sabah;

    // Gün 1'de SOS her iki taraf için de eşit (tek çift müsait), tiebreak hash
    // ile kararlaştırılır. Gün 2'de SOS yine ikisini de eşit "aktif" sayar
    // (2 kişiyle her gün ikisi de görevli), bu yüzden ayrımı yalnızca
    // ağırlıklı yük yapar: dün yedek olan, dün asil olandan daha az yük
    // taşıdığından gün 2'de asil seçilir.
    expect(gun2.asil).toBe(gun1.yedek);
    expect(gun2.yedek).toBe(gun1.asil);
  });

  it('tekKisiliGunleriBul, yalnızca tek kişinin (yedeksiz) müsait olduğu günleri tespit eder', () => {
    const muezzinler = [
      muezzin('a'),
      muezzin('b', { haftalikIzinGunu: 1 }), // Pazartesi izinli
    ];

    const plan = haftalikPlanUret(['2026-08-03', '2026-08-04'], muezzinler, []);

    // 2026-08-03 Pazartesi: yalnızca a müsait (b izinli) -> tek kişili.
    // 2026-08-04 Salı: ikisi de müsait -> tek kişili değil.
    expect(tekKisiliGunleriBul(plan)).toEqual(['2026-08-03']);
  });

  it('tekKisiliGunleriBul, günün TEK bir vakti (ör. yatsı) yedeksiz kalsa bile günü tespit eder (kod denetimi regresyonu)', () => {
    // Elle kurulmuş bir gunPlan: sabah/ogle/ikindi/aksam gerçek yedeklerle
    // kapsanmış, yalnızca yatsı yedeksiz (yedek: 'Sistem') kalmış — önceden
    // `.every(...)` kullanan filtre, günün TÜM vakitleri yedeksiz olmadıkça
    // hiç uyarı üretmiyordu (bkz. kod denetimi bulgusu; bu tam olarak
    // planServisi.ts `korunmusAtama`'nın reddedilen bir yatsı devrinde
    // üretebildiği durum).
    const gunPlan: Record<string, Record<Vakit, { asil: string; yedek: string }>> = {
      '2026-08-03': {
        sabah: { asil: 'a', yedek: 'b' },
        ogle: { asil: 'a', yedek: 'b' },
        ikindi: { asil: 'a', yedek: 'b' },
        aksam: { asil: 'a', yedek: 'b' },
        yatsi: { asil: 'a', yedek: 'Sistem' },
      },
    };

    expect(tekKisiliGunleriBul(gunPlan)).toEqual(['2026-08-03']);
  });

  it('tekKisiliGunleriBul, hiç kimsenin müsait olmadığı (Sistem/Sistem) günleri saymaz', () => {
    const muezzinler = [muezzin('a', { haftalikIzinGunu: 1 }), muezzin('b', { haftalikIzinGunu: 1 })];

    const plan = haftalikPlanUret(['2026-08-03'], muezzinler, []);

    expect(tekKisiliGunleriBul(plan)).toEqual([]);
  });

  it('kapsamsizGunleriBul, hiç kimsenin müsait olmadığı günleri tespit eder (O3 regresyonu)', () => {
    // Önceden bu durum (kadro yeterli ama belirli bir gün herkes izinli)
    // hiçbir uyarı üretmiyordu — bkz. mimari denetim O3.
    const muezzinler = [
      muezzin('a', { haftalikIzinGunu: 1 }), // Pazartesi izinli
      muezzin('b', { haftalikIzinGunu: 1 }), // Pazartesi izinli
    ];

    const plan = haftalikPlanUret(['2026-08-03', '2026-08-04'], muezzinler, []);

    expect(kapsamsizGunleriBul(plan)).toEqual(['2026-08-03']);
  });

  it('kapsamsizGunleriBul, tek kişinin müsait olduğu günü kapsamsız saymaz', () => {
    const muezzinler = [muezzin('a'), muezzin('b', { haftalikIzinGunu: 1 })];

    const plan = haftalikPlanUret(['2026-08-03'], muezzinler, []);

    expect(kapsamsizGunleriBul(plan)).toEqual([]);
  });

  it('sürekli yedek kalma kilidini kırar: 3 kişilik kadroda 4 hafta sonunda herkes en az bir kez asil olmuş olur (K6 regresyonu)', () => {
    // Mimari denetimde bulunan gerçek hata: yedeklik hiçbir kalıcı sayaca
    // işlenmediği için SOS + haftalık-yük-sıfırlama etkileşimi bir kişiyi
    // süresiz yedekte kilitliyordu (4 hafta sonunda gözlenen gerçek dağılım:
    // asil {aaa:70, bbb:0, ccc:70}). Bu test, scripts/yatsiSonuIslemleri.ts'in
    // gün sonu kalıcı kredilendirmesini (aylikVakitSayisi + aylikYedekSayisi)
    // hafta hafta simüle ederek kilidin artık kırıldığını doğrular.
    let muezzinler: MuezzinAday[] = [muezzin('aaa'), muezzin('bbb'), muezzin('ccc')];
    const haftalar = [
      ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'],
      ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'],
      ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'],
      ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'],
    ];
    const toplamAsilSayisi: Record<string, number> = { aaa: 0, bbb: 0, ccc: 0 };
    let oncekiHaftaSonEkibi: string[] = [];
    let oncekiGunPlan: Record<string, Record<Vakit, { asil: string; yedek: string }>> | undefined;

    for (const gunler of haftalar) {
      const oncekiArdArdaYedekSayilari = oncekiHaftaninArdArdaYedekSayilariniHesapla(
        oncekiGunPlan,
        muezzinler.map((m) => m.id)
      );
      const plan = haftalikPlanUret(gunler, muezzinler, [], undefined, oncekiHaftaSonEkibi, oncekiArdArdaYedekSayilari);

      const haftaAsilKredi: Record<string, number> = { aaa: 0, bbb: 0, ccc: 0 };
      const haftaYedekKredi: Record<string, number> = { aaa: 0, bbb: 0, ccc: 0 };
      for (const gun of gunler) {
        for (const vakit of VAKITLER) {
          const atama = plan[gun][vakit];
          if (atama.asil !== 'Sistem') {
            haftaAsilKredi[atama.asil]++;
            toplamAsilSayisi[atama.asil]++;
          }
          if (atama.yedek !== 'Sistem') haftaYedekKredi[atama.yedek]++;
        }
      }

      // scripts/yatsiSonuIslemleri.ts'in gün sonu kalıcı kredilendirmesinin
      // hafta sonundaki eşdeğeri.
      muezzinler = muezzinler.map((m) => ({
        ...m,
        aylikVakitSayisi: (m.aylikVakitSayisi || 0) + haftaAsilKredi[m.id],
        aylikYedekSayisi: (m.aylikYedekSayisi || 0) + haftaYedekKredi[m.id],
      }));

      const sonGun = gunler[6];
      const sonVakitAtama = plan[sonGun].yatsi;
      oncekiHaftaSonEkibi = [sonVakitAtama.asil].filter((uid) => uid !== 'Sistem');
      oncekiGunPlan = plan;
    }

    expect(Object.values(toplamAsilSayisi).every((n) => n > 0)).toBe(true);
  });
});

describe('gunIzinliUidler', () => {
  // `haftalikPlanUret`'in izin filtresi ile src/services/planServisi.ts'in
  // "onaylı izin, korunmuş bir slotu ezer mi" kararı AYNI aralık yorumunu
  // kullanmak zorunda (bkz. src/lib/slotKorumasi.ts korumaliSlotMu).
  const izinler: OnayliIzin[] = [
    { uid: 'a', baslangic: '2026-08-03', bitis: '2026-08-05' },
    { uid: 'b', baslangic: '2026-08-06', bitis: '2026-08-06' },
  ];

  it('aralığın her iki ucu DAHİL olacak şekilde o günün izinlilerini döndürür', () => {
    expect(gunIzinliUidler(izinler, '2026-08-03')).toEqual(['a']);
    expect(gunIzinliUidler(izinler, '2026-08-05')).toEqual(['a']);
    expect(gunIzinliUidler(izinler, '2026-08-06')).toEqual(['b']);
  });

  it('aralık dışındaki günler için boş döner', () => {
    expect(gunIzinliUidler(izinler, '2026-08-02')).toEqual([]);
    expect(gunIzinliUidler(izinler, '2026-08-07')).toEqual([]);
  });
});

describe('nobeteAtanabilirMi', () => {
  it('aktif, onay bekleyen olmayan bir muezzin icin true doner', () => {
    expect(nobeteAtanabilirMi({ role: 'muezzin', onayBekliyor: false })).toBe(true);
  });

  it('onayBekliyor alani hic olmayan (eski) bir muezzin icin true doner (fail-open)', () => {
    expect(nobeteAtanabilirMi({ role: 'muezzin' })).toBe(true);
  });

  it('onayBekliyor:true olan bir davetli icin false doner (Y4 regresyonu)', () => {
    // AuthGuard bu kisiye zaten bir bekleme ekrani gosteriyor — gorevini
    // goremedigi bir vakte atanmamali (bkz. mimari denetim Y4).
    expect(nobeteAtanabilirMi({ role: 'muezzin', onayBekliyor: true })).toBe(false);
  });

  it('admin/gozlemci rolu icin false doner', () => {
    expect(nobeteAtanabilirMi({ role: 'admin', onayBekliyor: false })).toBe(false);
    expect(nobeteAtanabilirMi({ role: 'gozlemci', onayBekliyor: false })).toBe(false);
  });
});
