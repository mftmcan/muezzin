import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Sessiz hata yutma — bu kod tabanında tekrar eden bir kusur sınıfı (bkz.
 * kod denetimi, premium/kurumsal SaaS standardı analizi, 2026-09-19):
 * `VacationRequestCard.tsx` (izin iptali) ve `PersonalHistoryCard.tsx`
 * (görev geçmişi) kullanıcının bir eylem sonucunu ASLA görememesine yol
 * açıyordu — hata yalnızca `console.error`'a gidiyor, arayüzde hiçbir şey
 * değişmiyordu. Bu test dosyası iki deseni CI'da kilitler:
 *
 *  1. Tamamen BOŞ `catch {}` / `catch (e) {}` — hiçbir gerekçe/yorum yok.
 *     Bu her zaman yasaktır (gerekçeli bir yorum eklemek ücretsizdir).
 *  2. Gövdesi YALNIZCA `console.error`/`console.warn` çağrısından oluşan
 *     `catch` blokları — RATCHET/allowlist deseni (bkz. tasarimSistemi.test.ts
 *     aynı desen). Bunların hepsi TEK TEK incelendi (2026-09-19): 19'u da
 *     gerçekten arka plan/kozmetik hatalar (ses çalma, telemetrinin kendi
 *     hata kaydı, FCM push token, App Check fallback, SW güncelleme
 *     kontrolü, sessionStorage yazma, ikincil audit-log yazımı) — kullanıcı
 *     eylemine bağlı DEĞİLLER, bu yüzden allowlist'te kalabilirler. YENİ bir
 *     "yalnızca console" catch bloğu eklerken kendine sor: bu, bir kullanıcı
 *     eylemine (buton tıklama, form gönderme) doğrudan yanıt veriyor mu? Öyle
 *     ise `showNotification`/`handleFirestoreError` ile kullanıcıya bildir,
 *     allowlist'e ekleme.
 */

const SRC_DIR = path.resolve(__dirname, '../../src');

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function relPath(absPath: string): string {
  return path.relative(path.resolve(__dirname, '../..'), absPath).replace(/\\/g, '/');
}

const sourceFiles = walkSourceFiles(SRC_DIR);

/** `catch` anahtar kelimesinden başlayıp dengeli süslü parantezle biten gövdeyi çıkarır. */
function findCatchBlocks(content: string): { index: number; body: string }[] {
  const sonuc: { index: number; body: string }[] = [];
  const catchRe = /catch\s*(?:\([^)]*\))?\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = catchRe.exec(content))) {
    const braceStart = content.indexOf('{', m.index);
    let depth = 1;
    let i = braceStart + 1;
    while (i < content.length && depth > 0) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') depth--;
      i++;
    }
    sonuc.push({ index: m.index, body: content.slice(braceStart + 1, i - 1) });
  }
  return sonuc;
}

