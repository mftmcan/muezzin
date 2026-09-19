# CLAUDE.md

## Proje

Bir cami/müezzin ekibi için nöbet çizelgeleme PWA'sı. Vite + React 19 + TypeScript +
Firebase (Auth/Firestore/Messaging) + Zustand + Tailwind CSS v4 + `motion/react`
(Framer Motion). Offline-first: Firestore `persistentLocalCache` ile PWA modunda
bağlantısız çalışabiliyor (`src/lib/firebase.ts`).

Dizin yapısı:
- `src/pages` — rota bileşenleri (`admin/modules/*` admin paneli sekmeleri,
  kalan `pages/*` müezzin tarafı ekranları).
- `src/components` — paylaşılan UI bileşenleri (`components/ui/*`).
- `src/hooks`, `src/store` (Zustand), `src/services` (Firestore yazma/okuma),
  `src/lib` (saf yardımcılar: tarih, planlama çekirdeği, firebase init),
  `src/utils`.

## Tasarım sistemi

### Köşe yarıçapı: `rounded-card`

Uygulama genelinde "ana kart" katmanı (dashboard kartları, admin panel kartları,
modal/login/boş-durum kartları) tek bir standarda oturur: **15px**. Bu,
`src/index.css`'teki `@theme` bloğunda bir Tailwind v4 token'ı:

```css
--radius-card: 15px;
```

**Yeni bir "ana kart" eklerken `rounded-[15px]` yazma — `rounded-card` kullan.**
Değer değişirse tek satır (`--radius-card`) güncellenir, 44+ dosyada
arama-değiştirme gerekmez. Küçük katman öğeleri (butonlar, ikon daireleri,
rozetler, toast'lar, nav chrome, tablo hücreleri, iç içe alt kartlar) bu
standarda dahil değildir — onlar kendi ölçeğinde kalır. **Ama "kendi
ölçeği" artık keyfi bir `rounded-[NNpx]` değil** — önceki hâliyle 17 farklı
keyfi piksel değerine (128 kullanım) dağılmıştı, bazıları adlandırılmış
Tailwind sınıflarıyla (`rounded-2xl`=16px, `rounded-xl`=12px,
`rounded-3xl`=24px, `rounded-lg`=8px) birebir çakışıyordu (bkz. premium
denetim B20). Yeni yazımda:

1. Değer Tailwind'in yerleşik ölçeğinde varsa (`rounded-lg/xl/2xl/3xl`)
   **onu kullan**, `rounded-[NNpx]` yazma.
2. Yoksa şu token'lardan birini kullan — `rounded-avatar` (22px: avatar,
   büyük ikon kutusu), `rounded-icon` (28px: EmptyState/ConfirmModal/
   GpsConsentModal ortak "sonuç ikonu" dairesi), `rounded-chip` (14px: liste
   satırı/küçük chip, en yoğun kullanılan ölçek), `rounded-panel` (18px:
   ikincil panel/modal iç bölüm), `rounded-control` (20px: kontrol yüzeyi,
   `.neural-btn` ile aynı değer). Bu beşi `src/index.css` `@theme` bloğunda
   tanımlı; isimleri BİLEREK Tailwind'in yerleşik `--radius-sm/md/lg/xl`
   namespace'iyle çakışmaz (o isimleri burada tanımlamak `rounded-lg` gibi
   zaten kullanımda olan sınıfların piksel değerini sessizce değiştirirdi).
