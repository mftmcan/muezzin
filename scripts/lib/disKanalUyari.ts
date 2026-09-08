/**
 * Bir GitHub Actions cron/deploy job'ı başarısız olduğunda, Firestore'a
 * BAĞIMLI OLMAYAN bir dış kanala (Slack/Discord/ntfy.sh webhook) bildirim
 * gönderir.
 *
 * Neden ayrı bir kanal: `scripts/lib/reportWorkflowFailure.ts` zaten her
 * arızada `adminUyarilari`'na bir kayıt bırakıyor, ama admin bunu ancak
 * uygulamayı AÇIP admin paneline bakarsa görür. Daha kötüsü — kök nedeni
 * Firestore'un kendisi (kimlik bilgisi bozulmuş, proje silinmiş, kota
 * tükenmiş) olan bir arızada `reportWorkflowFailure.ts`'in KENDİSİ de
 * yazamaz; bu kör noktayı yalnızca Firestore'dan tamamen bağımsız bir kanal
 * kapatabilir.
 *
 * `UYARI_WEBHOOK_URL` secret'ı tanımlı DEĞİLSE bu script sessizce hiçbir şey
 * yapmaz (exit 0) — dış kanal kurulumu opsiyoneldir, kurulmamış olması asıl
 * işi (workflow'un `if: failure()` adımı) ASLA kırmamalı. Bkz.
 * docs/RUNBOOK.md §7 (kurulum örnekleri: Slack/Discord/ntfy.sh).
 *
 * Payload KASITLI olarak birden fazla servisin beklediği alanı AYNI ANDA
 * taşır (`text` — Slack, `content` — Discord); her servis yalnızca kendi
 * bildiği alana bakar, fazlalık zararsızdır. ntfy.sh JSON API'si farklı bir
 * uç nokta bekler (bkz. RUNBOOK) — topic-özel bir URL'ye postalanırsa JSON
 * gövde ham metin olarak görünür, bu da işlevseldir (çirkin ama okunabilir).
 */
async function main() {
  const url = process.env.UYARI_WEBHOOK_URL;
  const isAdi = process.argv[2] || 'Bilinmeyen İş';

  if (!url) {
    console.log('UYARI_WEBHOOK_URL tanımlı değil — dış kanal bildirimi atlandı (bu opsiyoneldir, hata değildir).');
    return;
  }

  const mesaj = `⚠️ Otomasyon arızası: "${isAdi}" GitHub Actions işi başarısız oldu.`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: mesaj,
        content: mesaj,
        isAdi,
        zaman: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      console.error(`Dış kanal bildirimi HTTP ${res.status} ile reddedildi — asıl arıza durumu bundan etkilenmez.`);
    } else {
      console.log('Dış kanal bildirimi gönderildi.');
    }
  } catch (err) {
    // Best-effort: webhook'a ulaşılamaması workflow'u ASLA başarısız
    // yapmamalı (o zaten başarısız olduğu için burada) — sadece loglanır.
    console.error('Dış kanal bildirimi gönderilemedi:', err instanceof Error ? err.message : err);
  }
}

main();
