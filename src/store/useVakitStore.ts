import { create } from 'zustand';
import { doc, onSnapshot, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Vakitler, GunlukVakit } from '../types';
import { aylikVakitleriCek, aylikVakitleriGrupla } from '../services/ezanVaktiServisi';
import { getTurkeyNow, getTurkeyDateString } from '../lib/dateUtils';
import { useSystemSettingsStore } from './useSystemSettingsStore';
import { useAuthStore } from './useAuthStore';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

const isVakitEqual = (a: GunlukVakit | null, b: GunlukVakit | null) => {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.tarih === b.tarih && a.sabah === b.sabah && a.ogle === b.ogle && a.ikindi === b.ikindi && a.aksam === b.aksam && a.yatsi === b.yatsi
  );
};

interface VakitState {
  bugunVakitler: GunlukVakit | null;
  yarinVakitler: GunlukVakit | null;
  /** True only on the very first load when no data exists yet */
  loading: boolean;
  initializing: boolean;
  initialized: boolean;
  dateKey: string;
  currentMonthData: Vakitler | null;
  nextMonthData: Vakitler | null;
  init: () => () => void;
  _processData: () => void;
}

export const useVakitStore = create<VakitState>((set, get) => ({
  bugunVakitler: null,
  yarinVakitler: null,
  loading: true,
  initializing: false,
  initialized: false,
  dateKey: getTurkeyDateString(),
  currentMonthData: null,
  nextMonthData: null,

  _processData: () => {
    const { currentMonthData: curr, nextMonthData: next } = get();
    if (!curr) return;

    const tarih = getTurkeyNow();
    const yarinDate = new Date(tarih);
    yarinDate.setDate(tarih.getDate() + 1);

    const bugunStr = getTurkeyDateString(tarih);
    const yarinStr = getTurkeyDateString(yarinDate);

    const bugunV = curr.gunler?.[bugunStr];
    const newBugun: GunlukVakit | null =
      bugunV?.sabah && bugunV?.ogle && bugunV?.ikindi && bugunV?.aksam && bugunV?.yatsi
        ? ({ ...bugunV, tarih: bugunStr } as GunlukVakit)
        : null;

    const yarinSrc = curr.gunler?.[yarinStr] ? curr.gunler[yarinStr] : next?.gunler?.[yarinStr];

    const newYarin: GunlukVakit | null =
      yarinSrc?.sabah && yarinSrc?.ogle && yarinSrc?.ikindi && yarinSrc?.aksam && yarinSrc?.yatsi
        ? ({ ...yarinSrc, tarih: yarinStr } as GunlukVakit)
        : null;

    const { bugunVakitler: prevBugun, yarinVakitler: prevYarin } = get();

    // Only update state when data actually changes — avoids unnecessary re-renders
    const bugunChanged = !isVakitEqual(prevBugun, newBugun);
    const yarinChanged = !isVakitEqual(prevYarin, newYarin);

    if (bugunChanged || yarinChanged) {
      set({ bugunVakitler: newBugun, yarinVakitler: newYarin, loading: false, initializing: false, initialized: true });
    } else if (!get().initialized) {
      // First load: just clear the spinner, don't disturb existing data
      set({ loading: false, initializing: false, initialized: true });
    }
    // If nothing changed and already initialized, don't call set() at all
  },

  init: () => {
    if (get().initialized || get().initializing) return () => {};
    set({ initializing: true });

    let cleanup: (() => void) | null = null;
    let currentIlceId = '';

    const startVakitSubscription = (settings: { ilceId: string; ilceAdi: string }) => {
      if (cleanup) cleanup();

      const setupSubscriptions = () => {
        // `fetchFallback` (aşağıda) asenkron — çözüldüğünde bu abonelik hâlâ
        // "aktif" olmayabilir. İlçe değişip `startVakitSubscription` yeniden
        // çağrıldığında (bkz. useSystemSettingsStore.subscribe altta) `cleanup()`
        // önce eski `setupSubscriptions` çağrısının döndürdüğü fonksiyonu
        // çalıştırır — bu bayrağı burada true'ya çeker. Önceden fetchFallback
        // kapandığı `settings.ilceId`'yi hiç kontrol etmeden sonucu koşulsuz
        // `set({currentMonthData})` ile yazıyordu: İlçe A'nın eksik ay belgesi
        // yavaş bir fetchFallback tetiklerken admin İlçe B'ye geçerse, İlçe B
        // için doğru abonelik zaten kurulmuş olsa bile İlçe A'nın gecikmeli
        // sonucu gelince İlçe B'nin verisini sessizce ezebiliyordu (bkz. kod
        // denetimi race condition bulgusu).
        let iptalEdildi = false;
        const tarih = getTurkeyNow();
        const buAyYYYYMM = `${tarih.getFullYear()}-${String(tarih.getMonth() + 1).padStart(2, '0')}`;
        const buAyDocId = `${settings.ilceId}_${buAyYYYYMM}`;

        const yarinDate = new Date(tarih);
        yarinDate.setDate(tarih.getDate() + 1);
        const yarinAyYYYYMM = `${yarinDate.getFullYear()}-${String(yarinDate.getMonth() + 1).padStart(2, '0')}`;
        const yarinAyDocId = `${settings.ilceId}_${yarinAyYYYYMM}`;

        // Only show spinner if we have no data at all (first boot)
        if (!get().initialized) {
          set({ loading: true });
        }

        /** API tazelemesi BAŞARILI olduysa `true`, aksi halde `false` döner —
         *  çağıran (`fallbackTetikle`) yeniden deneme kararını buna göre verir. */
        const fetchFallback = async (yil: number, ay: number): Promise<boolean> => {
          try {
            const data = (await aylikVakitleriCek(yil, ay, settings.ilceId, settings.ilceAdi)) as unknown as Vakitler;
            // Bu abonelik iptal edildiyse (ilçe değişti / gece yarısı geçişiyle
            // yeniden kuruldu) sonucu artık STORE'a yazma — aşağıdaki Firestore
            // önbellek yazımı zararsız (hangi ilçe için olursa olsun geçerli bir
            // önbellekleme), o yüzden ondan ÖNCE değil, yalnızca state güncellemesinden
            // önce kontrol edilir.
            if (iptalEdildi) return true;
            set({ currentMonthData: data });
            get()._processData();
            // Yalnızca admin bu önbelleği Firestore'a yazabilir (bkz. firestore.rules
            // `vakitler` write kuralı) — diğer tüm kullanıcılarda bu deneme zaten
            // permission-denied ile reddediliyordu; gereksiz yazma denemesi ve
            // telemetri gürültüsü önlenir.
            if (useAuthStore.getState().isAdmin) {
              // `data` (birincil Diyanet kaynağı) yil/ay parametrelerini yok sayıp
              // bugünden itibaren ~30-32 günlük kayan bir pencere döner — bu, istenen
              // aydan FAZLASINI (bir sonraki ayın günlerini) içerebilir. aylikVakitleriGrupla
              // ile gerçek takvim ayına göre bölünüp yalnızca istenen ay'a denk gelen
              // günler yazılır — aksi halde (eski davranış) pencerenin TAMAMI `yil-ay`
              // doc'una yazılıyor, bir sonraki ayın günleri YANLIŞ doc'a gömülüp o ayın
              // KENDİ doc'unda hiç görünmüyordu (bkz. O5 ile aynı sınıf bug, mantık
              // denetiminde bu üçüncü — daha önce kaçırılmış — çağrı noktasında bulundu).
              const ayId = `${yil}-${String(ay).padStart(2, '0')}`;
              const gruplar = aylikVakitleriGrupla(data);
              const grup = gruplar[ayId];
              if (grup) {
                const docId = `${settings.ilceId}_${ayId}`;
                setDoc(doc(db, 'vakitler', docId), { ...grup, guncellenmeTarihi: Timestamp.now() }, { merge: true }).catch((e) =>
                  console.warn('Auto-cache failed:', e)
                );
              }
            }
            return true;
          } catch (err) {
            console.error('VakitStore Fallback API Hatası:', err);
            if (iptalEdildi) return false;
            set({ loading: false, initializing: false, initialized: true });
            return false;
          }
        };

        // --- Fallback tetikleyici (tek kilit + sınırlı yeniden deneme) --------------
        //
        // Aşağıdaki İKİ yol da (belge hiç yok / belge var ama bugün-yarın eksik) aynı
        // ayın verisini API'den çeker, bu yüzden TEK bir kilidi paylaşırlar.
        //
        // Önceden her yolun kendi `...Denendi` bayrağı vardı ve bayrak fetch'ten ÖNCE
        // `true`'ya çekiliyordu: tek bir başarısız API çağrısı (ağ kesintisi, Diyanet
        // API'si geçici olarak kapalı) bayrağı KALICI olarak kilitliyor, kullanıcı gece
        // yarısı yeniden aboneliğe kadar (saatlerce) boş vakit ekranında kalıyordu —
        // hiçbir yeniden deneme yapılmadan. Kilit artık:
        //   - eşzamanlı/çift çağrıyı hâlâ engeller (`calisiyor`) — `persistentLocalCache`
        //     ile "belge yok" snapshot'ının İKİ KEZ gelmesine karşı korumanın asıl
        //     amacı buydu (premium hata analizi HS-O6),
        //   - yalnızca BAŞARIDAN SONRA kalıcı olur (`basarili`),
        //   - başarısızlıkta sınırlı sayıda, 15 sn arayla yeniden dener — bu aralık
        //     dosyanın kendi `onSnapshot` hata yolundaki yeniden abone olma
        //     zamanlayıcısıyla aynıdır.
        const FALLBACK_YENIDEN_DENEME_MS = 15000;
        const FALLBACK_MAX_DENEME = 3;
        let fallbackCalisiyor = false;
        let fallbackBasarili = false;
        let fallbackDenemeSayisi = 0;

        const fallbackTetikle = (yil: number, ay: number) => {
          if (iptalEdildi || fallbackCalisiyor || fallbackBasarili) return;
          fallbackCalisiyor = true;
          fallbackDenemeSayisi++;
          void fetchFallback(yil, ay).then((basarili) => {
            fallbackCalisiyor = false;
            if (iptalEdildi) return;
            if (basarili) {
              fallbackBasarili = true;
              return;
            }
            if (fallbackDenemeSayisi >= FALLBACK_MAX_DENEME) {
              console.warn(
                'VakitStore: fallback API tazelemesi üst üste başarısız oldu, bir sonraki snapshot/gün geçişine kadar beklenecek.'
              );
              return;
            }
            setTimeout(() => fallbackTetikle(yil, ay), FALLBACK_YENIDEN_DENEME_MS);
          });
        };

        // Doküman Firestore'da mevcut olsa bile içindeki `gunler` haritasında
        // bugün/yarın için kayıt bulunmayabilir (örn. cron'un bir sonraki
        // çalışmasına kadar geçen boşluk). _processData bu durumda sessizce
        // null üretip spinner'ı kapatıyordu — kullanıcı "Vakitler güncelleniyor"
        // ekranında sonsuza dek takılı kalıyordu. Eksik günü tespit edip API'den
        // tazeleme tetikleyerek kendi kendine onarım sağlanır. Tekrar/eşzamanlılık
        // kontrolü `fallbackTetikle`'nin paylaşılan kilidindedir (yukarı bkz.).
        const eksikGunuTazele = () => {
          if (fallbackBasarili || fallbackCalisiyor) return;
          if (!get().bugunVakitler || !get().yarinVakitler) {
            console.warn('VakitStore: doküman(lar) mevcut ama bugün/yarın verisi eksik, API üzerinden tazeleniyor...');
            fallbackTetikle(tarih.getFullYear(), tarih.getMonth() + 1);
          }
        };

        const unsubscribeBuAy = onSnapshot(
          doc(db, 'vakitler', buAyDocId),
          (snap) => {
            if (snap.exists()) {
              set({ currentMonthData: snap.data() as Vakitler });
              get()._processData();
              eksikGunuTazele();
            } else {
              // `persistentLocalCache` etkinken onSnapshot "belge yok" durumunu İKİ
              // KEZ tetikleyebilir (önce yerel önbellekten, sonra sunucudan);
              // `fallbackTetikle`'nin `calisiyor` kilidi bu çift tetiklemeyi
              // (dış API çağrısı + admin oturumundaysa çift Firestore yazımı)
              // engeller (premium hata analizi HS-O6) — AMA eski koddaki gibi
              // başarısız bir denemeden sonra kalıcı olarak kilitlemez.
              fallbackTetikle(tarih.getFullYear(), tarih.getMonth() + 1);
            }
          },
          (err) => {
            // Önceden yalnızca console.error'a yazılıyordu — uygulamanın en kritik
            // veri akışlarından biri (namaz vakitleri) telemetri/hata izleme dışı
            // kalıyordu; diğer store'ların (useAdminIzinlerStore, useMuezzinStore vb.)
            // tümü handleFirestoreError kullanırken bu ikisi tutarsızdı (bkz. kod
            // denetimi).
            handleFirestoreError(err, OperationType.GET, `vakitler/${buAyDocId}`);
            // `initialized:true` YAZILMAZ (bkz. useAdminIzinlerStore.ts'teki AYNI
            // düzeltme, premium hata analizi HS-O1). Spinner yalnızca hiç veri yoksa
            // kapatılır — zaten başarıyla yüklenmiş bir store'da geçici bir yeniden
            // bağlantı hatası mevcut veriyi/ekranı bozmamalı.
            if (!get().initialized) set({ loading: false, initializing: false });
            // Dış init()'i değil, YALNIZCA bu ilçe için abonelikleri yeniden kuran
            // startVakitSubscription'ı tekrar çağırır — aksi halde her retry ayrıca
            // yeni bir settings-aboneliği ve interval de kurup biriktirirdi.
            //
            // `settings` bu BAŞARISIZ aboneliğin closure'ından gelir. 15sn içinde
            // admin ilçeyi değiştirirse (bkz. aşağıdaki useSystemSettingsStore
            // aboneliği) yeni ilçe için abonelik ZATEN kurulmuş olur; bayat
            // `settings` ile körlemesine yeniden abone olmak `cleanup()` ile yeni
            // ilçenin aboneliğini öldürüp ESKİ ilçeye geri döndürüyordu (bkz. kod
            // denetimi). Zamanlayıcı ateşlendiği ANDA güncel ilçe yeniden okunur;
            // farklıysa hiç yeniden abone OLUNMAZ — o ilçenin meşru aboneliği zaten
            // ayakta (ya da normal yoldan kurulacak).
            setTimeout(() => {
              const guncelSettings = useSystemSettingsStore.getState().settings;
              if (guncelSettings.ilceId !== settings.ilceId) return;
              startVakitSubscription(guncelSettings);
            }, 15000);
          }
        );

        let unsubscribeYarin: (() => void) | null = null;
        if (buAyYYYYMM !== yarinAyYYYYMM) {
          unsubscribeYarin = onSnapshot(
            doc(db, 'vakitler', yarinAyDocId),
            (snap) => {
              if (snap.exists()) {
                set({ nextMonthData: snap.data() as Vakitler });
                get()._processData();
              }
              eksikGunuTazele();
            },
            (err) => handleFirestoreError(err, OperationType.GET, `vakitler/${yarinAyDocId}`)
          );
        }

        return () => {
          iptalEdildi = true;
          unsubscribeBuAy();
          unsubscribeYarin?.();
        };
      };

      cleanup = setupSubscriptions();
    };

    // Initial subscription
    const initialSettings = useSystemSettingsStore.getState().settings;
    currentIlceId = initialSettings.ilceId;
    startVakitSubscription(initialSettings);

    // Re-subscribe only when district changes
    const unsubSettings = useSystemSettingsStore.subscribe((state) => {
      if (state.settings.ilceId !== currentIlceId) {
        currentIlceId = state.settings.ilceId;
        startVakitSubscription(state.settings);
      }
    });

    // Periodic check for day transitions (midnight rollover)
    const interval = setInterval(() => {
      const nowStr = getTurkeyDateString();
      if (get().dateKey !== nowStr) {
        set({ dateKey: nowStr });
        startVakitSubscription(useSystemSettingsStore.getState().settings);
      } else {
        get()._processData();
      }
    }, 60_000);

    return () => {
      if (cleanup) cleanup();
      unsubSettings();
      clearInterval(interval);
    };
  },
}));
