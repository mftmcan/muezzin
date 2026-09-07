import { collection, getCountFromServer, getDocs, limit, query, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { telemetryService } from './telemetryService';
import { zamanAsimiIle } from '../lib/timeoutUtils';

/**
 * Sıfırlanabilir OPERASYONEL koleksiyonlar — "yeni sezona sıfırdan başla"
 * niyetiyle silinmesi güvenli olan, geçmiş/kalıcı bir kayıt SAYILMAYAN
 * veriler. `muezzins`/`invites`/`settings`/`config`/`vakitler` BİLEREK
 * dışarıda: bunlar silinirse kimse tekrar giriş yapamaz ya da uygulama
 * temel yapılandırmasını kaybeder.
 *
 * `mazeret_detaylari` ve `audit_logs` da BİLEREK burada YOK —
 * firestore.rules'ta admin istisnası bile olmadan
 * `allow update, delete: if false` ile kalıcı/tamper-proof olarak
 * sabitlenmişler (bkz. o dosyalardaki "Sabit kayıt" yorumları). Bir
 * sıfırlama özelliğinin kendi denetim izini ya da geçmiş mazeret
 * kayıtlarını silebilmesi kötü bir tasarım olurdu — bu kısıtlama BİLEREK
 * atlanmıyor.
 */
export const SIFIRLANABILIR_KOLEKSIYONLAR = [
  { anahtar: 'bildirimler', koleksiyon: 'bildirimler', etiket: 'Bildirimler', aciklama: 'Nöbet/onay/mazeret durumları', varsayilanSecili: true },
  { anahtar: 'haftaPlanlari', koleksiyon: 'haftaPlanlari', etiket: 'Haftalık Planlar', aciklama: 'Yayındaki tüm hizmet çizelgeleri', varsayilanSecili: true },
  { anahtar: 'izinler', koleksiyon: 'izinler', etiket: 'İzin Talepleri', aciklama: 'Onaylı/bekleyen/reddedilen tüm izinler', varsayilanSecili: true },
  { anahtar: 'vekalet_talepleri', koleksiyon: 'vekalet_talepleri', etiket: 'Vekalet Talepleri', aciklama: 'Görev devri teklifleri', varsayilanSecili: true },
  { anahtar: 'adminUyarilari', koleksiyon: 'adminUyarilari', etiket: 'Admin Uyarıları', aciklama: 'Çözülmüş/çözülmemiş kriz alarmları', varsayilanSecili: true },
  { anahtar: 'duyurular', koleksiyon: 'duyurular', etiket: 'Duyurular', aciklama: 'Cemaate yayınlanan panolar', varsayilanSecili: false },
  { anahtar: 'error_logs', koleksiyon: 'error_logs', etiket: 'Hata Günlükleri', aciklama: 'İstemci tarafı hata izleri', varsayilanSecili: false },
  { anahtar: 'telemetry_logs', koleksiyon: 'telemetry_logs', etiket: 'Telemetri Günlükleri', aciklama: 'Sayfa görüntüleme/tıklama izleri', varsayilanSecili: false },
] as const;

export type SifirlanabilirKoleksiyonAnahtari = typeof SIFIRLANABILIR_KOLEKSIYONLAR[number]['anahtar'];

/** Her koleksiyon için `getCountFromServer` ile ucuz bir belge sayısı okur
 * (tüm belgeleri çekmez) — onay ekranında admin'e "kaç belge silinecek"
 * göstermek için. */
export async function koleksiyonBelgeSayilariniGetir(): Promise<Record<SifirlanabilirKoleksiyonAnahtari, number>> {
  const girdiler = await Promise.all(
    SIFIRLANABILIR_KOLEKSIYONLAR.map(async (k) => {
      try {
        const snap = await getCountFromServer(collection(db, k.koleksiyon));
        return [k.anahtar, snap.data().count] as const;
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, k.koleksiyon);
        return [k.anahtar, 0] as const;
      }
    })
  );
  return Object.fromEntries(girdiler) as Record<SifirlanabilirKoleksiyonAnahtari, number>;
}

