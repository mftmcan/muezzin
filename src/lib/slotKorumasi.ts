/**
 * Bir gün/vakit slotunun `bildirimler` belgelerini yorumlayan SAF (yan
 * etkisiz) kararlar. `src/services/planServisi.ts` bu kararları Firestore
 * snapshot'larından türettiği düz verilerle çağırır — mantığın kendisi
 * burada olduğundan birim testlerle (tests/unit/slotKorumasi.test.ts)
 * doğrudan doğrulanabilir.
 *
 * İki karar var:
 *  1. `korumaliSlotMu` — bu slot taze hesaplamadan MUAF mı?
 *  2. `guncelSlotBildirimleriniSec` — slotun ŞU ANKİ asil/yedek belgesi hangisi?
 */

/** `bildirimler` belgesinin bu modülün ihtiyaç duyduğu alanları. */
export interface SlotBildirimVerisi {
  uid?: string;
  tip?: string;
  durum?: string;
  vekaletDevredildi?: boolean;
  vekaletDevriBekliyor?: boolean;
  manuelAtama?: boolean;
  sonGuncelleme?: { toMillis(): number } | null;
}

// 'okundu_varsayilan': yatsiSonuIslemleri.ts'in gün sonunda dokunulmamış
// bekleyen bildirimlere verdiği "tamamlandı" durumu — bu listede olmazsa
// tamamlanmış GEÇMİŞ günler bile bir sonraki plan yeniden üretiminde silinip
// farklı bir kişiye atanabiliyordu (bkz. mimari denetim K7).
export const KORUNAN_DURUMLAR = ['onaylandi', 'reddedildi', 'okundu_varsayilan'];

/**
 * `vekaletDevriBekliyor` bayrağının EN FAZLA bu kadar süre koruma sağlaması.
 *
 * KÖK NEDEN (kod denetimi): bu bayrak, istemcinin vekaleti kabul ettiği an ile
 * scripts/vekaletDevirleriniIsle.ts'in GERÇEK transferi uyguladığı an
 * arasındaki ~10-15 dakikalık pencerede slotu korumak için var. Bayrağı
 * TEMİZLEYEN tek yer o script; script'in uzlaştırma sorgusu ise
 * `tarih >= otuzGunOnce` ile sınırlı. Cron/workflow 30 günden uzun süre
 * çalışmazsa (GitHub Actions zamanlanmış iş'leri repo 60 gün hareketsiz
 * kalırsa kendiliğinden devre dışı bırakır — gerçekçi bir senaryo) o pencerenin
 * dışında kalan her bayrak BİR DAHA ASLA temizlenemez ve slot hem self-heal'e
 * hem ADMIN'İN ELLE ATAMASINA (`vakitAtamasiniGuncelle` → 'protected') karşı
 * SONSUZA DEK kilitlenir; admin'in UI'dan kurtarma yolu yoktur.
 *
 * Çözüm bir zaman aşımı: meşru bir bekleyen devir cron'un normal 10 dakikalık
 * temposunda çözülür, dolayısıyla 48 saatten eski bir bayrak TANIM GEREĞİ
 * takılmıştır. Süre dolduğunda bayrak koruma sağlamayı bırakır — slot normal
 * bir 'bekliyor' slotu gibi davranır, yani hem plan yeniden üretimi hem admin
 * ataması onu kurtarabilir. Bayrağın kendisi Firestore'da kalır (denetim izi);
 * script yeniden çalışmaya başladığında `vekaletDevirleriniIsle.ts`'in bayat
 * bayrak süpürmesi onu temizler ve admin'e bir uyarı bırakır.
 */
export const VEKALET_DEVRI_BEKLEME_ASIMI_MS = 48 * 60 * 60 * 1000;

