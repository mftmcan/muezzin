import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { getTurkeyNow, parseVakitToDate } from '../lib/dateUtils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

export async function okudumOnayla(bildirimId: string): Promise<void> {
  // İstemci tarafı tepe yükü düzleştirme (Jittering: Spark planda ezan vakti eşzamanlı veritabanı yazma baskısını önler)
  const randomDelay = Math.floor(Math.random() * 1500);
  await new Promise((resolve) => setTimeout(resolve, randomDelay));

  const bildirimRef = doc(db, 'bildirimler', bildirimId);
  const path = `bildirimler/${bildirimId}`;

  try {
    await runTransaction(db, async (transaction) => {
      const bildirimDoc = await transaction.get(bildirimRef);
      if (!bildirimDoc.exists()) throw new Error('Bildirim bulunamadı');

      const bildirim = bildirimDoc.data();
      if (bildirim.uid !== auth.currentUser?.uid) throw new Error('Yetkisiz işlem');
      if (bildirim.durum !== 'bekliyor') throw new Error('Bu görev zaten sonuçlandırılmış.');

      // Get system settings to fetch district prefix (ilceId) dynamically
      const settingsDoc = await transaction.get(doc(db, 'settings', 'system'));
      const ilceId = settingsDoc.exists() ? settingsDoc.data()?.ilceId || '9148' : '9148';

      // Ezan saati kontrolü (Dynamic prefix fixed)
      const buAyYYYYMM = bildirim.tarih.slice(0, 7);
      const buAyDocId = `${ilceId}_${buAyYYYYMM}`;
      const vakitDoc = await transaction.get(doc(db, 'vakitler', buAyDocId));
      // Yalnızca ilk `?.` ile zincirlenmişti — belge varsa ama `gunler` alanı
      // eksikse ya da `gunler`de bu tarih anahtarı yoksa (offline-first PWA
      // soğuk başlangıcı, admin henüz önbellek senkronu yapmadıysa) bu satır
      // aşağıdaki temiz 'Vakit bilgisi bulunamadı' hatası yerine yakalanmamış
      // ham bir TypeError fırlatıyordu — kullanıcı toast'ta anlaşılmaz teknik
      // bir mesaj görüyordu. mazeretServisi.ts'teki aynı okuma zaten tam
      // zincirleme kullanıyor (bkz. code-review, dördüncü denetim turu).
      const vakitSaati = vakitDoc.data()?.gunler?.[bildirim.tarih]?.[bildirim.vakit];

      if (!vakitSaati) throw new Error('Vakit bilgisi bulunamadı');

      const ezanSaati = parseVakitToDate(bildirim.tarih, vakitSaati);
      if (!ezanSaati) throw new Error('Vakit bilgisi bulunamadı');
      const simdi = getTurkeyNow();

      if (simdi.getTime() < ezanSaati.getTime()) {
        throw new Error('Henüz ezan vakti gelmedi');
      }

      // Not: aylikVakitSayisi puanı burada artırılmıyor — bu alan Firestore
      // kurallarında müezzinin kendi profilini güncelleme iznine dahil değil
      // (bkz. firestore.rules `muezzins` self-update). Puan, gece yatsı sonrası
      // cron'unda (scripts/yatsiSonuIslemleri.ts) bu bildirimin `durum` alanına
      // bakılarak merkezi olarak veriliyor.
      transaction.update(bildirimRef, { durum: 'onaylandi', pendingAck: false, sonGuncelleme: serverTimestamp() });
    });
  } catch (err) {
    // Bu dosya önceden hiçbir Firestore yazımını handleFirestoreError ile
    // sarmalamıyordu — ham SDK hataları (ör. 'unavailable', 'permission-
    // denied') doğrudan UI'a sızıyor ve telemetriye hiç düşmüyordu (bkz.
    // kod denetimi). Diğer tüm yazma servisleriyle (mazeret/muezzin/plan/
    // duyuru/vakitCache) tutarlı hale getirildi.
    throw handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function adminOkudumOnayla(bildirimId: string): Promise<void> {
  const bildirimRef = doc(db, 'bildirimler', bildirimId);
  const path = `bildirimler/${bildirimId}`;

  try {
    await runTransaction(db, async (transaction) => {
      const bildirimDoc = await transaction.get(bildirimRef);
      if (!bildirimDoc.exists()) {
        throw new Error('Bildirim bulunamadı');
      }

      const bildirim = bildirimDoc.data();
      if (bildirim.durum !== 'bekliyor') {
        throw new Error('Bu görev zaten sonuçlandırılmış.');
      }

      // Not: aylikVakitSayisi puanı burada artırılmıyor — okudumOnayla'daki
      // gibi puanlama yalnızca gece yatsı sonrası cron'unda (scripts/
      // yatsiSonuIslemleri.ts), bildirimin `durum` alanına bakılarak merkezi
      // olarak veriliyor. Burada da artırılsaydı, cron aynı geceyi tekrar
      // sayıp çift puan verirdi (bkz. mimari denetim O7).
      transaction.update(bildirimRef, {
        durum: 'onaylandi',
        pendingAck: false,
        sonGuncelleme: serverTimestamp(),
      });
    });
  } catch (err) {
    throw handleFirestoreError(err, OperationType.UPDATE, path);
  }
}
