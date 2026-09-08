import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * `public/firebase-messaging-sw.js`'in ETİKET (Notification `tag`) mantığının
 * birim testleri.
 *
 * Neden dosya kaynak olarak yükleniyor: service worker'lar Vite'ın modül
 * pipeline'ından geçmez (public/ olduğu gibi kopyalanır), bu yüzden etiket
 * mantığı import edilebilir bir modüle çıkarılamaz — `scripts/verify-sw-config.ts`
 * de aynı nedenle bu dosyayı METİN olarak okuyup doğruluyor. Burada bir adım
 * ileri gidilip dosya, sahte bir `self`/`firebase` kapsamında GERÇEKTEN
 * çalıştırılıyor ve kaydedilen `onBackgroundMessage` geri çağrısı doğrudan
 * sürülüyor; böylece test edilen şey dosyanın gerçek davranışı oluyor.
 *
 * KÖK NEDEN (bu testlerin var olma sebebi): tag `data.bildirimId ||
 * 'muezzin-task-notification'` ile hesaplanıyordu; FCM push üreten dört
 * script'in hiçbiri `bildirimId` göndermediğinden HER bildirim aynı etikete
 * düşüyor ve tepside birbirini eziyordu (arka arkaya gelen iki duyurunun
 * ilki kullanıcıya hiç görünmüyordu).
 */

// `import.meta.url` jsdom ortamında bir http URL'i olduğundan dosya yolu
// proje köküne (vitest'in cwd'si) göre çözülür — scripts/verify-sw-config.ts
// de aynı yolu kullanıyor.
const SW_KAYNAK = readFileSync(resolve(process.cwd(), 'public/firebase-messaging-sw.js'), 'utf8');

type BildirimSecenekleri = { tag: string; body: string; renotify: boolean };
type FcmPayload = {
  notification?: { title?: string; body?: string };
  data?: Record<string, string | undefined>;
};

type SwCalistirici = (
  importScripts: (...urls: string[]) => void,
  firebase: {
    initializeApp: (config: unknown) => void;
    messaging: () => { onBackgroundMessage: (cb: (payload: FcmPayload) => void) => void };
  },
  self: {
    registration: { showNotification: (baslik: string, secenekler: BildirimSecenekleri) => void };
    addEventListener: (tip: string, dinleyici: unknown) => void;
  },
  clients: unknown,
  konsol: { log: (...args: unknown[]) => void }
) => void;

/**
 * Service worker'ı izole bir kapsamda çalıştırır ve `onBackgroundMessage`
 * geri çağrısını sürebilen bir yardımcı döndürür.
 */
function serviceWorkerYukle() {
  const gosterilenler: { baslik: string; secenekler: BildirimSecenekleri }[] = [];
  let arkaPlanGeriCagrisi: ((payload: FcmPayload) => void) | undefined;

  const calistir = new Function('importScripts', 'firebase', 'self', 'clients', 'console', SW_KAYNAK) as unknown as SwCalistirici;

  calistir(
    () => {},
    {
      initializeApp: () => {},
      messaging: () => ({
        onBackgroundMessage: (cb) => {
          arkaPlanGeriCagrisi = cb;
        },
      }),
    },
    {
      registration: {
        showNotification: (baslik, secenekler) => {
          gosterilenler.push({ baslik, secenekler });
        },
      },
      addEventListener: () => {},
    },
    {},
    { log: () => {} }
  );

  if (!arkaPlanGeriCagrisi) {
    throw new Error('firebase-messaging-sw.js onBackgroundMessage geri çağrısını kaydetmedi.');
  }

  const surucu = arkaPlanGeriCagrisi;
  return {
    gosterilenler,
    /** Bir push'u işler ve gösterilen bildirimin etiketini döndürür. */
    etiket(payload: FcmPayload): string {
      surucu(payload);
      return gosterilenler[gosterilenler.length - 1]!.secenekler.tag;
    },
  };
}

/** scripts/duyuruBildirimGonder.ts'in gerçekte gönderdiği payload biçimi. */
function duyuruPush(duyuruId: string, baslik = 'Duyuru'): FcmPayload {
  return {
    notification: { title: baslik, body: 'İçerik' },
    data: { type: 'duyuru_yayinlandi', duyuruId, duyuruTip: 'duyuru' },
  };
}

/** scripts/izinDurumBildirimGonder.ts'in gerçekte gönderdiği payload biçimi. */
function izinPush(izinId: string, durum = 'onaylandi'): FcmPayload {
  return {
    notification: { title: 'İzin Talebiniz Onaylandı ✅', body: 'Talebiniz onaylandı.' },
    data: { type: 'izin_durumu', izinId, durum },
  };
}

