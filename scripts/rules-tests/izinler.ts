// Izin talepleri testleri: izin ve izin_detaylari koleksiyonlari, izin
// onarimi, sema (hasOnly) kurallari ve yillik izin kotasinin muezzins
// sayacina atomik yansimasi.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { TestCase, testUser } from './ortak.ts';

export const tests: TestCase[] = [
  {
    name: 'izin talebinde kullanici sadece kendisi adina kayit acabilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      // 2026-05-18 Pazartesi, 2026-05-19 Sali — Cuma icermeyen bir aralik.
      const base = {
        baslangic: '2026-05-18',
        bitis: '2026-05-19',
        tip: 'mazeret',
        durum: 'onay_bekliyor',
        olusturmaTarihi: Timestamp.now(),
      };

      await assertSucceeds(
        setDoc(doc(db, 'izinler/ownLeave'), {
          ...base,
          uid: 'muezzin1',
        })
      );
      await assertFails(
        setDoc(doc(db, 'izinler/otherLeave'), {
          ...base,
          uid: 'muezzin2',
        })
      );
    },
  },
  {
    // Izin (leave) yalnizca nobete atanabilen 'muezzin' rolu icin
    // anlamlidir (bkz. isAssignableDutyUidVeri) — admin ve gozlemci
    // hicbir zaman nobete atanmiyor, sunucu tarafi bunu isValidIzin'de
    // artik zorunlu kiliyor (bkz. yetki denetimi).
    name: 'gozlemci ve admin izin talebi olusturamaz',
    run: async (env) => {
      const base = {
        baslangic: '2026-05-18',
        bitis: '2026-05-19',
        tip: 'mazeret',
        durum: 'onay_bekliyor',
        olusturmaTarihi: Timestamp.now(),
      };

      const gozlemciDb = testUser(env, 'gozlemci1').firestore();
      await assertFails(
        setDoc(doc(gozlemciDb, 'izinler/gozlemciLeave'), {
          ...base,
          uid: 'gozlemci1',
        })
      );

      const adminDb = testUser(env, 'admin').firestore();
      await assertFails(
        setDoc(doc(adminDb, 'izinler/adminLeave'), {
          ...base,
          uid: 'admin',
        })
      );
    },
  },
  {
    // izinler'in `list` kuralinda (yukarida, ayni match blogu) zaten
    // `resource == null` dali var (O10 yorumuyla belgelenmis), ama komsu
    // `get` kuralinda bu dal eksikti: admin olmayan bir kullanici var
    // olmayan bir izin ID'sine getDoc atarsa `resource.data.durum`
    // null-deref hatasiyla reddediliyordu (bkz. vekalet_talepleri'ndeki
    // ayni sinif bug, e2e denetimi).
    name: 'muezzin henuz var olmayan bir izin kaydini get ile sorgulayabilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(getDoc(doc(db, 'izinler/hicOlusturulmamisIzin')));
    },
  },
  {
    name: 'izin talebi Cuma iceren bir araligi sunucu tarafinda reddeder',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      const base = {
        uid: 'muezzin1',
        tip: 'mazeret',
        durum: 'onay_bekliyor',
        olusturmaTarihi: Timestamp.now(),
      };

      // 2026-05-22 tek basina bir Cuma.
      await assertFails(
        setDoc(doc(db, 'izinler/tekGunCuma'), {
          ...base,
          baslangic: '2026-05-22',
          bitis: '2026-05-22',
        })
      );
      // 2026-05-18 (Pzt) - 2026-05-24 (Paz) araligi 2026-05-22 Cuma'yi kapsiyor.
      await assertFails(
        setDoc(doc(db, 'izinler/araligaCumaGiriyor'), {
          ...base,
          baslangic: '2026-05-18',
          bitis: '2026-05-24',
        })
      );
      // 7+ gunluk her aralik istatistiksel olarak bir Cuma icerir.
      await assertFails(
        setDoc(doc(db, 'izinler/haftalikArayaCumaGirer'), {
          ...base,
          baslangic: '2026-05-19',
          bitis: '2026-05-26',
        })
      );
      // Cuma icermeyen kisa bir araligin gecmesi gerekir (regresyon kontrolu).
      await assertSucceeds(
        setDoc(doc(db, 'izinler/cumasizAralik'), {
          ...base,
          baslangic: '2026-05-18',
          bitis: '2026-05-21',
        })
      );
      // Ters cevrilmis aralik (bitis < baslangic) reddedilmeli.
      await assertFails(
        setDoc(doc(db, 'izinler/tersAralik'), {
          ...base,
          baslangic: '2026-05-25',
          bitis: '2026-05-20',
        })
      );
    },
  },
  {
    // FR-O3 sonrasi: `sebep` artik `izinler`de degil, kendi ID'si karsilik
    // gelen izinler belgesiyle AYNI olan `izin_detaylari`da. Onceden
    // isValidIzin'in `sebep` alani hasOnly'de listeleniyordu ama hic tip/
    // uzunluk dogrulamasi yapmiyordu — burada isValidIzinDetay icin ayni
    // sinir testleri tekrarlanir.
    name: 'izin_detaylari sebep 1000 karakteri asarsa veya string degilse reddedilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(
        setDoc(doc(db, 'izinler/izinDetaySinirTest'), {
          uid: 'muezzin1',
          baslangic: '2026-05-18',
          bitis: '2026-05-19',
          tip: 'mazeret',
          durum: 'onay_bekliyor',
          olusturmaTarihi: Timestamp.now(),
        })
      );

      const base = { uid: 'muezzin1', olusturmaTarihi: Timestamp.now() };
      await assertFails(
        setDoc(doc(db, 'izin_detaylari/izinDetaySinirTest'), {
          ...base,
          sebep: 'a'.repeat(1001),
        })
      );
      await assertFails(
        setDoc(doc(db, 'izin_detaylari/izinDetaySinirTest'), {
          ...base,
          sebep: 12345,
        })
      );
      // Tam sinirda (1000 karakter) gecmeli (regresyon kontrolu).
      await assertSucceeds(
        setDoc(doc(db, 'izin_detaylari/izinDetaySinirTest'), {
          ...base,
          sebep: 'a'.repeat(1000),
        })
      );
    },
  },
  {
    // izin_detaylari'nin create kurali kendi uid'ini dogrular ama (mazeret_
    // detaylari'nin aksine, bkz. firestore.rules yorumu) karsilik gelen
    // izinler belgesinin sahibini CAPRAZ DOGRULAMAZ — ID rastgele/tahmin
    // edilemez oldugundan bu yeterli. Yine de "baskasinin uid'i ile
    // olusturamaz" temel kontrolu burada dogrulanir.
    name: 'izin_detaylari yalnizca kendi uid ile olusturulabilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(
        setDoc(doc(db, 'izin_detaylari/baskasininUidi'), {
          uid: 'muezzin2',
          sebep: 'Baskasi adina yazma denemesi',
          olusturmaTarihi: Timestamp.now(),
        })
      );
      await assertSucceeds(
        setDoc(doc(db, 'izin_detaylari/kendiUidi'), {
          uid: 'muezzin1',
          sebep: 'Gecerli',
          olusturmaTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    // VacationRequestCard.tsx'in GERCEK yazim deseni: izinler + izin_detaylari
    // TEK bir atomik batch'te, ayni cagrida olusturulur (izin_detaylari'nin
    // create kuralindaki get() karsilik gelen izinler belgesini AYNI
    // batch'teki kardes islemden mi yoksa yalnizca batch-oncesi durumdan mi
    // goruyor? — bu, bir onceki testteki SIRALI/ayri setDoc cagrilarindan
    // FARKLI bir senaryo, ayrica dogrulanmasi gerekiyordu).
    name: 'izinler + izin_detaylari AYNI atomik batch icinde birlikte olusturulabilir (VacationRequestCard deseni)',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      const batch = writeBatch(db);
      batch.set(doc(db, 'izinler/izinDetayAyniBatch'), {
        uid: 'muezzin1',
        baslangic: '2026-05-18',
        bitis: '2026-05-19',
        tip: 'mazeret',
        durum: 'onay_bekliyor',
        olusturmaTarihi: Timestamp.now(),
      });
      batch.set(doc(db, 'izin_detaylari/izinDetayAyniBatch'), {
        uid: 'muezzin1',
        sebep: 'Ayni batch testi',
        olusturmaTarihi: Timestamp.now(),
      });
      await assertSucceeds(batch.commit());
    },
  },
  {
    name: 'izin_detaylari yalnizca ilgili kisi veya admin tarafindan okunabilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'izin_detaylari/ozelIzinSebebi'), {
          uid: 'muezzin1',
          sebep: 'Gizli saglik detayi',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const digerKullanici = testUser(env, 'muezzin2').firestore();
      await assertFails(getDoc(doc(digerKullanici, 'izin_detaylari/ozelIzinSebebi')));

      const sahibi = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(getDoc(doc(sahibi, 'izin_detaylari/ozelIzinSebebi')));

      const adminDb = testUser(env, 'admin').firestore();
      await assertSucceeds(getDoc(doc(adminDb, 'izin_detaylari/ozelIzinSebebi')));
    },
  },
  {
    name: 'izin_detaylari yalnizca admin tarafindan listelenebilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(getDocs(collection(db, 'izin_detaylari')));

      const adminDb = testUser(env, 'admin').firestore();
      await assertSucceeds(getDocs(collection(adminDb, 'izin_detaylari')));
    },
  },
  {
    // Ucuncu denetim turu bulgusu: veriOnarimServisi.ts'in "Veri Sagligi"
    // onarim akisi ters-tarihli bir izin kaydini admin olarak duzeltmek icin
    // SADECE baslangic/bitis yaziyor (durum/redSebebi'ye dokunmuyor) — bu
    // onceden izinler update kuralinin admin disjunct'inin (hasOnly yalnizca
    // durum/redSebebi) disinda kaliyordu, her zaman PERMISSION_DENIED
    // aliyordu.
    name: 'admin ters-tarihli bir izin kaydini baslangic/bitis yazarak onarabilir (veriOnarimServisi regresyonu)',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        // 2026-05-18 (Pzt) - 2026-05-19 (Sal), Cuma icermeyen bir aralik —
        // ama ters kaydedilmis: baslangic=19, bitis=18.
        await setDoc(doc(db, 'izinler/tersTarihliKayit'), {
          uid: 'muezzin1',
          baslangic: '2026-05-19',
          bitis: '2026-05-18',
          tip: 'mazeret',
          durum: 'onaylandi',
          sebep: 'Aile',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'admin').firestore();
      const ref = doc(db, 'izinler/tersTarihliKayit');

      // veriOnarimServisi.ts'in gercek onarim yazimi: iki tarihi yer
      // degistirir, baska hicbir alana dokunmaz.
      await assertSucceeds(updateDoc(ref, { baslangic: '2026-05-18', bitis: '2026-05-19' }));
    },
  },
  {
    // Onarim yolu sonsuz esneklige acilmamali — duzeltilmis aralik da
    // isValidIzinTarihAraligi'nin sekil/is-kurallarina (ters aralik, Cuma
    // icerme) tabi olmali.
    name: 'admin izin onarimi gecersiz bir tarih araligina yazilamaz',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'izinler/gecersizOnarimDenemesi'), {
          uid: 'muezzin1',
          baslangic: '2026-05-19',
          bitis: '2026-05-18',
          tip: 'mazeret',
          durum: 'onaylandi',
          sebep: 'Aile',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'admin').firestore();
      const ref = doc(db, 'izinler/gecersizOnarimDenemesi');

      // Duzeltme sonrasi da hala ters aralik (bitis < baslangic) — reddedilmeli.
      await assertFails(updateDoc(ref, { baslangic: '2026-05-20', bitis: '2026-05-15' }));
    },
  },
  {
    // Admin izin onarim yolu yalnizca durum/redSebebi/baslangic/bitis
    // yazabilmeli — uid gibi kimlik alanlarina sizmamali.
    name: 'admin izin onarimi kimlik alanlarini (uid) degistiremez',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'izinler/kimlikDenemesi'), {
          uid: 'muezzin1',
          baslangic: '2026-05-18',
          bitis: '2026-05-19',
          tip: 'mazeret',
          durum: 'onaylandi',
          sebep: 'Aile',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'admin').firestore();
      const ref = doc(db, 'izinler/kimlikDenemesi');

      await assertFails(updateDoc(ref, { uid: 'muezzin2' }));
    },
  },
  {
    // isValidIzin artik hasOnly ile sinirli — sema disi ekstra bir alan
    // (ornegin sinirsiz uzunlukta rastgele bir alan) create'te reddedilmeli.
    name: 'izin talebi sema disi ekstra alan icermemeli (isValidIzin hasOnly)',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(
        setDoc(doc(db, 'izinler/ekstraAlanli'), {
          uid: 'muezzin1',
          baslangic: '2026-05-18',
          bitis: '2026-05-19',
          tip: 'mazeret',
          durum: 'onay_bekliyor',
          sebep: 'Aile',
          olusturmaTarihi: Timestamp.now(),
          yetkisizAlan: 'sizma denemesi',
        })
      );
    },
  },
  {
    // izinGuncelle karar aninda durum ile AYNI update'te bildirimGonderildi:
    // false yazar (bkz. useAdminIzinlerStore.ts) — admin disjunct'inin
    // affectedKeys hasOnly'sine bu alan eklenmezse izinGuncelle her zaman
    // PERMISSION_DENIED alirdi (bkz. Firebase/GitHub veri akisi
    // optimizasyonu, duyuru/izin push bildirimi ozelligi).
    name: 'admin izin kararini bildirimGonderildi:false ile AYNI update icinde yazabilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'izinler/kararBekleyen'), {
          uid: 'muezzin1',
          baslangic: '2026-05-18',
          bitis: '2026-05-19',
          tip: 'mazeret',
          durum: 'onay_bekliyor',
          sebep: 'Aile',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'admin').firestore();
      const ref = doc(db, 'izinler/kararBekleyen');

      await assertSucceeds(updateDoc(ref, { durum: 'onaylandi', bildirimGonderildi: false }));
    },
  },
  {
    // Düşük öncelikli bulgu: admin dalı hangi ALANLARIN değiştiğini
    // kontrol ediyordu ama `durum`un DEĞERİNİ hiç doğrulamıyordu — şema
    // dışı bir değer sessizce kabul edilip izinDurumBildirimGonder.ts'in
    // hiçbir dalına girmeden yutulabiliyordu.
    name: 'admin izin kararini sema disi bir durum degeriyle guncelleyemez',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'izinler/semaDisiDurumDenemesi'), {
          uid: 'muezzin1',
          baslangic: '2026-05-18',
          bitis: '2026-05-19',
          tip: 'mazeret',
          durum: 'onay_bekliyor',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'admin').firestore();
      const ref = doc(db, 'izinler/semaDisiDurumDenemesi');

      await assertFails(updateDoc(ref, { durum: 'gecersizDurum' }));
    },
  },
  {
    // izinGeriAl bir karari geri alirken bildirimGonderildi'yi SILER (deleteField)
    // — aksi halde yeniden karar verildiginde eski true degeri yuzunden yeni
    // bildirim hic gitmezdi (bkz. useAdminIzinlerStore.ts izinGeriAl yorumu).
    name: 'admin bir karari geri alirken bildirimGonderildi bayragini silebilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'izinler/geriAlinacakKarar'), {
          uid: 'muezzin1',
          baslangic: '2026-05-18',
          bitis: '2026-05-19',
          tip: 'mazeret',
          durum: 'onaylandi',
          sebep: 'Aile',
          olusturmaTarihi: Timestamp.now(),
          bildirimGonderildi: true,
        });
      });

      const db = testUser(env, 'admin').firestore();
      const ref = doc(db, 'izinler/geriAlinacakKarar');

      await assertSucceeds(updateDoc(ref, { durum: 'onay_bekliyor', bildirimGonderildi: deleteField() }));
    },
  },
  {
    // `puanIslendi`nin isValidBildirim'de yol actigi bulgunun BIREBIR
    // AYNISI: isValidIzin'in hasOnly'si `bildirimGonderildi`yi (ve iki fazli
    // gonderim damgasini) listelemiyordu. hasOnly her update'te TUM belgeyi
    // dogruladigindan, bu alanlari tasiyan bir izin belgesi 'onay_bekliyor'a
    // geri dondugunde sahibinin kendi bekleyen talebini duzenledigi
    // self-update dali KALICI olarak reddediliyordu. Ulasilabilir yaris:
    // cron dokumani 'onaylandi' + bayrak:false okur, admin arada izinGeriAl
    // yapar, cron sonra bayragi true yazar.
    name: 'sahibi, bildirimGonderildi/gonderim damgasi tasiyan bekleyen kendi izin talebini duzenleyebilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'izinler/bayrakliBekleyen'), {
          uid: 'muezzin1',
          baslangic: '2026-05-18',
          bitis: '2026-05-19',
          tip: 'mazeret',
          durum: 'onay_bekliyor',
          olusturmaTarihi: Timestamp.now(),
          bildirimGonderildi: true,
          bildirimGonderimBaslangici: Timestamp.now(),
        });
      });

      const db = testUser(env, 'muezzin1').firestore();
      const ref = doc(db, 'izinler/bayrakliBekleyen');

      // 2026-05-18 (Pzt) - 2026-05-21 (Per): Cuma icermeyen gecerli aralik.
      await assertSucceeds(updateDoc(ref, { bitis: '2026-05-21' }));
    },
  },
  {
    // Alanlar hasOnly'ye eklenirken TIPSIZ birakilmamali (bkz. isValidDuyuru
    // ve isValidBildirim'deki ayni desen) — aksi halde istemci bu alanlara
    // sinirsiz uzunlukta serbest metin yazabilirdi.
    name: 'izin talebinde bildirimGonderildi/gonderim damgasi yanlis tiplerle yazilamaz',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(
        setDoc(doc(db, 'izinler/yanlisTipBayrak'), {
          uid: 'muezzin1',
          baslangic: '2026-05-18',
          bitis: '2026-05-19',
          tip: 'mazeret',
          durum: 'onay_bekliyor',
          olusturmaTarihi: Timestamp.now(),
          bildirimGonderildi: 'evet',
        })
      );
      await assertFails(
        setDoc(doc(db, 'izinler/yanlisTipDamga'), {
          uid: 'muezzin1',
          baslangic: '2026-05-18',
          bitis: '2026-05-19',
          tip: 'mazeret',
          durum: 'onay_bekliyor',
          olusturmaTarihi: Timestamp.now(),
          bildirimGonderimBaslangici: 'simdi',
        })
      );
    },
  },
  {
    // Yıllık izin onayı, izinler.durum ve muezzins.yillikIzinKullanilanGun'u
    // AYNI transaction'da atomik günceller (bkz. useAdminIzinlerStore.ts
    // izinGuncelle). Kota dahilindeyse (20 + 5 gün = 25 <= 30) her iki yazım
    // da başarılı olmalı.
    name: 'yillik izin onayi kota dahilindeyse muezzins sayacini da atomik gunceller',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'muezzins/muezzin1'), { yillikIzinKullanilanGun: 20 }, { merge: true });
        await setDoc(doc(db, 'izinler/yillikTalebi1'), {
          uid: 'muezzin1',
          baslangic: '2026-08-10',
          bitis: '2026-08-14', // 5 gün (dahil)
          tip: 'yillik',
          durum: 'onay_bekliyor',
          sebep: 'Test',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'admin').firestore();
      await assertSucceeds(
        runTransaction(db, async (transaction) => {
          transaction.update(doc(db, 'izinler/yillikTalebi1'), { durum: 'onaylandi' });
          transaction.update(doc(db, 'muezzins/muezzin1'), { yillikIzinKullanilanGun: 25 });
        })
      );
    },
  },
  {
    // Kotayı aşan bir onay (28 + 5 gün = 33 > 30) SUNUCU tarafında
    // tamamen reddedilmeli — admin override'ı yok (kullanıcı kararı).
    // isValidMuezzin'deki <=30 sert sınırı muezzins yazımını reddeder,
    // bu da TÜM transaction'ı (izinler.durum dahil) başarısız kılar.
    name: 'yillik izin onayi kotayi asiyorsa sunucu tarafinda tamamen reddedilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'muezzins/muezzin2'), { yillikIzinKullanilanGun: 28 }, { merge: true });
        await setDoc(doc(db, 'izinler/yillikTalebi2'), {
          uid: 'muezzin2',
          baslangic: '2026-09-01',
          bitis: '2026-09-05', // 5 gün (dahil)
          tip: 'yillik',
          durum: 'onay_bekliyor',
          sebep: 'Test',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'admin').firestore();
      await assertFails(
        runTransaction(db, async (transaction) => {
          transaction.update(doc(db, 'izinler/yillikTalebi2'), { durum: 'onaylandi' });
          transaction.update(doc(db, 'muezzins/muezzin2'), { yillikIzinKullanilanGun: 33 });
        })
      );
    },
  },
];
