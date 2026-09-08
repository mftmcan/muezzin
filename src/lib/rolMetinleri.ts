/**
 * rolMetinleri.ts
 * Rol tabanlı erişim kısıtlamalarının kullanıcıya gösterilen TEK metin
 * kaynağı. Aynı açıklama birden fazla ekranda (görev kartı, izin talebi,
 * vekalet kutusu, admin tehlikeli-bölge kartları) tekrarlandığından, metin
 * kayması olmasın diye burada toplanır (bkz. premium denetim P1.5/P1.6).
 *
 * NOT: bu metinlerin hiçbiri bir GÜVENLİK sınırı değildir — yalnızca
 * kullanıcıya "neden bu düğme kapalı" sorusunun cevabını verirler. Gerçek
 * sınır her zaman `firestore.rules`'tadır.
 */

/** 'gozlemci' rolü hiçbir yazma/talep akışını kullanamaz — sunucu tarafı
 *  karşılığı: firestore.rules `isAssignableDutyUidVeri` (role == 'muezzin')
 *  ve `isValidIzin` / `isValidVekaletCreate` içindeki rol şartları. */
export const GOZLEMCI_SALT_OKUMA_IPUCU = 'Gözlemci rolündesiniz — bu ekranı yalnızca görüntüleyebilirsiniz, işlem yapamazsınız.';

/** Geri alınamaz toplu silme işlemleri yalnızca config/bootstrap
 *  superAdminEmails listesindeki süper-adminlere açıktır — sunucu tarafı
 *  karşılığı: firestore.rules `isSuperAdmin()`. */
export const SUPER_ADMIN_GEREKLI_IPUCU = 'Bu geri alınamaz işlem yalnızca baş yönetici (süper-admin) yetkisiyle yürütülebilir.';
