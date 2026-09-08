# Katkı Rehberi

Bu depo, tek bir cami/müezzin ekibi için nöbet çizelgeleme sistemidir. Kod
tabanına dair makine-okunur kurallar `CLAUDE.md`'de tutulur — bu doküman
onun insan-okunur, PR-akışına odaklı özeti.

## Kurulum

1. `npm install`
2. `firebase-applet-config.json` zaten repo'da commit'li (Firebase web config
   gizli değildir). Push bildirimleri veya emülatör bağlantısı gibi opsiyonel
   özellikler için `.env.example`'ı `.env`'e kopyalayıp doldurun.
3. `npm run dev` — port **3000** sabittir (Playwright bu portu bekler,
   değiştirmeyin).

## PR açmadan önce zorunlu

```bash
npm run test:all
```

**`npm test`, `test:all`'ın takma adı DEĞİLDİR** — yalnızca `test:smoke`
çalıştırır. `test:all` typecheck + typecheck:scripts + lint + format:check +
smoke + unit + rules + integration + sw-config + indexes zincirini çalıştırır.

`test:rules`, `test:integration` ve `test:e2e` bir Firebase emülatörü ister:

```bash
firebase emulators:exec --only firestore,auth --project muezzin-c8485 "npx playwright test"
```

## Commit ve dallanma

- Commit mesajları Türkçe, açıklayıcı (bu depoda conventional-commit önekleri
  zorunlu değil, ama okunan git geçmişiyle tutarlı yazın).
- Branch adlandırma mevcut örüntüyü izler: `feat/`, `fix/`, `chore/`, `docs/`.
- Her başarılı `main` push'u otomatik olarak production'a deploy edilir
  (`.github/workflows/test.yml` → `build_and_deploy`, onay kapısı arkasında —
  bkz. `docs/RUNBOOK.md`). PR'ınız merge edilmeden önce `test:all`'ın CI'da
  yeşil olduğundan emin olun.

## Dokunulmaması gereken alanlar

Aşağıdaki dosyalar hassas, birbirine bağımlı iş kuralları taşır — burada bir
değişiklik yapacaksanız önce `CLAUDE.md`'nin ilgili bölümünü okuyun ve
Opus modeliyle ikinci bir gözle doğrulatın:

- `src/lib/planlamaCekirdegi.ts`, `src/utils/tieBreaker.ts` — haftalık nöbet
  atamasının tek kaynağı, hem cron hem istemci bunu çağırır.
- `src/lib/mazeretKurallari.ts` ve onunla senkron tutulması gereken üç
  uygulama noktası: `src/services/mazeretServisi.ts`,
  `src/services/vekaletServisi.ts`, `scripts/vekaletDevirleriniIsle.ts` +
  `firestore.rules`'taki karşılıkları. Cuma/1 saatlik pencere kısıtlaması bu
  dört yerde bağımsız olarak uygulanıyor — birini değiştirirken diğerlerini
  unutmayın.
- `firestore.rules` — tüm yetkilendirmenin gerçek sınırı, istemci kodu
  güvenilmez kabul edilir.
- `.github/workflows/*.yml` — public repoda canlıya kendi başına
  deploy/yazan tetikleyiciler.

## Tasarım sistemi

Yeni UI eklerken `CLAUDE.md`'deki "Tasarım sistemi" bölümündeki token'ları
kullanın: köşe yarıçapı için `rounded-card`/`rounded-avatar`/`rounded-icon`
(çıplak `rounded-[NNpx]` yazmayın), ikincil metin için `text-muted/subtle/
faint` (çıplak `opacity-NN` yazmayın), motion için `src/lib/motion.ts`
(`SPRING`/`EASE`/`DURATION`).

## Model seçimi (Claude Code ile çalışıyorsanız)

`CLAUDE.md`'deki "Model Seçimi" tablosunu izleyin: keşif/dosya bulma → Haiku,
uygulama/refactor → Sonnet (varsayılan), riskli alan/plan/doğrulama → Opus.
