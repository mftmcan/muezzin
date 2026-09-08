import { deleteDoc, doc, getDoc, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { mazeretZamanKontrolYap } from './mazeretServisi';
import { Bildirim, Vakit, VekaletTalebi } from '../types';
import { vekaletDevriBekliyorGecerliMi } from '../lib/slotKorumasi';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

function buildVekaletTalebiId(haftaId: string, tarih: string, vakit: Vakit, tip: 'asil' | 'yedek' | 'gorev_cagrisi', aliciUid: string) {
  return `${haftaId}_${tarih}_${vakit}_${tip}_${aliciUid}`;
}

export async function vekaletTeklifEt(
  bildirimId: string,
  haftaId: string,
  tarih: string,
  vakit: Vakit,
  saat: string,
  tip: 'asil' | 'yedek' | 'gorev_cagrisi',
  aliciUid: string,
  aliciIsim: string
): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Oturum açmış bir kullanıcı bulunamadı.');

  // Cuma günleri ve mazeretin 1 saatlik son başvuru penceresi, görev devri
  // (vekalet) için de geçerlidir — aksi halde mazeret kısıtlaması bu yoldan
  // atlatılabilir (bkz. mimari denetim K3/K4). Bildirim belgesindeki
  // (eski belgelerde eksik olabilen) `cumaMi` alanına GÜVENMEZ, `tarih`'ten
  // taze türetir — bkz. src/services/mazeretServisi.ts `mazeretZamanKontrolYap`.
  // GÜNCELLEME (kod denetimi — cihaz saati bypass'ı): 1 saatlik zaman
  // penceresinin ARTIK sunucu tarafı karşılığı VAR — firestore.rules
  // `isValidVekaletCreate` → `mazeretPenceresiAcik`, bildirim belgesindeki
  // önceden hesaplanmış `mazeretSonBasvuru` damgasını Firestore'un KENDİ
  // `request.time` değeriyle karşılaştırır. Bu satır artık yalnızca bir
  // UX/erken-ret katmanıdır: `getTurkeyNow()`, RTDB zaman senkronu
  // (src/lib/timeSync.ts) hiç ateşlemezse cihazın saatine düşer ve GÜVENLİK
  // SINIRI SAYILMAZ. Kabulden sonraki gerçek transfer anında ezan vaktinin
  // geçip geçmediği ayrıca scripts/vekaletDevirleriniIsle.ts'te (Admin SDK,
  // taze veriyle) tekrar kontrol edilir.
  const mazeretDurumu = await mazeretZamanKontrolYap(tarih, vakit, saat);
  if (mazeretDurumu.kapali) {
    throw new Error(mazeretDurumu.sebep ?? 'Bu görev için görev devri (vekalet) kullanılamaz.');
  }

  const talepId = buildVekaletTalebiId(haftaId, tarih, vakit, tip, aliciUid);
  const talepRef = doc(db, 'vekalet_talepleri', talepId);
  const path = `vekalet_talepleri/${talepId}`;

  try {
    // Talep ID'si deterministik (haftaId_tarih_vakit_tip_aliciUid) — aynı
    // alıcıya aynı görev için ikinci kez teklif göndermek normalde bir
    // `update` sayılır ve hiçbir kuralla eşleşmediği için reddedilir. Daha
    // önce reddedilmiş bir talep varsa önce sil (aşağıdaki create bu yüzden
    // gerçek bir create olur) — aksi halde bir kez reddedilen teklif o
    // gün/vakit için kalıcı olarak kilitleniyordu (bkz. mimari denetim O7).
    const oncekiTalepSnap = await getDoc(talepRef);
    if (oncekiTalepSnap.exists() && oncekiTalepSnap.data().durum === 'reddedildi') {
      await deleteDoc(talepRef);
    }

    await setDoc(talepRef, {
      bildirimId,
      haftaId,
      gonderenUid: currentUser.uid,
      gonderenIsim: currentUser.displayName || currentUser.email || 'Değerli Hocam',
      aliciUid,
      aliciIsim,
      tarih,
      vakit,
      saat,
      tip,
      durum: 'beklemede',
      olusturmaTarihi: serverTimestamp(),
    });
  } catch (err) {
    // Bu dosya önceden hiçbir Firestore yazımını handleFirestoreError ile
    // sarmalamıyordu — diğer tüm yazma servisleriyle (mazeret/muezzin/
    // plan/duyuru/okudum) tutarlı hale getirildi (bkz. kod denetimi).
    throw handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function vekaletKabulEt(talepId: string): Promise<void> {
  const talepRef = doc(db, 'vekalet_talepleri', talepId);
  const path = `vekalet_talepleri/${talepId}`;

  // Mazeret zaman penceresi kontrolü Firestore'dan ezan verisi çekmek zorunda
  // olduğundan transaction dışında yapılır (mazeretBildir ile aynı desen).
  // Teklif gönderildikten SONRA ezan vakti geçmiş olabileceğinden bu kontrol
  // kabul anında AYRICA yapılmalı — yalnızca teklif anında bakmak yetmez
  // (bkz. mimari denetim K4). Aşağıdaki transaction'daki 'beklemede' ve
  // bildirim 'bekliyor' kontrolleri otoriter kalır; bu yalnızca erken bir
  // reddir, kabulü tetikleyen esas doğrulama değildir.
  // Kabulün SUNUCU tarafı zorlayıcısı iki yerdedir (ikisi de bu
  // transaction'ın yazımlarını kapsar): firestore.rules
  // `isRecipientVekaletStatusUpdate` → `vekaletKabulPenceresiAcik` (talep
  // durumu yazımı) ve `isVekaletDevriBekliyorIsareti` → `mazeretPenceresiAcik`
  // (bildirimdeki niyet bayrağı). Cihaz saati geri alınmış bir istemci bu
  // yüzden pencereyi artık atlatamaz.
  const onKontrolSnap = await getDoc(talepRef);
  if (!onKontrolSnap.exists()) throw new Error('Vekalet talebi bulunamadı.');
  const onKontrolTalep = onKontrolSnap.data() as VekaletTalebi;
  // `onKontrolTalep.saat` GÖNDERENİN yazdığı serbest metin bir alan —
  // üçüncü parametre olarak geçirilmez ki `mazeretZamanKontrolYap` gerçek
  // ezan saatini `vakitler` koleksiyonundan taze okusun (mazeretBildir'in
  // asil yolundaki gibi). Önceden dürüst bir alıcı, kötü niyetli/hatalı bir
  // göndericinin yazdığı saate güvenip pencereyi yanlış açık/kapalı
  // görebiliyordu — bu erken kontrol otoriter olmasa da (bkz. yukarıdaki
  // yorum) yanlış erken ret/kabul UX'i üretmemeli (premium hata analizi MV-O3).
  const mazeretDurumu = await mazeretZamanKontrolYap(onKontrolTalep.tarih, onKontrolTalep.vakit);
  if (mazeretDurumu.kapali) {
    throw new Error(mazeretDurumu.sebep ?? 'Bu görev için vekalet kabul penceresi kapandı.');
  }

  // NOT ("1000 ifade tavanı" kök neden çözümü): bu transaction eskiden
  // bildirimler.uid'i BURADA, anlık olarak flip ediyordu — bu,
  // firestore.rules'taki `isAcceptedVekaletBildirimTransfer`'in emülatörün
  // "1000 ifade" bütçesine çarpan ~45 terimlik çapraz-belge doğrulamasını
  // (talep korelasyonu + atanabilirlik + Cuma + izin-günü, hepsi CEL'de)
  // gerektiriyordu. Artık istemci yalnızca (1) talebi kabul edildi olarak
  // işaretliyor ve (2) bildirime dar bir "niyet" bayrağı
  // (vekaletDevriBekliyor) yazıyor — GERÇEK transfer (uid flip'i + tüm iş
  // kurallarının taze veriyle yeniden doğrulanması, audit-log dahil) artık
  // scripts/vekaletDevirleriniIsle.ts'te, Admin SDK ile (kural bütçesi yok)
  // gerçekleşiyor; script'in bir sonraki çalışmasına kadar (~10-15 dk)
  // gecikmeli.
  try {
    await runTransaction(db, async (transaction) => {
      const talepDoc = await transaction.get(talepRef);
      if (!talepDoc.exists()) throw new Error('Vekalet talebi bulunamadı.');

      const talep = talepDoc.data() as VekaletTalebi;
      if (talep.durum !== 'beklemede') throw new Error('Bu talep zaten sonuçlandırılmış.');
      if (talep.aliciUid !== auth.currentUser?.uid) throw new Error('Bu vekalet teklifi size ait değil.');

      const bildirimRef = doc(db, 'bildirimler', talep.bildirimId);
      const bildirimDoc = await transaction.get(bildirimRef);
      if (!bildirimDoc.exists()) throw new Error('Orijinal görev bildirimi bulunamadı.');

      const bildirim = bildirimDoc.data() as Bildirim;
      if (bildirim.durum !== 'bekliyor') throw new Error('Bu görev zaten sonuçlandırılmış.');
      // Aynı bildirim için BAŞKA bir alıcının kabulü zaten "niyet" bayrağını
      // yazmış olabilir (asıl sahip aynı görevi birden fazla kişiye teklif
      // etmişse, iki farklı talep aynı bildirimId'yi paylaşabilir).
      // `bildirim.durum` bu durumda hâlâ 'bekliyor' kalır (bayrak durumu
      // değiştirmez), bu yüzden ayrıca kontrol edilmezse iki kabul de burada
      // başarılı olur ve GERÇEK sonuç yalnızca ~10-15 dk sonra
      // scripts/vekaletDevirleriniIsle.ts'in `bildirim.uid === talep.gonderenUid`
      // kontrolüyle (kaybedene admin uyarısı üreterek) çözülürdü — bunu
      // burada erkenden reddetmek kullanıcıya anında doğru geri bildirim
      // verir (bkz. kod denetimi race condition bulgusu).
      //
      // ZAMAN AŞIMI (aynı kök neden — bkz. src/lib/slotKorumasi.ts
      // VEKALET_DEVRI_BEKLEME_ASIMI_MS): düz `=== true` kontrolü, uzlaştırma
      // cron'u 30 günlük sorgu penceresinden daha uzun süre durursa bu görevi
      // vekalete KALICI OLARAK kapatıyordu — bayrağı temizleyecek tek yol o
      // script olduğundan hiç kimse bir daha o bildirim için devir kabul
      // edemezdi. Bayat bir bayrak "devam eden devir" sayılmaz. Burada istemci
      // saati kullanılıyor olması güvenlik sorunu değil: bu kontrol yalnızca
      // erken/UX reddidir (yukarıdaki yoruma bkz.), otoriter olan
      // firestore.rules ve scripts/vekaletDevirleriniIsle.ts'tir — saati
      // kaydırılmış bir cihaz en fazla, bu kontrol hiç yokken de var olan
      // "iki kabul yarışı" durumunu üretir ve onu cron zaten çözer.
      if (vekaletDevriBekliyorGecerliMi(bildirim)) {
        throw new Error('Bu görev için zaten bekleyen başka bir vekalet devri var.');
      }

      transaction.update(talepRef, { durum: 'kabul_edildi', sonGuncelleme: serverTimestamp() });
      transaction.update(bildirimRef, { vekaletDevriBekliyor: true, sonGuncelleme: serverTimestamp() });
    });
  } catch (err) {
    throw handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function vekaletReddet(talepId: string): Promise<void> {
  const talepRef = doc(db, 'vekalet_talepleri', talepId);
  const path = `vekalet_talepleri/${talepId}`;
  try {
    await updateDoc(talepRef, { durum: 'reddedildi', sonGuncelleme: serverTimestamp() });
  } catch (err) {
    throw handleFirestoreError(err, OperationType.UPDATE, path);
  }
}
