import { db, Timestamp } from './lib/firebaseAdminInit.ts';
import { getTurkeyDateString, getTurkeyNow } from '../src/lib/dateUtils.ts';
import type { DocumentReference } from 'firebase-admin/firestore';

type BildirimData = {
  haftaId: string;
  tarih: string;
  vakit: string;
  uid: string;
  tip: 'asil' | 'yedek' | 'gorev_cagrisi';
  durum: string;
  devirSonucu?: 'yedek_atandi' | 'alarm_bekliyor' | 'alarm_uretildi';
  mazeretPlanSenkronEdildi?: boolean;
};

type MuezzinData = {
  role?: string;
  aktif?: boolean;
};

/**
 * NOT ("1000 ifade tavanı" kök neden çözümü — bkz. firestore.rules
 * `isSelfBildirimUpdateIcin` yorumu): `devirSonucu === 'yedek_atandi'` dalı
 * eskiden yalnızca `src/services/mazeretServisi.ts`'in İSTEMCİDE ZATEN
 * yaptığı yedek-terfisini haftaPlanlari önbelleğine yansıtıyordu — terfinin
 * kendisi, security rules'ta (`isBackupPromotionFromMazeret`) ~27 terimlik
 * bir getAfter() çapraz-doğrulamasıyla, istemcinin AYNI transaction'ında
 * gerçekleşiyordu. O doğrulama emülatörün "istek başına 1000 ifade"
 * bütçesine (en basit yazımda bile) çarpıyordu; kök neden kuralın
 * DERLENMİŞ toplam karmaşıklığıydı. Çözüm: istemci artık yedek belgeye HİÇ
 * dokunmuyor, yalnızca kendi asil belgesine `devirSonucu` İPUCUNU yazıyor;
 * GERÇEK terfi — yedeğin uygunluğunun (role/aktif, yedek belgenin hâlâ
 * uygun durumda olması) TAZE veriyle yeniden doğrulanması dahil — burada,
 * Admin SDK ile (kural bütçesi yok) gerçekleşiyor.
 *
 * Yedek, istemcinin karar anından bu yana (~10-15 dk) artık uygun DEĞİLSE
 * (arşivlendi, kendi belgesi de reddedildi, vb.), terfi uygulanmaz — bu
 * mazeret `alarm_bekliyor`'a düşürülür ve admin uyarısı oluşturulur (aynı
 * yol, `alarmOlustur` ile).
 *
 * İşlenen belge `mazeretPlanSenkronEdildi: true` ile işaretlenir ki bu iş
 * tekrar tekrar aynı kaydı işlemesin (idempotent).
 *
 * NOT: bu bayrak, `vekaletDevirleriniIsle.ts`'in kullandığı
 * `vekaletPlanSenkronEdildi`'den KASITLI OLARAK AYRI bir alandır — ikisi
 * eskiden tek bir paylaşılan `planSenkronEdildi` alanını kullanıyordu. Aynı
 * bildirim belgesi önce bir vekalet devriyle senkronlanıp sonra (yeni
 * sahibi tarafından) mazeretle reddedilirse, paylaşılan bayrak zaten
 * `true` olduğundan bu iş belgeyi "zaten işlenmiş" sanıp tamamen
 * atlıyordu — vakit görevlisiz kalıyor, hiçbir admin uyarısı üretilmiyordu
 * (bkz. mimari denetim Y2). Alanlar ayrıldığından beri her iş yalnızca
 * kendi yaşam döngüsü olayını takip ediyor.
 */

async function alarmVarMi(tarih: string, vakit: string): Promise<boolean> {
  const alarmSnap = await db
    .collection('adminUyarilari')
    .where('tarih', '==', tarih)
    .where('vakit', '==', vakit)
    .where('cozuldu', '==', false)
    .limit(1)
    .get();

  return !alarmSnap.empty;
}

/** `alarm_bekliyor` dalının paylaşılan gövdesi — hem doğrudan hem de
 * yedek-terfi başarısız olduğunda (fallback) çağrılır. */