/**
 * `vekaletDevriBekliyor` bayrağı HÂLÂ koruma sağlıyor mu (yani bayat değil mi)?
 *
 * Zaman damgası olarak `sonGuncelleme` kullanılır: bayrağı yazan TEK yol
 * (`src/services/vekaletServisi.ts` `vekaletKabulEt`) onu `sonGuncelleme` ile
 * AYNI yazımda set eder ve firestore.rules `isVekaletDevriBekliyorIsaretiIcin`
 * bunu zorunlu kılar (`changed.hasOnly(['vekaletDevriBekliyor',
 * 'sonGuncelleme'])` + `incoming().sonGuncelleme is timestamp`). Dolayısıyla
 * ayrı bir alan (ve ayrı bir kural değişikliği) gerekmez: bayrak `true` iken
 * `sonGuncelleme`, bayrağın yazıldığı andır. Bayrak `true` kalırken belgeye
 * dokunan diğer yollar (mazeret → durum 'reddedildi', yatsı sonu →
 * 'okundu_varsayilan') zaten KENDİ BAŞLARINA koruma sağladığından, saatin
 * onlar tarafından ileri alınması koruma kararını değiştirmez. 10 dakikalık
 * `mazeretPenceresiBackfill.ts` yalnızca `mazeretSonBasvuru` yazar,
 * `sonGuncelleme`'ye DOKUNMAZ — yani saati sessizce tazeleyen periyodik bir iş
 * yoktur (kontrol edildi).
 *
 * DAMGA OKUNAMIYORSA "TAZE" (koruyucu) sayılır — fail-closed. Bunun gerçek
 * nedeni offline-first mimarisi: `serverTimestamp()` henüz sunucuda
 * çözülmemişken yerel snapshot'ta `sonGuncelleme` `null` görünür (Firestore
 * web SDK varsayılanı). Çevrimdışı bir cihazın az önce kabul ettiği bir devir
 * tam olarak bu görünümdedir ve KORUNMALIDIR. Bu, düzeltilen hatayı geri
 * getirmez: takılı kalmış gerçek bir bayrağın `sonGuncelleme`'si sunucuda
 * çözülmüş, ESKİ ve okunabilir bir Timestamp'tir.
 */
export function vekaletDevriBekliyorGecerliMi(
  data: Pick<SlotBildirimVerisi, 'vekaletDevriBekliyor' | 'sonGuncelleme'>,
  simdiMs: number = Date.now()
): boolean {
  if (data.vekaletDevriBekliyor !== true) return false;
  const damgaMs = data.sonGuncelleme?.toMillis?.();
  if (typeof damgaMs !== 'number' || !Number.isFinite(damgaMs)) return true;
  return simdiMs - damgaMs <= VEKALET_DEVRI_BEKLEME_ASIMI_MS;
}

/**
 * Slottaki hangi belgeler korumayı SAĞLIYOR — yani bu slotun taze
 * hesaplamadan muaf tutulmasının sebebi hangileri.
 *
 * vekaletDevredildi: true — scripts/vekaletDevirleriniIsle.ts GERÇEK
 * transferi uyguladığında yazar. Kabul edilen bir vekalet devri, bildirimin
 * `durum`unu DEĞİŞTİRMEZ (hâlâ 'bekliyor' kalabilir) — bu alan olmadan
 * korumaliSlotMu bu slotu korumasız sanıp plan yeniden üretiminde
 * sessizce eski sahibine geri döndürüyordu (bkz. mimari denetim K5).
 * vekaletDevriBekliyor: true — vekaletServisi.ts'teki vekaletKabulEt
 * bunu YAZAR (istemci artık transferi anlık yapmıyor, bkz. "1000 ifade
 * tavanı" kök neden çözümü). Script çalışana kadar (~10-15 dk) geçen
 * pencerede bu bayrak OLMADAN korumaliSlotMu slotu yine korumasız
 * sanıp, script daha transferi uygulamadan bir admin manuel ataması
 * veya haftalık plan yeniden üretimi kabul edilmiş devri sessizce
 * ezebilirdi — vekaletDevredildi'nin bu geçişteki AYNI rolü. Bu bayrağın
 * koruması ZAMAN AŞIMLIDIR (bkz. `vekaletDevriBekliyorGecerliMi` ve
 * VEKALET_DEVRI_BEKLEME_ASIMI_MS) — bayat bir bayrak slotu sonsuza dek
 * kilitlemez.
 * manuelAtama: true — vakitAtamasiniGuncelle (admin'in elle ataması)
 * yazar. `durum` bu anda hâlâ 'bekliyor' kaldığından (kişi henüz
 * onaylamadı/reddetmedi), bu bayrak olmadan taze bir manuel atama hiçbir
 * KORUNAN_DURUMLAR'a girmiyor ve bir sonraki plan yeniden üretiminde
 * sessizce eziliyordu (premium hata analizi PL-K2).
 */
