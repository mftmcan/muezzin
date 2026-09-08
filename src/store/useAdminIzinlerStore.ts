import { create } from 'zustand';
import { collection, query, onSnapshot, updateDoc, doc, getDoc, runTransaction, deleteField } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Izin } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { telemetryService } from '../services/telemetryService';
import { haftalikPlanOlustur } from '../services/planServisi';
import { getHaftaIdFromDate, izinGunSayisi, toTurkishUpperCase } from '../lib/dateUtils';

/** Yıllık izin kotası (takvim yılı başına gün) — bkz. firestore.rules
 *  isValidMuezzin (yillikIzinKullanilanGun <= 30), aynı sabit orada da
 *  ayrıca tanımlıdır (Firestore Rules TS sabitlerini import edemez). Bu
 *  sabiti değiştirirsen firestore.rules'taki karşılığını da güncelle. */
const YILLIK_IZIN_KOTASI = 30;

/**
 * Bir iznin [baslangic, bitis] aralığını kapsayan tüm haftaId'leri (Pazartesi
 * başlangıçlı, 7 günlük adımlarla) hesaplar — izin onaylandığında/geri
 * alındığında bu haftaların HEPSİNİN yeniden planlanması gerekir (bkz. Y1).
 */
function izinAraligindakiHaftaIdleri(baslangic: string, bitis: string): string[] {
  const haftaIdSeti = new Set<string>();

  // Örneklemeye `baslangic`'ın kendi gününden değil, o haftanın Pazartesi'sinden
  // başlanır (getHaftaIdFromDate zaten bunu hesaplıyor, format 'W-YYYY-MM-DD').
  // Önceki hâliyle `baslangic`'tan 7 günlük sabit adımlarla ilerlemek, aralık
  // hafta sınırını hizasız bir günde kesiyorsa (ör. Cumartesi–Salı arası kısa
  // bir izin) `bitis`'i içeren haftayı tamamen atlıyordu — o hafta hiç yeniden
  // planlanmadığından izinli kişi nöbetçi olarak atanmış görünmeye devam
  // edebiliyordu (bkz. kod denetimi, kritik bulgu). Pazartesi'den başlayıp
  // 7'şer gün ilerlemek, adım hizası ne olursa olsun ara hafta kaybını önler.
  const ilkHaftaId = getHaftaIdFromDate(baslangic);
  const [py, pm, pd] = ilkHaftaId.slice(1).split('-').map(Number);
  const gun = new Date(py, pm - 1, pd);

  const [ey, em, ed] = bitis.split('-').map(Number);
  const sonGun = new Date(ey, em - 1, ed);

  // Sonsuz döngü koruması: geçersiz/ters bir aralık (bitis < baslangic) gelse
  // bile en fazla ~5 yıl (260 hafta) tarar, sonra durur.
  let guvenlikSayaci = 0;
  while (gun <= sonGun && guvenlikSayaci < 260) {
    const gunStr = `${gun.getFullYear()}-${String(gun.getMonth() + 1).padStart(2, '0')}-${String(gun.getDate()).padStart(2, '0')}`;
    haftaIdSeti.add(getHaftaIdFromDate(gunStr));
    gun.setDate(gun.getDate() + 7);
    guvenlikSayaci++;
  }
  return Array.from(haftaIdSeti);
}

/**
 * İzin kararı (onay/geri alma) sonrası, izin aralığını kapsayan haftaların
 * planını yeniden üretmeyi dener. Cron zaten mevcut bir plan belgesini asla
 * yeniden yazmadığından (bkz. scripts/haftalikPlanOlustur.ts), bir izin
 * onaylandığında bu tetiklenmezse kişi haftalarca izinliyken nöbete atanmış
 * kalabiliyordu (bkz. mimari denetim Y1). Hatalar yutulur — izin kararının
 * kendisini engellememeli.
 */
async function izinEtkilenenHaftalariYenile(izinId: string): Promise<void> {
  try {
    const izinSnap = await getDoc(doc(db, 'izinler', izinId));
    if (!izinSnap.exists()) return;
    const { baslangic, bitis } = izinSnap.data() as Izin;
    if (!baslangic || !bitis) return;

    const haftaIdler = izinAraligindakiHaftaIdleri(baslangic, bitis);
    for (const haftaId of haftaIdler) {
      try {
        await haftalikPlanOlustur(haftaId);
      } catch (err) {
        console.warn(`İzin kararı sonrası plan yenilenemedi (${haftaId}):`, err);
      }
    }
  } catch (err) {
    console.warn('İzin kararı sonrası etkilenen haftalar hesaplanamadı:', err);
  }
}