// Firestore'un sabit "batch başına 500 yazım" sınırının altında, pay
// bırakılmış bir sayfa boyutu.
const SAYFA_BOYUTU = 450;

/**
 * Bir koleksiyonun TÜM belgelerini sayfa sayfa siler. Cursor tabanlı
 * sayfalama YOK — buna gerek yok, çünkü her turda okunan sayfa hemen
 * silindiğinden "kalan belgelerin ilk N'i" doğal olarak kayar. Büyük
 * koleksiyonlarda (ör. yıllar içinde birikmiş `bildirimler`) tüm belgeleri
 * tek seferde belleğe almamak için sayfalanır.
 */
async function koleksiyonuSil(koleksiyonAdi: string, onSayfa?: (toplamSilinen: number) => void): Promise<number> {
  let toplamSilinen = 0;
  for (;;) {
    // `persistentLocalCache` etkinken çevrimdışı başlatılan write/commit
    // Promise'leri sonsuza dek askıda kalabiliyor (bkz. timeoutUtils.ts) —
    // bu döngü sarmalanmadan admin "siliniyor..." ekranında süresiz
    // kilitlenebilirdi (düşük öncelikli bulgu). `zamanAsimiIle` yalnızca
    // ARAYÜZÜN beklemesini keser; Firestore'un kendi offline yazım kuyruğu
    // arka planda çalışmaya devam eder.
    const snap = await zamanAsimiIle(getDocs(query(collection(db, koleksiyonAdi), limit(SAYFA_BOYUTU))));
    if (snap.empty) break;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await zamanAsimiIle(batch.commit());
    toplamSilinen += snap.size;
    onSayfa?.(toplamSilinen);
    if (snap.size < SAYFA_BOYUTU) break;
  }
  return toplamSilinen;
}

/** aylikVakitSayisi/aylikCumaSayisi/aylikYedekSayisi/toplamVakitSayisi
 * `bildirimler`'den, yillikIzinKullanilanGun `izinler`'den TÜRETİLEN kalıcı
 * sayaçlardır (muezzins belgesinde tutulur). Bu iki koleksiyon sıfırlanıp bu
 * sayaçlar dokunulmadan bırakılırsa, kişi kartlarındaki "GÖREV YÜKÜ"/"HİZMET
 * VERİMİ", hizmet rozetleri ve yıllık izin kotası artık HİÇBİR kaynak kaydı
 * olmayan hayalet değerler gösterirdi — "yeni sezona sıfırdan başla"
 * niyetiyle çelişir.
 */
async function kadroSayaclariniSifirla(): Promise<number> {
  const muezzinSnap = await zamanAsimiIle(getDocs(collection(db, 'muezzins')));
  let guncellenen = 0;
  for (let i = 0; i < muezzinSnap.docs.length; i += SAYFA_BOYUTU) {
    const parca = muezzinSnap.docs.slice(i, i + SAYFA_BOYUTU);
    const batch = writeBatch(db);
    parca.forEach((d) => {
      batch.update(d.ref, {
        aylikVakitSayisi: 0,
        aylikCumaSayisi: 0,
        aylikYedekSayisi: 0,
        toplamVakitSayisi: 0,
        yillikIzinKullanilanGun: 0,
      });
    });
    await zamanAsimiIle(batch.commit());
    guncellenen += parca.length;
  }
  return guncellenen;
}

export interface VeriSifirlamaSonucu {
  koleksiyonBazinda: Partial<Record<SifirlanabilirKoleksiyonAnahtari, number>>;
  toplamSilinenBelge: number;
  kadroSayaclariGuncellenenKisi: number | null;
}

