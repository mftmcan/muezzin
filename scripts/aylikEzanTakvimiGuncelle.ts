import { db, Timestamp } from './lib/firebaseAdminInit.ts';
import { aylikVakitleriGrupla, type AylikVakitGrubu } from '../src/services/ezanVaktiServisi.ts';
import { vakitleriCekOncelikli } from './lib/diyanetResmiApi.ts';
import { getTurkeyNow, getTurkeyDateString } from '../src/lib/dateUtils.ts';
import { handleFirestoreError, OperationType } from './lib/errors.ts';

async function main() {
  const simdi = getTurkeyNow();

  try {
    // Uygulamanın gerçekten okuduğu ilçe hangisiyse veriyi ona göre çek ve
    // doküman ID'sini de aynı şekilde ilçe önekiyle yaz — aksi halde
    // (bkz. src/store/useVakitStore.ts `${ilceId}_${YYYY-MM}`) uygulama bu
    // güncellemeyi hiç görmez ve eski veri üzerinde donar.
    const settingsSnap = await db.collection('settings').doc('system').get();
    const settings = settingsSnap.data() as { ilceId?: string; ilceAdi?: string } | undefined;
    const ilceId = settings?.ilceId || '9148';
    const ilceAdi = settings?.ilceAdi || 'Ceyhan';

    // Resmi Diyanet API başarılı olduğunda zaten yaklaşık 30-32 günlük
    // kayan bir pencere döner (mevcut günden itibaren, doğal olarak bir
    // sonraki aya taşar). Ama başarısız olup (kimlik bilgisi yok/kota/ağ
    // hatası) mevcut public zincire (emushaf/Aladhan) düştüğümüzde,
    // Aladhan'ın calendarByCity uç noktası istenen (yil, ay) ile KESİN
    // olarak sınırlıdır — bir sonraki ayı asla döndürmez. Bu cron ayın
    // 28'inde çalışıp bir sonraki ayı ÖNDEN hazırlamak için var, o yüzden
    // bu ayı ve bir sonraki ayı ayrı ayrı isteyip birleştiriyoruz; aksi
    // halde fallback zincirine düşüldüğünde bir sonraki ay hiç yazılmaz
    // (bkz. 2026-08-28/29 canlı arızası: Eylül verisi bu adım tek bir aya
    // kilitliyken hiç yazılamamıştı).
    const buAy = { yil: simdi.getFullYear(), ay: simdi.getMonth() + 1 };
    const sonrakiAyTarihi = new Date(simdi);
    sonrakiAyTarihi.setDate(1);
    sonrakiAyTarihi.setMonth(sonrakiAyTarihi.getMonth() + 1);
    const sonrakiAy = { yil: sonrakiAyTarihi.getFullYear(), ay: sonrakiAyTarihi.getMonth() + 1 };

    const aylar: Record<string, AylikVakitGrubu> = {};

    const buAyVakitData = await vakitleriCekOncelikli(buAy.yil, buAy.ay, ilceId, ilceAdi);
    // Verileri aylara göre grupla (bkz. src/services/ezanVaktiServisi.ts
    // aylikVakitleriGrupla — istemci senkronuyla paylaşılan tek gruplama
    // mantığı, mimari denetim O5).
    Object.assign(aylar, aylikVakitleriGrupla(buAyVakitData));

    // Resmi API başarılıysa yukarıdaki çağrı zaten ~30-32 günlük kayan bir
    // pencere döndürür — ayın sonlarına doğru çalıştığında bu pencere
    // DOĞAL OLARAK bir sonraki ayı da kapsar. Bu durumda ikinci bir resmi
    // API çağrısı yapmak (a) aynı veriyi tekrar ister, (b) aylık kotayı
    // (AYLIK_ISTEK_LIMITI) gereksiz yere iki katına çıkarır — birkaç manuel
    // deneme kotayı tüketebiliyordu (premium hata analizi FR-O6). Sadece
    // ilk çağrının sonucu bir sonraki ayı KAPSAMIYORSA (fallback zincirine
    // düşüldü — o zincir istenen aya kesin sınırlı — ya da pencere henüz o
    // kadar ileri gitmiyor) ikinci bir istek yapılır.
    const sonrakiAyId = `${sonrakiAy.yil}-${String(sonrakiAy.ay).padStart(2, '0')}`;
    if (!aylar[sonrakiAyId]) {
      const sonrakiAyVakitData = await vakitleriCekOncelikli(sonrakiAy.yil, sonrakiAy.ay, ilceId, ilceAdi);
      Object.assign(aylar, aylikVakitleriGrupla(sonrakiAyVakitData));
    }

    // Gruplanmış verileri Firestore'a yaz
    for (const [ayId, data] of Object.entries(aylar)) {
      const docId = `${ilceId}_${ayId}`;
      await db
        .collection('vakitler')
        .doc(docId)
        .set(
          {
            ...data,
            guncellenmeTarihi: Timestamp.now(),
          },
          { merge: true }
        );
      console.log(`Başarılı: ${docId} (${Object.keys(data.gunler).length} gün güncellendi)`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // NOT: burada önceden Firestore-izin/not-found hatası tespit edilince
    // `handleFirestoreError` çağrılıyordu — o fonksiyon HER ZAMAN fırlatır
    // (dönüş tipi `never`), bu yüzden altındaki admin uyarısı yazımı bu
    // durumda HİÇ çalışmıyordu; tam da en ciddi hata sınıfının (izin/
    // not-found) admin panelinde görünmeyen tür olması riski vardı (bkz.
    // kod denetimi). Yalnızca ek yapılandırılmış konsol logu için çağrılır,
    // fırlatması yutulur — admin uyarısı koşulsuz olarak aşağıda yazılır.
    const isFirestoreHatasi =
      message.includes('permission') || message.includes('NOT_FOUND') || message.includes('code: 5') || message.includes('code: 7');
    if (isFirestoreHatasi) {
      try {
        handleFirestoreError(err, OperationType.WRITE, `vakitler`);
      } catch {
        /* handleFirestoreError zaten fırlatır — yalnızca yapılandırılmış log için çağrıldı */
      }
    }

    console.error(`Hata:`, message);
    await db.collection('adminUyarilari').add({
      tip: 'apiHatasi',
      mesaj: `Vakit güncelleme hatası: ${message}`,
      // AdminUyarisi.tarih/vakit zorunlu alanlar — önceden hiç yazılmıyordu.
      // Bu uyarı gün/vakte özgü değil (aylık cron'un genel başarısızlığı),
      // bu yüzden çalışma günü + null vakit yazılır (bkz. yatsiSonuIslemleri.ts
      // aynı desen).
      tarih: getTurkeyDateString(simdi),
      vakit: null,
      cozuldu: false,
      olusturmaTarihi: Timestamp.now(),
    });
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Kritik hata:', err);
  process.exit(1);
});
