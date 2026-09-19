import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { VekaletTalebi } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { useChangeKey } from './useChangeKey';
import { useNotificationStore } from '../store/useNotificationStore';
import { toTurkishUpperCase } from '../lib/dateUtils';

export interface VekaletTalepDurumlari {
  /** Oturum sahibine yönelik, henüz karar verilmemiş gelen vekalet teklifleri. */
  gelenVekaletler: (VekaletTalebi & { id: string })[];
  /** Kabul edilmiş ama cron tarafından henüz UYGULANMAMIŞ devirler. */
  bekleyenDevirler: (VekaletTalebi & { id: string })[];
}

/**
 * Oturum sahibine gelen TÜM vekalet taleplerini TEK bir `onSnapshot` ile
 * dinler ve durumlarına göre ikiye ayırır.
 *
 * Eskiden bu iş iki ayrı hook'taydı (`useGelenVekaletler` /
 * `useBekleyenVekaletDevirleri`): aynı koleksiyona, aynı
 * `where('aliciUid','==',uid)` filtresiyle ama farklı `durum` filtresiyle iki
 * ayrı gerçek-zamanlı WebChannel bağlantısı açıyorlardı. `durum` filtresi
 * kaldırılıp ayrım istemciye alındığında bağlantı sayısı yarıya iner; kullanıcı
 * başına talep sayısı çok küçük olduğundan ek okuma maliyeti yok denecek
 * kadar azdır.
 *
 * GÜVENLİK: `firestore.rules`'taki `allow list: if isAdmin() ||
 * isVekaletParticipant(existing())` kuralı SORGU ŞEKLİNE değil yalnızca belge
 * alanlarına (`gonderenUid`/`aliciUid == request.auth.uid`) bakar — `durum`
 * filtresinin kalkması kuralı etkilemez. `aliciUid` üzerindeki tek alanlı
 * eşitlik sorgusu otomatik indekslidir, yeni composite index gerekmez.
 *
 * `bildirimUygulandi` filtresi (bekleyen devirler için) istemci tarafında
 * uygulanır — Firestore'da `!=` + başka `where` kombinasyonu ek composite
 * index gerektirir (bkz. eski `useBekleyenVekaletDevirleri` yorumu).
 */
export function useVekaletTalepleri(uid: string | undefined): VekaletTalepDurumlari {
  const [talepler, setTalepler] = useState<(VekaletTalebi & { id: string })[]>([]);
  const showNotification = useNotificationStore((s) => s.showNotification);

  if (useChangeKey(uid)) {
    setTalepler([]);
  }

  useEffect(() => {
    if (!uid) return;

    // `durum` filtresi YOK: hem 'beklemede' (gelen teklifler) hem
    // 'kabul_edildi'/'reddedildi' (devir takibi) aynı dinleyiciden gelir.
    // Filtresiz sorgunun ek bir faydası: bir talep 'beklemede' →
    // 'kabul_edildi' → (cron) 'reddedildi' yolculuğunun TAMAMINDA sorgu
    // kapsamında kalır, dolayısıyla her geçiş docChanges'a 'modified' olarak
    // düşer; hiçbir aşamada 'removed' (verisi güncel olmayan değişim tipi)
    // üretilmez.
    const q = query(collection(db, 'vekalet_talepleri'), where('aliciUid', '==', uid));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        // `bildirimUygulandi`, script'in talebi İŞLEDİĞİNİ gösterir, SONUCUNU
        // değil — hem başarı hem red aynı bayrağı true yapar. Script gerçekten
        // reddettiğinde ('modified' tipi — ilk yüklemede eski/zaten-reddedilmiş
        // taleplerin 'added' olarak gelip yeniden bildirim üretmemesi için
        // kasıtlı olarak yalnızca 'modified' kontrol edilir) kullanıcıya TEK
        // seferlik bir toast gösterilir; aksi halde banner sessizce kaybolup
        // kullanıcı devri gerçekten alıp almadığını hiç öğrenemiyordu (bkz.
        // mimari denetim).
        //
        // Sorgu artık 'beklemede'yi de kapsadığından ARA adımlar (beklemede →
        // kabul_edildi) de 'modified' olarak görünür; ama toast'ı tetikleyen
        // koşul yalnızca `bildirimUygulandi === true && talepSonuc ===
        // 'reddedildi'` olduğundan bu ara adımlarda koşul tutmaz — toast erken
        // ateşlenmez.
        snapshot.docChanges().forEach((change) => {
          if (change.type !== 'modified') return;
          const data = change.doc.data() as VekaletTalebi;
          if (data.bildirimUygulandi === true && data.talepSonuc === 'reddedildi') {
            showNotification(
              'Devir Uygulanamadı',
              `${data.tarih} ${toTurkishUpperCase(String(data.vakit))} vakti için kabul ettiğiniz devir işlenirken artık uygun bulunmadınız. Admin bilgilendirildi.`,
              'error'
            );
          }
        });

        setTalepler(snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as VekaletTalebi) })));
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'vekalet_talepleri');
      }
    );

    return () => unsubscribe();
  }, [uid, showNotification]);

  const gelenVekaletler = useMemo(() => talepler.filter((talep) => talep.durum === 'beklemede'), [talepler]);

  const bekleyenDevirler = useMemo(
    () => talepler.filter((talep) => talep.durum === 'kabul_edildi' && talep.bildirimUygulandi !== true),
    [talepler]
  );

  return useMemo(() => ({ gelenVekaletler, bekleyenDevirler }), [gelenVekaletler, bekleyenDevirler]);
}
