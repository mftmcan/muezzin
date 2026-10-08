// Vekalet talebi testleri: olusturma, kimlik/korelasyon alanlari,
// kabul niyet bayragi, silme ve listeleme yetkileri.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { TestCase, testUser, PENCERE_ACIK } from './ortak.ts';

export const tests: TestCase[] = [
  {
    // Fix 3'un KOK NEDENI: `vekalet_talepleri` update kuralinin admin dali
    // eskiden KOSULSUZ `isAdmin()` idi — hicbir sema kisiti yoktu. Bir admin
    // yazimi talebi bagli bildirimden desenkronize edebiliyordu (talep.tarih
    // != bildirim.tarih) ve scripts/vekaletDevirleriniIsle.ts o noktadan
    // sonra bazi kontrolleri talep'ten, bazilarini bildirim'den okudugu icin
    // FARKLI gorevler hakkinda karar veriyordu.
    name: 'admin bir vekalet talebinin kimlik/korelasyon alanlarini degistiremez',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'vekalet_talepleri/adminDesyncDeneme'), {
          bildirimId: 'ownPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'kabul_edildi',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'admin').firestore();
      const ref = doc(db, 'vekalet_talepleri/adminDesyncDeneme');
      // Korelasyon alanlari: hepsi reddedilmeli.
      await assertFails(updateDoc(ref, { tarih: '2026-05-22' }));
      await assertFails(updateDoc(ref, { vakit: 'yatsi' }));
      await assertFails(updateDoc(ref, { bildirimId: 'otherPendingAsil' }));
      await assertFails(updateDoc(ref, { aliciUid: 'muezzin1' }));
      await assertFails(updateDoc(ref, { tip: 'yedek' }));
      // Mesru bir admin onarimi (durum + goruntulenen alanlar) hala serbest.
      await assertSucceeds(updateDoc(ref, { durum: 'reddedildi', sonGuncelleme: Timestamp.now() }));
    },
  },
  {
    name: 'muezzin kendi bekleyen gorevi icin vekalet talebi acabilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(
        setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
          bildirimId: 'ownPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'beklemede',
          olusturmaTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'muezzin Cuma gorevi icin vekalet talebi acamaz',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(
        setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-22_ogle_asil_muezzin2'), {
          bildirimId: 'fridayPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-22',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'beklemede',
          olusturmaTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'muezzin baskasinin gorevi icin vekalet talebi acamaz',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(
        setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-22_ikindi_asil_muezzin1'), {
          bildirimId: 'otherPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin1',
          aliciIsim: 'Muezzin One',
          tarih: '2026-05-22',
          vakit: 'ikindi',
          saat: '16:30',
          tip: 'asil',
          durum: 'beklemede',
          olusturmaTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    // O10 regresyonu: vekaletTeklifEt (src/services/vekaletServisi.ts), yeni
    // bir teklif olusturmadan once ayni deterministik ID'de daha once
    // reddedilmis bir talep var mi diye getDoc ile bakar. Talep henuz HIC
    // olusturulmamissa `resource` null olur; eskiden `isVekaletParticipant`
    // bu durumda `null.gonderenUid` erisimiyle degerlendirme hatasi
    // firlatiyordu ve admin OLMAYAN hicbir kullanici ilk teklifini
    // gonderemiyordu (getDoc adimi her zaman reddediliyordu). `izinler`
    // L783'teki `resource == null` deseniyle simetrik sekilde duzeltildi.
    name: 'muezzin henuz var olmayan bir vekalet talebini get ile sorgulayabilir (O10 regresyonu)',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(getDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-22_yatsi_asil_muezzin2')));
    },
  },
  {
    // O7'nin AYNI SINIFI, cron kaynakli red yolunda:
    // scripts/vekaletDevirleriniIsle.ts kabul edilmis bir devri uygulama
    // aninda uygulayamadiginda talebi (Admin SDK ile, kurallari atlayarak)
    // durum:'reddedildi' + talepSonuc:'reddedildi' + bildirimUygulandi:true
    // olarak isaretler. `durum` 'kabul_edildi'de BIRAKILSAYDI asagidaki
    // delete kurali eslesmez, ayni deterministik ID'ye (haftaId_tarih_vakit_
    // tip_aliciUid) yapilan setDoc ise create degil UPDATE sayilip
    // isValidVekaletCreate/isRecipientVekaletStatusUpdate'in hicbiriyle
    // eslesmezdi — gonderen o (gorev, alici) cifti icin bir daha ASLA teklif
    // gonderemezdi. Kurallar gevsetilmedi; script'in yazdigi durum,
    // ZATEN VAR OLAN delete kuralinin kapsamina getirildi.
    name: 'cron tarafindan reddedilen talebi gonderen silip yeniden olusturabilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
          bildirimId: 'ownPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'reddedildi',
          talepSonuc: 'reddedildi',
          bildirimUygulandi: true,
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(deleteDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2')));
      await assertSucceeds(
        setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
          bildirimId: 'ownPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'beklemede',
          olusturmaTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    // Yukaridaki duzeltmenin kurallari GEVSETMEDIGINI kilitler: hala
    // uygulanmayi bekleyen (durum 'kabul_edildi') bir talep gonderen
    // tarafindan silinemez — aksi halde gonderen, alicinin kabulunu
    // cron uygulamadan once tek tarafli olarak yok edebilirdi.
    name: 'gonderen kabul edilmis (henuz uygulanmamis) bir talebi silemez',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
          bildirimId: 'ownPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'kabul_edildi',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(deleteDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2')));
    },
  },
  {
    name: 'vekalet alicisi talebi kabul edip bildirimi devralabilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
          bildirimId: 'ownPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'beklemede',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'muezzin2').firestore();
      // NOT ("1000 ifade tavanı" kök neden çözümü): GERÇEK transfer (uid
      // flip'i) artık istemci tarafında değil, scripts/vekaletDevirleriniIsle.ts'te
      // (Admin SDK) gerçekleşiyor — bkz. tests/integration/vekaletDevirleriniIsle.test.ts.
      // İstemci burada yalnızca talebi kabul eder ve dar bir niyet bayrağı yazar.
      await assertSucceeds(
        runTransaction(db, async (transaction) => {
          transaction.update(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
            durum: 'kabul_edildi',
            sonGuncelleme: Timestamp.now(),
          });
          transaction.update(doc(db, 'bildirimler/ownPendingAsil'), {
            vekaletDevriBekliyor: true,
            sonGuncelleme: Timestamp.now(),
          });
        })
      );

      // Eski doğrudan-transfer yolu artık TAMAMEN KAPALI — talep kabul
      // edilmiş olsa bile istemci uid'i doğrudan flip edemez (bkz.
      // isAcceptedVekaletBildirimTransfer'in silindiği "1000 ifade tavanı"
      // kök neden çözümü). Bu, aşağıdaki "vekalet alicisi kabul etmeden
      // bildirimi devralamaz" testinin ayna görüntüsü — burada FARKI, talep
      // GERÇEKTEN kabul edilmiş olması, yine de fark etmiyor.
      await assertFails(
        updateDoc(doc(db, 'bildirimler/ownPendingAsil'), {
          uid: 'muezzin2',
          vekaletDevredildi: true,
          sonGuncelleme: Timestamp.now(),
        })
      );
    },
  },
  {
    // NOT ("1000 ifade tavanı" kök neden çözümü): sabit haftalık izin-günü
    // çakışması artık BURADA (CEL'de) değil, scripts/vekaletDevirleriniIsle.ts'te
    // TAZE veriyle yeniden doğrulanıyor (bkz. tests/integration/
    // vekaletDevirleriniIsle.test.ts "izin gününe denk gelen..." vakası).
    // Rules katmanında artık doğru davranış, izin-günü çakışmasından
    // BAĞIMSIZ olarak dar niyet bayrağı yazımının başarılı olmasıdır —
    // gerçek engelleme script'te gerçekleşir.
    name: "vekalet kabul niyet bayragi izin-gunu cakismasindan bagimsiz yazilabilir (kontrol script'e tasindi)",
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        // 2026-05-20 bir Carsamba (haftaGunuNumarasi -> 3); Cuma kisitlamasi
        // (cumaMi) ile karismasin diye ayri bir bilinen gun kullanildi.
        await setDoc(doc(db, 'muezzins/muezzin2'), { haftalikIzinGunu: 3 }, { merge: true });
        await setDoc(doc(db, 'bildirimler/wednesdayPendingAsil'), {
          haftaId: 'W2026-05-18',
          tarih: '2026-05-20',
          vakit: 'ogle',
          uid: 'muezzin1',
          tip: 'asil',
          durum: 'bekliyor',
          pendingAck: true,
          retSebebi: null,
          olusturmaTarihi: Timestamp.now(),
          sonGuncelleme: Timestamp.now(),
          mazeretSonBasvuru: PENCERE_ACIK(),
        });
        await setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
          bildirimId: 'wednesdayPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'kabul_edildi',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'muezzin2').firestore();
      await assertSucceeds(
        updateDoc(doc(db, 'bildirimler/wednesdayPendingAsil'), {
          vekaletDevriBekliyor: true,
          sonGuncelleme: Timestamp.now(),
        })
      );
      // Ama dogrudan uid transferi hala her kosulda kapali.
      await assertFails(
        updateDoc(doc(db, 'bildirimler/wednesdayPendingAsil'), {
          uid: 'muezzin2',
          vekaletDevredildi: true,
          sonGuncelleme: Timestamp.now(),
        })
      );
    },
  },
  {
    // NOT ("1000 ifade tavanı" kök neden çözümü): arşivlenmiş alıcı kontrolü
    // artık BURADA (CEL'de) değil, scripts/vekaletDevirleriniIsle.ts'te TAZE
    // veriyle yeniden doğrulanıyor (bkz. tests/integration/
    // vekaletDevirleriniIsle.test.ts "arşivlenmiş alıcı..." vakası, eski O9
    // regresyonunun taşınmış hali). Rules katmanında artık doğru davranış,
    // alıcının arşivli olmasından BAĞIMSIZ olarak dar niyet bayrağı
    // yazımının başarılı olmasıdır.
    name: "vekalet kabul niyet bayragi alicinin arsivli olmasindan bagimsiz yazilabilir (kontrol script'e tasindi)",
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'muezzins/muezzin2'), {
          displayName: 'Muezzin Two',
          email: 'muezzin2@example.test',
          role: 'muezzin',
          aktif: false, // talep beklerken admin tarafından arşivlendi
          photoURL: '',
          fcmToken: null,
          aylikVakitSayisi: 0,
        });
        await setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
          bildirimId: 'ownPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'beklemede',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'muezzin2').firestore();
      await assertSucceeds(
        runTransaction(db, async (transaction) => {
          transaction.update(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
            durum: 'kabul_edildi',
            sonGuncelleme: Timestamp.now(),
          });
          transaction.update(doc(db, 'bildirimler/ownPendingAsil'), {
            vekaletDevriBekliyor: true,
            sonGuncelleme: Timestamp.now(),
          });
        })
      );
    },
  },
  {
    name: 'vekalet alicisi kendi bekleyen tekliflerini listeleyebilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
          bildirimId: 'ownPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'beklemede',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'muezzin2').firestore();
      await assertSucceeds(
        getDocs(query(collection(db, 'vekalet_talepleri'), where('aliciUid', '==', 'muezzin2'), where('durum', '==', 'beklemede')))
      );
    },
  },
  {
    name: 'muezzin tum vekalet taleplerini listeleyemez',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
          bildirimId: 'ownPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'beklemede',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(getDocs(collection(db, 'vekalet_talepleri')));
    },
  },
  {
    name: 'vekalet alicisi kabul etmeden bildirimi devralamaz',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'vekalet_talepleri/W2026-05-18_2026-05-20_ogle_asil_muezzin2'), {
          bildirimId: 'ownPendingAsil',
          haftaId: 'W2026-05-18',
          gonderenUid: 'muezzin1',
          gonderenIsim: 'Muezzin One',
          aliciUid: 'muezzin2',
          aliciIsim: 'Muezzin Two',
          tarih: '2026-05-20',
          vakit: 'ogle',
          saat: '12:45',
          tip: 'asil',
          durum: 'beklemede',
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'muezzin2').firestore();
      await assertFails(
        updateDoc(doc(db, 'bildirimler/ownPendingAsil'), {
          uid: 'muezzin2',
          sonGuncelleme: Timestamp.now(),
        })
      );
    },
  },
];
