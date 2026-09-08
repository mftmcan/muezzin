import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { Bildirim } from '../../types';
import { handleFirestoreError, OperationType } from '../../lib/firestore-errors';
import { getTurkeyDateString, getTurkeyNow } from '../../lib/dateUtils';

/**
 * Arşivin kaç ay geriye baktığı. Sorgu ÖNCEDEN yalnızca
 * `durum == 'reddedildi'` ile filtreleniyordu — hiçbir tarih alt sınırı ve
 * `limit` olmadan. `bildirimler` koleksiyonu her hafta yeni nöbet kayıtlarıyla
 * büyüdüğünden (ve reddedilmiş mazeretler hiç silinmediğinden) bu dinleyici
 * aylar/yıllar içinde sınırsızca büyüyen bir sonuç kümesini CANLI dinliyordu:
 * admin panelini her açışta tüm geçmiş yeniden okunuyor, üstelik her satır için
 * ayrıca bir `mazeret_detaylari` okuması yapılıyordu (bkz. aşağıdaki önbellek).
 *
 * Alt sınır deseni `scripts/mazeretDevirleriniIsle.ts`'ten alınmıştır (aynı
 * koleksiyon, aynı `durum == 'reddedildi'` filtresi, orada 30 günlük pencere).
 * Burada pencere daha geniş: bu ekran operasyonel bir uzlaştırma işi değil,
 * admin'in geriye dönük baktığı ve CSV'ye aktardığı bir ARŞİV — bir yıllık
 * kapsam hem anlamlı hem de sınırlı.
 */
const ARSIV_AY_SAYISI = 12;

/**
 * `limit()` KULLANILMAZ: sorguda `orderBy` yok (bkz. aşağıdaki istemci-tarafı
 * sıralama), bu yüzden Firestore'un örtük sıralaması aralık alanı olan
 * `tarih`'e göre ARTAN'dır — bir `limit(N)` en YENİ değil en ESKİ N kaydı
 * döndürürdü. Azalan bir `orderBy` eklemek ise yeni bir bileşke indeks
 * (durum ASC, tarih DESC) gerektirir; mevcut `firestore.indexes.json`'da
 * `bildirimler: [durum, tarih]` (ikisi de ASC) indeksi zaten var ve aşağıdaki
 * eşitlik+aralık sorgusunu olduğu gibi karşılıyor.
 */
function arsivBaslangicTarihi(): string {
  const simdi = getTurkeyNow();
  const baslangic = new Date(simdi);
  baslangic.setMonth(baslangic.getMonth() - ARSIV_AY_SAYISI);
  return getTurkeyDateString(baslangic);
}

export function useMazeretGecmisi() {
  const [reddedilenler, setReddedilenler] = useState<(Bildirim & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  // Bir kez hesaplanır: bileşen yeniden render olduğunda sorgu penceresinin
  // kaymaması (ve efektin yeniden kurulmaması) için.
  const baslangicTarihi = useMemo(() => arsivBaslangicTarihi(), []);

  useEffect(() => {
    let iptalEdildi = false;

    // `mazeret_detaylari` kayıtları DEĞİŞMEZ (create + delete; `allow update:
    // if false`, bkz. firestore.rules) — bu yüzden bir kez okunan retSebebi
    // efektin ömrü boyunca önbelleğe alınabilir. Önceden HER snapshot, listedeki
    // HER satır için yeniden bir `getDoc` fan-out'u başlatıyordu: N satırlık bir
    // arşivde tek bir mazeret kaydının silinmesi bile N okuma daha üretiyordu.
    const detayOnbellek = new Map<string, string | null>();
    // Hızlı ardışık snapshot'lar (ör. yerel önbellek → sunucu) aynı satır için
    // İKİNCİ bir okuma başlatmasın diye uçuştaki id'ler ayrıca izlenir.
    const ucustakiIdler = new Set<string>();

    /** Önbellekteki detayları satırlara işler; hiçbir şey değişmiyorsa AYNI
     *  diziyi döndürür — böylece gereksiz bir yeniden render tetiklenmez. */
    const detaylariUygula = (satirlar: (Bildirim & { id: string })[]) => {
      let degisti = false;
      const sonuc = satirlar.map((b) => {
        if (!detayOnbellek.has(b.id)) return b;
        const retSebebi = detayOnbellek.get(b.id) ?? null;
        if (b.retSebebi === retSebebi) return b;
        degisti = true;
        return { ...b, retSebebi };
      });
      return degisti ? sonuc : satirlar;
    };

    const q = query(collection(db, 'bildirimler'), where('durum', '==', 'reddedildi'), where('tarih', '>=', baslangicTarihi));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as (Bildirim & {
          id: string;
        })[];
        // Client side sort to avoid requiring a composite index
        data.sort((a, b) => b.tarih.localeCompare(a.tarih));
        setReddedilenler(detaylariUygula(data));
        setLoading(false);

        // retSebebi artık bildirimler snapshot'ında gelmiyor — ayrı,
        // yalnızca kendisi+admin'in okuyabildiği mazeret_detaylari
        // koleksiyonuna taşındı (bkz. firestore.rules yorumu, mimari denetim
        // — altıncı tur). Doc ID karşılık gelen bildirim ile aynı olduğundan
        // doğrudan eşleştirilir. Sabit/immutable bir kayıt olduğundan canlı
        // dinlemeye gerek yok, tek seferlik okunur.
        const eksikler = data.filter((b) => !detayOnbellek.has(b.id) && !ucustakiIdler.has(b.id));
        if (eksikler.length === 0) return;
        eksikler.forEach((b) => ucustakiIdler.add(b.id));

        void Promise.all(
          eksikler.map(async (b) => {
            try {
              const detaySnap = await getDoc(doc(db, 'mazeret_detaylari', b.id));
              const retSebebi = detaySnap.exists() ? ((detaySnap.data().retSebebi as string) ?? null) : null;
              // Önbellek, uçuş kaydı silinmeden ÖNCE yazılır — aksi halde
              // ikisi arasındaki mikro-görev penceresinde gelen bir snapshot
              // aynı satır için gereksiz bir okuma daha başlatabilirdi.
              detayOnbellek.set(b.id, retSebebi);
            } catch {
              // Okuma HATASINDA önbelleğe yazılmaz — aksi halde geçici bir
              // hata, oturum boyunca kalıcı bir "sebep belirtilmedi"ye
              // dönüşürdü; sonraki snapshot yeniden dener.
            } finally {
              ucustakiIdler.delete(b.id);
            }
          })
        ).then(() => {
          // Bileşen unmount olduysa (ya da efekt yeniden kurulduysa) çözülen
          // fan-out artık state'e DOKUNMAZ. Önceden bu kontrol hiç yoktu:
          // admin sekme değiştirdiğinde uçuştaki getDoc'lar unmount sonrası
          // setState çağırıyordu.
          if (iptalEdildi) return;
          // Fonksiyonel güncelleme + önbellek birleştirmesi: bu fan-out
          // başlatıldığından beri daha YENİ bir snapshot gelmiş olsa bile
          // yalnızca O SNAPSHOT'IN satırları üzerinde çalışılır — bayat bir
          // liste geri yazılamaz, silinmiş bir satır diriltilemez.
          setReddedilenler((prev) => detaylariUygula(prev));
        });
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'bildirimler');
        setLoading(false);
      }
    );

    return () => {
      iptalEdildi = true;
      unsubscribe();
    };
  }, [baslangicTarihi]);

  return { gecmis: reddedilenler, loading, baslangicTarihi, arsivAySayisi: ARSIV_AY_SAYISI };
}
