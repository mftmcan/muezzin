// Duyurular, sistem ayarlari (settings), vakit onbellegi, denetim
// (audit) kayitlari ve K6 error_log/telemetry_log semasi.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { TestCase, testUser, validVakitGunleri } from './ortak.ts';

export const tests: TestCase[] = [
  {
    name: 'admin gecerli semali hafta plani olusturup dinamik bir slotu guncelleyebilir',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();
      const ref = doc(db, 'haftaPlanlari/W2026-11-02');

      await assertSucceeds(
        setDoc(ref, {
          haftaBaslangic: '2026-11-02',
          haftaBitis: '2026-11-08',
          durum: 'yayinda',
          olusturmaTarihi: Timestamp.now(),
          sonGuncelleme: Timestamp.now(),
          gunler: {
            '2026-11-02': {
              sabah: { asil: 'muezzin1', yedek: 'muezzin2' },
            },
          },
        })
      );

      // planServisi.vakitAtamasiniGuncelle ve veriOnarimServisi bu nokta-yol
      // desenini kullanir; üst seviye şema doğrulaması bunu bozmamalıdır.
      await assertSucceeds(
        updateDoc(ref, {
          'gunler.2026-11-02.ogle': { asil: 'muezzin2', yedek: 'muezzin1' },
          sonGuncelleme: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'manuel plan atamasi bildirimler ve denetim kaydiyla atomik yazilabilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'haftaPlanlari/W2026-11-02'), {
          haftaBaslangic: '2026-11-02',
          haftaBitis: '2026-11-08',
          durum: 'yayinda',
          olusturmaTarihi: Timestamp.now(),
          sonGuncelleme: Timestamp.now(),
          gunler: {
            '2026-11-03': {
              ogle: { asil: 'Sistem', yedek: 'Sistem' },
            },
          },
        });
      });

      const db = testUser(env, 'admin').firestore();
      const batch = writeBatch(db);
      batch.update(doc(db, 'haftaPlanlari/W2026-11-02'), {
        'gunler.2026-11-03.ogle': { asil: 'muezzin1', yedek: 'muezzin2' },
      });
      for (const [tip, uid] of [
        ['asil', 'muezzin1'],
        ['yedek', 'muezzin2'],
      ] as const) {
        batch.set(doc(db, `bildirimler/W2026-11-02_2026-11-03_ogle_${tip}`), {
          haftaId: 'W2026-11-02',
          tarih: '2026-11-03',
          vakit: 'ogle',
          uid,
          tip,
          durum: 'bekliyor',
          pendingAck: true,
          retSebebi: null,
          cumaMi: false,
          olusturmaTarihi: Timestamp.now(),
          sonGuncelleme: Timestamp.now(),
          manuelAtama: true,
        });
      }
      batch.set(doc(db, 'audit_logs/atomikManuelAtama'), {
        actionType: 'Manuel Görev Atama',
        targetName: '2026-11-03',
        details: 'OGLE vakti için asil ve yedek ataması yapıldı.',
        userId: 'admin',
        userDisplayName: 'Admin',
        timestamp: serverTimestamp(),
      });

      await assertSucceeds(batch.commit());
    },
  },
  {
    name: 'hafta plani sema disi alan, gecersiz durum veya gecersiz belge kimligiyle yazilamaz',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();
      const temelPlan = {
        haftaBaslangic: '2026-11-02',
        haftaBitis: '2026-11-08',
        durum: 'yayinda',
        olusturmaTarihi: Timestamp.now(),
        gunler: {
          '2026-11-02': {
            sabah: { asil: 'muezzin1', yedek: 'muezzin2' },
          },
        },
      };

      await assertFails(
        setDoc(doc(db, 'haftaPlanlari/W2026-11-02'), {
          ...temelPlan,
          yetkisizAlan: true,
        })
      );
      await assertFails(
        setDoc(doc(db, 'haftaPlanlari/W2026-11-09'), {
          ...temelPlan,
          durum: 'taslak',
        })
      );
      await assertFails(setDoc(doc(db, 'haftaPlanlari/keyfi-plan'), temelPlan));
    },
  },
  {
    name: 'hafta plani bos veya yedi gunden buyuk gun haritasiyla yazilamaz',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();
      const temel = {
        haftaBaslangic: '2026-11-02',
        haftaBitis: '2026-11-08',
        durum: 'yayinda',
        olusturmaTarihi: Timestamp.now(),
      };

      await assertFails(setDoc(doc(db, 'haftaPlanlari/W2026-11-02'), { ...temel, gunler: {} }));
      await assertFails(
        setDoc(doc(db, 'haftaPlanlari/W2026-11-09'), {
          ...temel,
          gunler: Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`2026-11-${String(index + 9).padStart(2, '0')}`, {}])),
        })
      );
    },
  },
  {
    name: 'admin duyuru yazabilir ve silebilir',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();
      const ref = doc(db, 'duyurular/adminNotice');

      // Gercek servis (duyuruServisi.ts duyuruYayinla) her zaman 'tip'
      // gonderiyor — isValidDuyuru eklenmeden once bu alan sema disi
      // kaldigindan bu test fixture'i eksikti (bkz. asagidaki yeni testler).
      await assertSucceeds(
        setDoc(ref, {
          baslik: 'Admin',
          icerik: 'Metin',
          tip: 'duyuru',
          tarih: Timestamp.now(),
        })
      );
      await assertSucceeds(deleteDoc(ref));
    },
  },
  {
    // Ucuncu denetim turu bulgusu: duyurular hic sema dogrulamasi
    // yapmiyordu (diger tum yazilabilir varliklarin aksine) — yetki acigi
    // degildi (yalnizca admin yazabiliyor) ama tutarsizlikti.
    name: 'admin duyurusuna sema disi ekstra alan ekleyemez (isValidDuyuru hasOnly)',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();
      await assertFails(
        setDoc(doc(db, 'duyurular/extraFieldNotice'), {
          baslik: 'Admin',
          icerik: 'Metin',
          tip: 'duyuru',
          tarih: Timestamp.now(),
          yetkisizAlan: 'sizma denemesi',
        })
      );
    },
  },
  {
    name: 'admin duyurusu gecersiz tip degeriyle olusturulamaz',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();
      await assertFails(
        setDoc(doc(db, 'duyurular/invalidTipNotice'), {
          baslik: 'Admin',
          icerik: 'Metin',
          tip: 'gecersiz_kategori',
          tarih: Timestamp.now(),
        })
      );
    },
  },
  {
    // duyuruYayinla yayin aninda bildirimGonderildi:false yazar (bkz.
    // duyuruServisi.ts) — bu alan isValidDuyuru'nun hasOnly'sine eklenmezse
    // her yeni duyuru "fazladan anahtar" ihlaliyle reddedilirdi.
    name: 'admin duyuruyu bildirimGonderildi:false ile olusturabilir',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();
      await assertSucceeds(
        setDoc(doc(db, 'duyurular/bildirimBayrakli'), {
          baslik: 'Admin',
          icerik: 'Metin',
          tip: 'duyuru',
          tarih: Timestamp.now(),
          bildirimGonderildi: false,
        })
      );
    },
  },
  {
    name: 'push gonderim claimi belgede kalmis duyuru admin tarafindan duzenlenebilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'duyurular/stuckClaimNotice'), {
          baslik: 'Gönderiliyor',
          icerik: 'Push gönderim süreci yarıda kaldı.',
          tip: 'bilgi',
          tarih: Timestamp.now(),
          bildirimGonderildi: false,
          bildirimGonderimBaslangici: Timestamp.now(),
        });
      });

      const db = testUser(env, 'admin').firestore();
      await assertSucceeds(
        updateDoc(doc(db, 'duyurular/stuckClaimNotice'), {
          baslik: 'Gönderim yeniden denenecek',
        })
      );
    },
  },
  {
    name: 'duyuru olusturma ve silme denetim kaydiyla atomik tamamlanabilir',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();
      const duyuruRef = doc(db, 'duyurular/atomikAuditNotice');

      const yayinBatch = writeBatch(db);
      yayinBatch.set(duyuruRef, {
        baslik: 'Atomik duyuru',
        icerik: 'Duyuru ve denetim kaydi ayni batch icinde yazilir.',
        tip: 'duyuru',
        tarih: serverTimestamp(),
        bildirimGonderildi: false,
      });
      yayinBatch.set(doc(db, 'audit_logs/atomikDuyuruYayin'), {
        actionType: 'Duyuru Yayınlama',
        targetName: 'Atomik duyuru',
        details: 'Yeni duyuru yayınlandı.',
        userId: 'admin',
        userDisplayName: 'Admin',
        timestamp: serverTimestamp(),
      });
      await assertSucceeds(yayinBatch.commit());

      const silmeBatch = writeBatch(db);
      silmeBatch.delete(duyuruRef);
      silmeBatch.set(doc(db, 'audit_logs/atomikDuyuruSilme'), {
        actionType: 'Duyuru Silme',
        targetName: 'Atomik duyuru',
        details: 'Duyuru silindi.',
        userId: 'admin',
        userDisplayName: 'Admin',
        timestamp: serverTimestamp(),
      });
      await assertSucceeds(silmeBatch.commit());
    },
  },
  {
    name: 'duyurunun bildirimGonderildi alani bool disi bir degerle olusturulamaz',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();
      await assertFails(
        setDoc(doc(db, 'duyurular/gecersizBildirimBayrakli'), {
          baslik: 'Admin',
          icerik: 'Metin',
          tip: 'duyuru',
          tarih: Timestamp.now(),
          bildirimGonderildi: 'evet',
        })
      );
    },
  },
  {
    name: 'admin sistem ayarlarini sadece gecerli sema ile yazabilir',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();

      await assertSucceeds(
        setDoc(doc(db, 'settings/system'), {
          ilceId: '9148',
          ilceAdi: 'Ceyhan',
          hicriDuzeltme: 0,
        })
      );

      await assertFails(
        setDoc(doc(db, 'settings/system'), {
          ilceId: '91',
          ilceAdi: '',
          hicriDuzeltme: 7,
        })
      );
    },
  },
  {
    name: 'admin sistem ayarini denetim kaydiyla atomik guncelleyebilir',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();
      const batch = writeBatch(db);
      batch.set(doc(db, 'settings/system'), {
        ilceId: '9148',
        ilceAdi: 'Ceyhan',
        hicriDuzeltme: 1,
      });
      batch.set(doc(db, 'audit_logs/atomikSistemAyari'), {
        actionType: 'Dizge Ayarı Güncelleme',
        targetName: 'Vakit Bölgesi',
        details: 'İlçe ve hicri düzeltme ayarları güncellendi.',
        userId: 'admin',
        userDisplayName: 'Admin',
        timestamp: serverTimestamp(),
      });
      await assertSucceeds(batch.commit());
    },
  },
  {
    name: 'admin kriz alarmi cozumunu denetim kaydiyla atomik tamamlayabilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'adminUyarilari/atomikAlarm'), {
          tip: 'test',
          cozuldu: false,
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'admin').firestore();
      const batch = writeBatch(db);
      batch.update(doc(db, 'adminUyarilari/atomikAlarm'), {
        cozuldu: true,
        cozulmeTarihi: Timestamp.now(),
      });
      batch.set(doc(db, 'audit_logs/atomikAlarmCozumu'), {
        actionType: 'Kriz Alarmı Çözme',
        targetName: 'atomikAlarm',
        details: 'Kriz alarmı yönetici tarafından çözüldü.',
        userId: 'admin',
        userDisplayName: 'Admin',
        timestamp: serverTimestamp(),
      });
      await assertSucceeds(batch.commit());
    },
  },
  {
    name: 'admin yalnizca gecerli istemci kriz uyarisi semasini olusturabilir',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();
      await assertSucceeds(
        setDoc(doc(db, 'adminUyarilari/gecerliIstemciUyarisi'), {
          tip: 'planOlusturulamadi',
          mesaj: 'Belirli bir gün için uygun görevli bulunamadı.',
          tarih: '2026-11-02',
          vakit: null,
          cozuldu: false,
          olusturmaTarihi: serverTimestamp(),
        })
      );
      await assertSucceeds(
        setDoc(doc(db, 'adminUyarilari/gecerliVakitUyarisi'), {
          tip: 'zincirTukendi',
          mesaj: 'Belirli bir vakit için görev zinciri tükendi.',
          tarih: '2026-11-02',
          vakit: 'ogle',
          cozuldu: false,
          olusturmaTarihi: serverTimestamp(),
        })
      );

      await assertFails(
        setDoc(doc(db, 'adminUyarilari/sunucuTipiTaklidi'), {
          tip: 'kotaUyarisi',
          mesaj: 'İstemci sunucu uyarısı üretmeye çalışıyor.',
          tarih: '2026-11-02',
          vakit: null,
          cozuldu: false,
          olusturmaTarihi: serverTimestamp(),
        })
      );

      await assertFails(
        setDoc(doc(db, 'adminUyarilari/semaDisiAlan'), {
          tip: 'zincirTukendi',
          mesaj: 'Geçerli görünen ama fazladan alan taşıyan uyarı.',
          tarih: '2026-11-02',
          vakit: 'ogle',
          cozuldu: false,
          olusturmaTarihi: serverTimestamp(),
          gizliAlan: true,
        })
      );
    },
  },
  {
    name: 'admin kriz uyarisinin icerigini keyfi degistiremez',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'adminUyarilari/degistirilemezAlarm'), {
          tip: 'zincirTukendi',
          mesaj: 'Orijinal alarm.',
          tarih: '2026-11-02',
          vakit: 'ogle',
          cozuldu: false,
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const db = testUser(env, 'admin').firestore();
      await assertFails(updateDoc(doc(db, 'adminUyarilari/degistirilemezAlarm'), { mesaj: 'Manipüle edildi.' }));
    },
  },
  {
    name: 'kriz uyarilarini yalnizca super-admin silebilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'config/bootstrap'), { superAdminEmails: ['superadmin@example.test'] });
        await setDoc(doc(db, 'adminUyarilari/silinecekAlarm'), {
          tip: 'otomasyonHatasi',
          mesaj: 'Sunucu kaynaklı alarm.',
          cozuldu: false,
          olusturmaTarihi: Timestamp.now(),
        });
      });

      const adminDb = testUser(env, 'admin').firestore();
      await assertFails(deleteDoc(doc(adminDb, 'adminUyarilari/silinecekAlarm')));

      const superDb = testUser(env, 'superadmin').firestore();
      await assertSucceeds(deleteDoc(doc(superDb, 'adminUyarilari/silinecekAlarm')));
    },
  },
  {
    name: 'admin vakit onbellegini sadece gecerli sema ile yazabilir',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();

      await assertSucceeds(
        setDoc(doc(db, 'vakitler/9148_2026-05'), {
          ilceId: '9148',
          gunler: validVakitGunleri(),
          kaynakApi: 'diyanet',
          guncellenmeTarihi: Timestamp.now(),
        })
      );

      await assertFails(
        setDoc(doc(db, 'vakitler/9148_2026-06'), {
          ilceId: '9148',
          gunler: {},
          kaynakApi: 'bilinmeyen',
          guncellenmeTarihi: Timestamp.now(),
        })
      );

      await assertFails(
        setDoc(doc(db, 'vakitler/9999_2026-06'), {
          ilceId: '9148',
          gunler: validVakitGunleri(),
          kaynakApi: 'diyanet',
          guncellenmeTarihi: Timestamp.now(),
        })
      );

      await assertFails(
        setDoc(doc(db, 'vakitler/9148_2026-13'), {
          ilceId: '9148',
          gunler: validVakitGunleri(),
          kaynakApi: 'diyanet',
          guncellenmeTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    // Resmi Diyanet API'si (bkz. scripts/lib/diyanetResmiApi.ts) 'diyanet'
    // (emushaf.net proxy'si) yerine ayirt edici 'diyanet-resmi' degeriyle
    // yaziyor — uc kaynagin da (diyanet/diyanet-resmi/aladhan) semaya kabul
    // edildigini dogrular.
    name: 'admin vakit onbellegine diyanet-resmi kaynagiyla da yazabilir',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();

      await assertSucceeds(
        setDoc(doc(db, 'vakitler/9148_2026-08'), {
          ilceId: '9148',
          gunler: validVakitGunleri(),
          kaynakApi: 'diyanet-resmi',
          guncellenmeTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    // aylikVakitleriGrupla, API'nin kayan penceresini gerçek takvim ayına göre
    // böldüğünden içinde bulunulan ay için kasıtlı olarak PARTIAL bir grup
    // üretir (ayın ortasında senkronize edilirse o ay yalnızca kalan günleri
    // içerir) — alt sınır bunu artık reddetmemeli (bkz. mantık denetimi).
    name: 'admin vakit onbellegine ayin kismi (partial) gununu de yazabilir',
    run: async (env) => {
      const db = testUser(env, 'admin').firestore();

      await assertSucceeds(
        setDoc(doc(db, 'vakitler/9148_2026-07'), {
          ilceId: '9148',
          gunler: {
            '2026-07-28': { sabah: '04:10', gunes: '05:42', ogle: '12:45', ikindi: '16:30', aksam: '19:51', yatsi: '21:18' },
            '2026-07-29': { sabah: '04:10', gunes: '05:42', ogle: '12:45', ikindi: '16:30', aksam: '19:51', yatsi: '21:18' },
            '2026-07-30': { sabah: '04:10', gunes: '05:42', ogle: '12:45', ikindi: '16:30', aksam: '19:51', yatsi: '21:18' },
          },
          kaynakApi: 'diyanet',
          guncellenmeTarihi: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'giris yapan kullanici kendi denetim kaydini olusturabilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();

      await assertSucceeds(
        setDoc(doc(db, 'audit_logs/userAudit'), {
          actionType: 'Vekalet Kabul',
          targetName: '2026-05-22 ogle',
          details: 'Kullanici kendisine gelen vekalet talebini kabul etti.',
          userId: 'muezzin1',
          userDisplayName: 'Muezzin One',
          timestamp: serverTimestamp(),
        })
      );
    },
  },
  {
    name: 'denetim kaydinda istemci tarafli sahte zaman damgasi reddedilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(
        setDoc(doc(db, 'audit_logs/forgedTime'), {
          actionType: 'Vekalet Kabul',
          targetName: '2026-05-22 ogle',
          details: 'Gecmise tasinmis kayit.',
          userId: 'muezzin1',
          userDisplayName: 'Muezzin One',
          timestamp: Timestamp.fromDate(new Date('2020-01-01T00:00:00Z')),
        })
      );
    },
  },
  {
    name: 'kullanici baskasi adina denetim kaydi olusturamaz',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();

      await assertFails(
        setDoc(doc(db, 'audit_logs/forgedAudit'), {
          actionType: 'Sahte Kayit',
          targetName: 'Admin',
          details: 'Baska kullanici adina audit yazma denemesi.',
          userId: 'admin',
          userDisplayName: 'Admin',
          timestamp: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'denetim kayitlari sonradan degistirilemez ve sadece admin listeleyebilir',
    run: async (env) => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'audit_logs/existingAudit'), {
          actionType: 'Personel Daveti',
          targetName: 'valid@example.test',
          details: 'Davet olusturuldu.',
          userId: 'admin',
          userDisplayName: 'Admin',
          timestamp: Timestamp.now(),
        });
      });

      const adminDb = testUser(env, 'admin').firestore();
      const muezzinDb = testUser(env, 'muezzin1').firestore();

      await assertSucceeds(getDocs(query(collection(adminDb, 'audit_logs'), orderBy('timestamp', 'desc'), limit(30))));
      await assertFails(getDocs(query(collection(muezzinDb, 'audit_logs'), orderBy('timestamp', 'desc'), limit(30))));
      await assertFails(
        updateDoc(doc(adminDb, 'audit_logs/existingAudit'), {
          details: 'Degistirildi.',
        })
      );
      await assertFails(deleteDoc(doc(adminDb, 'audit_logs/existingAudit')));
    },
  },
  {
    name: 'K6: gecerli semali error_log olusturulabilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(
        setDoc(doc(db, 'error_logs/validLog'), {
          errorMessage: 'Test hatasi',
          errorStack: 'Error: Test hatasi\n  at test.ts:1:1',
          componentStack: '',
          userId: 'muezzin1',
          device: { os: 'Test', browser: 'Test', screenSize: '1x1', pwaMode: false, language: 'tr' },
          breadcrumbs: Array.from({ length: 5 }, (_, index) => ({
            action: `Sayfa Geçişi ${index}`,
            category: 'navigation',
            dataSummary: '{"page":"Profil"}',
            timestamp: 123 + index,
            wallTime: '2026-10-31T12:00:00.000Z',
          })),
          stateSnapshot: { authUid: 'muezzin1' },
          timestamp: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'K6: asiri buyuk error_log reddedilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(
        setDoc(doc(db, 'error_logs/tooBig'), {
          errorMessage: 'x'.repeat(3000),
          errorStack: '',
          componentStack: '',
          userId: 'muezzin1',
          device: {},
          breadcrumbs: [],
          stateSnapshot: {},
          timestamp: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'K6: error_log cihaz ve durum haritalarina sema disi veri eklenemez',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      const temel = {
        errorMessage: 'Test',
        errorStack: '',
        componentStack: '',
        userId: 'muezzin1',
        breadcrumbs: [],
        timestamp: Timestamp.now(),
      };

      await assertFails(
        setDoc(doc(db, 'error_logs/oversizedDevice'), {
          ...temel,
          device: { os: 'Test', rawUserAgent: 'x'.repeat(10000) },
          stateSnapshot: {},
        })
      );
      await assertFails(
        setDoc(doc(db, 'error_logs/oversizedState'), {
          ...temel,
          device: {},
          stateSnapshot: { arbitraryStoreDump: { payload: 'x'.repeat(10000) } },
        })
      );
      await assertFails(
        setDoc(doc(db, 'error_logs/arbitraryBreadcrumb'), {
          ...temel,
          device: {},
          stateSnapshot: {},
          breadcrumbs: [
            {
              action: 'Test',
              category: 'system',
              data: { arbitraryPayload: 'x'.repeat(10000) },
              timestamp: 123,
              wallTime: '2026-10-31T12:00:00.000Z',
            },
          ],
        })
      );
      await assertFails(
        setDoc(doc(db, 'error_logs/oversizedBreadcrumbSummary'), {
          ...temel,
          device: {},
          stateSnapshot: {},
          breadcrumbs: [
            {
              action: 'Test',
              category: 'system',
              dataSummary: 'x'.repeat(501),
              timestamp: 123,
              wallTime: '2026-10-31T12:00:00.000Z',
            },
          ],
        })
      );
    },
  },
  {
    name: 'K6: baskasi adina error_log olusturulamaz',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(
        setDoc(doc(db, 'error_logs/forged'), {
          errorMessage: 'Test',
          errorStack: '',
          componentStack: '',
          userId: 'muezzin2',
          device: {},
          breadcrumbs: [],
          stateSnapshot: {},
          timestamp: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'K6: gecerli semali telemetry_log olusturulabilir',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertSucceeds(
        setDoc(doc(db, 'telemetry_logs/validEvent'), {
          eventType: 'page_view',
          eventName: '/profil',
          userId: 'muezzin1',
          metadata: { device: { os: 'Test' } },
          timestamp: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'K6: gecersiz eventType ile telemetry_log olusturulamaz',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(
        setDoc(doc(db, 'telemetry_logs/invalidType'), {
          eventType: 'gecersiz_tip',
          eventName: '/profil',
          userId: 'muezzin1',
          metadata: {},
          timestamp: Timestamp.now(),
        })
      );
    },
  },
  {
    name: 'K6: telemetry metadata sema disi veya sinirsiz ic ice veri kabul etmez',
    run: async (env) => {
      const db = testUser(env, 'muezzin1').firestore();
      await assertFails(
        setDoc(doc(db, 'telemetry_logs/arbitraryMetadata'), {
          eventType: 'click',
          eventName: 'test',
          userId: 'muezzin1',
          metadata: { arbitraryPayload: { nested: 'x'.repeat(10000) } },
          timestamp: Timestamp.now(),
        })
      );
      await assertFails(
        setDoc(doc(db, 'telemetry_logs/arbitraryDevice'), {
          eventType: 'click',
          eventName: 'test',
          userId: 'muezzin1',
          metadata: { device: { rawUserAgent: 'x'.repeat(10000) } },
          timestamp: Timestamp.now(),
        })
      );
    },
  },
];
