importScripts('https://www.gstatic.com/firebasejs/12.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  "apiKey": "AIzaSyBLuax0dOUhoRi3b8YKKpTNydFaJMq_aPc",
  "authDomain": "ezanmerkezi.firebaseapp.com",
  "databaseURL": "https://ezanmerkezi-default-rtdb.europe-west1.firebasedatabase.app",
  "projectId": "ezanmerkezi",
  "storageBucket": "ezanmerkezi.firebasestorage.app",
  "messagingSenderId": "905285951417",
  "appId": "1:905285951417:web:7649fc246f5c8c92402068"
});

const messaging = firebase.messaging();

/**
 * Notification API'sinin `tag` alanı bir KİMLİKTİR: aynı tag ile gösterilen
 * iki bildirim işletim sistemi tepsisinde yan yana DURMAZ, ikincisi
 * birincinin YERİNE geçer. Bu bazen istenir (aynı varlığın güncellenmesi /
 * bir gönderimin tekrar denenmesi), farklı varlıklar için ise sessiz veri
 * kaybıdır.
 *
 * KÖK NEDEN: tag daha önce `data.bildirimId || 'muezzin-task-notification'`
 * ile hesaplanıyordu. Bugün FCM push üreten DÖRT yolun (bkz. aşağıdaki
 * tablo) HİÇBİRİ payload'a `bildirimId` koymuyor — duyuru `duyuruId`, izin
 * `izinId`, günlük hatırlatma `tarih` gönderiyor, haftalık plan ise hiç
 * kimlik göndermiyor. Yani `data.bildirimId` HER ZAMAN undefined kalıyor ve
 * gelen her bildirim aynı `'muezzin-task-notification'` etiketine düşüyordu:
 * arka arkaya yayınlanan iki farklı duyuru (ya da bir duyuru + bir izin
 * kararı) tepside birbirini eziyor, kullanıcı ilkini hiç görmüyordu.
 *
 * ÇÖZÜM: her bildirim TÜRÜ, konusu olan varlığı tekil olarak tanımlayan bir
 * etiket alır. Farklı varlıklar asla çakışmaz; AYNI varlığın yeniden
 * gönderimi (cron retry, karar güncellemesi) hâlâ eskisinin yerine geçer —
 * bu yüzden `Date.now()` gibi her seferinde değişen bir etiket KULLANILMAZ,
 * o hem meşru "aynı bildirimi tazele" davranışını bozar hem de tekrar
 * denemelerde tepsiyi kopyalarla doldurur.
 *
 * `onEk`: etiket ön eki. `alan`: `payload.data` içinde varlığı tanımlayan
 * alanın adı; `null` ise o tür KASITLI olarak tek bir etikette toplanır.
 */
const BILDIRIM_ETIKET_TANIMLARI = {
  // scripts/duyuruBildirimGonder.ts — her duyuru ayrı bir varlıktır.
  duyuru_yayinlandi: { onEk: 'duyuru', alan: 'duyuruId' },
  // scripts/izinDurumBildirimGonder.ts — her izin talebi ayrı bir varlıktır.
  izin_durumu: { onEk: 'izin', alan: 'izinId' },
  // scripts/yatsiSonuIslemleri.ts — "yarınki görevin" bildirimi. Kimlik
  // GÜNdür: aynı gün için tekrar gönderim eskisini tazeler (istenen),
  // farklı günler birbirini ezmez.
  daily_duty_reminder: { onEk: 'gorev-hatirlatma', alan: 'tarih' },
  // scripts/haftalikPlanOlustur.ts — payload'da kimlik yok ve gerek de yok:
  // "yeni plan yayınlandı" duyurusunun yalnızca EN GÜNCELİ anlamlıdır,
  // eskisinin yerine geçmesi KASITLIDIR.
  weekly_plan_published: { onEk: 'haftalik-plan', alan: null },
  // Görev/nöbet bildirimleri (aşağıdaki `actions` dalı ve notificationclick
  // yolu bunları bekler): kimlik `bildirimler/{id}` belgesidir.
  asil: { onEk: 'bildirim', alan: 'bildirimId' },
  yedek: { onEk: 'bildirim', alan: 'bildirimId' },
  gorev_cagrisi: { onEk: 'bildirim', alan: 'bildirimId' }
};

