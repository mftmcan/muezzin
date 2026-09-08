# Operasyonel Runbook — Müezzin Hizmet Dizgesi

Bu doküman, production'da (`muezzin-c8485`) bir şeyler ters gittiğinde
izlenecek adımları tarif eder. Hedef kitle: bu depoya erişimi olan
(Firebase Console + GitHub Actions secrets) bir yönetici/geliştirici.

Genel bağlam: `main`'e her push, testler geçtiyse production'a deploy edilir
(`.github/workflows/test.yml` → `build_and_deploy` job'ı) — bir **onay
kapısı** arkasında (bkz. §6). Ayrı bir staging/preview ortamı hâlâ yoktur
(Firebase Hosting preview channel aynı production Firestore/Auth'a bağlanır,
gerçek bir staging sağlamaz — bilinçli olarak eklenmedi). Bu yüzden geri alma
(rollback) prosedürleri özellikle önemlidir.

## 1. Hosting'i geri alma (statik dosyalar — JS/CSS/manifest)

Firebase Hosting, son birkaç deploy'u saklar ve tek komutla geri almayı
destekler:

```bash
firebase hosting:rollback --project muezzin-c8485
```

Alternatif (Firebase Console): **Hosting → Release history** → geri
dönülecek sürümün yanındaki **⋮ → Rollback**.

Bu komut yalnızca hosting'i (statik dosyaları) etkiler — `firestore.rules`
ve `firestore.indexes.json` deploy'unu GERİ ALMAZ (aşağıya bakın).

## 2. `firestore.rules`'u geri alma

Firebase CLI'da rules için özel bir "rollback" komutu YOKTUR — her deploy
tek yönlüdür. Hatalı bir rules deploy'unu düzeltmenin tek yolu, önceki
GEÇERLİ sürümü yeniden deploy etmektir:

1. Hangi commit'in "son bilinen iyi" durum olduğunu bul. Her başarılı
   production deploy'u `release-YYYYMMDD-HHmmss` biçiminde bir git tag'i
   bırakır (bkz. `test.yml`'deki `build_and_deploy` job'ı, "Deploy'u
   etiketle" adımı) — `git tag -l 'release-*' --sort=-creatordate | head`
   ile en son etiketleri, `git log --oneline <tag>` ile o andaki
   `firestore.rules` içeriğini görebilirsin.
2. O tag'teki `firestore.rules` dosyasını geçici bir worktree'ye çıkar:
   ```bash
   git show <tag>:firestore.rules > /tmp/firestore.rules.rollback
   ```
3. Yalnızca rules'u (hosting'e veya indexes'e dokunmadan) yeniden deploy et:
   ```bash
   cp /tmp/firestore.rules.rollback firestore.rules
   firebase deploy --only firestore:rules --project muezzin-c8485
   git checkout -- firestore.rules   # yerel çalışma kopyasını temizle
   ```
4. Kalıcı düzeltme için: `main`'de düzeltmeyi içeren yeni bir commit/PR aç
   — bu geçici deploy bir sonraki `main` push'unda otomatik olarak
   ÜZERİNE YAZILIR, bu yüzden yalnızca acil durdurma amaçlıdır.

**Önemli**: rules'ta bir hata canlı veri erişimini KİLİTLEYEBİLİR (örn.
yanlışlıkla `allow read, write: if false` bırakmak) — bu durumda kullanıcı
raporları/hata izleme (`error_logs`, admin panelinde "Sistem Hataları")
`PERMISSION_DENIED` patlaması olarak görünür. Şüphede kaldığında, önce
son tag'teki rules'a dönüp sonra kök nedeni araştır.

## 3. Kota tükenmesi (Firestore Spark plan)

Belirtiler: uygulama genelinde ani `PERMISSION_DENIED` / `RESOURCE_EXHAUSTED`
hataları, admin panelinde "Sistem Hataları"nda ani bir sıçrama.

1. Firebase Console → **Usage and billing** → günlük okuma/yazma
   grafiğine bak (kotaya ne kadar yaklaşıldığını gösterir).
2. `error_logs`'un kendisinin kotayı tükettiğinden şüpheleniyorsan (bir
   render döngüsünde tekrarlayan bir hata): `telemetryService.ts`'teki
   `logError` dedup/rate-limit (imza başına oturum içi maks. 3, dizge
   genelinde dakikada maks. 5 yazım — bkz. premium denetim P0.4) bunu
   normalde önler; devre dışıysa/bozulduysa kök nedeni orada ara.
