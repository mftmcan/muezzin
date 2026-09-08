import { Timestamp, GeoPoint, DocumentReference } from 'firebase-admin/firestore';

/**
 * Firestore'un JSON'da doğrudan temsil edilemeyen tiplerini (Timestamp,
 * GeoPoint, DocumentReference) NDJSON'a yazılabilir/geri okunabilir kılan
 * tipli sarmalayıcı. `Bytes` KASITLI OLARAK ele alınmıyor — Admin SDK'nın
 * `firebase-admin/firestore` modülü client SDK'nın aksine ayrı bir `Bytes`
 * sınıfı export etmiyor (bytes alanları düz `Buffer` olarak döner) ve bu
 * projenin şemasında (`firestore.rules`) hiçbir bytes alanı yok — eklenirse
 * bu dosya + `serilestir`/`serilestirmeyiCoz` genişletilmeli.
 *
 * TUZAK (bilerek burada belgelenir): `firebase-admin`'in `Timestamp`'i
 * `JSON.stringify`'da sessizce `{_seconds, _nanoseconds}` düz bir map'e
 * düşer — bu haliyle geri yüklendiğinde bir `Timestamp` DEĞİL, sıradan bir
 * map olarak Firestore'a yazılır (tip sessizce bozulur, hiçbir hata
 * vermez). Bu yüzden `JSON.stringify` asla doğrudan bir Firestore belgesine
 * uygulanmaz — her değer önce `serilestir()`den geçer.
 */
export type SerilestirilmisDeger =
  | null
  | string
  | number
  | boolean
  | { __tip: 'timestamp'; s: number; ns: number }
  | { __tip: 'geopoint'; lat: number; lng: number }
  | { __tip: 'docref'; path: string }
  | SerilestirilmisDeger[]
  | { [anahtar: string]: SerilestirilmisDeger };

export function serilestir(deger: unknown): SerilestirilmisDeger {
  if (deger === null || deger === undefined) return null;
  if (deger instanceof Timestamp) return { __tip: 'timestamp', s: deger.seconds, ns: deger.nanoseconds };
  if (deger instanceof GeoPoint) return { __tip: 'geopoint', lat: deger.latitude, lng: deger.longitude };
  if (deger instanceof DocumentReference) return { __tip: 'docref', path: deger.path };
  if (Array.isArray(deger)) return deger.map(serilestir);
  if (typeof deger === 'object') {
    const sonuc: { [anahtar: string]: SerilestirilmisDeger } = {};
    for (const [k, v] of Object.entries(deger as Record<string, unknown>)) {
      sonuc[k] = serilestir(v);
    }
    return sonuc;
  }
  // string | number | boolean
  return deger as string | number | boolean;
}

function tipliMi(deger: unknown): deger is { __tip: string } {
  return typeof deger === 'object' && deger !== null && '__tip' in deger;
}

/** `db` yalnızca `docref` tipini gerçek bir `DocumentReference`'a geri
 * çevirmek için gerekli (yol → referans dönüşümü Firestore instance ister). */
export function serilestirmeyiCoz(deger: SerilestirilmisDeger, db: FirebaseFirestore.Firestore): unknown {
  if (deger === null) return null;
  if (Array.isArray(deger)) return deger.map((d) => serilestirmeyiCoz(d, db));
  if (typeof deger === 'object') {
    if (tipliMi(deger)) {
      switch (deger.__tip) {
        case 'timestamp':
          return new Timestamp((deger as { s: number }).s, (deger as { ns: number }).ns);
        case 'geopoint':
          return new GeoPoint((deger as { lat: number }).lat, (deger as { lng: number }).lng);
        case 'docref':
          return db.doc((deger as { path: string }).path);
        default:
          throw new Error(`Bilinmeyen serileştirme tipi: ${(deger as { __tip: string }).__tip}`);
      }
    }
    const sonuc: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(deger)) {
      sonuc[k] = serilestirmeyiCoz(v as SerilestirilmisDeger, db);
    }
    return sonuc;
  }
  return deger;
}