describe('firebase-messaging-sw.js — bildirim etiketi (Notification tag)', () => {
  it('FARKLI iki duyuru birbirini EZMEZ (asıl regresyon)', () => {
    const sw = serviceWorkerYukle();
    const a = sw.etiket(duyuruPush('duyuruA'));
    const b = sw.etiket(duyuruPush('duyuruB'));

    expect(a).toBe('duyuru-duyuruA');
    expect(b).toBe('duyuru-duyuruB');
    expect(a).not.toBe(b);
    // Eski hatalı davranışın kesin imzası:
    expect([a, b]).not.toContain('muezzin-task-notification');
  });

  it('AYNI duyurunun yeniden gönderimi eskisinin YERİNE geçer (tekrar denemede tepsi kopyalanmaz)', () => {
    const sw = serviceWorkerYukle();
    expect(sw.etiket(duyuruPush('duyuruA', 'İlk'))).toBe(sw.etiket(duyuruPush('duyuruA', 'Güncellenmiş')));
  });

  it('FARKLI iki izin kararı birbirini EZMEZ, aynı izin kararı tazelenir', () => {
    const sw = serviceWorkerYukle();
    expect(sw.etiket(izinPush('izin1'))).toBe('izin-izin1');
    expect(sw.etiket(izinPush('izin2'))).not.toBe(sw.etiket(izinPush('izin1')));
    expect(sw.etiket(izinPush('izin1', 'reddedildi'))).toBe(sw.etiket(izinPush('izin1', 'onaylandi')));
  });

  it('duyuru ile izin bildirimi birbirini EZMEZ', () => {
    const sw = serviceWorkerYukle();
    expect(sw.etiket(duyuruPush('x'))).not.toBe(sw.etiket(izinPush('x')));
  });

  it('günlük görev hatırlatması GÜN başına tekildir (aynı gün tazelenir, farklı gün ezmez)', () => {
    const sw = serviceWorkerYukle();
    const push = (tarih: string) => ({
      notification: { title: 'Yarınki Ezan Göreviniz var 🕌', body: `Yarın sabah göreviniz var.` },
      data: { type: 'daily_duty_reminder', tarih },
    });

    expect(sw.etiket(push('2026-09-05'))).toBe('gorev-hatirlatma-2026-09-05');
    expect(sw.etiket(push('2026-09-06'))).not.toBe(sw.etiket(push('2026-09-05')));
    expect(sw.etiket(push('2026-09-05'))).toBe(sw.etiket(push('2026-09-05')));
  });

  it('haftalık plan duyurusu KASITLI olarak tek etikette toplanır (yalnızca en güncel plan anlamlıdır)', () => {
    const sw = serviceWorkerYukle();
    const push: FcmPayload = {
      notification: { title: 'Yeni Haftalık Plan Yayınlandı 🗓️', body: 'Plan hazır.' },
      data: { type: 'weekly_plan_published' },
    };
    expect(sw.etiket(push)).toBe('haftalik-plan');
    expect(sw.etiket(push)).toBe('haftalik-plan');
  });

  it('görev bildirimleri (asil/yedek/gorev_cagrisi) bildirim belgesi başına tekildir', () => {
    const sw = serviceWorkerYukle();
    const push = (tip: string, bildirimId: string): FcmPayload => ({
      notification: { title: 'Görev', body: 'Göreviniz var' },
      data: { type: tip, bildirimId, uid: 'u1' },
    });

    expect(sw.etiket(push('asil', 'b1'))).toBe('bildirim-b1');
    expect(sw.etiket(push('yedek', 'b2'))).toBe('bildirim-b2');
    // AYNI bildirim belgesi için tip değişse bile etiket aynı kalır: rol
    // güncellemesi eski bildirimin YERİNE geçmelidir.
    expect(sw.etiket(push('gorev_cagrisi', 'b1'))).toBe('bildirim-b1');
  });

  it('tanımsız bir tür için farklı İÇERİK farklı etiket alır, birebir aynı içerik aynı etiketi alır', () => {
    const sw = serviceWorkerYukle();
    const push = (body: string): FcmPayload => ({
      notification: { title: 'Yeni tür', body },
      data: { type: 'ileride_eklenen_tur' },
    });

    expect(sw.etiket(push('A olayı'))).not.toBe(sw.etiket(push('B olayı')));
    expect(sw.etiket(push('A olayı'))).toBe(sw.etiket(push('A olayı')));
  });

  it('bilinen tür kimlik alanı olmadan gelirse yine de tür başına TEK etikete düşmez', () => {
    const sw = serviceWorkerYukle();
    const bozuk = (baslik: string): FcmPayload => ({
      notification: { title: baslik, body: 'İçerik' },
      data: { type: 'duyuru_yayinlandi' },
    });
    expect(sw.etiket(bozuk('Duyuru 1'))).not.toBe(sw.etiket(bozuk('Duyuru 2')));
  });

  it('etiket HER ZAMAN boş olmayan bir dizgedir (renotify: true tag olmadan geçersizdir)', () => {
    const sw = serviceWorkerYukle();
    for (const payload of [{}, { data: {} }, { data: { type: '' } }, { notification: {}, data: { duyuruId: '  ' } }]) {
      const etiket = sw.etiket(payload as FcmPayload);
      expect(typeof etiket).toBe('string');
      expect(etiket.length).toBeGreaterThan(0);
    }
    expect(sw.gosterilenler.every((g) => g.secenekler.renotify === true)).toBe(true);
  });
});