3. Kısa vadeli hafifletme: `workflow_dispatch` ile tetiklenen 10 dakikalık
   cron'ları (`mazeret-devirleri.yml`, `bildirim-gonder.yml`) GEÇİCİ olarak
   GitHub Actions'tan devre dışı bırakmak (Actions sekmesi → workflow →
   "Disable workflow") gün içindeki okuma/yazım hacmini azaltır — ama bu
   kullanıcı deneyimini (mazeret devri, bildirimler) etkiler, yalnızca
   gerçek bir kota krizinde başvur.
4. Kalıcı çözüm kota sınırı DEĞİL kullanım paternidir — sınırsız
   `onSnapshot` dinleyicileri veya tam-koleksiyon okumaları varsa
   (bkz. premium denetim, bölüm 17) bunları daraltmak gerçek düzeltmedir.

## 4. Cron/otomasyon kesintisi

Her kritik cron (haftalık plan, günlük yatsı sonu, aylık takvim, mazeret
devirleri) başarısız olduğunda `scripts/lib/reportWorkflowFailure.ts`
`adminUyarilari`'na otomatik bir kayıt açar — admin panelinde "Kriz
Uyarıları" sekmesinde görünür.

1. Admin panel → Kriz Uyarıları'ndan hangi iş'in başarısız olduğunu gör.
2. GitHub → Actions sekmesi → ilgili workflow → başarısız run'ın loglarına
   bak (kök neden genelde burada).
3. Kök nedeni düzeltip elle yeniden tetikle: Actions → ilgili workflow →
   **Run workflow** (`workflow_dispatch` hepsinde tanımlı).
4. `adminUyarilari` kaydını admin panelinden "çözüldü" olarak işaretle.

## 5. Deploy sürüm geçmişi

Her production deploy'u bir git tag'i bırakır (`release-YYYYMMDD-HHmmss`,
bkz. `test.yml`). Belirli bir zamanda hangi kodun canlıda olduğunu görmek
için:

```bash
git tag -l 'release-*' --sort=-creatordate | head -20
git show <tag> --stat
```

## 6. Onay kapısı ve acil deploy

`build_and_deploy` job'ı `environment: production` taşır
(`.github/workflows/test.yml`). GitHub → Settings → Environments →
`production` → **Required reviewers** yapılandırıldıysa, `test` job'ı
geçtikten sonra bu job **onay verilene kadar hiçbir adımı çalıştırmaz** —
build başlamaz, Firebase servis hesabı anahtarı runner'a hiç inmez. Onay,
GitHub'daki ilgili Actions run sayfasından ("Review deployments" butonu) ile
verilir.

