import { hostingSaglikKontrol } from './lib/hostingSaglik.ts';

// Kullanım: tsx scripts/hostingSaglikKontrolu.ts <baseUrl> <beklenenSha>
// Ortam: SAGLIK_DENEME (varsayılan 12), SAGLIK_BEKLEME_MS (varsayılan 5000).
// Yalnızca GET isteği atar — canlıya karşı yerelde çalıştırmak güvenlidir.

const [baseUrl, beklenenSha] = process.argv.slice(2);
if (!baseUrl || !beklenenSha) {
  console.error('Kullanım: tsx scripts/hostingSaglikKontrolu.ts <baseUrl> <beklenenSha>');
  process.exit(2);
}

const deneme = Math.max(1, Number(process.env.SAGLIK_DENEME ?? 12));
const beklemeMs = Math.max(0, Number(process.env.SAGLIK_BEKLEME_MS ?? 5000));

async function main(): Promise<void> {
  for (let i = 1; i <= deneme; i++) {
    let sorunlar: string[];
    try {
      sorunlar = await hostingSaglikKontrol(baseUrl, beklenenSha);
    } catch (hata) {
      sorunlar = [`istek hatası: ${hata instanceof Error ? hata.message : String(hata)}`];
    }
    if (sorunlar.length === 0) {
      console.log(`Sağlıklı: ${baseUrl} sha=${beklenenSha} (deneme ${i}/${deneme})`);
      return;
    }
    console.log(`Deneme ${i}/${deneme} başarısız:\n  - ${sorunlar.join('\n  - ')}`);
    if (i < deneme) await new Promise((r) => setTimeout(r, beklemeMs));
  }
  console.error(`::error::Hosting sağlık kontrolü ${deneme} denemede geçemedi: ${baseUrl} (beklenen sha ${beklenenSha})`);
  process.exit(1);
}

void main();
