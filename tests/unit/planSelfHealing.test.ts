import { describe, it, expect } from 'vitest';
import { selfHealingTetiklenmeliMi, SelfHealingKarariGirdisi } from '../../src/lib/planSelfHealing';

/**
 * `selfHealingTetiklenmeliMi`, "hafta planı yok → istemcide otomatik üret"
 * kararının iki uygulama noktası (`useBugunPlanDurumu.ts` ve
 * `HaftalikCizelge.tsx`) tarafından paylaşılan tek kaynağıdır.
 *
 * Bu testlerin ASIL amacı `sunucudanDogrulandi` kapısıdır: Firestore
 * `persistentLocalCache` ile "belge yerel önbellekte yok" ile "belge sunucuda
 * gerçekten yok" ayırt edilemez; çevrimdışı bir yanlış-negatif üzerine
 * self-healing tetiklenirse yerel olarak hesaplanan plan, bağlantı gelince
 * sunucudaki gerçek (cron'un ürettiği) çizelgeyi ezer.
 */
const temel: SelfHealingKarariGirdisi = {
  planVarMi: false,
  planLoading: false,
  sunucudanDogrulandi: true,
  isAdmin: true,
  haftaId: 'W2026-09-07',
  dahaOnceTetiklenenHaftaId: null,
};

const girdi = (over: Partial<SelfHealingKarariGirdisi> = {}) => ({ ...temel, ...over });

describe('selfHealingTetiklenmeliMi', () => {
  it('çevrimiçi + sunucudan doğrulanmış "plan yok" okumasında tetiklenir', () => {
    expect(selfHealingTetiklenmeliMi(girdi())).toBe(true);
  });

  it('okuma önbellekten geldiyse (fromCache) TETİKLENMEZ — yanlış-negatif koruması', () => {
    expect(selfHealingTetiklenmeliMi(girdi({ sunucudanDogrulandi: false }))).toBe(false);
  });

  it('çevrimdışı açılış senaryosu: plan sunucuda VAR ama önbellekte yok → tetiklenmez', () => {
    // Uygulama çevrimdışı açıldı: dinleyici önbellekten "belge yok" dedi
    // (planVarMi=false, sunucudanDogrulandi=false), yükleme de bitti.
    expect(
      selfHealingTetiklenmeliMi(
        girdi({
          planVarMi: false,
          planLoading: false,
          sunucudanDogrulandi: false,
        })
      )
    ).toBe(false);
  });

  it("yeniden bağlanma sonrası sunucu snapshot'ı gelince tetiklenebilir hale gelir", () => {
    const oncesi = girdi({ sunucudanDogrulandi: false });
    expect(selfHealingTetiklenmeliMi(oncesi)).toBe(false);
    expect(selfHealingTetiklenmeliMi({ ...oncesi, sunucudanDogrulandi: true })).toBe(true);
  });

  it('bağlantı tekrar koptuğunda (snapshot yeniden önbellekten gelir) kapanır', () => {
    expect(selfHealingTetiklenmeliMi(girdi({ sunucudanDogrulandi: true }))).toBe(true);
    expect(selfHealingTetiklenmeliMi(girdi({ sunucudanDogrulandi: false }))).toBe(false);
  });

  it('plan zaten varsa tetiklenmez', () => {
    expect(selfHealingTetiklenmeliMi(girdi({ planVarMi: true }))).toBe(false);
  });

  it('ilk snapshot henüz gelmediyse (loading) tetiklenmez', () => {
    expect(selfHealingTetiklenmeliMi(girdi({ planLoading: true }))).toBe(false);
  });

  it('admin olmayan kullanıcı tetikleyemez', () => {
    expect(selfHealingTetiklenmeliMi(girdi({ isAdmin: false }))).toBe(false);
  });

  it('haftaId boşken tetiklenmez', () => {
    expect(selfHealingTetiklenmeliMi(girdi({ haftaId: '' }))).toBe(false);
  });

  it('aynı hafta için ikinci kez tetiklenmez', () => {
    expect(selfHealingTetiklenmeliMi(girdi({ dahaOnceTetiklenenHaftaId: 'W2026-09-07' }))).toBe(false);
  });

  it('kilit haftaId bazlıdır: başka bir hafta için tetiklenmeye devam eder', () => {
    expect(selfHealingTetiklenmeliMi(girdi({ dahaOnceTetiklenenHaftaId: 'W2026-08-31' }))).toBe(true);
  });

  it('elle plan üretimi sürerken (olusturuluyor) tetiklenmez', () => {
    expect(selfHealingTetiklenmeliMi(girdi({ olusturuluyor: true }))).toBe(false);
  });
});