/**
 * Seçilen operasyonel koleksiyonları TAMAMEN siler (bkz. dosya başı
 * yorumu — kapsam dışı bırakılanlar). Tek bir atomik işlem DEĞİLDİR
 * (Firestore'da koleksiyonlar arası bir transaction/batch sınırı yok) —
 * her koleksiyon kendi içinde sayfa sayfa, ayrı `writeBatch`'lerle
 * silinir. Yarıda bir hata oluşursa o ana kadar silinenler kalıcı olarak
 * silinmiş kalır (geri alınmaz) — çağıran taraf bunu net bir onay
 * ekranıyla önceden bildirmelidir.
 *
 * Denetim izi (audit_logs, bu işlemin kapsamı DIŞINDA, silinmez) kısmi
 * bir başarısızlıkta bile yazılmaya çalışılır (finally) — "ne kadarı
 * tamamlandı" hiçbir zaman kaybolmasın diye.
 */
export async function operasyonelVeriyiSifirla(
  secilenler: SifirlanabilirKoleksiyonAnahtari[],
  kadroSayaclariniDaSifirla: boolean,
  tetikleyenAdminAdi: string,
  onIlerleme?: (mesaj: string) => void
): Promise<VeriSifirlamaSonucu> {
  if (secilenler.length === 0) {
    throw new Error('Sıfırlamak için en az bir koleksiyon seçmelisiniz.');
  }

  const koleksiyonBazinda: Partial<Record<SifirlanabilirKoleksiyonAnahtari, number>> = {};
  let toplamSilinenBelge = 0;
  let kadroSayaclariGuncellenenKisi: number | null = null;
  let hataMesaji: string | null = null;

  try {
    for (const anahtar of secilenler) {
      const tanim = SIFIRLANABILIR_KOLEKSIYONLAR.find((k) => k.anahtar === anahtar);
      if (!tanim) continue;
      onIlerleme?.(`${tanim.etiket} siliniyor...`);
      const silinen = await koleksiyonuSil(tanim.koleksiyon, (n) => onIlerleme?.(`${tanim.etiket}: ${n} belge silindi...`));
      koleksiyonBazinda[anahtar] = silinen;
      toplamSilinenBelge += silinen;
    }

    if (kadroSayaclariniDaSifirla) {
      onIlerleme?.('Kadro sayaçları sıfırlanıyor...');
      kadroSayaclariGuncellenenKisi = await kadroSayaclariniSifirla();
    }

    return { koleksiyonBazinda, toplamSilinenBelge, kadroSayaclariGuncellenenKisi };
  } catch (err) {
    hataMesaji = err instanceof Error ? err.message : String(err);
    throw handleFirestoreError(err, OperationType.DELETE, 'operasyonel-veri-sifirlama');
  } finally {
    const ozet = Object.entries(koleksiyonBazinda).map(([k, n]) => `${k}: ${n}`).join(', ') || '(hiçbir koleksiyon tamamlanmadı)';
    // isValidAuditLog `details.size() <= 500` şart koşuyor — hata mesajı
    // dahil edilince bu sınırı aşıp audit yazımının KENDİSİNİN de
    // reddedilmesi (ve kısmi işlemin hiç iz bırakmaması) riskini önlemek
    // için sabit bir uzunlukta kırpılır.
    const detay = (
      hataMesaji
        ? `YARIDA KESİLDİ (${hataMesaji}). O ana kadar silinen: ${ozet}.`
        : `Toplam ${toplamSilinenBelge} belge silindi (${ozet})${kadroSayaclariniDaSifirla ? `; kadro sayaçları ${kadroSayaclariGuncellenenKisi ?? 0} kişide sıfırlandı` : ''}.`
    ).slice(0, 480);
    try {
      await telemetryService.logAudit('Operasyonel Veri Sıfırlama', tetikleyenAdminAdi, detay);
    } catch (auditErr) {
      console.error('Veri sıfırlama denetim kaydı yazılamadı:', auditErr);
    }
  }
}