async function alarmOlustur(mazeret: BildirimData, mazeretRef: DocumentReference): Promise<'alarm_uretildi' | 'atlandi'> {
  const alarmZatenVar = await alarmVarMi(mazeret.tarih, mazeret.vakit);
  if (alarmZatenVar) {
    await mazeretRef.update({ mazeretPlanSenkronEdildi: true, sonGuncelleme: Timestamp.now() });
    return 'atlandi';
  }

  const batch = db.batch();
  batch.set(db.collection('adminUyarilari').doc(), {
    tip: 'zincirTukendi',
    mesaj:
      mazeret.tip === 'yedek'
        ? 'Yedek gorevli mazeret bildirdi; bu vakit icin artik yedek gorevli bulunmuyor. Admin mudahalesi gerekir.'
        : 'Mazeret sonrasi gorevi devralacak uygun yedek bulunamadi. Admin mudahalesi gerekir.',
    tarih: mazeret.tarih,
    vakit: mazeret.vakit,
    cozuldu: false,
    olusturmaTarihi: Timestamp.now(),
  });
  batch.update(mazeretRef, {
    devirSonucu: 'alarm_uretildi',
    mazeretPlanSenkronEdildi: true,
    sonGuncelleme: Timestamp.now(),
  });
  await batch.commit();
  return 'alarm_uretildi';
}

