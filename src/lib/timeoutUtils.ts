/**
 * Firestore JS SDK'nın `persistentLocalCache`'i etkinken, çevrimdışıyken
 * başlatılan write/transaction Promise'leri (bilinen SDK davranışı) asla
 * reddetmeyip sonsuza dek askıda kalabiliyor — bu, "İŞLENİYOR" durumundaki
 * düğmelerin kullanıcı arayüzünde sonsuza dek kilitli kalmasına yol
 * açıyordu (ör. çıkış düğmesi, vekalet kabul/red, okudum onayla, mazeret
 * bildirme — bkz. beşinci denetim turu). `zamanAsimiIle` belirtilen sürede
 * sonuçlanmazsa `IslemZamanAsimi` fırlatır.
 *
 * ÖNEMLİ: alttaki işlemi İPTAL ETMEZ — Firestore'un kendi offline yazım
 * kuyruğu arka planda çalışmaya devam eder, bağlantı geldiğinde işlem
 * kendiliğinden tamamlanır. Bu yardımcı yalnızca arayüzün sonsuza dek
 * beklemesini önler; çağıran taraf `IslemZamanAsimi`'yi yakalayıp dürüst
 * bir "çevrimdışı görünüyorsunuz, bağlantı sağlanınca tamamlanabilir"
 * mesajı göstermeli, "başarısız oldu" gibi yanlış bir sonuç iddia
 * etmemelidir.
 */
export class IslemZamanAsimi extends Error {}

export function zamanAsimiIle<T>(promise: Promise<T>, sureMs = 8000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new IslemZamanAsimi(
          'Bu işlem şu anda tamamlanamadı. Çevrimdışı olabilirsiniz — bağlantınız sağlanınca işlem kendiliğinden tamamlanabilir; birkaç dakika sonra tekrar kontrol edin.'
        )
      );
    }, sureMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
