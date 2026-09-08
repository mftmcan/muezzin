import { collection, getDoc, getDocs, writeBatch, doc, type DocumentData, type UpdateData } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Muezzin, Izin, HaftaPlan, Vakit } from '../types';
import { telemetryService } from './telemetryService';
import { toTurkishUpperCase } from '../lib/dateUtils';
import { zamanAsimiIle } from '../lib/timeoutUtils';

// Denetlenen belgeler tanım gereği güvenilmez olabilir (eksik/bozuk alanlar
// aranan şey) — bu yüzden `Muezzin`/`Izin`/`HaftaPlan` yerine bunların
// `Partial` hali kullanılıyor; alan adları yine de tip kontrolünden geçer.
export type PersonnelDoc = Partial<Muezzin> & { id: string };
export type VacationDoc = Partial<Izin> & { id: string };
export type PlanDoc = Partial<HaftaPlan> & { id: string };

export type RepairData =
  | { type: 'personnel_field'; docId: string; field: 'displayName' | 'role' | 'aktif'; value: string | boolean }
  | { type: 'vacation_date'; docId: string; start: string; end: string }
  | { type: 'delete_doc'; collectionName: string; docId: string }
  | { type: 'schedule_reset'; planId: string; gun: string; vakit: Vakit; field: 'asil' | 'yedek'; value: string };

export interface AuditError {
  id: string;
  category: 'personnel' | 'vacation' | 'schedule';
  message: string;
  severity: 'warning' | 'critical';
  details: string;
  repairData?: RepairData;
}

export interface VeriSagligiTaramaSonucu {
  errors: AuditError[];
  stats: { totalPersonnel: number; totalVacations: number; totalPlans: number };
  /** Denetimin kendisi (koleksiyon okumaları dışında) çöktüyse dolu gelir — bu durumda `errors` güvenilir değildir. */
  auditError: string | null;
}