export async function processMazeretDevirleri(dryRun = false) {
  console.log(`Mazeret devirleri uzlaştırılıyor${dryRun ? ' (dry-run)' : ''}...`);

  // NOT: tip filtresi kasıtlı olarak yalnızca 'asil' ile sınırlı değil — yedek
  // görevli de kendi mazeretini bildirebilir (bkz. src/services/mazeretServisi.ts),
  // bu durumda devirSonucu doğrudan 'alarm_bekliyor' olur ve aşağıdaki
  // yedek_atandi dalı hiç tetiklenmez (bir yedeğin yedeği olmadığından).
  //
  // `tarih >= otuzGunOnce` sınırı: bu iş her 10 dakikada bir çalışıyor ve
  // öncesinde `durum == reddedildi` filtresi TEK BAŞINA koleksiyondaki her
  // reddedilmiş mazereti — zaten işlenmiş (mazeretPlanSenkronEdildi: true)
  // olanlar dahil — sınırsızca çekiyordu; koleksiyon yıllar içinde büyüdükçe
  // her çalıştırma neredeyse tamamı gereksiz okuma yapıyordu (bkz. Firebase/
  // GitHub veri akışı denetimi). 30 günlük pencere `temizleGunlukler.ts`'teki
  // RETENTION_DAYS ile aynı — bu işten daha eski bir görev tarihi zaten
  // geçmişte kalmıştır, yeniden uzlaştırılacak bir şey kalmaz.
  const otuzGunOnce = getTurkeyDateString(new Date(getTurkeyNow().getTime() - 30 * 24 * 60 * 60 * 1000));
  const mazeretSnap = await db.collection('bildirimler').where('durum', '==', 'reddedildi').where('tarih', '>=', otuzGunOnce).get();

  const islenecekler = mazeretSnap.docs.filter((docSnap) => {
    const data = docSnap.data() as BildirimData;
    return data.mazeretPlanSenkronEdildi !== true && !!data.devirSonucu;
  });

  let terfiUygulandi = 0;
  let alarmUretildi = 0;
  let atlandi = 0;

  for (const mazeretDoc of islenecekler) {
    const mazeret = mazeretDoc.data() as BildirimData;

    if (mazeret.devirSonucu === 'yedek_atandi') {
      const promotedRef = db.collection('bildirimler').doc(`${mazeret.haftaId}_${mazeret.tarih}_${mazeret.vakit}_yedek`);

      if (dryRun) {
        console.log(`${mazeret.tarih} ${mazeret.vakit}: yedek terfisi uygulanacak (istemcinin ipucu: ${mazeret.uid} -> yedek).`);
        terfiUygulandi++;
        continue;
      }

      let sonuc: 'terfi' | 'fallback-alarm' | 'atlandi' = 'atlandi';

      await db.runTransaction(async (transaction) => {
        const freshMazeret = await transaction.get(mazeretDoc.ref);
        if (!freshMazeret.exists) return;
        const freshMazeretData = freshMazeret.data() as BildirimData;
        if (freshMazeretData.mazeretPlanSenkronEdildi === true) return;

        const freshPromoted = await transaction.get(promotedRef);
        const promotedData = freshPromoted.exists ? (freshPromoted.data() as BildirimData) : null;

        // İstemcinin karar anından bu yana yedeğin uygunluğu TAZE veriyle
        // yeniden doğrulanıyor — istemcinin `devirSonucu: 'yedek_atandi'`
        // ipucusuna GÜVENİLMİYOR (bkz. src/services/mazeretServisi.ts
        // `yedekUygun` hesaplamasıyla AYNI kriterler).
        const yedekBelgeUygun = !!promotedData && promotedData.durum !== 'reddedildi' && promotedData.uid !== mazeret.uid;

        let yedekMuezzin: MuezzinData | null = null;
        if (yedekBelgeUygun) {
          const yedekMuezzinSnap = await transaction.get(db.collection('muezzins').doc(promotedData!.uid));
          yedekMuezzin = yedekMuezzinSnap.exists ? (yedekMuezzinSnap.data() as MuezzinData) : null;
        }

        const atanabilir = yedekBelgeUygun && !!yedekMuezzin && yedekMuezzin.role === 'muezzin' && yedekMuezzin.aktif === true;

        if (atanabilir) {
          transaction.update(promotedRef, {
            tip: 'asil',
            durum: 'bekliyor',
            pendingAck: true,
            asilMazeretUid: mazeret.uid,
            sonGuncelleme: Timestamp.now(),
          });
          transaction.update(db.collection('haftaPlanlari').doc(mazeret.haftaId), {
            [`gunler.${mazeret.tarih}.${mazeret.vakit}.asil`]: promotedData!.uid,
            [`gunler.${mazeret.tarih}.${mazeret.vakit}.yedek`]: 'Sistem',
          });
          transaction.update(mazeretDoc.ref, {
            mazeretPlanSenkronEdildi: true,
            sonGuncelleme: Timestamp.now(),
          });
          sonuc = 'terfi';
        } else {
          // Yedek artık uygun değil — bu mazeret alarm_bekliyor'a düşürülüp
          // (mazeretPlanSenkronEdildi İŞARETLENMEDEN) döngünün alarm
          // dalına devrediliyor.
          transaction.update(mazeretDoc.ref, { devirSonucu: 'alarm_bekliyor', sonGuncelleme: Timestamp.now() });
          sonuc = 'fallback-alarm';
        }
      });

      // NOT: `as` ile açık tip ataması kasıtlı — `sonuc`, kapsayan bir async
      // closure içinde yeniden atanan bir `let` olduğundan TypeScript'in
      // kontrol akışı analizi burada değeri yanlışlıkla ilk atamaya
      // daraltıyor (bilinen bir TS closure-narrowing sınırlaması — bkz.
      // src/services/vekaletServisi.ts'teki AYNI desen). Açık cast bu
      // zinciri kırar.
      const finalSonuc = sonuc as 'terfi' | 'fallback-alarm' | 'atlandi';
      if (finalSonuc === 'terfi') {
        console.log(
          `${mazeret.tarih} ${mazeret.vakit}: yedek terfisi + haftaPlanlari senkronu uygulandı (${mazeret.uid} -> yedek terfisi).`
        );
        terfiUygulandi++;
        continue;
      }
      if (finalSonuc === 'fallback-alarm') {
        console.log(`${mazeret.tarih} ${mazeret.vakit}: yedek artık uygun değil, alarm_bekliyor'a düşürüldü.`);
        const alarmSonucu = await alarmOlustur({ ...mazeret, devirSonucu: 'alarm_bekliyor' }, mazeretDoc.ref);
        if (alarmSonucu === 'alarm_uretildi') alarmUretildi++;
        else atlandi++;
        continue;
      }
      continue;
    }

    if (mazeret.devirSonucu === 'alarm_bekliyor') {
      if (dryRun) {
        console.log(`${mazeret.tarih} ${mazeret.vakit}: admin alarmi olusturulacak.`);
        alarmUretildi++;
        continue;
      }
      const alarmSonucu = await alarmOlustur(mazeret, mazeretDoc.ref);
      if (alarmSonucu === 'alarm_uretildi') {
        console.log(`${mazeret.tarih} ${mazeret.vakit}: uygun yedek yok, admin alarmi olusturuldu.`);
        alarmUretildi++;
      } else {
        console.log(`${mazeret.tarih} ${mazeret.vakit}: aktif alarm zaten var, atlandi.`);
        atlandi++;
      }
      continue;
    }

    // devirSonucu === 'alarm_uretildi' (önceki bir çalıştırmada zaten işlenmiş): sadece işaretle.
    if (!dryRun) {
      await mazeretDoc.ref.update({ mazeretPlanSenkronEdildi: true, sonGuncelleme: Timestamp.now() });
    }
  }

  console.log(`Tamamlandi. terfiUygulandi=${terfiUygulandi}, alarmUretildi=${alarmUretildi}, atlandi=${atlandi}`);
}

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  const isDryRun = process.argv.includes('--dry-run');
  processMazeretDevirleri(isDryRun).catch((err) => {
    console.error('Mazeret devirleri islenemedi:', err);
    process.exit(1);
  });
}
