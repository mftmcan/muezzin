/**
 * "Hafta planı yok → istemci tarafında otomatik üret" (self-healing) kararının
 * TEK saf kaynağı.
 *
 * Bu karar İKİ yerde uygulanır — `src/hooks/useBugunPlanDurumu.ts` (müezzin/
 * dashboard tarafı) ve `src/pages/admin/modules/HaftalikCizelge.tsx` (admin
 * çizelge ekranı) — ve ikisinin AYNI cevabı vermesi zorunludur (bu kod
 * tabanındaki "aynı kural birden çok uygulama noktasında" deseni, bkz.
 * CLAUDE.md → Mazeret/Cuma kısıtlaması). Kural buraya çıkarıldı ki iki nokta
 * sessizce birbirinden ayrışmasın ve kural birim testlenebilsin.
 *
 * ─── Neden `sunucudanDogrulandi` şart? ───────────────────────────────────────
 *
 * Firestore `persistentLocalCache` ile açıldığından (bkz. src/lib/firebase.ts),
 * `haftaPlanlari/{haftaId}` dinleyicisi ÇEVRİMDIŞIYKEN de bir snapshot üretir:
 * belge yerel önbellekte YOKSA `snapshot.exists() === false` döner. Bu, "belge
 * sunucuda da gerçekten yok" ile AYIRT EDİLEMEZ — uygulama çevrimdışı açıldıysa
 * ya da yeniden bağlandıktan hemen sonra ilk sunucu senkronu tamamlanmadıysa,
 * SUNUCUDA VAR OLAN (gece cron'unun ürettiği, yayınlanmış) plan için bile
 * `!plan` görünür.
 *
 * Bu yanlış-negatif üzerine self-healing tetiklenirse `planServisi.
 * haftalikPlanOlustur` müezzin/izin verilerini de önbellekten (eksik/bayat)
 * okuyup TÜM haftayı yeniden hesaplar ve `writeBatch.commit()` eder. Çevrimdışı
 * yazımlar Firestore SDK'sında iyimserdir: yazım anında yerel önbelleğe işlenir
 * ve senkron kuyruğuna girer — bağlantı gelince sunucudaki GERÇEK çizelgeyi
 * EZER. Yani zararsız bir "gereksiz yeniden üretim" değil, yayınlanmış nöbet
 * çizelgesinin bozulmasıdır.
 *
 * Bu yüzden negatif okuma yalnızca `SnapshotMetadata.fromCache === false` olan
 * (yani sunucuya gidip gelmiş, TAZE) bir snapshot'tan geldiyse güvenilir kabul
 * edilir. Bilinçli olarak AZ tetiklemeye eğimliyiz: gerçekten eksik bir planı
 * ara sıra kaçırmak katlanılabilir (admin "PLANLARI GÜNCELLE" ile elle
 * tetikleyebilir, ayrıca gece cron'u zaten üretir), bayat önbellek yüzünden
 * fazladan tetiklemek katlanılamaz.
 */
export interface SelfHealingKarariGirdisi {
  /** `useHaftaPlan().plan` truthy mi (plan belgesi elimizde var mı). */
  planVarMi: boolean;
  /** `useHaftaPlan().loading` — ilk snapshot henüz gelmediyse true. */
  planLoading: boolean;
  /**
   * `useHaftaPlan().sunucudanDogrulandi` — EN SON snapshot `fromCache: false`
   * ile (sunucudan) geldiyse true. Yalnızca bu durumda "plan yok" cevabına
   * güvenilir.
   */
  sunucudanDogrulandi: boolean;
  isAdmin: boolean;
  haftaId: string;
  /** Bu haftaId için self-healing daha önce tetiklendiyse onun id'si. */
  dahaOnceTetiklenenHaftaId: string | null;
  /** Elle/otomatik bir plan üretimi hâlihazırda sürüyorsa true. */
  olusturuluyor?: boolean;
}

export function selfHealingTetiklenmeliMi(girdi: SelfHealingKarariGirdisi): boolean {
  const { planVarMi, planLoading, sunucudanDogrulandi, isAdmin, haftaId, dahaOnceTetiklenenHaftaId, olusturuluyor = false } = girdi;

  if (!haftaId) return false;
  if (!isAdmin) return false;
  if (planLoading) return false;
  if (planVarMi) return false;
  if (olusturuluyor) return false;
  // Yanlış-negatif koruması — bkz. dosya başındaki gerekçe.
  if (!sunucudanDogrulandi) return false;
  // Aynı hafta için en fazla bir kez (haftaId'ye kapsanmış kilit).
  if (dahaOnceTetiklenenHaftaId === haftaId) return false;
  return true;
}
