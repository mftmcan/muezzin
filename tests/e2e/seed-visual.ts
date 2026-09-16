/**
 * `visual.spec.ts` için tek amaçlı seed: 1 admin + 1 müezzin, GERÇEK "bugün"e
 * ait bir vakit tablosu, cari haftanın birkaç slotuna atama, ve müezzine ait
 * birkaç `bildirimler` kaydı — böylece ana ekran/haftalık takvim/profil BOŞ
 * kabuk değil GERÇEK içerikle render olur (görsel regresyonun tespit edeceği
 * yüzey alanı arttırılır).
 *
 * SABIT_TARIH `gorselSabitTarih.ts`'teki TEK, gerçek-olmayan sabit güne
 * yazılır — `visual.spec.ts`'teki `saatiSabitle()` de SAATİ (Türkiye
 * saatiyle 11:00) dondururken AYNI sabit günü kullanır, ikisi birbirine
 * bağımlı (bkz. o dosyanın gerekçesi — önceden ikisi de GERÇEK "bugün"e
 * bağlıydı, bu yüzden baseline her gerçek takvim günü ilerledikçe
 * bayatlıyordu). Saat `page.clock.setFixedTime` ile deterministik (bkz.
 * visual.spec.ts dosya başı yorumu — `pauseAt` denenip Firebase'in
 * zamanlayıcılarını kırdığı için terk edilmişti, `setFixedTime` yalnızca
 * Date'i sabitler).
 * Diğer e2e testlerinden İZOLE: kendi `_e2e_visual_` uid önekini ve kendi
 * hafta/gün verisini kullanır, paylaşılan koleksiyonlara sadece kendi
 * doc id'leriyle yazar (bkz. playwright.config.ts'teki paylaşılan emülatör
 * izolasyon notu).
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { startOfWeek, format } from 'date-fns';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };
import { GORSEL_SABIT_TARIH } from './gorselSabitTarih.ts';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

const app = getApps().length ? getApps()[0]! : initializeApp({ projectId: firebaseConfig.projectId });
const db = getFirestore(app);
const auth = getAuth(app);

export const SABIT_TARIH = GORSEL_SABIT_TARIH;

const ADMIN_UID = 'muezzin_e2e_visual_admin';
const MUEZZIN_UID = 'muezzin_e2e_visual_muezzin';
const ASIL_UID = 'muezzin_e2e_visual_asil';
const YEDEK_UID = 'muezzin_e2e_visual_yedek';
const ILCE_ID = '9148';

type Vakit = 'sabah' | 'ogle' | 'ikindi' | 'aksam' | 'yatsi';

function haftaIdFromDate(dateStr: string): string {
  const pazartesi = startOfWeek(new Date(`${dateStr}T00:00:00`), { weekStartsOn: 1 });
  return `W${format(pazartesi, 'yyyy-MM-dd')}`;
}

async function ensureUser(uid: string, displayName: string, role: 'admin' | 'muezzin') {
  try {
    await auth.deleteUser(uid);
  } catch {
    /* yoktu, sorun değil */
  }
  await auth.createUser({ uid, email: `${uid}@example.test`, displayName, emailVerified: true });
  await db
    .collection('muezzins')
    .doc(uid)
    .set({
      displayName,
      email: `${uid}@example.test`,
      role,
      aktif: true,
      photoURL: '',
      fcmToken: null,
      aylikVakitSayisi: 8,
      yillikIzinKullanilanGun: 2,
    });
}

async function seed() {
  await ensureUser(ADMIN_UID, 'Görsel QA Admin', 'admin');
  await ensureUser(MUEZZIN_UID, 'Ahmet Yılmaz', 'muezzin');
  await ensureUser(ASIL_UID, 'Mehmet Demir', 'muezzin');
  await ensureUser(YEDEK_UID, 'Ali Kaya', 'muezzin');

  await db.collection('settings').doc('system').set({ ilceId: ILCE_ID, ilceAdi: 'Ceyhan' }, { merge: true });

  await db
    .collection('vakitler')
    .doc(`${ILCE_ID}_${SABIT_TARIH.slice(0, 7)}`)
    .set(
      {
        gunler: {
          [SABIT_TARIH]: {
            imsak: '04:35',
            sabah: '05:05',
            gunes: '06:30',
            ogle: '13:02',
            ikindi: '16:38',
            aksam: '19:42',
            yatsi: '21:05',
          },
        },
      },
      { merge: true }
    );

  const haftaId = haftaIdFromDate(SABIT_TARIH);
  const gunlerObj: Record<string, Record<string, { asil: string; yedek: string }>> = {
    [SABIT_TARIH]: {
      sabah: { asil: ASIL_UID, yedek: YEDEK_UID },
      ogle: { asil: MUEZZIN_UID, yedek: YEDEK_UID },
      ikindi: { asil: ASIL_UID, yedek: MUEZZIN_UID },
      aksam: { asil: MUEZZIN_UID, yedek: ASIL_UID },
      yatsi: { asil: YEDEK_UID, yedek: ASIL_UID },
    },
  };
  await db
    .collection('haftaPlanlari')
    .doc(haftaId)
    .set({
      haftaBaslangic: format(startOfWeek(new Date(`${SABIT_TARIH}T00:00:00`), { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      haftaBitis: SABIT_TARIH,
      durum: 'yayinda',
      olusturmaTarihi: Timestamp.now(),
      sonGuncelleme: Timestamp.now(),
      gunler: gunlerObj,
    });

  const bildirimKaydi = (vakit: Vakit, tip: 'asil' | 'yedek', uid: string, durum: string) =>
    db
      .collection('bildirimler')
      .doc(`${haftaId}_${SABIT_TARIH}_${vakit}_${tip}`)
      .set({
        haftaId,
        tarih: SABIT_TARIH,
        vakit,
        uid,
        tip,
        durum,
        pendingAck: durum === 'bekliyor',
        retSebebi: null,
        olusturmaTarihi: Timestamp.now(),
        sonGuncelleme: Timestamp.now(),
      });

  await bildirimKaydi('ogle', 'asil', MUEZZIN_UID, 'onaylandi');
  await bildirimKaydi('ikindi', 'yedek', MUEZZIN_UID, 'bekliyor');
  await bildirimKaydi('aksam', 'asil', MUEZZIN_UID, 'bekliyor');

  return {
    tokenAdmin: await auth.createCustomToken(ADMIN_UID),
    tokenMuezzin: await auth.createCustomToken(MUEZZIN_UID),
  };
}

seed()
  .then((tokens) => {
    console.log(JSON.stringify(tokens));
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
