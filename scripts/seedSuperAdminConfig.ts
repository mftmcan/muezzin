import { db } from './lib/firebaseAdminInit.ts';

/**
 * config/bootstrap dokümanındaki superAdminEmails listesine e-posta ekler
 * veya (--remove ile) çıkarır. Kaynak koda gömülü süper-admin e-postası
 * yerine geçer (bkz. firestore.rules isSuperAdminEmail, src/store/useAuthStore.ts).
 *
 * En yüksek yetkili config belgesini değiştirdiğinden — `backfillCumaMi.ts`
 * ile AYNI güvenlik ağı deseni uygulanır (bkz. kod denetimi): varsayılan
 * KURU ÇALIŞTIRMA, gerçek yazım için `--apply` gerekir.
 *
 * Kullanım:
 *   tsx scripts/seedSuperAdminConfig.ts admin@example.com [baska@example.com ...]                     # yalnızca rapor, yazmaz
 *   tsx scripts/seedSuperAdminConfig.ts admin@example.com [baska@example.com ...] --apply              # gerçekten ekler
 *   tsx scripts/seedSuperAdminConfig.ts eski@example.com --remove --apply                              # gerçekten çıkarır
 *
 * NOT: Önceden bu script yalnızca EKLEME yapabiliyordu — listeden bir
 * e-postayı çıkarmanın tek yolu Firebase Console'dan elle düzenlemekti,
 * çünkü `config` koleksiyonu `allow write: if false` ile kapalı (düşük
 * öncelikli bulgu). `--remove` bayrağı bunu script üzerinden de mümkün kılar.
 */

// Basit ama gerçekçi bir e-posta şekli kontrolü — RFC 5322'nin tamamını
// uygulamaz, yalnızca "@ öncesi/sonrası boş değil, tam olarak bir @, alan
// adında en az bir nokta" gibi bariz yazım hatalarını (ör. yanlış yazılmış
// bir bayrak, boş argüman) yakalar. Önceden HİÇBİR doğrulama yoktu —
// `--apply` dışındaki her argüman e-posta sayılıyordu (düşük öncelikli
// bulgu): bir yazım hatası ("--dry-run" gibi bilinmeyen bir bayrak) sessizce
// süper-admin listesine eklenebiliyordu.
const EMAIL_SEKLI = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmailSekli(email: string): boolean {
  return EMAIL_SEKLI.test(email);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const remove = args.includes('--remove');
  const emails = args
    .filter((a) => a !== '--apply' && a !== '--remove')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (emails.length === 0) {
    throw new Error('En az bir e-posta adresi verilmeli. Örnek: tsx scripts/seedSuperAdminConfig.ts admin@example.com --apply');
  }

  const gecersizler = emails.filter((e) => !isValidEmailSekli(e));
  if (gecersizler.length > 0) {
    throw new Error(`Geçersiz e-posta biçimi (yazım hatası/yanlış bayrak olabilir): ${gecersizler.join(', ')}`);
  }

  const ref = db.collection('config').doc('bootstrap');
  const snap = await ref.get();
  const existing: string[] = snap.exists ? snap.data()?.superAdminEmails || [] : [];

  const sonuc = remove ? existing.filter((e) => !emails.includes(e)) : Array.from(new Set([...existing, ...emails]));
  const degisenler = remove ? emails.filter((e) => existing.includes(e)) : emails.filter((e) => !existing.includes(e));

  console.log(
    apply
      ? 'UYGULAMA MODU — config/bootstrap yazılacak.'
      : 'KURU ÇALIŞTIRMA — hiçbir şey yazılmayacak (--apply ile gerçek çalıştırma yapın).'
  );
  console.log(`Mod: ${remove ? 'ÇIKARMA' : 'EKLEME'}`);
  console.log(`Mevcut süper-admin e-postaları: ${existing.length > 0 ? existing.join(', ') : '(yok)'}`);
  console.log(
    `${remove ? 'Çıkarılacak' : 'Eklenecek'} e-postalar: ${degisenler.length > 0 ? degisenler.join(', ') : remove ? '(listede yoklar)' : '(hepsi zaten listede)'}`
  );

  if (remove && sonuc.length === 0) {
    throw new Error('Bu işlem süper-admin listesini TAMAMEN boşaltır — en az bir süper-admin kalmalı. İşlem iptal edildi.');
  }

  if (!apply) {
    console.log(`\nGerçek yazım için: tsx scripts/seedSuperAdminConfig.ts <e-posta...> ${remove ? '--remove ' : ''}--apply`);
    return;
  }

  await ref.set({ superAdminEmails: sonuc }, { merge: true });
  console.log(`config/bootstrap güncellendi. Süper-admin e-postaları: ${sonuc.join(', ')}`);
}

main().catch((err) => {
  console.error('Süper-admin seed hatası:', err);
  process.exit(1);
});