describe('hata yutma — kaynak taraması', () => {
  it('tamamen boş catch bloğu içermez (gerekçeli yorum bile yoksa yasak)', () => {
    const ihlaller: string[] = [];

    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf8');
      for (const { index, body } of findCatchBlocks(content)) {
        if (body.trim() === '') {
          const satir = content.slice(0, index).split('\n').length;
          ihlaller.push(`${relPath(file)}:${satir}`);
        }
      }
    }

    expect(
      ihlaller,
      `Tamamen boş catch bloğu bulundu — en azından NEDEN yutulduğunu açıklayan bir yorum ekle (bkz. src/services/gpsVakitServisi.ts örneği):\n${ihlaller.join('\n')}`
    ).toEqual([]);
  });

  it('yalnızca console.error/warn içeren catch blokları bilinen/gerekçeli listeyle sınırlıdır', () => {
    // Format: "dosya:satır" — her biri 2026-09-19 denetiminde tek tek
    // incelendi. Kategoriler: ses çalma (kozmetik), telemetri servisinin
    // kendi hata kaydı (özyinelemeyi önler), FCM push token / App Check /
    // SW güncelleme kontrolü (arka plan, kullanıcı eylemine bağlı değil),
    // sessionStorage yazma/okuma (önbellek, fail-soft), ikincil audit-log
    // yazımı (birincil işlem zaten tamamlanmış/bildirilmiş).
    const IZINLI_KONSOL_SADECE_CATCH = new Set([
      'src/App.tsx:40', // telemetryService.logError'ın KENDİSİ hata verirse — özyinelemeli çağrıyı önler
      'src/hooks/useFcmToken.ts:280', // FCM push token alınamadı — arka plan, kullanıcı bunu beklemiyor
      'src/lib/firebase.ts:24', // App Check başlatılamazsa PASİF modda devam (bkz. 2026-09-04 geri alma notu)
      'src/lib/sounds.ts:62',
      'src/lib/sounds.ts:104',
      'src/lib/sounds.ts:134',
      'src/lib/sounds.ts:173', // dördü de bildirim sesi çalma — kozmetik, sessiz başarısızlık kabul edilebilir
      'src/lib/timeSync.ts:52', // RTDB zaman senkronu — yalnızca UX, güvenlik sınırı değil (bkz. CLAUDE.md)
      'src/pages/admin/components/SistemTestleriSekmesi.tsx:188', // service worker güncelleme kontrolü — admin tanı aracı
      'src/services/gpsVakitServisi.ts:120', // sessionStorage yazma (kota/gizli mod) — önbellek, fail-soft
      'src/services/gpsVakitServisi.ts:126', // geocoding ağ hatası — çağıran taraf null'ı bilinen varsayılana düşürüp kullanıcıya bildiriyor
      'src/services/gpsVakitServisi.ts:253', // ilçe geocoding ağ hatası — aynı gerekçe
      'src/services/planServisi.ts:110', // mazeret penceresi damgası hesaplanamazsa FAIL-CLOSED (kural tarafı kapalı sayar), plan üretimini engellemez
      'src/services/telemetryService.ts:303',
      'src/services/telemetryService.ts:339',
      'src/services/telemetryService.ts:570',
      'src/services/telemetryService.ts:594', // telemetri servisinin kendi Firestore yazımı hataları — özyinelemeyi önler
      'src/services/veriSifirlamaServisi.ts:225', // ikincil audit-log yazımı — birincil sıfırlama işlemi zaten tamamlanmış/bildirilmiş, bunu maskeleyecek bir hata fırlatmaz
      'src/store/useNotificationStore.ts:199', // bildirim sesi çalma — kozmetik
    ]);

    const ihlaller: string[] = [];

    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf8');
      for (const { index, body } of findCatchBlocks(content)) {
        const trimmed = body.trim();
        if (trimmed === '') continue; // ayrı testte ele alınıyor

        const yorumsuz = trimmed
          .replace(/\/\/.*$/gm, '')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .trim();
        if (yorumsuz === '') continue; // yalnızca yorum içeriyor — kasıtlı boş, ayrı testte ele alınıyor

        const satirlar = yorumsuz
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        const sadeceKonsol = satirlar.every((s) => /^console\.(error|warn)\(/.test(s) || s === '}' || s === ')');
        if (!sadeceKonsol) continue;

        const satir = content.slice(0, index).split('\n').length;
        const anahtar = `${relPath(file)}:${satir}`;
        if (!IZINLI_KONSOL_SADECE_CATCH.has(anahtar)) {
          ihlaller.push(anahtar);
        }
      }
    }

    expect(
      ihlaller,
      `Yalnızca console.error/warn içeren YENİ bir catch bloğu bulundu — kullanıcı eylemine yanıt veriyorsa showNotification/handleFirestoreError ile bildir, arka plan/kozmetik bir hataysa gerekçesiyle allowlist'e ekle:\n${ihlaller.join('\n')}`
    ).toEqual([]);
  });
});
