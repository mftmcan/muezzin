import {
  collection,
  deleteField,
  doc,
  deleteDoc,
  DocumentData,
  FirestoreError,
  getDocsFromServer,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Invite, Muezzin } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { telemetryService } from './telemetryService';
import { haftalikPlanOlustur } from './planServisi';
import { getHaftaIdFromDate, getTurkeyDateString, toTurkishUpperCase } from '../lib/dateUtils';

type MuezzinDoc = Muezzin & { id: string };
type InviteDoc = Invite & { id: string };

/** Bir personelin sistemdeki son aktif yönetici olup olmadığını belirler — son yönetici pasife/arşive alınamaz.
 * Bu, YALNIZCA hızlı bir istemci-tarafı ön-kontrol (anlık UI geri bildirimi
 * için) — çağıranlar (`muezzinler`) genelde Zustand/onSnapshot önbelleğinden
 * gelir. Asıl yetkilendirici karşılığı `sonAdminKorumaliGuncelle`'dir (bkz.
 * o fonksiyonun yorumu) — burada true dönmesi işlemi engellemek için
 * yeterli, ama false dönmesi TEK BAŞINA yeterli değil. */
export function isLastActiveAdmin(m: MuezzinDoc, muezzinler: MuezzinDoc[]): boolean {
  const activeAdmins = muezzinler.filter((user) => user.role === 'admin' && user.aktif === true && user.arsivlendi !== true);
  return m.role === 'admin' && m.aktif === true && activeAdmins.length <= 1;
}

/** Sunucudan taze aday aktif-admin UID listesini toplar — `getDocsFromServer`
 * ile istemci önbelleğini atlar. Bu liste TEK BAŞINA yetkilendirici DEĞİL,
 * yalnızca "`sonAdminKorumaliGuncelle`'in transaction içinde BİLİNEN belge
 * referansı olarak okuyacağı adaylar hangileri" sorusuna cevap verir —
 * gerçek sayım/karar orada, aynı transaction'daki taze `transaction.get()`
 * okumalarıyla yapılır. */
async function aktifAdminUidleriGetir(): Promise<string[]> {
  const q = query(collection(db, 'muezzins'), where('role', '==', 'admin'), where('aktif', '==', true));
  const snap = await getDocsFromServer(q);
  return snap.docs.filter((d) => d.data().arsivlendi !== true).map((d) => d.id);
}

/**
 * "Son aktif admin" değişmezini GERÇEKTEN atomik olarak uygulayarak
 * `hedefUid`'e `guncelleme`'yi yazar. Firestore Web SDK transaction'ları
 * SORGU okuyamaz, yalnızca BİLİNEN belge referanslarını okuyabilir — bu
 * yüzden aday admin kümesi transaction DIŞINDA (taze bir sorguyla,
 * `aktifAdminUidleriGetir`) toplanır, ama asıl SAYIM ve YAZIM AYNI
 * transaction içinde, bu adayların `transaction.get()` ile taze
 * okunmasıyla yapılır.
 *
 * Neden bu atomik: iki admin birbirini AYNI anda pasifleştirmeye çalışırsa,
 * her iki transaction'ın da okuma kümesi (aday admin belgeleri, ki her iki
 * adminin KENDİ belgesini de içerir) diğerinin YAZDIĞI belgeyle çakışır —
 * Firestore bu çakışmayı optimistic concurrency ile tespit edip kaybedeni
 * otomatik olarak YENİDEN ÇALIŞTIRIR; yeniden çalıştırmada taze okuma artık
 * güncel (azalmış) sayıyı görür ve doğru şekilde reddeder. (Önceki, tek
 * başına bir `getDocsFromServer` + transaction'sız `updateDoc` yaklaşımı
 * yarışı yalnızca DARALTIYORDU — bkz. kod denetimi race condition bulgusu —
 * bu tasarım onu tamamen KAPATIR, ayrı bir sayaç belgesi/şema göçü
 * gerektirmeden.)
 */
async function sonAdminKorumaliGuncelle(hedefUid: string, guncelleme: DocumentData, hataMesaji: string): Promise<void> {
  const adayUidler = await aktifAdminUidleriGetir();
  const tumUidler = adayUidler.includes(hedefUid) ? adayUidler : [...adayUidler, hedefUid];
  await runTransaction(db, async (transaction) => {
    const snaps = await Promise.all(tumUidler.map((uid) => transaction.get(doc(db, 'muezzins', uid))));
    const aktifAdminSayisi = snaps.filter((s) => {
      const data = s.data();
      return s.exists() && data?.role === 'admin' && data?.aktif === true && data?.arsivlendi !== true;
    }).length;
    if (aktifAdminSayisi <= 1) {
      throw new Error(hataMesaji);
    }
    transaction.update(doc(db, 'muezzins', hedefUid), guncelleme);
  });
}