/** `izinler` dinleyicisinin hata yolundaki yeniden abone olma aralığı — ikincil
 *  `izin_detaylari` dinleyicisi de AYNI aralığı kullanır (bkz. init). */
const YENIDEN_ABONE_MS = 15000;

/** `izin_detaylari` için üst üste kaç yeniden abone denemesi yapılacağı.
 *  Ana `izinler` dinleyicisinin yeniden denemesi `!get().initialized`
 *  koşuluyla sarılıdır; ikincil dinleyicinin böyle bir doğal durma koşulu
 *  yok, bu yüzden kalıcı bir hatada (ör. beklenmedik bir permission-denied)
 *  15 sn'de bir sonsuza dek telemetri üretmesin diye sayı sınırlanır. */
const DETAY_MAX_YENIDEN_DENEME = 5;

interface AdminIzinlerState {
  izinler: (Izin & { id: string })[];
  loading: boolean;
  error: string | null;
  /** `izin_detaylari` dinleyicisi kalıcı olarak başarısız oldu mu — true ise
   *  `sebep` alanları EKSİK'tir ("belirtilmedi" DEĞİL). UI bu ikisini
   *  ayırt edebilsin diye ayrı tutulur (bkz. IzinYonetimi.tsx). */
  detaylarHatasi: boolean;
  initialized: boolean;
  /** bkz. useKrizAlarmlariStore.ts'teki AYNI alan yorumu — `isAdmin` hızlı
   * geçişinde çift dinleyici açılmasını önler (düşük öncelikli bulgu). */
  initializing: boolean;
  init: () => () => void;
  izinGuncelle: (id: string, durum: 'onaylandi' | 'reddedildi') => Promise<void>;
  /** Yanlışlıkla verilmiş bir onay/red kararını geri alır, talebi tekrar bekleme durumuna döndürür. */
  izinGeriAl: (id: string) => Promise<void>;
  izinSil: (id: string) => Promise<void>;
}