/** Boş/boşluk-dolu olmayan bir dizge ise kırpılmış hâlini, değilse null. */
function dolguluDizge(deger) {
  return typeof deger === 'string' && deger.trim().length > 0 ? deger.trim() : null;
}

/**
 * İÇERİK imzası (FNV-1a 32-bit). Yalnızca yukarıdaki tabloda tanımlı
 * OLMAYAN (ileride eklenecek ya da bozuk) bir tür için son çare olarak
 * kullanılır: içeriği farklı olan iki bildirim farklı etiket alır (yani
 * birbirini ezmez), BİREBİR aynı bildirim ise aynı etiketi alır (yani
 * tekrar gönderim yine tazeler). Rastgele/zaman tabanlı bir etiketin
 * aksine bu iki özelliği de korur; tabloya kayıt eklemeyi unutan gelecekteki
 * bir bildirim türü de böylece eski hataya geri düşmez.
 */
function icerikImzasi(parcalar) {
  // Parcalar UZUNLUK ONEKLI birlestirilir: aksi halde farkli bolunmus ama
  // yan yana ayni metni veren iki bildirim ("ab"+"c" ile "a"+"bc") ayni
  // imzayi alirdi.
  const metin = parcalar.map((p) => { const s = dolguluDizge(p) || ''; return s.length + ':' + s; }).join('');
  let h = 0x811c9dc5;
  for (let i = 0; i < metin.length; i++) {
    h ^= metin.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * SAF fonksiyon: FCM payload'ından gösterilecek bildirimin `tag` değerini
 * üretir. Service worker'lar Vite'ın modül pipeline'ından geçmediği (public/
 * olduğu gibi kopyalanır, bkz. scripts/verify-sw-config.ts) için bu mantık
 * ayrı bir modüle çıkarılamaz; bunun yerine yan etkisiz tutuldu ve
 * tests/unit/bildirimEtiketi.test.ts bu dosyayı kaynak olarak yükleyip
 * doğrudan test ediyor.
 *
 * DÖNÜŞ HER ZAMAN boş olmayan bir dizgedir — `renotify: true` yalnızca bir
 * tag ile birlikte geçerlidir, boş tag `showNotification`'ı fırlattırır.
 */
function bildirimEtiketiUret(data, baslik, govde) {
  const tanim = BILDIRIM_ETIKET_TANIMLARI[data.type];

  if (tanim) {
    if (tanim.alan === null) return tanim.onEk;
    const kimlik = dolguluDizge(data[tanim.alan]);
    if (kimlik) return `${tanim.onEk}-${kimlik}`;
    // Beklenen kimlik alanı eksik (bozuk gönderim): aşağıdaki son çareye
    // düşülür — tür başına TEK bir etikete düşmek, tam da düzeltilen
    // hatanın kendisi olurdu.
  }

  const bildirimId = dolguluDizge(data.bildirimId);
  if (bildirimId) return `bildirim-${bildirimId}`;

  return `muezzin-${icerikImzasi([data.type, baslik, govde])}`;
}

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);

  const data = payload.data || {};
  const notificationTitle = payload.notification?.title || data.title || 'Yeni Bildirim';
  const notificationBody = payload.notification?.body || data.body || '';
  const actions = [];

  if (data.type === 'asil' || data.type === 'gorev_cagrisi') {
    actions.push({ action: 'onayla', title: 'Gorevi Onayla' });
    actions.push({ action: 'mazeret', title: 'Mazeret Bildir' });
  }

  self.registration.showNotification(notificationTitle, {
    body: notificationBody,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    vibrate: [100, 50, 100, 50, 200],
    data: {
      bildirimId: data.bildirimId,
      uid: data.uid,
      type: data.type
    },
    actions,
    tag: bildirimEtiketiUret(data, notificationTitle, notificationBody),
    renotify: true
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const action = event.action || 'open';
  const data = event.notification.data || {};
  const url = data.bildirimId
    ? `/?notificationAction=${encodeURIComponent(action)}&bildirimId=${encodeURIComponent(data.bildirimId)}`
    : '/';

  // Keep writes inside the app where Firebase Auth, vakit validation, and
  // Firestore rules are already enforced by the same code path.
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if ('focus' in client) {
          if ('navigate' in client) {
            return client.navigate(url).then((navigatedClient) => {
              return navigatedClient ? navigatedClient.focus() : client.focus();
            });
          }
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