**Bilinen davranış**: Ard arda birden fazla `main` push'u, `concurrency:
deploy-production` (`cancel-in-progress: false`) nedeniyle onay bekleyen bir
kuyruğa girer — her biri sırayla onay ister. Tek geliştiricili bir depoda bu
kabul edilebilir ama unutulursa deploy'lar birikir; Actions sekmesinde
"Waiting" durumundaki run'ları düzenli kontrol edin.

**Acil durum**: Onay adımını atlamanın CLI'dan bir yolu yoktur (bilerek —
amaç budur). Gerçekten acil bir düzeltme gerekiyorsa (örn. §2'deki rules
rollback'i) doğrudan `firebase deploy --only firestore:rules --project
muezzin-c8485` ile yerel makineden elle deploy edilebilir; bu, onay kapısını
atlamaz çünkü zaten GitHub Actions akışının dışındadır.

Bu onay kapısı **rules'un kendisini test etmez** — o güvenlik ağı hâlâ
`npm run test:rules` (emülatör, PR'da `test` job'ı içinde çalışır). Onay
kapısı yalnızca "testler geçti ama gerçekten canlıya çıksın mı" kararını
insana bırakır.

## 7. Proaktif uyarı sistemi (dış kanal webhook + hata patlaması eşiği)

Admin paneli AÇIK olmadıkça `adminUyarilari`'ndaki kayıtlar görünmezdi.
Şimdi iki tamamlayıcı mekanizma var:

**a) FCM push (Firestore'a bağımlı)** —
`.github/workflows/kritik-uyari-bildirimi.yml` her 30 dakikada bir
`scripts/kritikUyariBildirimGonder.ts`'i çalıştırır; `cozuldu: false` olan
her uyarıyı tüm **aktif admin**'lere (`muezzins` `role=='admin' &&
aktif==true`) push bildirimi olarak gönderir. Bildirim tercihi YOK — kritik
sistem arızası opt-out edilebilir değildir (bkz. script başı yorumu).

**b) Dış kanal webhook (Firestore'dan BAĞIMSIZ)** — 8 cron workflow'unun
her birinde `if: failure()` adımının yanına eklenen "Kritik arızayı dış
kanala bildir" adımı, `UYARI_WEBHOOK_URL` secret'ı tanımlıysa
`scripts/lib/disKanalUyari.ts` ile bir HTTP POST gönderir. Bu, kök nedeni
Firestore'un KENDİSİ olan arızaları da (a)'nın kör noktasını kapatarak
haber verir. **Kurulum opsiyoneldir** — secret tanımlı değilse script
sessizce atlanır, hiçbir iş bu yüzden kırılmaz.

Kurulum örnekleri (GitHub → Settings → Secrets and variables → Actions →
`UYARI_WEBHOOK_URL`):
- **Slack**: bir "Incoming Webhook" uygulaması ekleyip verdiği URL'yi
  (`https://hooks.slack.com/services/...`) olduğu gibi kullan.
- **Discord**: kanal ayarları → Integrations → Webhooks → New Webhook →
  URL'yi kopyala.
- **ntfy.sh**: `https://ntfy.sh/<kendi-topic-adın>` — topic'e abone olmak
  için ntfy uygulamasını/tarayıcısını kullan. JSON gövde bu uç noktaya
  düz metin olarak görünür (çirkin ama okunabilir); tam JSON API deseni
  isteniyorsa `disKanalUyari.ts`'in payload'ı ayrıca uyarlanmalı.