export function korumaSaglayanBildirimler(
  slotBildirimleri: (SlotBildirimVerisi | undefined)[],
  simdiMs: number = Date.now()
): SlotBildirimVerisi[] {
  return slotBildirimleri.filter(
    (data): data is SlotBildirimVerisi =>
      !!data &&
      (KORUNAN_DURUMLAR.includes(data.durum as string) ||
        data.tip === 'gorev_cagrisi' ||
        data.vekaletDevredildi === true ||
        vekaletDevriBekliyorGecerliMi(data, simdiMs) ||
        data.manuelAtama === true)
  );
}

/**
 * Bu koruma, ONAYLI BİR İZİN tarafından ezilebilir mi?
 *
 * Yalnızca "kişi bu görevi kabul etti / admin elle atadı" türü koruma
 * ezilebilir. KASITLI OLARAK dışarıda bırakılanlar:
 * - `reddedildi` (mazeret kaydı): belgenin kendisi denetim izidir ve
 *   scripts/mazeretDevirleriniIsle.ts'in `devirSonucu` üzerinden işleyeceği
 *   HEDEFTİR — silinirse hem geçmiş hem bekleyen uzlaştırma kaybolur.
 * - `okundu_varsayilan`: yalnızca günü BİTMİŞ (yatsı sonrası) slotlarda
 *   oluşur — geçmişi yeniden yazmamak için dokunulmaz (bkz. K7).
 * - `gorev_cagrisi`: admin'in elle başlattığı acil çağrı.
 * - `vekaletDevredildi` / `vekaletDevriBekliyor`: devam eden ya da
 *   tamamlanmış bir görev devri; izin, devrin KARŞI tarafını da ilgilendirir,
 *   bu yüzden otomatik olarak ezilmez (admin müdahalesine bırakılır). BAYAT
 *   (bkz. `vekaletDevriBekliyorGecerliMi`) bir `vekaletDevriBekliyor` artık
 *   "devam eden bir devir" DEĞİLDİR, bu yüzden burada da engelleyici sayılmaz —
 *   aksi halde zaman aşımı yalnızca korumanın bir yarısını çözer, onaylı izin
 *   yolu kilitli kalırdı.
 */
function izinIleEzilebilirKoruma(data: SlotBildirimVerisi, simdiMs: number): boolean {
  if (data.durum === 'reddedildi' || data.durum === 'okundu_varsayilan') return false;
  if (data.tip === 'gorev_cagrisi') return false;
  if (data.vekaletDevredildi === true || vekaletDevriBekliyorGecerliMi(data, simdiMs)) return false;
  return data.durum === 'onaylandi' || data.manuelAtama === true;
}

/**
 * Bu slot taze hesaplamadan muaf mı?
 *
 * `izinliUidler` verilirse (self-healing yolu), o gün ONAYLI İZİNDE olan
 * kişilerin uid'leri beklenir. Bir slotun korumasını yalnızca "kabul edilmiş
 * / elle atanmış görev" sağlıyorsa VE koruyan belgelerden biri o gün onaylı
 * izinliyse, koruma DÜŞER — böylece plan yeniden üretimi o kişiyi slottan
 * çıkarıp yerine adalet/tie-breaker kurallarıyla seçilmiş birini koyabilir.
 *
 * Kök neden: plan yayınlanır → müezzin "okudum" der (durum 'onaylandi') →
 * SONRA aynı güne izni onaylanır. Koruma koşulsuz olduğu sürece
 * `haftalikPlanUret`'in izin filtresi bu slota HİÇ ulaşamıyor, kişi onaylı
 * izninde nöbetçi kalmaya devam ediyordu; admin'in elindeki tek yol
 * Firestore'u elle düzenlemekti (vakitAtamasiniGuncelle de aynı korumaya
 * takılıp 'protected' dönüyordu).
 */
