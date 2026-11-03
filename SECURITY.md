# Güvenlik Politikası

## Desteklenen sürüm

Yalnızca `main` dalındaki ve son production release tag'indeki sürüm güvenlik
güncellemesi alır.

## Güvenlik açığı bildirimi

Güvenlik açıklarını herkese açık issue olarak paylaşmayın. GitHub deposunun
**Security → Report a vulnerability** özel bildirim kanalını kullanın. Bildirimde
etkilenen akış, yeniden üretme adımları, olası etki ve varsa önerilen düzeltme
bulunmalıdır.

İlk alındı onayı hedefi 2 iş günü, ilk risk değerlendirmesi hedefi 5 iş günüdür.
Kritik bulgularda düzeltme veya geçici risk azaltma hedefi 72 saattir.

## Bağımlılık ve tedarik zinciri

- Production bağımlılıklarında `high` veya `critical` npm advisory CI'ı kırar.
- GitHub Actions referansları değişmez commit SHA'sına sabitlenir.
- Dependabot haftalık npm ve GitHub Actions güncelleme PR'ları açar.
- Bir açık hemen kapatılamıyorsa etkilenen yüzey, telafi edici kontrol, sorumlu
  ve son geçerlilik tarihi PR açıklamasında belgelenir.