**c) Hata patlaması eşiği** — `.github/workflows/hata-esigi-kontrolu.yml`
her 6 saatte bir `scripts/hataEsigiKontrol.ts`'i çalıştırır: son 6 saatte
aynı imzalı bir istemci hatasının 50'den fazla kez kaydedilip
kaydedilmediğine bakar (imza formülü `telemetryService.ts`'teki OTURUM
başına rate-limit ile AYNI, ama bu script TÜM oturumlar toplamını görür).
Eşik aşılırsa `hataPatlamasi` tipinde bir `adminUyarilari` kaydı açılır —
(a) mekanizması bunu otomatik push'lar. Eşik altına dönünce önceki uyarı
otomatik çözülür (kotaKontrol.ts'teki AYNI desen).

Her iki yeni cron da elle tetiklenebilir: Actions → ilgili workflow → **Run
workflow**.

## 8. Firestore yedekleme ve geri yükleme (DR)

Proje Spark planında kaldığından native Managed Export/PITR yok — yedekleme
`scripts/firestoreYedekle.ts` ile Admin SDK üzerinden, haftalık
(`.github/workflows/firestore-yedek.yml`, Pazar 09:00 TR) çalışır.

**Kapsam**: `scripts/lib/yedekKapsam.ts`'teki `YEDEKLENECEK_KOLEKSIYONLAR`
(iş verisi: `muezzins`, `izinler`, `bildirimler`, `haftaPlanlari`, `duyurular`
vb.) — `error_logs`/`telemetry_logs` (TTL'li teşhis verisi) ve `vakitler`
(Diyanet API'den yeniden üretilebilir) ve `cronDurumu` (kısa ömürlü sentinel)
bilinçli hariç (bkz. o dosyadaki gerekçe). **Fail-closed**: canlı
veritabanında bu iki listede olmayan bir koleksiyon varsa yedekleme
FIRLATIR — `npm run verify:backup` (offline, `test:all` zincirinde) da
`firestore.rules`'taki her koleksiyonun kapsamda olduğunu CI'da doğrular.

**Kota koruması**: toplam belge sayısı 30.000'i (Spark'ın günlük 50K okuma
kotasının ~%60'ı) aşarsa yedek İPTAL edilir, `adminUyarilari`'na bir uyarı
bırakılır (§7'deki (a) mekanizması bunu push'lar) — dosya hiç yazılmaz.
Kapsam normale dönünce bir sonraki koşu bu uyarıyı otomatik çözer.

**Şifreleme**: depo PUBLIC olduğundan (bkz. kök `CLAUDE.md`) GitHub Actions
artifact'ları da repoyu okuyabilen herkese açıktır — yedek `gpg --symmetric
--cipher-algo AES256` ile `YEDEK_PAROLASI` secret'ı kullanılarak şifrelenir,
90 gün saklanan bir artifact olarak yüklenir. **`YEDEK_PAROLASI` repo
DIŞINDA (ör. bir parola yöneticisinde) saklanmalı** — yalnızca GitHub
secret'ında tutulursa ve secret bir şekilde erişilemez hâle gelirse (repo
silinir/erişim kaybedilir) yedek de işe yaramaz hâle gelir.

### Geri yükleme (acil durum)

`scripts/firestoreGeriYukle.ts` **CI'da ASLA çalıştırılmaz** (bilerek
reddedilir — deploy adımının tam tersi bir koruma) — yalnızca elle, yerel
bir makineden:

```bash
# 1. Artifact'ı GitHub Actions → ilgili "Firestore Yedekle" run'ından indir,
#    şifresini çöz:
gpg --batch --yes --passphrase "$YEDEK_PAROLASI" --output yedek.tar.gz --decrypt yedek.tar.gz.gpg
tar -xzf yedek.tar.gz

# 2. ÖNCE her zaman dry-run (varsayılan — --onayla verilmedikçe hiçbir şey
#    yazılmaz):
FIREBASE_SERVICE_ACCOUNT_KEY=... npm run yedek:geri-yukle -- --in=firestore-yedek.ndjson

# 3. Yalnızca çıktı beklentiyle eşleşiyorsa GERÇEK yazım — proje ID'sini
#    doğru teyit etmek ZORUNLUDUR (yanlış proje reddedilir):
FIREBASE_SERVICE_ACCOUNT_KEY=... npm run yedek:geri-yukle -- --in=firestore-yedek.ndjson --onayla --proje=muezzin-c8485

# Yalnızca tek bir koleksiyonu geri yüklemek için (tam felaket nadir,
# tipik senaryo tek koleksiyonun bozulmasıdır):
FIREBASE_SERVICE_ACCOUNT_KEY=... npm run yedek:geri-yukle -- --in=firestore-yedek.ndjson --onayla --proje=muezzin-c8485 --koleksiyon=izinler
```

**Önemli**: geri yükleme `set()` ile TAM ÜZERİNE YAZAR (merge değil) —
yedek alındıktan SONRA oluşturulan belgeler etkilenmez, ama yedekteki bir
belge o tarihten sonra değiştiyse değişiklik geri alınır. Kısmi/güncel bir
felakette önce hangi koleksiyonun etkilendiğini belirleyip yalnızca onu
`--koleksiyon` ile geri yükleyin.
