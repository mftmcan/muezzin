export type SaglikYaniti = {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};

export type SaglikFetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<SaglikYaniti>;

const MODUL_SCRIPT_DESENI = /<script[^>]+type="module"[^>]+src="(\/assets\/[^"]+\.js)"/;

/**
 * Yayınlanmış bir Firebase Hosting sürümünün gerçekten SERVİS EDİLDİĞİNİ
 * doğrular; sorun listesi boşsa sağlıklıdır.
 *
 * Yalnızca "200 döndü mü" bakmak yetmez: firebase.json'daki `** -> /index.html`
 * SPA rewrite'ı, VAR OLMAYAN her yol için de 200 + HTML döndürür. Bu yüzden
 * (1) `version.json`'daki `sha` beklenen commit ile karşılaştırılır — hem
 * dosyanın gerçekten var olduğunu hem de CDN'in eski sürümü değil bu build'i
 * sunduğunu kanıtlar; (2) index.html'in referans verdiği ana JS chunk'ının
 * gerçekten JavaScript content-type'ıyla geldiği kontrol edilir (eksik
 * asset da rewrite yüzünden 200 + HTML dönerdi).
 */
export async function hostingSaglikKontrol(baseUrl: string, beklenenSha: string, fetchFn: SaglikFetch = fetch): Promise<string[]> {
  const sorunlar: string[] = [];
  const kok = baseUrl.replace(/\/+$/, '');

  const al = async (yol: string) => {
    const yanit = await fetchFn(`${kok}${yol}`, {
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    });
    return {
      status: yanit.status,
      tip: yanit.headers.get('content-type') ?? '',
      govde: await yanit.text(),
    };
  };

  const surum = await al('/version.json');
  if (surum.status !== 200) {
    sorunlar.push(`/version.json HTTP ${surum.status}`);
  } else {
    let sha: unknown = null;
    let jsonMi = true;
    try {
      sha = (JSON.parse(surum.govde) as { sha?: unknown }).sha;
    } catch {
      jsonMi = false;
    }
    if (!jsonMi) {
      sorunlar.push('/version.json JSON değil (SPA rewrite index.html döndürmüş olabilir — dosya eksik)');
    } else if (sha !== beklenenSha) {
      sorunlar.push(`/version.json sha uyuşmuyor: beklenen ${beklenenSha}, sunulan ${String(sha)}`);
    }
  }

  const index = await al('/');
  if (index.status !== 200) {
    sorunlar.push(`/ HTTP ${index.status}`);
  } else {
    const eslesme = index.govde.match(MODUL_SCRIPT_DESENI);
    if (!eslesme) {
      sorunlar.push('index.html içinde /assets/ altında module script bulunamadı');
    } else {
      const js = await al(eslesme[1]);
      if (js.status !== 200 || !js.tip.includes('javascript')) {
        sorunlar.push(`${eslesme[1]} HTTP ${js.status}, content-type "${js.tip || '(yok)'}"`);
      }
    }
  }

  for (const [yol, beklenenTip] of [
    ['/manifest.json', 'json'],
    ['/sw.js', 'javascript'],
  ] as const) {
    const yanit = await al(yol);
    if (yanit.status !== 200 || !yanit.tip.includes(beklenenTip)) {
      sorunlar.push(`${yol} HTTP ${yanit.status}, content-type "${yanit.tip || '(yok)'}"`);
    }
  }

  return sorunlar;
}