3. Gerçekten tek seferlik, üçüncü bir bileşenle paylaşılmayan bir değerse
   `rounded-[NNpx]` hâlâ meşru — ama önce 1 ve 2'yi ele. `tests/unit/
   tasarimSistemi.test.ts`'teki ratchet guard, 14/18/20px ve Tailwind
   ölçeğindeki (8/12/16/24px) değerlerin `rounded-[NNpx]` olarak YENİDEN
   sızmasını CI'da engeller (bkz. kod denetimi, premium/kurumsal SaaS
   standardı analizi, 2026-09-19).

### `.spatial-glass` ailesi

`.spatial-glass` (`src/index.css`), tüm kartların temel katmanıdır: cam efektli
arka plan (`--spatial-glass-bg`, temaya göre değişir), kenarlık, gölge. Üzerine
inşa eden varyantlar (`.apple-card*`, `.spatial-glass-elevated/flat`,
`.tactile-card`) hiçbiri köşe yarıçapını override etmez, hepsi
`--radius-card`'ı miras alır.

### İkincil metin/etiket hiyerarşisi: `text-muted/subtle/faint` ve `label-primary/secondary/tertiary`

İkincil metin için **`opacity-NN` (raw Tailwind opaklık sınıfı) yazma** —
`src/index.css`'teki bu altı semantik utility'den birini kullan:

- Düz gövde metni (`text-secondary`/`text-primary` renkli, `uppercase` DEĞİL):
  `text-muted` (en görünür) → `text-faint` → `text-subtle` (en soluk).
- `authority-title`/`premium-label` tabanlı (uppercase, tracking'li) etiketler:
  `label-primary` (en görünür) → `label-secondary` → `label-tertiary` (en soluk).

Her ikisinin de opaklık değerleri `[data-theme='light']`/`[data-theme='dark']`
bloklarında ayrı ayrı tanımlı token'lardan gelir (`--text-*-opacity`,
`--label-*-opacity`) — ışık modunda WCAG AA'yı (text-secondary için ölçülen
gerçek eşik ≥0.85) garanti eder, karanlık modda gerçek bir hiyerarşi bırakır.
Bu iki üçlünün dışında kalan (eski) `opacity-NN` çağrı noktaları için ışık
modunda yalnızca `.authority-title`/`.premium-label` İLE BİRLİKTE bu sınıfı
taşıyan elementleri hedefleyen kapsamlı (scoped) bir taban kuralı var — bkz.
`src/index.css`'te "ESKİ DAVRANIŞ (kaldırıldı...)" yorumu. **Bu geriye dönük
uyumluluk için var, yeni kodda kullanma.**

### `authority-title`/`uppercase` yalnızca tek satırlık etiketler için

`text-2xs` (11px) + `uppercase` + `tracking-wide` kombinasyonu bu kod
tabanında ~390 noktada kullanılıyor — bir noktada bu, İKİ SATIRI AŞAN gövde
metni (ör. bir açıklama paragrafı, bir onay diyaloğunun mesajı) için de
kullanılmıştı (bkz. premium denetim B10: `SistemAnalitigi.tsx` 6 satırlık bir
uyarı metnini, `ConfirmModal.tsx` kullanıcı adı içeren dinamik onay cümlesini
büyük harfle basıyordu). **Yeni kodda `authority-title`/`uppercase`'i yalnızca
gerçekten TEK SATIRA sığan bir etikette (eyebrow, rozet, kolon başlığı) kullan
— iki satırı aşabilecek herhangi bir metin (açıklama, onay mesajı, hata
metni) cümle düzeninde ve normal (≥13px) bir boyutta kalır.** Büyük harf
kalıcı bir "vurgu" aracıdır; gövde kopyasına uygulandığında hem okunabilirliği
düşürür hem Türkçe kelimelerin İngilizceden ortalama daha uzun olması nedeniyle
taşma riskini artırır.

### Motion fizik token'ları: `src/lib/motion.ts`

Yeni bir `motion/react` geçişi yazarken `stiffness`/`damping`/`duration`/easing
dizisi için elle sayı yazma — `SPRING`/`EASE`/`DURATION` (bkz. `src/lib/motion.ts`)
dışında bir değer icat etmeden önce oradaki gruplardan birine bakılır. Kod
denetimi (premium/kurumsal SaaS standardı analizi, 2026-09-19) sonrası
`SPRING.snappy`/`sheet`/`gentle` ve `EASE.in`'e birebir eşleşen tüm çağrı
noktaları token'a taşındı, `EASE.outQuart` yeni eklendi — artık geriye dönük
uyumluluk istisnası yok. Kalan tekil/bounce spring değerleri (FloatingDock.tsx,
Layout.tsx, Switch.tsx vb.) bilinçli olarak token'a taşınmadı; bunlar
`tests/unit/tasarimSistemi.test.ts`'teki ratchet guard'da gerekçeleriyle
allowlist'te kayıtlı — yeni bir tekil değer eklemek istersen önce oraya bak.

### Doygun dolgu üzerine metin rengi

Renkli/doygun bir arka plan (`bg-emerald-500`, `bg-[var(--dynamic-aura,...)]`
vb.) üzerine metin/ikon yazarken **her zaman `text-[var(--app-bg)]`, asla
`text-[var(--text-primary)]` yazma.** Işık temasında `--text-primary` neredeyse
siyahtır (`hsl(210,25%,8%)`) — koyu bir dolgu üzerinde ~1,6–3,1:1 kontrasta
düşer (bkz. premium denetim B2). Doğru desen zaten `ConfirmModal`,
`EmptyState`, `Layout`, `btn-premium`'da tutarlı kullanılıyor.

### Aura / circadian renk sistemi

Beş isimli "aura" rengi (`--aura-ruby`, `--aura-amber`, `--aura-emerald`,
`--aura-indigo`, `--aura-rose`) hem light hem dark temada ayrı ayrı ayarlanmış
hue/saturation/lightness değerleriyle tanımlı (`src/index.css` `@theme` ve
`[data-theme='light']`/`[data-theme='dark']` blokları). `--dynamic-aura` CSS
değişkeni, güncel vakte/duruma göre bu beşliden birine bağlanır (bkz.
`src/hooks/useAuraColors.ts`) — bileşenler doğrudan `var(--aura-indigo)` yerine
genellikle `var(--dynamic-aura, var(--aura-indigo))` fallback deseniyle yazar,
böylece "dinamik aura henüz hesaplanmadıysa" bile sabit bir renge düşer.

### Tipografi

`--text-2xs` (`0.6875rem`), standart Tailwind ölçeğinde olmayan ama uygulama
genelinde (etiketler, `authority-title` sınıfı) 400+ kez kullanılan bir boyut
olduğu için `@theme`'e token olarak eklendi — `rounded-card` ile aynı gerekçe.

## Mimari kalıplar

### "Render sırasında state senkronu" — kasıtlı, anti-pattern DEĞİL

Bu kod tabanında sık görülen bir desen:

```ts
const [last, setLast] = useState(deger);
if (deger !== last) {
  setLast(deger);
  // ... state resetini/senkronunu burada yap
}
```

Bu React'in resmi dokümante ettiği "adjusting state when a prop changes"
desenidir (react.dev/learn/you-might-not-need-an-effect). Bir `useEffect` +
ekstra render turu yerine, prop/kaynak değiştiğinde state'i doğrudan render
sırasında günceller. **Bunu bir bug ya da anti-pattern olarak flagleme** — bu
kalıp bu projede birçok yerde bilinçli olarak kullanılıyor. Ortak parçası
`src/hooks/useChangeKey.ts`'e çıkarıldı (`key !== last` karşılaştırmasını ve
state güncellemesini tek satırda yapar); yeni bir yerde bu deseni yazman
gerekirse önce `useChangeKey` kullanılabilir mi diye bak.

### Planlama çekirdeği

`src/lib/planlamaCekirdegi.ts` (`haftalikPlanUret`) haftalık nöbet atamasının
**tek** saf (yan etkisiz) kaynağıdır — hem gece cron'u
(`scripts/haftalikPlanOlustur.ts`) hem istemci "self-healing" servisi
(`src/services/planServisi.ts`) bunu çağırır. Atama kuralları (onaylı izin/sabit
haftalık izin gününde asla atama yok, haftalık yük dengesi, Cuma vakitleri 1.5x
ağırlıklı + ayrıca `aylikCumaSayisi` üzerinden kalıcı bir adalet kademesi, yedek
görevi asil'in yarısı (`YEDEK_YUK_CARPANI=0.5`) kadar yük sayılır, art arda
dinlenme kuralı) yalnızca burada ve `src/utils/tieBreaker.ts`
(`tieBreakerSirala`) içinde tanımlı. Dinlenme kuralı (SOS) hafta sınırında
sıfırlanmasın diye `haftalikPlanUret`'in 5. parametresi
(`oncekiHaftaSonEkibi`) bir önceki haftanın Pazar/yatsı ekibiyle
beslenir — çağıran taraf bunu `src/lib/dateUtils.ts`'teki `getOncekiHafta`
ile hesaplar. `tekKisiliGunleriBul(gunPlan)`, yedeksiz (tek kişilik) kalan
günleri tespit eder; çağıranlar bunun için bir `adminUyarilari` kaydı açar.
Bu dosyaları değiştirirken `tests/unit/planlamaCekirdegi.test.ts` ve
`tests/unit/tieBreaker.test.ts`'i çalıştır — planlama mantığının tek test
kapsamı bunlar.

### Mazeret / Cuma kısıtlaması

`src/lib/mazeretKurallari.ts` (`mazeretKapaliMi`) mazeret/görev devri
penceresinin saf karar fonksiyonudur: Cuma günleri (asil veya yedek fark
etmeksizin) her zaman kapalı, sabah vakti önceki günün yatsısına göre kapanır,
diğer vakitler ezandan 1 saat öncesine kadar açık. Bu kısıtlama üç yerde ayrıca
uygulanır — birini değiştirirken diğerlerini unutma:

**1 saatlik zaman penceresi — sunucu tarafı (`mazeretSonBasvuru` damgası).**
İki kısıtlamanın (Cuma / 1 saat) uygulanma biçimi FARKLIDIR. Cuma, kurallarda
`tarih`ten taze hesaplanabilir; ezan saati hesaplanamaz (CEL "HH:MM"
ayrıştıramaz ve `bildirimler` update kuralı belgeli "1000 ifade" tavanına
yakındır). Bu yüzden pencerenin **kapandığı an**, plan üretiminde önceden
hesaplanıp `bildirimler.mazeretSonBasvuru` alanına gerçek bir `Timestamp`
olarak yazılır; `firestore.rules` `mazeretPenceresiAcik()` bunu Firestore'un
kendi `request.time`'ı ile karşılaştırır. İstemcinin `getTurkeyNow()`'u
(RTDB zaman senkronu — `src/lib/timeSync.ts` — hiç ateşlemezse CİHAZ SAATİ)
yalnızca UX'tir, **güvenlik sınırı değildir**. Kural FAIL-CLOSED'dır: damga
yoksa mazeret/vekalet reddedilir. Damgayı yazan/tamamlayan yollar:
`scripts/haftalikPlanOlustur.ts`, `src/services/planServisi.ts` (self-healing)
ve 10 dakikada bir çalışan `scripts/mazeretPenceresiBackfill.ts` (ezan verisi
plan üretiminden sonra geldiğinde tamamlar). Formülün tek kaynağı
`mazeretKurallari.ts`'teki `mazeretSonBasvuruHesapla`; Admin SDK tarafı
`scripts/lib/ezanVakitleri.ts` (`EzanVakitOkuyucu`) üzerinden okur.

**Ezan saati dizgeleri.** `vakitler` belgesindeki "HH:MM" değerleri
`src/lib/dateUtils.ts`'teki `normalizeVakitSaati` ile hem KAYNAKTA (üç API
ayrıştırıcısı: `ezanVaktiServisi.ts`'teki ikisi + `scripts/lib/diyanetResmiApi.ts`)
hem her okuma noktasında doğrulanır; ayrıştırılamayan bir değer her yerde
FAIL-CLOSED (pencere kapalı / transfer reddedilir) davranır. Eskiden cron katı
bir regex ile, istemci ise hiç doğrulamadan okuyordu — `"9:05"` gibi tek bir
kayıt cron'da sessiz bir fail-open üretiyordu.
- `src/services/mazeretServisi.ts` (`mazeretBildir`) — istemci tarafı, hem
  asil hem yedek için.
- `firestore.rules` `isSelfBildirimUpdate()` — sunucu tarafı, `cumaMiIsaretli()`
  ile bildirim belgesinin `tarih` alanından TAZE hesaplar (saklı, opsiyonel
  `cumaMi` alanına GÜVENMEZ — o alan eksik/eski bir belgede fail-open bir
  bypass'a yol açıyordu, bkz. kod denetimi kök neden çözümü).
- `firestore.rules` `isValidVekaletCreate` (talep oluşturma, aynı şekilde
  `tarih`ten taze hesaplar) ve `scripts/vekaletDevirleriniIsle.ts` (GERÇEK
  transfer — "1000 ifade tavanı" kök neden çözümü sonrası artık CEL'de
  değil, Admin SDK'da taze veriyle yeniden doğrulanıyor; bu script de
  `haftaGunuNumarasi(tarih)` ile taze hesaplar, ÖNCEDEN saklı `cumaMi`
  bayrağına güvenip fail-open olabiliyordu — premium hata analizi MV-O1)
  ve `src/services/vekaletServisi.ts` — vekalet (gönüllü görev devri) de
  aynı Cuma kısıtlamasına tabi, aksi halde mazeret engelini bu yoldan
  atlatmak mümkün olurdu (bkz. algoritma denetimi).

### Firestore dinleyici deseni

Gerçek-zamanlı veri gereken yerlerde `onSnapshot`, tek seferlik okuma yeterli
olan yerlerde `getDocs`/`getDoc` kullanılır (bkz. `useDuyurular.ts`). Bir hook
"neden bu veri canlı değil" sorusuna cevap veremiyorsa muhtemelen bug'dır.

### Oturum da ÜÇ durumludur — `user:null` "çıkış yapmış" demek DEĞİLDİR

Aşağıdaki rol sorununun bir katman YUKARIDAKİ ikizi. `init()` içindeki 4.5
sn'lik `authInitFailsafe`, `onAuthStateChanged` hiç ateşlenmezse
`loading:false, initialized:true` yazar ama `user` hâlâ `null`'dır — bu bir
CEVAP değil, cevabın gelmemiş olmasıdır (yavaş ağ, kilitli/yavaş IndexedDB;
uygulama offline-first olduğundan oturum IndexedDB'den geri yükleniyor).
`AuthGuard` bunu "giriş yapılmamış" diye okuyup **login ekranı** gösteriyordu:
oturumu açık bir kullanıcı, kendisi çıkış yapmamışken çıkış yapmış gibi
görünüyordu.

`authDogrulanamadi: boolean` bu belirsizliği taşır. `AuthGuard`'ın karar
zinciri: `disabledReason → error → isPending → (authDogrulanamadi && !user)
→ !user → children`. Belirsizlik dalı `OturumBelirsizEkrani`'nı gösterir —
"sayfayı yenile" ve "giriş ekranına geç" (`authBeklemeyiGec()`) ile.

- **Failsafe'in amacını bozma:** `loading:false` KALMALI, yoksa sonsuz splash
  ekranı sorunu geri gelir. Eklenen tek şey belirsizliğin işaretlenmesi.
- **Erişim genişlemez:** kullanıcı yine `children`'a alınmaz. Buradaki
  düzeltme güvenlik yönünü değiştirmez (login göstermek zaten erişim
  vermiyordu); düzeltilen şey KESİN OLMAYAN bir bilgiyi kesinmiş gibi
  sunmaktı.
- **Çıkış yolu ŞART:** gerçekten çıkış yapmış ama ağı da kötü olan kullanıcı
  giriş düğmesine ulaşamadan tıkanmamalı — `authBeklemeyiGec()` bunun için.
- Dinleyici sökülmez; geç gelen `onAuthStateChanged` (user dolu VEYA null)
  bayrağı kendiliğinden temizler.

### Rol/yetki ÜÇ durumludur — `isAdmin:false` "admin değil" demek DEĞİLDİR

`useAuthStore` rol için üç ayrı durum taşır: **yükleniyor** (`loading`),
**çözüldü** (`role`/`isAdmin` geçerli) ve **çözülemedi**
(`rolDogrulanamadi`). Üçüncüsü, 6 sn'lik `snapshotFailsafe` ya da
`onSnapshot`'ın hata callback'i devreye girdiğinde (yavaş bağlantı, soğuk
Firestore bağlantısı, `permission-denied`) oluşur — bu yollarda rol HİÇ
öğrenilmez ama `loading` false'a düşer.

**`isAdmin`/`isSuperAdmin`/`isReadOnly` bir yönlendirme/karar kapısında tek
başına kullanılmamalı** — belirsizlik durumunda hepsi `false`'tur ve gerçek
bir admin "admin değil" muamelesi görür. `AdminPanel.tsx` tam olarak bunu
yapıyordu ve adminleri ana ekrana atıyordu (2026-09-16'da görsel regresyon
testi yakaladı). Doğru desen:

- **Yönlendirme/redirect**: `!authLoading && !rolDogrulanamadi && isAdmin === false`.
  Belirsizlikte yönlendirme YOK — sebebi söyleyen + `rolTekrarDene()`
  sunan bir ekran gösterilir.
- **Yetki verme (buton/aksiyon/panel render)**: `isAdmin`/`isSuperAdmin`
  tek başına yeterlidir ve `rolDogrulanamadi` bunu GEVŞETMEZ — belirsizlikte
  yetki kapalı kalır (fail-closed). Gerçek sınır zaten `firestore.rules`.

`rolTekrarDene()` tek seferlik `getDocFromServer` yapar, **ikinci bir
`onSnapshot` açmaz** (failsafe yolunda canlı dinleyici hâlâ ayakta olabilir).
Rol türetimi (süper-admin kontrolü dahil) tek bir yerde —
`init()` içindeki `rolDurumunuUygula` — tanımlıdır; **kopyalama**, bu
dosyanın geçmişindeki `isSuperAdmin` hatasının aynısını üretir.
Kapsam: `tests/unit/useAuthStore.test.ts`.

## Komutlar

```bash
npm run dev               # vite --port=3000 (Playwright bu portu bekliyor, değiştirme)
npm run typecheck         # tsc --noEmit
npm run lint               # eslint .
npm run build              # production build
npm run test:unit          # vitest (tests/unit/**/*.test.{ts,tsx})
npm run test:e2e           # playwright, TÜM e2e (görsel dahil; emülatör gerektirir)
npm run test:e2e:fonksiyonel # playwright, görsel OLMAYAN e2e (--grep-invert @gorsel)
npm run test:visual        # yalnızca görsel regresyon (--grep @gorsel)
npm run test:rules         # firestore.rules testleri (emülatör)
npm run test:integration   # admin-SDK uzlaştırma cron'ları (tests/integration, emülatör)
npm run test:all           # typecheck + typecheck:scripts + lint + smoke + unit + rules + integration + sw-config + indexes
```

**`npm test` `test:all`'ın takma adı DEĞİL** — sadece `test:smoke`'u çalıştırır.
Tam doğrulama için `npm run test:all` kullan.

### Görsel regresyon deploy'u BLOKLAMAZ (`@gorsel` etiketi)

`tests/e2e/visual.spec.ts`'teki iki `describe` `{ tag: '@gorsel' }` taşır ve
`test.yml`'de AYRI bir `gorsel_regresyon` job'ında koşar. `build_and_deploy`
BİLEREK yalnızca `needs: test`'e bağlıdır — yani bir piksel farkı production
deploy'unu durdurmaz (sessizce yutulmaz: job kırmızıya düşer, bir
`::warning::` anotasyonu, `$GITHUB_STEP_SUMMARY` bloğu ve
`gorsel-regresyon-raporu` artifact'i bırakır). Gerekçe: görsel testler gerçek
bir kod regresyonu olmadan da kırılabiliyor (font render'ı, yanlış OS için
üretilmiş baseline, veri yükleme yarışı) ve tam olarak bu, son ~10 commit
boyunca deploy'u bloklayan tek sebep oldu.

- Deploy'u bloklayan taraf `--grep-invert @gorsel`'dir; yani **etiketi
  olmayan her YENİ spec dosyası kendiliğinden BLOKLAYAN tarafa düşer**
  (fail-closed). Bir testi deploy kapısının dışına çıkarmak ancak `@gorsel`
  etiketini bilinçli eklemekle olur — bunu yapmadan önce testin gerçekten
  yalnızca görsel olduğundan emin ol.
- **Baseline yenilerken CI'ın `ubuntu-latest` olduğunu unutma:**
  `-chromium-linux.png` VE `-mobile-chrome-linux.png` yenilenmelidir.
  Yalnızca Windows'ta (`-chromium-win32.png`) yenilemek CI'ı kırık bırakır —
  2026-09-16'da tam olarak bu oldu (`0d71808` → `4bc9450` döngüsü). Linux
  baseline'ları için `.github/workflows/gorsel-baseline-yenile.yml` var:
  **yalnızca `workflow_dispatch`** (zorunlu bir "gerekçe" girdisiyle), sonucu
  `tests/e2e/visual.spec.ts-snapshots/*-linux.png` ile SINIRLI tek bir
  commit olarak `main`'e push eder ve `git diff --stat`'ı iş akışı özetine
  yazar. Windows baseline'ları kapsam dışıdır, yerelde
  `npm run test:visual -- --update-snapshots` ile ayrıca yönetilir. Bu
  workflow'a **push/PR tetikleyicisi ekleme** — otomatik baseline kabulü,
  gerçek bir regresyonu sessizce "yeni normal" yapardı.
- Görsel testlerde ekran görüntüsünden önceki bekleme `ekranHazirBekle()`
  üzerinden gerçek sinyallere bağlıdır (`data-ekran-hazir`,
  `.skeleton-shimmer`, `document.fonts.ready`). **Yeni bir görsel test
  yazarken `waitForTimeout(NNNN)` ile "veri gelsin diye" bekleme** — bu
  kalıp bu dosyada defalarca kırıldı ve süreyi büyütmek onu çözmedi.
- Yerelde `test:e2e`/`test:e2e:fonksiyonel` paralel worker'larla koşar
  (`workers` yalnızca `CI` ortamında 1'dir) ve spec'ler AYNI emülatörü
  paylaşıp kendi seed'lerini yazdığından birbirini bozabilir. CI davranışını
  taklit etmek için yerelde `--workers=1` ekle.

### E2E'de saat dondurma — RTDB senkronu kaynağında kapalı

`src/lib/timeSync.ts` → `initTimeSync()` (App.tsx'te her sayfa yüklemesinde)
Firebase RTDB'nin `.info/serverTimeOffset`'ini dinleyip `globalThis.__timeOffset`'i
yazar, `getTurkeyNow()` (dateUtils.ts) bunu HER okumada ekler. RTDB'nin
emülatörü hiç başlatılmıyor (yalnızca firestore+auth), yani emülatör modunda
bile bu GERÇEK production RTDB'sine bağlanıyordu ve `page.clock.setFixedTime`
ile dondurulmuş saati/tarihi sessizce geçersiz kılıyordu.

`initTimeSync()` artık `VITE_USE_EMULATOR === '1'` iken **hiç bağlanmadan
dönüyor**; `__timeOffset` hiç yazılmadığından `dateUtils.ts` onu 0 kabul
eder. **Production davranışı değişmez** (`VITE_USE_EMULATOR` yalnızca
`playwright.config.ts` → `webServer.env` ile set edilir, bkz. `.env.example`).

Bu kök neden daha önce test tarafında ÜÇ ayrı bantajla örtülmüştü:
`visual.spec.ts`'te `__timeOffset`'i salt-okunur 0'a sabitleme, ayrıca
`mazeret-flow.spec.ts` ve `vekalet-flow.spec.ts`'te RTDB host'una giden
istek/WebSocket'i abort etme. **Üçü de KALDIRILDI. Saat-bağımlı yeni bir e2e
testi yazarken bu bantajları yeniden icat etme** — `page.clock.setFixedTime`
tek başına yeterli.

### ⚠️ Emulator güvenliği — port çakışmasında ASLA çalışan instance'a bağlanma

`tests/integration/*.test.ts` dosyalarının çoğu dosya başında doğrudan
`process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'` yazar ve testler
neredeyse hepsi `clearCollections()` ile `muezzins`, `bildirimler`,
`vakitler`, `settings`, `haftaPlanlari`, `vekalet_talepleri`, `audit_logs`
koleksiyonlarını TOPTAN SİLER. Bu dosyaları normalde `firebase
emulators:exec` çalıştırır — bu her seferinde SIFIRDAN, izole, atılabilir
bir emulator başlatır. **Ama `emulators:exec` port 8080/9099 zaten
doluyken başarısız olur** ve bir sonraki içgüdüsel adım ("madem
başlatamadım, zaten çalışan instance'a bağlanıp testi yine de koşturayım")
gerçek bir veri kaybı olayına yol açtı (2026-09-13, bkz. bu oturumun
öncesindeki bir subagent olayı): kullanıcının kendi elle başlattığı,
manuel test için tuttuğu bir dev emulator'ü bu şekilde tamamen sıfırlandı.

**Kural:** `test:integration`/`test:rules`/`test:e2e` (veya bunların
sardığı herhangi bir `tsx tests/integration/*.test.ts` çağrısı)
`emulators:exec`'in "port already in use" gibi bir hatayla başarısız
olursa, **asla** zaten 8080/9099'da yanıt veren instance'a karşı testi
tekrar çalıştırma — bu, o instance'ın kim tarafından, ne amaçla
başlatıldığını bilmediğin, atılabilir olmayan bir ortam olabileceği
anlamına gelir. Bunun yerine DUR ve kullanıcıya sor: (a) o emulator'ü
kapatıp tekrar deneyeyim mi, (b) farklı bir portta izole bir instance mı
başlatayım, yoksa (c) doğrulamayı CI'ya mı bırakayım. `curl -s -o
/dev/null -w '%{http_code}' http://127.0.0.1:8080` gibi basit bir portu
"zaten dolu mu" kontrolü, herhangi bir emulator-bağımlı testi
`emulators:exec` DIŞINDA bir yolla çalıştırmadan önce yapılmalı.

## Bundle bölme

`vite.config.ts`'teki `manualChunks`, Firebase'i üç ayrı chunk'a böler:
`vendor-firebase-auth` (login gate'te hemen gerekli), `vendor-firebase`
(Firestore + core, daha büyük), `vendor-firebase-messaging` (boot sonrası lazy
yüklenir). Yeni bir Firebase alt-paketi eklersen bu ayrımı bozmadan (yani hangi
chunk'a düşeceğini bilerek) ekle.

## Model Seçimi (Claude Pro — verimli kullanım)

Varsayılan Sonnet. Basit arama/keşif işlerinde Haiku yeterli — ama `model: "haiku"`'yu
**açıkça** ver, override'sız bırakmak artık güvenilir şekilde Haiku'ya düşmüyor (bkz.
kök `CLAUDE.md` → Model Seçimi, 2026-09-03 ölçümü). **Opus'a geç**
(`/model opus` veya Agent çağrısında `model: "opus"`):

- **Riskli kod**: `firestore.rules` (`isSelfBildirimUpdate`, `isValidVekaletCreate`,
  `isRecipientVekaletStatusUpdate`, `isVekaletDevriBekliyorIsareti` ve ortak
  `mazeretPenceresiAcik` — mazeret/vekalet Cuma VE 1 saatlik pencere
  kısıtlamalarının sunucu tarafı zorlayıcısı), `src/lib/mazeretKurallari.ts`
  ve onunla senkron tutulması gereken uygulama noktaları (`mazeretServisi.ts`,
  `vekaletServisi.ts`, `scripts/vekaletDevirleriniIsle.ts` — gerçek, geri dönüşü olmayan
  görev devri — ayrıca `mazeretSonBasvuru` damgasını üreten
  `scripts/lib/ezanVakitleri.ts`, `scripts/haftalikPlanOlustur.ts`,
  `scripts/mazeretPenceresiBackfill.ts`, `src/services/planServisi.ts`),
  `src/lib/planlamaCekirdegi.ts`/`tieBreaker.ts` (haftalık nöbet atamasının
  tek kaynağı, hem cron hem istemci bunu çağırır), `scripts/*.ts` altındaki zamanlanmış
  cron script'leri ve bunları tetikleyen `.github/workflows/*.yml` (haftalik-plan,
  gunluk-yatsi-sonu, mazeret-devirleri, aylik-ezan-takvimi, gunluk-log-temizligi ve
  `test.yml` içindeki `build_and_deploy` job'ı — ayrı bir deploy.yml YOK; bu job
  önizleme kanalı → sağlık kontrolü → canlıya terfi → sağlık kontrolü → otomatik
  hosting geri alma zincirini ve rules/indexes deploy'unu yürütür, sağlık kontrolünün
  tek kaynağı `scripts/lib/hostingSaglik.ts`'tir; public repo'da canlıya kendi
  başına deploy/yazan tetikleyiciler, bkz. kök otomasyon ayarlarındaki soft-deny
  listesi). Ayrıca `gorsel-baseline-yenile.yml` — `contents: write` ile
  DOĞRUDAN `main`'e commit/push eder; tetikleyicisini (`workflow_dispatch`),
  `main` kısıtını veya `git add` pathspec'ini genişletmek riskli kategoridedir.
- **Planlama**: `mazeretKurallari.ts`/vekalet zincirindeki üç uygulama noktasından birini
  değiştirirken (diğer ikisini birlikte tasarlamak gerekir), ya da yeni bir zamanlanmış
  script/GitHub Actions workflow eklerken.
- **Doğrulama**: `firestore.rules`, planlama çekirdeği veya `scripts/` içindeki bir
  cron/transfer script'ine dokunduktan sonra `npm run test:all` yeşil olsa bile ikinci
  bir gözle geçir — özellikle Cuma kısıtlamasının üç uygulama noktasında hâlâ tutarlı
  olduğunu ve `scripts/vekaletDevirleriniIsle.ts`'in taze veriyle yeniden doğrulama
  mantığını bozmadığını kontrol et. Deploy komutunu (workflow tetikleme, `firebase deploy`)
  Claude kendi başına çalıştırmaz — bkz. kök otomasyon ayarları.
