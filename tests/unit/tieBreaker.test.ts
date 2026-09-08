import { describe, it, expect } from 'vitest';
import { tieBreakerSirala, ARD_ARDA_YEDEK_ESIGI } from '../../src/utils/tieBreaker';
import { Muezzin } from '../../src/types';

function muezzin(id: string, overrides: Partial<Muezzin> = {}): Muezzin & { id: string } {
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

describe('tieBreakerSirala', () => {
  it('sıralamayı aylık + haftalık ağırlıklı toplam yüke göre artan sırada verir', () => {
    const muezzinler = [
      muezzin('a', { aylikVakitSayisi: 10 }),
      muezzin('b', { aylikVakitSayisi: 2 }),
      muezzin('c', { aylikVakitSayisi: 6 }),
    ];

    const sirali = tieBreakerSirala(muezzinler, { a: 0, b: 0, c: 0 });

    expect(sirali.map((m) => m.id)).toEqual(['b', 'c', 'a']);
  });

  it('bir önceki vakitte görevli olanları toplam yük eşit olsa bile en sona atar (SOS kuralı)', () => {
    const muezzinler = [
      muezzin('a', { aylikVakitSayisi: 5 }),
      muezzin('b', { aylikVakitSayisi: 5 }),
      muezzin('c', { aylikVakitSayisi: 5 }),
    ];

    const sirali = tieBreakerSirala(muezzinler, {}, ['a', 'b']);

    expect(sirali[0].id).toBe('c');
    expect(sirali.map((m) => m.id).slice(1)).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('orijinal diziyi mutasyona uğratmaz', () => {
    const muezzinler = [muezzin('a', { aylikVakitSayisi: 10 }), muezzin('b', { aylikVakitSayisi: 2 })];
    const originalOrder = muezzinler.map((m) => m.id);

    tieBreakerSirala(muezzinler, {});

    expect(muezzinler.map((m) => m.id)).toEqual(originalOrder);
  });

  it('ağırlıklı toplam kademesi Cuma günü DEĞİŞMEZ — 1.5x çarpanı artık yalnızca birikimde uygulanır', () => {
    // Kök neden (bkz. tieBreaker.ts tier 2 yorumu): bu kademe eskiden Cuma
    // günleri `buHaftakiYukler`i GEÇİCİ olarak 1.5 ile çarpıyordu. Ama
    // tieBreakerSirala günde bir kez, o günün yükü BİRİKİME işlenmeden önce
    // çağrılır — yani Cuma günü çarpılan değer Pazartesi–Perşembe birikimidir,
    // Cuma'lıkla ilgisi yoktur. Üstelik toplamın diğer iki terimi
    // (aylikVakitSayisi, aylikYedekSayisi*0.5) çarpılmadığından bu, "bu hafta"
    // teriminin "bu ay" terimine göre ağırlığını Cuma günleri sessizce %50
    // artırıyordu.
    //
    // a: aylık 3, bu hafta 0 -> toplam 3
    // b: aylık 0, bu hafta 2 -> toplam 2  => her iki günde de b önde olmalı.
    // ESKİ (hatalı) davranışta Cuma'da b'nin toplamı 0 + 2*1.5 = 3'e çıkıp
    // eşitlik oluşuyor ve sıra ['a','b']'ye dönüyordu.
    const muezzinler = [muezzin('a', { aylikVakitSayisi: 3 }), muezzin('b', { aylikVakitSayisi: 0 })];
    const buHaftakiYukler = { a: 0, b: 2 };

    const normalGun = tieBreakerSirala(muezzinler, buHaftakiYukler, [], false);
    const cuma = tieBreakerSirala(muezzinler, buHaftakiYukler, [], true);

    expect(normalGun.map((m) => m.id)).toEqual(['b', 'a']);
    expect(cuma.map((m) => m.id)).toEqual(['b', 'a']);
  });

  it('Cuma günü ağırlıklı toplam, önceki günlerin birikimini olduğu gibi (çarpansız) kullanır — sayısal örnek', () => {
    // Fix 2'nin sayısal kanıtı. 3 kişilik kadro, haftanın 2. haftası; Cuma
    // günü tieBreakerSirala çağrıldığında elde YALNIZCA Pzt–Per birikimi var:
    //   sabit terim = aylikVakitSayisi + aylikYedekSayisi*0.5
    //   aaa: 20 + 15*0.5 = 27.5 | buHafta 10   -> 37.5
    //   bbb: 10 + 20*0.5 = 20   | buHafta 7.5  -> 27.5
    //   ccc:  5 + 15*0.5 = 12.5 | buHafta 12.5 -> 25   (en az yüklü: ccc)
    // ESKİ formülde (buHafta*1.5): aaa 42.5, bbb 31.25, ccc 31.25 — bbb ile
    // ccc YAPAY olarak eşitleniyor ve sıra tier 3'e (ham haftalık yük) düşüp
    // bbb'yi öne alıyordu; oysa ccc bu ay belirgin biçimde daha az görev
    // yapmıştı. Cuma'lıkla ilgisi olmayan bir çarpanın sıralamayı bozmasının
    // tam olarak gözlemlenebilir hâli budur.
    const muezzinler = [
      muezzin('aaa', { aylikVakitSayisi: 20, aylikYedekSayisi: 15 }),
      muezzin('bbb', { aylikVakitSayisi: 10, aylikYedekSayisi: 20 }),
      muezzin('ccc', { aylikVakitSayisi: 5, aylikYedekSayisi: 15 }),
    ];
    const buHaftakiYukler = { aaa: 10, bbb: 7.5, ccc: 12.5 };

    const cuma = tieBreakerSirala(muezzinler, buHaftakiYukler, [], true);
    const normalGun = tieBreakerSirala(muezzinler, buHaftakiYukler, [], false);

    expect(cuma.map((m) => m.id)).toEqual(['ccc', 'bbb', 'aaa']);
    // Cuma'lık bu kademeyi hiç etkilememeli: iki sıra birebir aynı.
    expect(cuma.map((m) => m.id)).toEqual(normalGun.map((m) => m.id));
  });

  it('Cuma adaleti kademesi, aylık toplamın Cuma çarpanını bastırdığı durumda devreye girer', () => {
    // a: aylık toplamı düşük (3) ama bu ay zaten 3 kez Cuma yapmış.
    // b: aylık toplamı yüksek (10) ama bu ay hiç Cuma yapmamış.
    // Eski davranışta (aylikCumaSayilari verilmeden) Cuma'da bile a'nın düşük
    // aylık toplamı kazanırdı — bu da Cuma ağırlığının ay ilerledikçe
    // görünmez hale gelmesi sorunuydu. Yeni kademe bunu SOS'tan hemen sonra,
    // ağırlıklı toplamdan önce karşılaştırarak düzeltir.
    const muezzinler = [muezzin('a', { aylikVakitSayisi: 3 }), muezzin('b', { aylikVakitSayisi: 10 })];
    const aylikCumaSayilari = { a: 3, b: 0 };

    const cumaOncesi = tieBreakerSirala(muezzinler, {}, [], true); // aylikCumaSayilari verilmedi
    const cumaSonrasi = tieBreakerSirala(muezzinler, {}, [], true, aylikCumaSayilari);

    expect(cumaOncesi.map((m) => m.id)).toEqual(['a', 'b']); // eski davranış: aylık toplam kazanır
    expect(cumaSonrasi.map((m) => m.id)).toEqual(['b', 'a']); // yeni davranış: Cuma adaleti kazanır
  });

  it('Cuma adaleti kademesi, Cuma olmayan günlerde devreye girmez', () => {
    const muezzinler = [muezzin('a', { aylikVakitSayisi: 3 }), muezzin('b', { aylikVakitSayisi: 10 })];
    const aylikCumaSayilari = { a: 3, b: 0 };

    const sirali = tieBreakerSirala(muezzinler, {}, [], false, aylikCumaSayilari);

    expect(sirali.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('art arda yedek eşiğini aşan kişi ASİLE TERFİ ETTİRİLİR, ağırlıklı toplamı daha yüksek olsa bile (K6 sınır testi)', () => {
    // a: dün asildi (SOS ile bloklu, her zaman en sona). b: art arda yedek
    // eşiğini aşmış AMA c'den daha yüklü. c: eşiği aşmamış, daha az yüklü.
    // Eşik olmasaydı c (daha az yüklü) tier 2'de kazanıp asil olurdu — küçük
    // kadrolarda bu, b'yi süresiz yedekte kilitliyordu (premium hata analizi
    // PL-K1 sonrası: SOS artık yalnızca dünkü ASİLİ eliyor, dolayısıyla b ve
    // c doğrudan asil/yedek için yarışıyor — kilidi kıran kademe artık
    // streaklenmiş kişiyi ASİLE İTMELİ, "yedekten çıkarmamalı", çünkü burada
    // "yedekten çıkmak" tam olarak yedekte kalmak anlamına gelirdi).
    const muezzinler = [
      muezzin('a', { aylikVakitSayisi: 100 }),
      muezzin('b', { aylikVakitSayisi: 50 }),
      muezzin('c', { aylikVakitSayisi: 10 }),
    ];
    const ardArdaYedekSayilari = { b: ARD_ARDA_YEDEK_ESIGI };

    const sirali = tieBreakerSirala(muezzinler, {}, ['a'], false, {}, ardArdaYedekSayilari);

    expect(sirali[0].id).toBe('b'); // eşiği aştığı için asile terfi eder
    expect(sirali[1].id).toBe('c'); // yedek olur
    expect(sirali[2].id).toBe('a'); // dün asildi, SOS ile bloklu
  });

  it('art arda yedek eşiğinin altındaki kişi normal ağırlıklı toplama göre sıralanır', () => {
    const muezzinler = [
      muezzin('a', { aylikVakitSayisi: 100 }),
      muezzin('b', { aylikVakitSayisi: 0 }),
      muezzin('c', { aylikVakitSayisi: 50 }),
    ];
    const ardArdaYedekSayilari = { b: ARD_ARDA_YEDEK_ESIGI - 1 }; // eşiğin altında

    const sirali = tieBreakerSirala(muezzinler, {}, ['a', 'b'], false, {}, ardArdaYedekSayilari);

    expect(sirali[0].id).toBe('c');
    expect(sirali[1].id).toBe('b'); // eşik aşılmadı, en az yüklü (b) yedek olur
    expect(sirali[2].id).toBe('a');
  });

  it('kalıcı aylık yedek sayacı ağırlıklı toplama 0.5x ile girer (YEDEK_YUK_CARPANI izolasyonu)', () => {
    // Bileşik ağırlık formülü: total = aylikVakitSayisi + (aylikYedekSayisi *
    // YEDEK_YUK_CARPANI) + buHaftakiYuk. Bu test `aylikYedekSayisi` teriminin
    // 0.5 ağırlıkla — ne 1x ne 0x — toplama girdiğini izole doğrular (bkz.
    // mimari denetim K6: bu terim olmadan sürekli yedek kalan kişi her hafta
    // yeniden "en az yüklü" ölçülüp yedeğe kilitleniyordu).
    //
    // a: aylikYedekSayisi=6 -> katkı 3, bu hafta 0  => total 3
    // b: aylikYedekSayisi=0, bu hafta 2             => total 2  -> b önde.
    // Terim 1x ağırlıkla girseydi a'nın toplamı 6 olurdu (sıra yine b,a) ama
    // aşağıdaki ikinci kurgu ayırt eder: a'nın yedek sayısı 6, b'nin haftalık
    // yükü 3.5 -> 0.5x ile a=3 < b=3.5 (a önde), 1x ile a=6 > b=3.5 (b önde).
    const muezzinler = [
      muezzin('a', { aylikVakitSayisi: 0, aylikYedekSayisi: 6 }),
      muezzin('b', { aylikVakitSayisi: 0, aylikYedekSayisi: 0 }),
    ];

    expect(tieBreakerSirala(muezzinler, { a: 0, b: 2 }).map((m) => m.id)).toEqual(['b', 'a']);
    expect(tieBreakerSirala(muezzinler, { a: 0, b: 3.5 }).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('Cuma adaleti kademesi, art arda yedek kilidi kırıcıdan ÖNCE gelir (Cuma bastırılamaz)', () => {
    // KÖK NEDEN (bkz. tieBreaker.ts tier 1.2 yorumu): iki kademe de sirali[0]'ı
    // belirlemek için yarışır. Sürekli-yedek kilidi haftanın HERHANGİ bir
    // gününde kırılabilir (Cuma'da girmezse en geç ertesi gün girer), Cuma
    // adaleti ise YALNIZCA Cuma günü düzeltilebilir. Eski sırada (kilit önce)
    // 26 haftalık simülasyonda 3 kişilik + tek sabit izin günlü bir kadroda
    // AYNI kişi 26 Cuma'nın 26'sını yapıyordu.
    //
    // Burada: SOS kimseyi engellemiyor; b art arda yedek eşiğini aşmış AMA bu
    // ay zaten 3 Cuma yapmış; c hiç Cuma yapmamış. Cuma günü asil c olmalı.
    const muezzinler = [muezzin('b', { aylikVakitSayisi: 0 }), muezzin('c', { aylikVakitSayisi: 0 })];
    const ardArdaYedekSayilari = { b: ARD_ARDA_YEDEK_ESIGI };
    const aylikCumaSayilari = { b: 3, c: 0 };

    const cuma = tieBreakerSirala(muezzinler, {}, [], true, aylikCumaSayilari, ardArdaYedekSayilari);
    const normalGun = tieBreakerSirala(muezzinler, {}, [], false, aylikCumaSayilari, ardArdaYedekSayilari);

    expect(cuma.map((m) => m.id)).toEqual(['c', 'b']);
    // Cuma DIŞINDAKİ günlerde kilit kırıcı aynen eskisi gibi çalışmaya devam
    // eder — düzeltme yalnızca Cuma'ya özgüdür, kilit kırıcıyı zayıflatmaz.
    expect(normalGun.map((m) => m.id)).toEqual(['b', 'c']);
  });

  it('Cuma sayıları EŞİTSE art arda yedek kilidi kırıcı Cuma günü de devrede kalır (kademeler birleşir)', () => {
    // Fix'in "biri diğerini yok etmesin" koşulu: Cuma adaleti ayırt EDEMEDİĞİ
    // anda karar yine kilit kırıcıya düşmeli, yani sürekli yedek kalan kişi
    // Cuma günü de asile terfi edebilmeli.
    const muezzinler = [muezzin('b', { aylikVakitSayisi: 50 }), muezzin('c', { aylikVakitSayisi: 10 })];
    const ardArdaYedekSayilari = { b: ARD_ARDA_YEDEK_ESIGI };
    const aylikCumaSayilari = { b: 2, c: 2 };

    const cuma = tieBreakerSirala(muezzinler, {}, [], true, aylikCumaSayilari, ardArdaYedekSayilari);

    expect(cuma.map((m) => m.id)).toEqual(['b', 'c']);
  });

  it('Cuma günü geri itilen streakli kişinin kilidi en geç ertesi (Cuma olmayan) gün kırılır', () => {
    // Cuma adaletinin kilit kırıcıyı öne geçmesinin SINIRLI bir gecikme
    // olduğunu gösterir: aynı girdilerle Cumartesi (isFriday=false) çağrısında
    // b yine asile terfi eder. Yani kilit sonsuza kadar ertelenemez.
    const muezzinler = [muezzin('b', { aylikVakitSayisi: 0 }), muezzin('c', { aylikVakitSayisi: 0 })];
    const ardArdaYedekSayilari = { b: ARD_ARDA_YEDEK_ESIGI + 1 }; // Cuma'da da yedek kaldı
    const aylikCumaSayilari = { b: 3, c: 0 };

    const cumartesi = tieBreakerSirala(muezzinler, {}, [], false, aylikCumaSayilari, ardArdaYedekSayilari);

    expect(cumartesi.map((m) => m.id)).toEqual(['b', 'c']);
  });

  it('tüm kriterler eşitse alfabetik değil, id karakter kodu toplamına göre sıralar', () => {
    // Alfabetik sırada 'aa-uid' < 'b-uid' olurdu; karakter kodu toplamına göre ise
    // 'b-uid' (465) 'aa-uid' (561) toplamından küçük olduğu için önce gelir.
    const muezzinler = [muezzin('aa-uid'), muezzin('b-uid')];

    const sirali = tieBreakerSirala(muezzinler, {});

    expect(sirali.map((m) => m.id)).toEqual(['b-uid', 'aa-uid']);
  });
});