/**
 * Bir kullanıcının kendi görünen adını (displayName) günceller.
 *
 * `src/pages/profil/ProfileHeader.tsx` önceden bu yazımı servis katmanını
 * atlayıp doğrudan `updateDoc` ile yapıyordu — bu yüzden (a) hata
 * `handleFirestoreError` ile eşlenmiyor, ham/İngilizce bir SDK hatası
 * kullanıcıya sızabiliyor ve telemetriye hiç düşmüyordu, (b) admin
 * panelindeki eşdeğer işlemin (`personelKaydet`) bıraktığı audit-log izi
 * kullanıcının kendi profilini değiştirmesinde hiç oluşmuyordu (bkz. kod
 * denetimi). Çağıran taraf (ProfileHeader) offline zaman aşımı koruması
 * için bunu `zamanAsimiIle` ile sarmalamalı — `okudumOnayla`/`vekaletKabulEt`
 * çağrılarıyla AYNI desen.
 */
export async function kendiAdiniGuncelle(uid: string, displayName: string): Promise<void> {
  const path = `muezzins/${uid}`;
  try {
    await updateDoc(doc(db, 'muezzins', uid), { displayName });
    await telemetryService.logAudit('Profil Güncelleme', uid, `Kullanıcı kendi görünen adını "${displayName}" olarak güncelledi.`);
  } catch (err) {
    throw handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

/** Bekleyen davetleri canlı dinler (yalnızca admin panelinde kullanılır). */
export function invitesAbone(onData: (invites: InviteDoc[]) => void, onError: (error: FirestoreError) => void): () => void {
  return onSnapshot(collection(db, 'invites'), (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as InviteDoc)), onError);
}

/** Gece cron'unun (scripts/haftalikPlanOlustur.ts) ürettiği kadar ileri hafta
 * sayısı — bkz. mimari denetim O4: kadro değişikliği yalnızca bu haftayı
 * yeniliyordu, +1/+2 haftalarındaki planlarda pasife alınan personel
 * atanmış kalmaya devam ediyordu, hiçbir uyarı da üretilmiyordu. */
const GUVENLI_YENILEME_HAFTA_SAYISI = 3;

/** Mevcut VE gece cron'unun ürettiği kadar ileri haftaların (bu hafta +
 * sonraki 2 hafta) her biri için güvenli bir yeniden hesaplama dener —
 * `role==='muezzin'` guard'ı YOK, çağıran taraf bu kararı verir (bkz.
 * `haftaPlaniniGuvenliYenile` ve mimari denetim O1). Başarısızlık sessizce
 * raporlanır — asıl işlemi engellemez; bir haftanın başarısız olması
 * diğerlerinin denenmesini engellemez. */
async function haftalikPlanlariYenile(): Promise<boolean> {
  const bugun = getTurkeyDateString();
  let hepsiBasarili = true;
  for (let haftaOffset = 0; haftaOffset < GUVENLI_YENILEME_HAFTA_SAYISI; haftaOffset++) {
    try {
      const [y, mo, d] = bugun.split('-').map(Number);
      const hedefTarih = new Date(y, mo - 1, d + haftaOffset * 7);
      const hedefTarihStr = getTurkeyDateString(hedefTarih);
      const haftaId = getHaftaIdFromDate(hedefTarihStr);
      await haftalikPlanOlustur(haftaId);
    } catch (err) {
      console.warn(`Kadro değişikliği sonrası plan yenilenemedi (hafta +${haftaOffset}):`, err);
      hepsiBasarili = false;
    }
  }
  return hepsiBasarili;
}

/** Kadro değişikliğinin (aktiflik/onay/arşiv geçişleri) plan yenilemesi
 * gerektirip gerektirmediğine `role==='muezzin'` bakarak karar verir —
 * `personelAktiflikDegistir`/`personelOnayla`/`personelGeriYukle`/
 * `personelArsivle` bu geçişlerin hepsinde kişinin rolü zaten 'muezzin'
 * olarak sabit kalır, yalnızca `aktif`/`onayBekliyor`/`arsivlendi` değişir. */
async function haftaPlaniniGuvenliYenile(m: MuezzinDoc): Promise<boolean> {
  if (m.role !== 'muezzin') return true;
  return haftalikPlanlariYenile();
}

export async function personelAktiflikDegistir(m: MuezzinDoc, muezzinler: MuezzinDoc[]): Promise<{ planRefreshed: boolean }> {
  if (isLastActiveAdmin(m, muezzinler)) {
    throw new Error('Son aktif yönetici pasife alınamaz.');
  }
  const path = `muezzins/${m.id}`;
  try {
    if (m.role === 'admin' && m.aktif === true) {
      // Aktif bir admin'i pasifleştiriyoruz — tam atomik son-admin koruması
      // gerekli (bkz. sonAdminKorumaliGuncelle). Aktifleştirme yönünde bu
      // kısıt anlamsız (aksine bir yazım updateDoc ile yeterli).
      await sonAdminKorumaliGuncelle(m.id, { aktif: false, onayBekliyor: false }, 'Son aktif yönetici pasife alınamaz.');
    } else {
      await updateDoc(doc(db, 'muezzins', m.id), { aktif: !m.aktif, onayBekliyor: false });
    }
    const planRefreshed = await haftaPlaniniGuvenliYenile(m);
    await telemetryService.logAudit(
      'Kadro Durumu Değiştirme',
      m.displayName,
      `Personel aktiflik durumu ${!m.aktif ? 'AKTİF' : 'PASİF'} yapıldı.`
    );
    return { planRefreshed };
  } catch (err) {
    throw handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function personelOnayla(m: MuezzinDoc): Promise<{ planRefreshed: boolean }> {
  const path = `muezzins/${m.id}`;
  try {
    await updateDoc(doc(db, 'muezzins', m.id), { aktif: true, onayBekliyor: false });
    if (m.email) {
      await deleteDoc(doc(db, 'invites', m.email.toLowerCase()));
    }
    const planRefreshed = await haftaPlaniniGuvenliYenile(m);
    await telemetryService.logAudit('Personel Onaylama', m.displayName, 'Dizgeye katılım talebi onaylandı ve aktif kadroya dahil edildi.');
    return { planRefreshed };
  } catch (err) {
    throw handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function personelGeriYukle(m: MuezzinDoc): Promise<{ planRefreshed: boolean }> {
  const path = `muezzins/${m.id}`;
  try {
    await updateDoc(doc(db, 'muezzins', m.id), {
      aktif: true,
      onayBekliyor: false,
      arsivlendi: false,
      arsivTarihi: null,
    });
    const planRefreshed = await haftaPlaniniGuvenliYenile(m);
    await telemetryService.logAudit('Personel Geri Yükleme', m.displayName, 'Arşivlenmiş personel aktif kadroya geri yüklendi.');
    return { planRefreshed };
  } catch (err) {
    throw handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function personelArsivle(m: MuezzinDoc, muezzinler: MuezzinDoc[]): Promise<{ planRefreshed: boolean }> {
  if (isLastActiveAdmin(m, muezzinler)) {
    throw new Error('Son aktif yönetici arşive alınamaz.');
  }
  const path = `muezzins/${m.id}`;
  try {
    const guncelleme = {
      aktif: false,
      onayBekliyor: false,
      arsivlendi: true,
      arsivTarihi: Timestamp.now(),
    };
    if (m.role === 'admin' && m.aktif === true) {
      await sonAdminKorumaliGuncelle(m.id, guncelleme, 'Son aktif yönetici arşive alınamaz.');
    } else {
      await updateDoc(doc(db, 'muezzins', m.id), guncelleme);
    }
    const planRefreshed = await haftaPlaniniGuvenliYenile(m);
    await telemetryService.logAudit('Personel Arşivleme', m.displayName, 'Personel aktif kadrodan çıkarılarak arşiv kategorisine alındı.');
    return { planRefreshed };
  } catch (err) {
    throw handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function davetSil(inviteEmail: string): Promise<void> {
  const path = `invites/${inviteEmail}`;
  try {
    await deleteDoc(doc(db, 'invites', inviteEmail));
    await telemetryService.logAudit('Davetiye İptal', inviteEmail, 'Gönderilmiş dizge katılım davetiyesi iptal edildi ve silindi.');
  } catch (err) {
    throw handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export interface PersonelKaydetParams {
  editingUser: MuezzinDoc | null;
  muezzinler: MuezzinDoc[];
  fullName: string;
  role: 'muezzin' | 'admin' | 'gozlemci';
  haftalikIzinGunu: number;
  email: string;
}

/** Yeni personel daveti oluşturur veya mevcut bir personelin profilini günceller; rol/izin günü değişimi hafta planını güvenli şekilde yeniden dengeler.
 * `planRefreshed: false` dönmesi, kaydın kendisinin BAŞARISIZ olduğu anlamına gelmez — yalnızca artçı plan
 * yenilemesinin başarısız olduğunu (bkz. `haftalikPlanlariYenile`'in sessiz-raporlama deseni) belirtir; çağıran
 * taraf `personelAktiflikDegistir`/`personelOnayla`/`personelGeriYukle`/`personelArsivle` ile AYNI şekilde
 * `warnIfPlanNotRefreshed`-benzeri bir uyarı göstermeli (bkz. mimari denetim — bu alan bugüne kadar hiç
 * çağırana geri bildirilmiyordu, yalnızca console.warn'a düşüyordu). */
export async function personelKaydet(params: PersonelKaydetParams): Promise<{ planRefreshed: boolean }> {
  const { editingUser, muezzinler, fullName, role, haftalikIzinGunu } = params;

  if (editingUser) {
    const activeAdmins = muezzinler.filter((user) => user.role === 'admin' && user.aktif === true && user.arsivlendi !== true);
    const isLastActiveAdminRoleChange =
      editingUser.role === 'admin' && editingUser.aktif === true && role !== 'admin' && activeAdmins.length <= 1;
    if (isLastActiveAdminRoleChange) {
      throw new Error('Son aktif yöneticinin yetki seviyesi değiştirilemez.');
    }

    const path = `muezzins/${editingUser.id}`;
    try {
      const impactsDutyPlan = editingUser.role === 'muezzin' || role === 'muezzin' || editingUser.haftalikIzinGunu !== haftalikIzinGunu;
      const guncelleme = {
        displayName: fullName,
        role,
        haftalikIzinGunu: haftalikIzinGunu > 0 ? haftalikIzinGunu : deleteField(),
      };
      if (editingUser.role === 'admin' && editingUser.aktif === true && role !== 'admin') {
        // Aktif bir admin'in rolü admin DIŞINA değiştiriliyor — tam atomik
        // son-admin koruması gerekli (bkz. sonAdminKorumaliGuncelle).
        await sonAdminKorumaliGuncelle(editingUser.id, guncelleme, 'Son aktif yöneticinin yetki seviyesi değiştirilemez.');
      } else {
        await updateDoc(doc(db, 'muezzins', editingUser.id), guncelleme);
      }
      let planRefreshed = true;
      if (impactsDutyPlan) {
        // haftalikPlanlariYenile (guard'sız) kullanılır — haftaPlaniniGuvenliYenile
        // DEĞİL: o, geçirilen nesnenin YENİ rolüne bakıp 'muezzin' değilse
        // hiç yenilemiyordu, oysa rol muezzin'den BAŞKA bir şeye değiştiğinde
        // de (kişi rotasyondan çıkıyor) +1/+2 haftaların yenilenmesi gerekir
        // (bkz. mimari denetim O1).
        planRefreshed = await haftalikPlanlariYenile();
      }
      await telemetryService.logAudit(
        'Profil Güncelleme',
        fullName,
        `Kullanıcı rolü: ${toTurkishUpperCase(role)}, İzin günü: ${haftalikIzinGunu > 0 ? haftalikIzinGunu : 'Yok'}`
      );
      return { planRefreshed };
    } catch (err) {
      throw handleFirestoreError(err, OperationType.UPDATE, path);
    }
  } else {
    const mail = params.email.trim().toLowerCase();
    if (!mail || !mail.includes('@')) {
      throw new Error('Geçerli bir e-posta adresi giriniz.');
    }

    const path = `invites/${mail}`;
    try {
      const inviteData: Record<string, unknown> = {
        email: mail,
        displayName: fullName,
        role,
        olusturmaTarihi: Timestamp.now(),
      };
      if (haftalikIzinGunu > 0) {
        inviteData.haftalikIzinGunu = haftalikIzinGunu;
      }
      await setDoc(doc(db, 'invites', mail), inviteData);
      await telemetryService.logAudit('Personel Daveti', mail, `Kullanıcı adı: ${fullName}, Davet edilen rol: ${toTurkishUpperCase(role)}`);
      return { planRefreshed: true };
    } catch (err) {
      throw handleFirestoreError(err, OperationType.CREATE, path);
    }
  }
}
