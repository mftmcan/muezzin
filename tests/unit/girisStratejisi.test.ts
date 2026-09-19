import { describe, it, expect } from 'vitest';
import { POPUP_DENE, girisYoluSec, popupHatasiniDegerlendir, redirectSonucunuDegerlendir } from '../../src/lib/girisStratejisi';

describe('girisYoluSec', () => {
  it('POPUP_DENE kapalıyken mobil/masaüstü fark etmeksizin her zaman redirect seçer', () => {
    expect(POPUP_DENE).toBe(false);
    expect(girisYoluSec(true)).toBe('redirect');
    expect(girisYoluSec(false)).toBe('redirect');
  });
});

describe('popupHatasiniDegerlendir — denylist (allowlist DEĞİL)', () => {
  it('gerçek kullanıcı iptalinde (popup-closed-by-user) kullanıcıya göster, redirect denemez', () => {
    expect(popupHatasiniDegerlendir('auth/popup-closed-by-user')).toBe('kullaniciya-goster');
  });

  it('config hatasında (unauthorized-domain) kullanıcıya göster, redirect de aynı şekilde başarısız olur', () => {
    expect(popupHatasiniDegerlendir('auth/unauthorized-domain')).toBe('kullaniciya-goster');
  });

  it('bilinen popup hatalarında (popup-blocked, internal-error, vb.) redirect-fallback döner', () => {
    expect(popupHatasiniDegerlendir('auth/popup-blocked')).toBe('redirect-fallback');
    expect(popupHatasiniDegerlendir('auth/internal-error')).toBe('redirect-fallback');
    expect(popupHatasiniDegerlendir('auth/web-storage-unsupported')).toBe('redirect-fallback');
    expect(popupHatasiniDegerlendir('auth/popup-timeout')).toBe('redirect-fallback');
  });

  it('BİLİNMEYEN/gelecekte eklenecek bir hata kodunda da redirect-fallback döner (denylist invaryantı — eski allowlist bunu KAÇIRIRDI)', () => {
    expect(popupHatasiniDegerlendir('auth/hic-bilinmeyen-yeni-firebase-kodu')).toBe('redirect-fallback');
  });
});

describe('redirectSonucunuDegerlendir', () => {
  it('ağ sınıfı hatalarda (network-request-failed, timeout) yalnızca loglar, hata göstermez', () => {
    expect(redirectSonucunuDegerlendir('auth/network-request-failed')).toBe('sadece-logla');
    expect(redirectSonucunuDegerlendir('auth/timeout')).toBe('sadece-logla');
  });

  it('config hatasında (unauthorized-domain) kullanıcıya hata gösterir', () => {
    expect(redirectSonucunuDegerlendir('auth/unauthorized-domain')).toBe('hata-goster');
  });

  it('diğer bilinmeyen hatalarda güvenli varsayılan olarak hata gösterir', () => {
    expect(redirectSonucunuDegerlendir('bilinmeyen-hata')).toBe('hata-goster');
  });
});
