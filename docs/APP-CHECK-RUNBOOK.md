# Firebase App Check Aktivasyon Runbook'u

Production ve staging deploy iş akışları artık reCAPTCHA Enterprise site key
olmadan bundle üretmez. İstemci token alma hatasında uygulamayı erişilemez
yapmaz; gerçek veri sınırı Firebase Console enforcement ayarıdır.

## Kademeli aktivasyon

1. Staging projesinde App Check'i Firestore için enforce edin.
2. Login, ana ekran, plan, izin, mazeret ve vekalet akışlarını web/PWA ve
   desteklenen tarayıcılarda doğrulayın.
3. Production Console metriklerinde en az 7 gün geçerli/geçersiz/eskimiş
   istek oranını izleyin. Bilinen uygulama sürümlerinden gelen geçersiz
   trafiğin kök nedenini çözmeden enforce etmeyin.
4. Düşük kullanım penceresinde production Firestore enforcement'i açın.
5. `adminUyarilari`, giriş hata oranı ve kullanıcı geri bildirimini ilk 60
   dakika yakından izleyin.

## Geri alma

Yaygın `permission-denied` ve App Check token hatası görülürse önce Firebase
Console'da enforcement'i tekrar monitoring moduna alın. Site key'i koddan
silmek veya Firestore rules'u gevşetmek geri alma yöntemi değildir.