// Admin panelinde birden fazla bileşen (ExecutiveHeroScreen, IzinYonetimi,
// AdminPanel'in bekleyen-izin rozet sayacı) tüm `izinler` koleksiyonuna
// ihtiyaç duyar. Her biri kendi onSnapshot'ını açmak yerine tek paylaşılan
// abonelik burada tutulur; bekleyen sayısı da buradan türetilir.
export const useAdminIzinlerStore = create<AdminIzinlerState>((set, get) => ({
  izinler: [],
  loading: true,
  error: null,
  detaylarHatasi: false,
  initialized: false,
  initializing: false,

  init: () => {
    if (get().initialized || get().initializing) return () => {};
    set({ initializing: true });

    const path = 'izinler';
    const q = query(collection(db, path));

    // `sebep` artık `izinler` belgesinde yok (bkz. types.ts Izin.sebep
    // yorumu, FR-O3) — admin panelinin görmesi gereken bu alan, ayrı
    // `izin_detaylari` koleksiyonundan (yalnızca admin listeleyebilir)
    // gelip burada MERGE edilir. İki bağımsız onSnapshot birbirinden
    // habersiz güncellenebileceğinden, her ikisinin de en son bilinen
    // halini kapanışta tutup her tetiklenmede birlikte birleştiriyoruz.
    let sonIzinlerDocs: { id: string; data: Record<string, unknown> }[] = [];
    let sonSebepMap: Record<string, string> = {};
    let izinlerYuklendi = false;

    const birlestirVeYaz = () => {
      if (!izinlerYuklendi) return;
      const data = sonIzinlerDocs.map(({ id, data: d }) => ({
        id,
        ...d,
        ...(sonSebepMap[id] !== undefined ? { sebep: sonSebepMap[id] } : {}),
      })) as (Izin & { id: string })[];

      data.sort((a, b) => {
        const timeA = a.olusturmaTarihi?.toMillis() || 0;
        const timeB = b.olusturmaTarihi?.toMillis() || 0;
        return timeB - timeA;
      });

      set({ izinler: data, loading: false, initializing: false, initialized: true, error: null });
    };

    const unsubscribeIzinler = onSnapshot(
      q,
      (snapshot) => {
        sonIzinlerDocs = snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
        izinlerYuklendi = true;
        birlestirVeYaz();
      },
      (err) => {
        // handleFirestoreError'ın DÖNÜŞ değeri kullanılır — ham err.message
        // değil, aksi halde ham SDK metni admin'e sızabilir (bkz.
        // useKrizAlarmlariStore.ts'teki AYNI düzeltme, firestore-errors.ts).
        const friendly = handleFirestoreError(err, OperationType.LIST, path);
        // `initialized:true` YAZILMAZ — onSnapshot hata callback'i dinleyiciyi
        // KALICI olarak sonlandırdığından (SDK otomatik yeniden bağlanmaz),
        // bunu yazmak init()'in guard'ını süresiz kilitleyip store'u oturum
        // boyunca ölü bırakıyordu (premium hata analizi HS-O1).
        set({ error: friendly.message, loading: false, initializing: false });
        setTimeout(() => {
          if (!get().initialized) get().init();
        }, YENIDEN_ABONE_MS);
      }
    );

    // İkincil dinleyici: hatası ana izin listesini ENGELLEMEMELİ (bu kısım
    // kasıtlıydı ve korunuyor) — ama önceden hatada YENİDEN DE DENEMİYORDU.
    // onSnapshot'ın hata callback'i dinleyiciyi KALICI olarak sonlandırdığından
    // (SDK kendiliğinden yeniden bağlanmaz) tek bir geçici hata, admin'in
    // oturumu boyunca TÜM `sebep` sütununu sessizce boşaltıyordu; üstelik UI
    // bunu "sebep belirtilmedi" diye gösterdiğinden yanlış bilgi veriyordu.
    // Kardeş dinleyicinin (yukarıda) yeniden abone olma deseni burada da
    // uygulanır — tek fark, `initialized` guard'ı burada işe yaramadığından
    // (o bayrak ana listeye aittir) deneme sayısının açıkça sınırlanması.
    let detayUnsubscribe: (() => void) | null = null;
    let detayDenemeSayisi = 0;
    let detaylarKapatildi = false;

    const detaylariDinle = () => {
      if (detaylarKapatildi) return;
      detayUnsubscribe = onSnapshot(
        collection(db, 'izin_detaylari'),
        (snapshot) => {
          const map: Record<string, string> = {};
          snapshot.docs.forEach((d) => {
            const sebepDeger = d.data().sebep;
            if (typeof sebepDeger === 'string') map[d.id] = sebepDeger;
          });
          sonSebepMap = map;
          detayDenemeSayisi = 0;
          if (get().detaylarHatasi) set({ detaylarHatasi: false });
          birlestirVeYaz();
        },
        (err) => {
          handleFirestoreError(err, OperationType.LIST, 'izin_detaylari');
          // Hata anında HEMEN işaretlenir (yeniden deneme başarılı olursa geri
          // alınır) — aksi halde admin, yeniden deneme penceresi boyunca boş
          // `sebep` alanlarını "belirtilmedi" sanardı.
          if (!get().detaylarHatasi) set({ detaylarHatasi: true });
          if (detaylarKapatildi) return;
          if (detayDenemeSayisi >= DETAY_MAX_YENIDEN_DENEME) return;
          detayDenemeSayisi++;
          setTimeout(detaylariDinle, YENIDEN_ABONE_MS);
        }
      );
    };

    detaylariDinle();

    return () => {
      unsubscribeIzinler();
      detaylarKapatildi = true;
      detayUnsubscribe?.();
    };
  },

  izinGuncelle: async (id, durum) => {
    const path = `izinler/${id}`;
    try {
      // TÜMÜYLE transaction içinde: hem karar hem (varsa) kota etkisi TEK
      // atomik yazım. Önceden yalnızca 'onaylandi' dalı transactional'dı;
      // 'reddedildi' dalı (mevcut durum ne olursa olsun) korumasız, düz bir
      // `updateDoc` idi. Bu, ZATEN ONAYLANMIŞ (kotaya eklenmiş) bir yıllık
      // izin daha sonra reddedilirse — ör. iki admin oturumu aynı talebi
      // aynı anda görüp biri onaylar biri reddederken ikincisinin UI'ı hâlâ
      // eski 'onay_bekliyor' durumunu gösteriyorsa — önceden eklenen
      // `yillikIzinKullanilanGun`'un asla geri düşürülmemesine yol açıyordu
      // (bkz. kod denetimi bulgusu; `izinGeriAl`/`izinSil`'deki AYNI
      // desenle simetrik hale getirildi). Güncel sunucu durumu her zaman
      // transaction İÇİNDE (stale bir ön-okumaya değil) taze okunur.
      await runTransaction(db, async (transaction) => {
        const izinRef = doc(db, 'izinler', id);
        const tazeIzinSnap = await transaction.get(izinRef);
        if (!tazeIzinSnap.exists()) throw new Error('İzin talebi bulunamadı.');
        const tazeIzin = tazeIzinSnap.data() as Izin;
        const mevcutDurum = tazeIzin.durum;

        if (mevcutDurum === durum) throw new Error('Bu talep zaten bu durumda.');

        const isYillik = tazeIzin.tip === 'yillik';
        // Kota yalnızca "onaylandi"ya GİRERKEN ya da ONDAN ÇIKARKEN etkilenir.
        const kotaEtkisiVar = isYillik && (durum === 'onaylandi' || mevcutDurum === 'onaylandi');
        const muezzinRef = kotaEtkisiVar ? doc(db, 'muezzins', tazeIzin.uid) : null;
        const muezzinSnap = muezzinRef ? await transaction.get(muezzinRef) : null;

        if (durum === 'onaylandi') {
          if (mevcutDurum !== 'onay_bekliyor') throw new Error('Bu talep zaten sonuçlandırılmış.');
          if (isYillik) {
            if (!muezzinSnap?.exists()) throw new Error('Personel kaydı bulunamadı.');
            const gunSayisi = izinGunSayisi(tazeIzin.baslangic, tazeIzin.bitis);
            const mevcutKullanilan = muezzinSnap.data().yillikIzinKullanilanGun || 0;
            const yeniKullanilan = mevcutKullanilan + gunSayisi;
            // firestore.rules (isValidMuezzin) bu sayacın 30'u AŞACAK
            // şekilde yazılmasını da ayrıca reddeder; kota aşan bir onay
            // burada başarısız olur, izin durumu değişmeden kalır (bkz.
            // kullanıcı kararı: sert engel, admin override'ı yok).
            if (yeniKullanilan > YILLIK_IZIN_KOTASI) {
              throw new Error(
                `Bu onay yıllık izin kotasını aşıyor: talep ${gunSayisi} gün, kullanılan ${mevcutKullanilan}/${YILLIK_IZIN_KOTASI} gün. Kalan kota: ${Math.max(0, YILLIK_IZIN_KOTASI - mevcutKullanilan)} gün.`
              );
            }
            transaction.update(muezzinRef!, { yillikIzinKullanilanGun: yeniKullanilan });
          }
        } else if (isYillik && mevcutDurum === 'onaylandi' && muezzinSnap?.exists()) {
          // Zaten onaylanmış bir yıllık izin reddediliyor — daha önce
          // kotaya eklenen gün sayısı geri düşülür.
          const gunSayisi = izinGunSayisi(tazeIzin.baslangic, tazeIzin.bitis);
          const mevcutKullanilan = muezzinSnap.data().yillikIzinKullanilanGun || 0;
          transaction.update(muezzinRef!, { yillikIzinKullanilanGun: Math.max(0, mevcutKullanilan - gunSayisi) });
        }

        // bildirimGonderildi: false — scripts/izinDurumBildirimGonder.ts
        // (Admin SDK cron) talep sahibine "mazeretDurumu" push bildirimini
        // gönderdikten sonra bu bayrağı true'ya çevirir. Kararla AYNI
        // transaction'da yazılması, o script'in sorgusunun tüm izinler
        // koleksiyonunu taramak yerine tek bir eşitlik filtresiyle
        // (`== false`) yalnızca henüz bildirilmemiş kararları bulmasını
        // sağlar (bkz. duyuruServisi.ts'teki AYNI desen).
        transaction.update(izinRef, { durum, bildirimGonderildi: false });
      });

      await telemetryService.logAudit('İzin Talebi Kararı', id, `Talep durumu '${toTurkishUpperCase(durum)}' olarak güncellendi.`);
      // Yalnızca onayda plan yenilemesi gerekir — reddedilen izin zaten
      // atamayı hiç etkilemiyordu (bkz. mimari denetim Y1).
      if (durum === 'onaylandi') {
        await izinEtkilenenHaftalariYenile(id);
      }
    } catch (err) {
      throw handleFirestoreError(err, OperationType.UPDATE, path);
    }
  },

  izinGeriAl: async (id) => {
    const path = `izinler/${id}`;
    try {
      const izinSnap = await getDoc(doc(db, 'izinler', id));
      if (!izinSnap.exists()) throw new Error('İzin talebi bulunamadı.');
      const izinData = izinSnap.data() as Izin;

      // Onaylanmış bir yıllık izin geri alınırsa, daha önce sayaca eklenen
      // gün sayısı da aynı transaction içinde geri düşülmeli — aksi halde
      // sayaç yapay olarak şişik kalır ve kişinin kalan kotasını haksız
      // yere azaltmaya devam eder.
      if (izinData.tip === 'yillik') {
        const gunSayisi = izinGunSayisi(izinData.baslangic, izinData.bitis);
        await runTransaction(db, async (transaction) => {
          const izinRef = doc(db, 'izinler', id);
          const muezzinRef = doc(db, 'muezzins', izinData.uid);
          const [tazeIzinSnap, muezzinSnap] = await Promise.all([transaction.get(izinRef), transaction.get(muezzinRef)]);
          if (!tazeIzinSnap.exists()) throw new Error('İzin talebi bulunamadı.');

          // bildirimGonderildi silinir — geri alınan bir karar tekrar
          // verildiğinde (izinGuncelle) bu alan `false` ile yeniden
          // yazılacak; silinmezse ESKİ kararın `true` değeri kalıp YENİ
          // karar için hiç push bildirimi gitmezdi. Ayrıca bu alan
          // `durum == 'onay_bekliyor'` iken üzerinde kalırsa, kullanıcının
          // kendi bekleyen talebini düzenlediği self-update yolu
          // (isValidIzin'in katı hasOnly'si) bu fazladan alan yüzünden
          // reddedilirdi (bkz. firestore.rules).
          transaction.update(izinRef, { durum: 'onay_bekliyor', bildirimGonderildi: deleteField() });
          // Sayaç yalnızca ONAYLANMIŞ bir izin geri alınırken düşürülmeli —
          // reddedilen izin izinGuncelle'de zaten sayaca hiç eklenmemişti
          // (bkz. L131), aksi halde reddedilen bir kaydı geri al/tekrar onayla
          // döngüsüyle 30 günlük kota sayaç şişirilmeden aşılabilir.
          if (tazeIzinSnap.data().durum === 'onaylandi' && muezzinSnap.exists()) {
            const mevcutKullanilan = muezzinSnap.data().yillikIzinKullanilanGun || 0;
            transaction.update(muezzinRef, { yillikIzinKullanilanGun: Math.max(0, mevcutKullanilan - gunSayisi) });
          }
        });
      } else {
        await updateDoc(doc(db, 'izinler', id), { durum: 'onay_bekliyor', bildirimGonderildi: deleteField() });
      }

      await telemetryService.logAudit('İzin Talebi Kararı Geri Alındı', id, "Talep durumu tekrar 'ONAY BEKLİYOR' olarak ayarlandı.");
      // Geri alınan bir onay da plan yenilemesi gerektirir — kişi artık
      // yeniden atanabilir olmalı (bkz. mimari denetim Y1).
      await izinEtkilenenHaftalariYenile(id);
    } catch (err) {
      throw handleFirestoreError(err, OperationType.UPDATE, path);
    }
  },

  izinSil: async (id) => {
    const path = `izinler/${id}`;
    try {
      // Kota geri alınıp alınmayacağı kararı artık transaction İÇİNDEKİ
      // taze okumaya göre veriliyor — önceden bu bir ÖN-okumaya (dış
      // `getDoc`) bakıyordu: örneğin talep ön-okuma anında 'onay_bekliyor'
      // iken transaction çalışana kadar başka bir oturum onu onaylarsa
      // (kota zaten eklendi) bu fonksiyon "else" dalına düşüp kotayı HİÇ
      // geri düşürmeden sileceğinden kota sızardı; tam tersi sırayla da
      // (ön-okumada 'onaylandi' ama arada geri alınmışsa) kota İKİNCİ KEZ
      // düşürülüp yapay olarak eksilirdi (bkz. kod denetimi bulgusu,
      // izinGuncelle'deki AYNI sınıf düzeltmeyle simetrik).
      await runTransaction(db, async (transaction) => {
        const izinRef = doc(db, 'izinler', id);
        const tazeIzinSnap = await transaction.get(izinRef);
        if (!tazeIzinSnap.exists()) throw new Error('İzin talebi bulunamadı.');
        const tazeIzin = tazeIzinSnap.data() as Izin;

        if (tazeIzin.tip === 'yillik' && tazeIzin.durum === 'onaylandi') {
          const gunSayisi = izinGunSayisi(tazeIzin.baslangic, tazeIzin.bitis);
          const muezzinRef = doc(db, 'muezzins', tazeIzin.uid);
          const muezzinSnap = await transaction.get(muezzinRef);
          if (muezzinSnap.exists()) {
            const mevcutKullanilan = muezzinSnap.data().yillikIzinKullanilanGun || 0;
            transaction.update(muezzinRef, { yillikIzinKullanilanGun: Math.max(0, mevcutKullanilan - gunSayisi) });
          }
        }

        transaction.delete(izinRef);
      });

      await telemetryService.logAudit('İzin Talebi Silme', id, 'İzin kaydı dizgeden kalıcı olarak silindi.');
    } catch (err) {
      throw handleFirestoreError(err, OperationType.DELETE, path);
    }
  },
}));
