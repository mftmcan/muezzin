import { describe, expect, it } from 'vitest';
import { hostingSaglikKontrol, type SaglikFetch } from '../../scripts/lib/hostingSaglik.ts';

const INDEX_HTML =
  '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-AbC123.js"></script></head><body></body></html>';

const GECERLI_CSP =
  "default-src 'self'; connect-src 'self' https://*.googleapis.com https://accounts.google.com https://www.google.com; frame-src 'self' https://accounts.google.com";

type Yol = Record<string, { status?: number; tip: string; govde: string; csp?: string }>;

function sahteFetch(yollar: Yol): SaglikFetch {
  return async (url) => {
    const yol = new URL(url).pathname;
    // firebase.json'daki `** -> /index.html` rewrite'ı: bilinmeyen her yol 200 + HTML döner.
    const kayit = yollar[yol] ?? { tip: 'text/html; charset=utf-8', govde: INDEX_HTML, csp: GECERLI_CSP };
    return {
      status: kayit.status ?? 200,
      headers: {
        get: (ad: string) => {
          const adKucuk = ad.toLowerCase();
          if (adKucuk === 'content-type') return kayit.tip;
          if (adKucuk === 'content-security-policy') return kayit.csp ?? null;
          return null;
        },
      },
      text: async () => kayit.govde,
    };
  };
}

const SAGLIKLI: Yol = {
  '/version.json': { tip: 'application/json', govde: '{"sha":"abc","builtAt":"2026-09-15T00:00:00Z"}' },
  '/': { tip: 'text/html; charset=utf-8', govde: INDEX_HTML, csp: GECERLI_CSP },
  '/assets/index-AbC123.js': { tip: 'text/javascript; charset=utf-8', govde: 'console.log(1)' },
  '/manifest.json': { tip: 'application/json', govde: '{}' },
  '/sw.js': { tip: 'text/javascript', govde: '' },
  '/__/auth/handler': { status: 400, tip: 'text/html', govde: '' },
};

describe('hostingSaglikKontrol', () => {
  it('beklenen sha ve tüm varlıklar doğru tipte geliyorsa sorun döndürmez', async () => {
    await expect(hostingSaglikKontrol('https://ornek.web.app/', 'abc', sahteFetch(SAGLIKLI))).resolves.toEqual([]);
  });

  it('version.json eksikse (rewrite HTML döndürür) sha kontrolünü 200 durum koduna rağmen geçmez', async () => {
    const { '/version.json': _, ...eksik } = SAGLIKLI;
    const sorunlar = await hostingSaglikKontrol('https://ornek.web.app', 'abc', sahteFetch(eksik));
    expect(sorunlar).toHaveLength(1);
    expect(sorunlar[0]).toContain('/version.json JSON değil');
  });

  it('CDN eski sürümü sunuyorsa sha uyuşmazlığını raporlar', async () => {
    const sorunlar = await hostingSaglikKontrol('https://ornek.web.app', 'yeni', sahteFetch(SAGLIKLI));
    expect(sorunlar).toEqual(['/version.json sha uyuşmuyor: beklenen yeni, sunulan abc']);
  });

  it('ana JS chunk eksikse (rewrite 200 + HTML döndürür) content-type üzerinden yakalar', async () => {
    const { '/assets/index-AbC123.js': _, ...eksik } = SAGLIKLI;
    const sorunlar = await hostingSaglikKontrol('https://ornek.web.app', 'abc', sahteFetch(eksik));
    expect(sorunlar).toEqual(['/assets/index-AbC123.js HTTP 200, content-type "text/html; charset=utf-8"']);
  });

  it('index.html 5xx dönerse JS/CSP kontrolüne geçmeden raporlar', async () => {
    const sorunlar = await hostingSaglikKontrol(
      'https://ornek.web.app',
      'abc',
      sahteFetch({
        ...SAGLIKLI,
        '/': { status: 503, tip: 'text/html', govde: '' },
      })
    );
    expect(sorunlar).toEqual(['/ HTTP 503']);
  });

  it('sw.js eksikse raporlar', async () => {
    const { '/sw.js': _, ...eksik } = SAGLIKLI;
    const sorunlar = await hostingSaglikKontrol('https://ornek.web.app', 'abc', sahteFetch(eksik));
    expect(sorunlar).toEqual(['/sw.js HTTP 200, content-type "text/html; charset=utf-8"']);
  });

  it('istekleri önbelleği atlayan başlıklarla yapar', async () => {
    const basliklar: Array<Record<string, string> | undefined> = [];
    const fetchFn: SaglikFetch = async (url, init) => {
      basliklar.push(init?.headers);
      return sahteFetch(SAGLIKLI)(url, init);
    };
    await hostingSaglikKontrol('https://ornek.web.app', 'abc', fetchFn);
    expect(basliklar.length).toBeGreaterThan(0);
    for (const b of basliklar) expect(b?.['Cache-Control']).toBe('no-cache');
  });

  it('CSP başlığı hiç yoksa raporlar (bkz. 4786c08 sınıfı arıza)', async () => {
    const eksik: Yol = { ...SAGLIKLI, '/': { tip: 'text/html; charset=utf-8', govde: INDEX_HTML, csp: '' } };
    await expect(hostingSaglikKontrol('https://ornek.web.app', 'abc', sahteFetch(eksik))).resolves.toEqual([
      '/ yanıtında Content-Security-Policy başlığı yok',
    ]);
  });

  it('CSP başlığında reCAPTCHA/Google Identity origin eksikse raporlar', async () => {
    const eksikCsp = "default-src 'self'; connect-src 'self'";
    const eksik: Yol = { ...SAGLIKLI, '/': { tip: 'text/html; charset=utf-8', govde: INDEX_HTML, csp: eksikCsp } };
    const sorunlar = await hostingSaglikKontrol('https://ornek.web.app', 'abc', sahteFetch(eksik));
    expect(sorunlar).toEqual([
      "CSP başlığında 'https://www.google.com' eksik (Google OAuth/reCAPTCHA girişini bozar)",
      "CSP başlığında 'https://accounts.google.com' eksik (Google OAuth/reCAPTCHA girişini bozar)",
      "CSP başlığında 'https://*.googleapis.com' eksik (Google OAuth/reCAPTCHA girişini bozar)",
    ]);
  });

  it('/__/auth/handler 5xx dönerse raporlar (hosting/authDomain yapılandırması bozuk)', async () => {
    const bozuk: Yol = { ...SAGLIKLI, '/__/auth/handler': { status: 502, tip: 'text/html', govde: '' } };
    const sorunlar = await hostingSaglikKontrol('https://ornek.web.app', 'abc', sahteFetch(bozuk));
    expect(sorunlar).toEqual(['/__/auth/handler HTTP 502']);
  });

  it('/__/auth/handler 4xx dönerse SORUN SAYMAZ (handler var, parametre bekliyor demektir)', async () => {
    await expect(hostingSaglikKontrol('https://ornek.web.app', 'abc', sahteFetch(SAGLIKLI))).resolves.toEqual([]);
  });
});
