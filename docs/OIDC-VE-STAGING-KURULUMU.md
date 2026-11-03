# OIDC ve Staging Kurulumu

Depo tarafı uzun ömürlü servis hesabı anahtarlarını kullanmadan çalışmaya
hazırdır. Aktivasyon Google Cloud ve GitHub yönetici yetkisi gerektirir.

## Workload Identity Federation

1. Google Cloud'da GitHub OIDC issuer'ı (`https://token.actions.githubusercontent.com`)
   için bir Workload Identity Pool/Provider oluşturun.
2. Attribute koşulunu bu depoya ve `main` dalına/environments'a daraltın.
3. Ayrı servis hesapları oluşturun:
   - automation: zamanlanmış işlerin ihtiyaç duyduğu Firestore/FCM yetkileri,
   - backup: yalnız yedek kapsamındaki koleksiyonları okuma ve uyarı yazma,
   - deploy: Hosting + Firestore rules/indexes deploy,
   - staging: yalnız staging projesine deploy.
4. GitHub Variables ekleyin:
   - `GCP_WORKLOAD_IDENTITY_PROVIDER`
   - `GCP_SERVICE_ACCOUNT_AUTOMATION`
   - `GCP_SERVICE_ACCOUNT_BACKUP`
   - `GCP_SERVICE_ACCOUNT_DEPLOY`
   - `GCP_SERVICE_ACCOUNT_STAGING`
5. Workflow'ları elle doğruladıktan sonra
   `FIREBASE_SERVICE_ACCOUNT_EZANMERKEZI` JSON secret'ını silin ve ilgili
   Google servis hesabı anahtarını iptal edin.

Workflow'lar geçiş süresince eski secret'a geri düşebilir; OIDC değişkenleri
tanımlandığında `google-github-actions/auth` Application Default Credentials
dosyasını üretir ve `firebaseAdminInit.ts` bunu otomatik kullanır.

## Ayrı Spark staging projesi

Production ve staging projeleri **Firebase Spark planında** kalır. Bu akış
Cloud Functions, Cloud Run, Cloud Scheduler, ücretli Artifact Registry,
Firestore PITR/managed backup veya Blaze'e bağlı başka bir servis kullanmaz.
Zamanlanmış işler GitHub Actions üzerinden çalışır; staging yalnız Hosting,
Authentication, Firestore ve App Check'in ücretsiz kotaları içinde tutulur.

GitHub Variables:

- `STAGING_FIREBASE_PROJECT`
- `STAGING_HOSTING_URL`
- `STAGING_FIREBASE_CONFIG_JSON`
- `STAGING_RECAPTCHA_SITE_KEY`
- `STAGING_FCM_VAPID_KEY`

Staging Firebase projesinde production kullanıcı/verisi kullanılmaz. Sentetik
hesaplar ve anonim seed verisi tutulur. `.github/workflows/staging.yml`, gerekli
değişkenler eksikse koşmaz; yapılandırıldığında her `main` push'ını ayrı projeye
deploy eder ve commit SHA tabanlı sağlık kontrolü yapar. Staging projesinde
Blaze'e yükseltme yapılmaz; ücretsiz kota yaklaşırsa deploy/seed sıklığı azaltılır.