/** muezzins/izinler/haftaPlanlari koleksiyonlarını tarar; alan eksikliği, yetim kayıt ve tutarsız nöbet ataması tespit eder. */
export async function veriSagligiTara(): Promise<VeriSagligiTaramaSonucu> {
  const auditErrors: AuditError[] = [];

  try {
    let personnelList: PersonnelDoc[] = [];
    let vacationsList: VacationDoc[] = [];
    let plansList: PlanDoc[] = [];

    try {
      const muezzinsSnap = await getDocs(collection(db, 'muezzins'));
      personnelList = muezzinsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as PersonnelDoc);
    } catch (err) {
      console.error('Audit: Failed to fetch muezzins:', err);
      auditErrors.push({
        id: 'error-fetch-muezzins',
        category: 'personnel',
        severity: 'critical',
        message: 'Personel verileri veritabanından çekilemedi!',
        details: `Hata: ${err instanceof Error ? err.message : String(err)}. Firebase Firestore kurallarında bu koleksiyonu listeleme izniniz olduğunu kontrol edin.`,
      });
    }

    try {
      const izinlerSnap = await getDocs(collection(db, 'izinler'));
      vacationsList = izinlerSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as VacationDoc);
    } catch (err) {
      console.error('Audit: Failed to fetch vacations:', err);
      auditErrors.push({
        id: 'error-fetch-vacations',
        category: 'vacation',
        severity: 'critical',
        message: 'İzin verileri veritabanından çekilemedi!',
        details: `Hata: ${err instanceof Error ? err.message : String(err)}. Firebase Firestore kurallarında bu koleksiyonu listeleme izniniz olduğunu kontrol edin.`,
      });
    }

    try {
      const haftaPlanlariSnap = await getDocs(collection(db, 'haftaPlanlari'));
      plansList = haftaPlanlariSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as PlanDoc);
    } catch (err) {
      console.error('Audit: Failed to fetch plans:', err);
      auditErrors.push({
        id: 'error-fetch-plans',
        category: 'schedule',
        severity: 'critical',
        message: 'Haftalık nöbet planları veritabanından çekilemedi!',
        details: `Hata: ${err instanceof Error ? err.message : String(err)}. Firebase Firestore kurallarında bu koleksiyonu listeleme izniniz olduğunu kontrol edin.`,
      });
    }

    const stats = {
      totalPersonnel: personnelList.length,
      totalVacations: vacationsList.length,
      totalPlans: plansList.length,
    };

    // Üç okumadan biri başarısız olduysa (ağ/permission-denied/offline) çapraz
    // referans denetimlerini (Kategori B/C) hiç ÇALIŞTIRMA — bunlar
    // personnelList'in TAM olduğunu varsayıyor. Örneğin muezzins okuması
    // patlarsa personnelList boş kalır ve her izin "yetim", her plan slotu
    // "sahipsiz" görünür; "Otomatik Onar" bu durumda TÜM izinler koleksiyonunu
    // silip TÜM planı 'Sistem'e sıfırlayabilirdi (premium hata analizi HS-K1).
    // auditError'ı burada da doldurmak, VeriSagligiSekmesi.tsx'teki koruma
    // ekranını (önceden yalnızca dıştaki catch'te tetiklenen) bu senaryoda da
    // devreye sokar.
    const okumaHatasiVarMi = auditErrors.some((e) => e.id.startsWith('error-fetch-'));
    if (okumaHatasiVarMi) {
      return {
        errors: auditErrors,
        stats,
        auditError: 'Bir veya daha fazla koleksiyon okunamadı — tarama güvenilir değil, onarım önerisi üretilmedi. Lütfen tekrar deneyin.',
      };
    }

    // --- Category A: Personnel Audits ---
    personnelList.forEach((p) => {
      if (!p.displayName || p.displayName.trim() === '') {
        auditErrors.push({
          id: `p-name-${p.id}`,
          category: 'personnel',
          severity: 'critical',
          message: `Personel ad/soyad alanı tanımsız veya boş!`,
          details: `ID: ${p.id} olan personelin görünen ismi boş.`,
          repairData: {
            type: 'personnel_field',
            docId: p.id,
            field: 'displayName',
            value: p.email ? p.email.split('@')[0] : `Muezzin_${p.id.slice(0, 4)}`,
          },
        });
      }
      if (!p.role) {
        auditErrors.push({
          id: `p-role-${p.id}`,
          category: 'personnel',
          severity: 'warning',
          message: `Personel yetki rolü belirtilmemiş!`,
          details: `İsim: ${p.displayName || 'Bilinmeyen'} için varsayılan 'muezzin' rolü atanacak.`,
          repairData: { type: 'personnel_field', docId: p.id, field: 'role', value: 'muezzin' },
        });
      }
      if (p.aktif === undefined) {
        auditErrors.push({
          id: `p-aktif-${p.id}`,
          category: 'personnel',
          severity: 'warning',
          message: `Personel aktiflik statüsü tanımsız!`,
          details: `İsim: ${p.displayName || 'Bilinmeyen'} için varsayılan aktif durumu 'true' olarak set edilecek.`,
          repairData: { type: 'personnel_field', docId: p.id, field: 'aktif', value: true },
        });
      }
    });

    // --- Category B: Vacation Audits ---
    vacationsList.forEach((v) => {
      if (v.baslangic && v.bitis && v.baslangic > v.bitis) {
        auditErrors.push({
          id: `v-date-${v.id}`,
          category: 'vacation',
          severity: 'critical',
          message: `Hatalı izin tarih aralığı!`,
          details: `İzin ID: ${v.id} için başlangıç tarihi (${v.baslangic}) bitiş tarihinden (${v.bitis}) sonra olamaz.`,
          // Gerçek bir swap: iki alan da 'bitis'e eşitlenirse (eski davranış)
          // orijinal 'baslangic' değeri tamamen kaybolup izin tek güne (bitis'in
          // kendisine) çöküyordu. Alanları yer değiştirerek asıl iki tarih de
          // korunur, yalnızca kronolojik sırası düzeltilir.
          repairData: { type: 'vacation_date', docId: v.id, start: v.bitis, end: v.baslangic },
        });
      }

      const ownerExists = personnelList.some((p) => p.id === v.uid);
      if (!ownerExists && v.uid) {
        auditErrors.push({
          id: `v-owner-${v.id}`,
          category: 'vacation',
          severity: 'critical',
          message: `Yetkisiz / Silinmiş Personele ait Yetim İzin!`,
          details: `İzin ID: ${v.id} dizgede bulunmayan bir personele (UID: ${v.uid}) ait.`,
          repairData: { type: 'delete_doc', collectionName: 'izinler', docId: v.id },
        });
      }
    });

    // --- Category C: Schedule Audits ---
    plansList.forEach((plan) => {
      const gunler = plan.gunler;
      if (gunler) {
        Object.keys(gunler).forEach((gun) => {
          const gunlukVakitler = gunler[gun];
          if (gunlukVakitler) {
            (Object.keys(gunlukVakitler) as Vakit[]).forEach((vakit) => {
              const asil = gunlukVakitler[vakit]?.asil;
              const yedek = gunlukVakitler[vakit]?.yedek;

              if (asil && asil !== 'Sistem') {
                const asilUser = personnelList.find((p) => p.id === asil);
                if (!asilUser) {
                  auditErrors.push({
                    id: `s-asil-exist-${plan.id}-${gun}-${vakit}`,
                    category: 'schedule',
                    severity: 'critical',
                    message: `Nöbette bulunamayan asil görevli!`,
                    details: `${gun} ${toTurkishUpperCase(vakit)} vakti asil görevlisi (UID: ${asil}) dizgede kayıtlı değil.`,
                    repairData: { type: 'schedule_reset', planId: plan.id, gun, vakit, field: 'asil', value: 'Sistem' },
                  });
                } else if (asilUser.aktif === false || asilUser.role !== 'muezzin') {
                  auditErrors.push({
                    id: `s-asil-duty-role-${plan.id}-${gun}-${vakit}`,
                    category: 'schedule',
                    severity: 'warning',
                    message: `Nöbette pasif asil görevli tespit edildi!`,
                    details: `${gun} ${toTurkishUpperCase(vakit)} vakti görevlisi ${asilUser.displayName} pasif statüde.`,
                    repairData: { type: 'schedule_reset', planId: plan.id, gun, vakit, field: 'asil', value: 'Sistem' },
                  });
                }
              }

              if (yedek && yedek !== 'Sistem') {
                const yedekUser = personnelList.find((p) => p.id === yedek);
                if (!yedekUser) {
                  auditErrors.push({
                    id: `s-yedek-exist-${plan.id}-${gun}-${vakit}`,
                    category: 'schedule',
                    severity: 'critical',
                    message: `Nöbette bulunamayan yedek görevli!`,
                    details: `${gun} ${toTurkishUpperCase(vakit)} vakti yedek görevlisi (UID: ${yedek}) dizgede kayıtlı değil.`,
                    repairData: { type: 'schedule_reset', planId: plan.id, gun, vakit, field: 'yedek', value: 'Sistem' },
                  });
                } else if (yedekUser.aktif === false || yedekUser.role !== 'muezzin') {
                  auditErrors.push({
                    id: `s-yedek-duty-role-${plan.id}-${gun}-${vakit}`,
                    category: 'schedule',
                    severity: 'warning',
                    message: `Nöbette pasif yedek görevli tespit edildi!`,
                    details: `${gun} ${toTurkishUpperCase(vakit)} vakti yedeği ${yedekUser.displayName} pasif statüde.`,
                    repairData: { type: 'schedule_reset', planId: plan.id, gun, vakit, field: 'yedek', value: 'Sistem' },
                  });
                }
              }
            });
          }
        });
      }
    });

    return { errors: auditErrors, stats, auditError: null };
  } catch (err) {
    console.error('Audit run failed: ', err);
    return {
      errors: [],
      stats: { totalPersonnel: 0, totalVacations: 0, totalPlans: 0 },
      auditError: err instanceof Error ? err.message : String(err),
    };
  }
}

