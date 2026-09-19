import { describe, it, expect } from 'vitest';
import firebaseJson from '../../firebase.json';
import firebaseConfig from '../../firebase-applet-config.json';

/**
 * `firebase.json`'daki CSP başlığı, giriş akışının gerçekte gittiği origin'leri
 * elle listeler — kod ile senkron tutan bir mekanizma yok. Üç ayrı canlı arıza
 * (bkz. commit'ler 4786c08, 4f39745) TAM OLARAK bu listenin eksik/eski kalması
 * yüzündendi ve hiçbiri CI'da yakalanmadı. Bu test o sınıf regresyonu kilitler.
 */
function cspYonergesiniAyristir(direktif: string): string[] {
  const csp = firebaseJson.hosting.headers
    .find((h) => h.source === '**')
    ?.headers.find((hh) => hh.key === 'Content-Security-Policy')?.value;
  if (!csp) throw new Error("firebase.json'da '**' kaynağı için CSP başlığı bulunamadı");
  const match = csp.split(';').find((parca) => parca.trim().startsWith(`${direktif} `));
  if (!match) throw new Error(`CSP içinde '${direktif}' direktifi bulunamadı`);
  return match.trim().split(/\s+/).slice(1);
}

describe("firebase.json CSP — giriş akışının gerekli origin'leri", () => {
  it("connect-src reCAPTCHA Enterprise ve Google Identity origin'lerini içeriyor (bkz. 4786c08)", () => {
    const connectSrc = cspYonergesiniAyristir('connect-src');
    expect(connectSrc).toContain('https://www.google.com');
    expect(connectSrc).toContain('https://accounts.google.com');
    expect(connectSrc).toContain('https://*.googleapis.com');
  });

  it("frame-src Google hesap seçim popup/redirect handler origin'ini içeriyor", () => {
    const frameSrc = cspYonergesiniAyristir('frame-src');
    expect(frameSrc).toContain('https://accounts.google.com');
  });

  it("authDomain hosting ile aynı origin'deyse (custom domain) frame-src ölü bir *.firebaseapp.com girdisi TAŞIMAZ", () => {
    // `authDomain` `.firebaseapp.com` DEĞİLSE (bkz. 4f39745 — custom hosting
    // domain'e taşındı), Firebase Auth'un `/__/auth/handler`'ı artık 'self'
    // altında servis edilir; frame-src'de firebaseapp.com'a ihtiyaç KALMAZ.
    // authDomain bir daha `.firebaseapp.com`'a dönerse bu test kırılır ve
    // geliştiriciye frame-src'yi GERİ eklemesi gerektiğini hatırlatır.
    const frameSrc = cspYonergesiniAyristir('frame-src');
    const authDomainFirebaseapp = firebaseConfig.authDomain.endsWith('.firebaseapp.com');
    const frameSrcFirebaseappIceriyor = frameSrc.some((o) => o.includes('firebaseapp.com'));
    expect(frameSrcFirebaseappIceriyor).toBe(authDomainFirebaseapp);
  });
});
