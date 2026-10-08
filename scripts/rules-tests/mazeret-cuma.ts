// Mazeret testleri: Cuma gunu kisitlamasi (asil ve yedek), yedek
// mazeret/devirSonucu kurallari ve K2 yedek tip guvenligi.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, Timestamp, updateDoc } from 'firebase/firestore';
import { TestCase, testUser, mazeretRetBatch } from './ortak.ts';

export const tests: TestCase[] = [
  {
    name: 'muezzin kendi asil gorevine mazeret yazabilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      // retSebebi artik bildirimler'e degil, ayni batch'teki
      // mazeret_detaylari'na yaziliyor (bkz. mazeretRetBatch, mimari
      // denetim — altinci tur).
      await assertSucceeds(mazeretRetBatch(db, 'ownPendingAsil', 'muezzin1', 'Hastalik', { devirSonucu: 'alarm_bekliyor' }));
    },
  },
  {
    // `legacyFridayNoCumaMiAsil` kasitli olarak cumaMi alani OLMADAN
    // olusturuldu (bkz. yukaridaki setup) — backfill-oncesi GERCEK bir
    // belgeyi temsil eder, ama tarihi GERCEKTEN bir Cuma. ONCEDEN
    // cumaMiIsaretli() yalnizca saklanan (ve bu belgede eksik olan) bayraga
    // bakiyordu, bu yuzden alan eksikken Cuma kisitlamasi SESSIZCE
    // atlatilabiliyordu (bkz. kod denetimi guvenlik bulgusu). Artik
    // `tarih`ten dogrudan hesaplandigi icin (bkz. firestore.rules
    // `cumaMiIsaretli`), alanin eksik olmasi kisitlamayi ATLATMIYOR — bu
    // test tam da bunu dogrular ki regresyon sessizce geri gelmesin.
    name: 'cumaMi alani hic olmayan ama gercekte Cuma olan bir bildirimde mazeret reddi hala engellenir',
    run: async (env) => {
      const db = testUser(env, 'muezzin2').firestore();
      await assertFails(mazeretRetBatch(db, 'legacyFridayNoCumaMiAsil', 'muezzin2', 'Hastalik', { devirSonucu: 'alarm_bekliyor' }));
    },
  },
  {
    name: 'muezzin cuma gorevine mazeret bildiremez',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      // Eslesen mazeret_detaylari yazimi DAHIL edildi ki test yalnizca
      // Cuma kisitlamasini izole etsin (baska bir nedenle degil).
      await assertFails(mazeretRetBatch(db, 'fridayPendingAsil', 'muezzin1', 'Hastalik', { devirSonucu: 'alarm_bekliyor' }));
    },
  },
  {
    name: 'muezzin cuma gorevini yine de okudum olarak onaylayabilir',
    run: async (env) => {
      // Cuma kisitlamasi yalnizca mazeret (reddedildi) geciscine uygulanir —
      // gorevi ustlenme (okudum/onaylandi) onayi hala serbesttir.
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(
        updateDoc(doc(db, 'bildirimler/fridayPendingAsil'), {
          durum: 'onaylandi',
          pendingAck: false,
          sonGuncelleme: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'yedek gorev mazeret reddine ceviremez',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      // devirSonucu eksik (asil dalindaki gibi eski/eksik bir istemci yuku
      // taklit ediyor) — bkz. asagidaki "devirSonucu ile" testi, dogru
      // sekilde bicimlendirilmis bir yedek mazereti bunun aksine basarili olur.
      await assertFails(mazeretRetBatch(db, 'ownPendingYedek', 'muezzin1', 'Uygun degilim', {}));
    },
  },
  {
    name: 'yedek gorevli kendi mazeretini (devirSonucu ile) bildirebilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(mazeretRetBatch(db, 'ownPendingYedek', 'muezzin1', 'Uygun degilim', { devirSonucu: 'alarm_bekliyor' }));
    },
  },
  {
    name: 'yedek gorevli Cuma gorevi icin mazeret bildiremez',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(mazeretRetBatch(db, 'fridayPendingYedek', 'muezzin1', 'Uygun degilim', { devirSonucu: 'alarm_bekliyor' }));
    },
  },
  {
    name: 'K2: yedegi olmayan/uygun olmayan mazeret sadece alarm_bekliyor ile reddedilebilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(mazeretRetBatch(db, 'ownPendingAsil', 'muezzin1', 'Hastalik', { devirSonucu: 'alarm_bekliyor' }));
    },
  },
  {
    // NOT ("1000 ifade tavanı" kök neden çözümü): isBackupPromotionFromMazeret
    // TAMAMEN SİLİNDİ — yedek belgenin `tip` alanını client-side değiştirebilecek
    // HİÇBİR dal kalmadı (bkz. firestore.rules yorumu). Asil'in durumu ne
    // olursa olsun (reddedilmiş olsun ya da olmasın) bu artık koşulsuz reddedilir.
    name: 'K2 guvenlik: yedek belgenin tip alani client tarafindan hicbir sekilde degistirilemez',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      const yedekRef = doc(db, 'bildirimler/W2026-06-01_2026-06-03_yatsi_yedek');
      await assertFails(
        updateDoc(yedekRef, {
          tip: 'asil',
          durum: 'bekliyor',
          pendingAck: true,
          asilMazeretUid: 'muezzin1',
          sonGuncelleme: Timestamp.now(),
        })
      );
    },
  },
  {
    name: "K2 guvenlik: baskasinin gorevi icin mazeret transaction'i baslatilamaz",
    run: async (env) => {
      const db = testUser(env, 'muezzin2').firestore();
      await assertFails(mazeretRetBatch(db, 'W2026-06-01_2026-06-03_yatsi_asil', 'muezzin2', 'Sahte', { devirSonucu: 'yedek_atandi' }));
    },
  },
  {
    // NOT ("1000 ifade tavanı" kök neden çözümü — DAVRANIŞ DEĞİŞİKLİĞİ):
    // eskiden 'yedek_atandi' TEK başına (yedeğin gerçekten terfi ettiğine
    // dair eşleşen bir getAfter() korelasyonu olmadan) reddediliyordu — bu,
    // kuralın en pahalı, ~27 terimlik çapraz-belge doğrulamasıydı. Artık bu
    // korelasyon KASITLI olarak CEL'den kaldırıldı: `devirSonucu` yalnızca
    // scripts/mazeretDevirleriniIsle.ts için bir İPUCU, YETKİLENDİRİCİ değil
    // — script, yedeğin GERÇEK uygunluğunu taze veriyle kendisi yeniden
    // doğrular (bkz. tests/integration/mazeretDevirleriniIsle.test.ts). Bu
    // yüzden asil-only bir yazım, yedek belgenin durumundan TAMAMEN
    // BAĞIMSIZ olarak artık başarılı olmalı.
    name: 'K2: devirSonucu=yedek_atandi asil-only yazim, yedegin gercek durumundan bagimsiz kabul edilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(
        mazeretRetBatch(db, 'W2026-06-01_2026-06-03_yatsi_asil', 'muezzin1', 'Hastalik', { devirSonucu: 'yedek_atandi' })
      );
    },
  },
  {
    name: 'K2: devirSonucu sema disi bir deger olamaz',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      // Eslesen mazeret_detaylari yazimi DAHIL edildi ki test yalnizca
      // gecersiz devirSonucu degerini izole etsin.
      await assertFails(mazeretRetBatch(db, 'ownPendingAsil', 'muezzin1', 'Hastalik', { devirSonucu: 'gecersiz_deger' }));
    },
  },
];