export function korumaliSlotMu(
  slotBildirimleri: (SlotBildirimVerisi | undefined)[],
  izinliUidler?: ReadonlySet<string>,
  /** Enjekte edilebilir "şimdi" (epoch ms) — yalnızca `vekaletDevriBekliyor`
   * zaman aşımı için kullanılır. `getTurkeyNow()` DEĞİL `Date.now()`: burada
   * bir SÜRE farkı hesaplanıyor, `getTurkeyNow()` ise sunum amaçlı kaydırılmış
   * (gerçek epoch olmayan) bir Date döner. */
  simdiMs: number = Date.now()
): boolean {
  const koruyanlar = korumaSaglayanBildirimler(slotBildirimleri, simdiMs);
  if (koruyanlar.length === 0) return false;
  if (!izinliUidler || izinliUidler.size === 0) return true;

  // Koruyan belgelerden BİRİ bile ezilemez türdeyse (mazeret/görev
  // çağrısı/vekalet/geçmiş gün) slot bütünüyle korunur — kısmi silme, aynı
  // slotun bildirim belgeleriyle plan belgesini birbirinden ayırırdı.
  if (!koruyanlar.every((data) => izinIleEzilebilirKoruma(data, simdiMs))) return true;

  return !koruyanlar.some((data) => !!data.uid && izinliUidler.has(data.uid));
}

/**
 * Slotun ŞU ANKİ (yetkili) asil ve yedek bildirim belgelerini seçer.
 *
 * Neden bir "seçim" gerekiyor: yedek terfisi (scripts/mazeretDevirleriniIsle.ts
 * ve src/services/mazeretServisi.ts `kriziBaslat`) YERİNDE yapılır — var olan
 * `..._yedek` belgesinin `tip` alanı 'asil'e çevrilir, mazeret bildiren
 * kişinin `..._asil` belgesi ise (denetim izi olduğundan) SİLİNMEZ ve `tip`i
 * hâlâ 'asil'dir. Yani terfi sonrası slotta `tip === 'asil'` olan İKİ belge
 * bulunur. Basit bir `find(tip === 'asil')` çağrısı, Firestore'un belge-ID
 * (`__name__`) sıralaması nedeniyle her zaman ESKİ `..._asil` belgesini
 * (`_asil` < `_yedek`) döndürüyordu: self-healing, mazeret bildiren kişiyi
 * hâlâ asil sanıp terfiyi `haftaPlanlari`'nda SESSİZCE GERİ ALIYOR, terfi
 * eden kişi ise ne haftalık yük ne dinlenme (SOS) kredisi alıyordu — plan ile
 * bildirimler/push bildirimleri birbirine düşüyordu.
 *
 * Seçim kuralı: aynı `tip` için birden fazla aday varsa
 *  1. `reddedildi` OLMAYAN belge kazanır (mazeret bildiren kişi tanım gereği
 *     artık o slotun sahibi değildir),
 *  2. eşitlikte en son güncellenen (`sonGuncelleme`) kazanır — terfi eden
 *     belge her zaman taze bir `sonGuncelleme` ile yazılır,
 *  3. o da eşitse girdi sırası korunur (eski davranış).
 */
export function guncelSlotBildirimleriniSec(slotBildirimleri: (SlotBildirimVerisi | undefined)[]): {
  asil?: SlotBildirimVerisi;
  yedek?: SlotBildirimVerisi;
} {
  const mevcutlar = slotBildirimleri.filter((d): d is SlotBildirimVerisi => !!d);
  return {
    asil: enGuncelBildirim(mevcutlar.filter((d) => d.tip === 'asil')),
    yedek: enGuncelBildirim(mevcutlar.filter((d) => d.tip === 'yedek')),
  };
}

function enGuncelBildirim(adaylar: SlotBildirimVerisi[]): SlotBildirimVerisi | undefined {
  if (adaylar.length <= 1) return adaylar[0];
  // Array.prototype.sort kararlıdır (ES2019+) — 3. kural (girdi sırası)
  // bundan gelir.
  return [...adaylar].sort((a, b) => {
    const aRed = a.durum === 'reddedildi' ? 1 : 0;
    const bRed = b.durum === 'reddedildi' ? 1 : 0;
    if (aRed !== bRed) return aRed - bRed;
    return (b.sonGuncelleme?.toMillis() ?? 0) - (a.sonGuncelleme?.toMillis() ?? 0);
  })[0];
}
