# Güvenlik İstisnaları

Production dependency ağacı için istisna yoktur; `npm run security:audit`
high/critical bulguda başarısız olur.

Geliştirme araç zincirindeki advisory'ler production bundle'a dahil değildir ve
upstream araç güncellemeleriyle izlenir. Bunlar kalıcı kabul değildir. Her
Dependabot turunda yeniden değerlendirilir; production ağacına taşınan herhangi
bir bulgu derhal sert CI kapısına girer.

2026-10-30 itibarıyla kalan geliştirme zinciri bulgularının ana kaynakları
`firebase-tools` ve `vite-plugin-pwa/workbox-build` transitif bağımlılıklarıdır.
`npm audit fix --force` tarafından önerilen geriye dönük major downgrade'ler
uygulamanın emulator/deploy/PWA zincirini bozabileceği için otomatik uygulanmaz.

## Spark planı denetim kaydı sınırı

Birinci taraf istemci akışlarındaki kritik yazımlar, mümkün olan yerlerde asıl
değişiklik ve `audit_logs` kaydını aynı Firestore batch'i içinde tamamlar. Bu,
uygulama kaynaklı yarım kalmış yazımları önler; ancak Spark planında güvenilir
bir sunucu çalışma zamanı bulunmadığından kötü niyetli bir istemciyi her
değişiklik için denetim kaydı üretmeye zorlayan otoritatif bir backend audit
zinciri değildir. Güvenlik sınırı denetim kaydı değil, `firestore.rules` erişim
ve şema kontrolleridir. Bu sınırlama Cloud Functions/Run eklenmeden tamamen
kaldırılamaz ve Spark planında kalma kararı gereği bilinçli olarak kabul edilir.