/** `veriSagligiTara`'nın bulduğu hataları, her birinin `repairData`sına göre otomatik onarır. İlerleme `onLog` ile canlı raporlanır. */
export async function veriHatalariniOnar(errors: AuditError[], onLog: (message: string) => void): Promise<void> {
  onLog(`Veritabanı Onarım İşlemi Başlatıldı...`);
  onLog(`Toplam Hata Sayısı: ${errors.length}`);

  // planId -> { 'gunler.<gun>.<vakit>.<field>': value } nokta-yollu alan
  // güncellemeleri. Önceden tüm `gunler` haritası getDoc ile okunup bellekte
  // değiştirilip TEK PARÇA geri yazılıyordu — bu, okuma ile yazma arasında
  // (gece cron'u/manuel atama aynı plana yazarsa) kayıp güncelleme riski
  // taşıyordu. Nokta-yollu alan güncellemesi hem bu riski ortadan kaldırıyor
  // hem de getDoc'a hiç ihtiyaç bırakmıyor (premium hata analizi HS-O5).
  const scheduleEdits: Record<string, Record<string, string>> = {};
  // Bir plan belgesi artık yoksa (silinmiş/arşivlenmiş) o planı hedefleyen
  // update'i batch'e HİÇ eklememek gerekir — Firestore batch'lerinde tek bir
  // "not-found" hatası TÜM batch'i (o 400'lük parçadaki diğer tüm onarımlar
  // dahil) reddeder (HS-O5).
  const planVarMi: Record<string, boolean> = {};
  // Tüm yazma/silme işlemleri önce burada toplanır, ardından Firestore'un
  // 500 işlemlik batch sınırını aşmamak için 400'lük parçalar halinde
  // commit edilir (bkz. telemetryService.errorLoglariniTemizle) — tek dev
  // bir batch, 500+ hata olduğunda commit'in komple başarısız olup hiçbir
  // kaydın onarılmamasına yol açardı.
  const operations: Array<{ ref: ReturnType<typeof doc>; type: 'update' | 'delete'; data?: UpdateData<DocumentData> }> = [];

  for (const err of errors) {
    if (!err.repairData) continue;

    const data = err.repairData;
    if (data.type === 'personnel_field') {
      onLog(`ONARILIYOR: Personel ${data.docId} için '${data.field}' alanı '${data.value}' yapılıyor.`);
      operations.push({ ref: doc(db, 'muezzins', data.docId), type: 'update', data: { [data.field]: data.value } });
    } else if (data.type === 'vacation_date') {
      onLog(`ONARILIYOR: İzin ${data.docId} için tarih düzeltmesi uygulanıyor.`);
      operations.push({ ref: doc(db, 'izinler', data.docId), type: 'update', data: { baslangic: data.start, bitis: data.end } });
    } else if (data.type === 'delete_doc') {
      onLog(`TEMİZLENİYOR: Yetim/Geçersiz belge (${data.collectionName}/${data.docId}) siliniyor.`);
      operations.push({ ref: doc(db, data.collectionName, data.docId), type: 'delete' });
    } else if (data.type === 'schedule_reset') {
      onLog(`DÜZELTİLİYOR: Plan ${data.planId} -> ${data.gun} -> ${data.vakit} -> ${data.field} dizge olarak sıfırlanıyor.`);
      if (!(data.planId in planVarMi)) {
        const planSnap = await getDoc(doc(db, 'haftaPlanlari', data.planId));
        planVarMi[data.planId] = planSnap.exists();
        if (!planSnap.exists()) {
          onLog(`ATLANDI: Plan ${data.planId} artık mevcut değil, düzeltme uygulanamadı.`);
        }
      }
      if (!planVarMi[data.planId]) continue;
      if (!scheduleEdits[data.planId]) scheduleEdits[data.planId] = {};
      scheduleEdits[data.planId][`gunler.${data.gun}.${data.vakit}.${data.field}`] = data.value;
    }
  }

  // Add accumulated schedule batch updates
  for (const planId of Object.keys(scheduleEdits)) {
    operations.push({ ref: doc(db, 'haftaPlanlari', planId), type: 'update', data: scheduleEdits[planId] });
  }

  onLog(`Değişiklikler Firebase Firestore veritabanına işleniyor...`);
  const CHUNK_SIZE = 400;
  for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    operations.slice(i, i + CHUNK_SIZE).forEach((op) => {
      if (op.type === 'update') batch.update(op.ref, op.data!);
      else batch.delete(op.ref);
    });
    // Çevrimdışıyken (persistentLocalCache) askıda kalabilecek commit'i
    // sarmalar — aksi halde admin "işleniyor..." ekranında süresiz
    // kilitlenebilirdi (düşük öncelikli bulgu, bkz. veriSifirlamaServisi.ts
    // aynı düzeltme).
    await zamanAsimiIle(batch.commit());
  }
  onLog(`Tebrikler! Tüm veri uyuşmazlıkları başarıyla giderildi ve onarıldı.`);

  // Diğer tüm ayrıcalıklı admin mutasyonları (izin onayı/geri alma/silme,
  // alarm çözme, manuel senkron) audit_logs'a yazarken bu toplu onarım hiç
  // yazmıyordu — potansiyel olarak çok sayıda kayıt sessizce değiştirilip/
  // silinip hiçbir iz bırakmıyordu (bkz. mimari denetim).
  const tipSayaclari = errors.reduce(
    (acc, err) => {
      if (!err.repairData) return acc;
      acc[err.repairData.type] = (acc[err.repairData.type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const ozet =
    Object.entries(tipSayaclari)
      .map(([tip, sayi]) => `${tip}: ${sayi}`)
      .join(', ') || 'işlem yok';
  await telemetryService.logAudit('Otomatik Veri Onarımı', `${operations.length} işlem uygulandı`, ozet);
}
