import { auth } from './firebase';
import { telemetryService } from '../services/telemetryService';
import { OperationType } from './operationType';

// Geriye dönük uyumluluk için tekrar dışa aktarılır — bu dosyayı
// `import { OperationType } from '../lib/firestore-errors'` şeklinde
// kullanan mevcut ~15 çağıran değişmeden çalışmaya devam eder. Enum'un
// TEK tanımı artık ./operationType.ts'te (bkz. scripts/lib/errors.ts'teki
// AYNI enum'la kod denetiminde tespit edilen kopya).
export { OperationType };

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
  };
}

// Firestore/Firebase SDK hata kodlarından kullanıcıya gösterilecek kısa,
// Türkçe mesajlara eşleme. Ham SDK mesajları ("Missing or insufficient
// permissions", teknik JSON vb.) hiçbir zaman doğrudan kullanıcıya
// gösterilmemeli — tam detay yalnızca console.error + telemetri'ye gider.
const FRIENDLY_MESSAGES: Record<string, string> = {
  'permission-denied': 'Bu işlem için yetkiniz yok.',
  'not-found': 'Aradığınız kayıt bulunamadı.',
  unavailable: 'Sunucuya şu anda ulaşılamıyor. İnternet bağlantınızı kontrol edip tekrar deneyin.',
  'deadline-exceeded': 'İşlem zaman aşımına uğradı. Lütfen tekrar deneyin.',
  'resource-exhausted': 'Dizge şu anda yoğun. Lütfen birkaç dakika sonra tekrar deneyin.',
  unauthenticated: 'Oturumunuz sona ermiş. Lütfen tekrar giriş yapın.',
  cancelled: 'İşlem iptal edildi.',
  'already-exists': 'Bu kayıt zaten mevcut.',
  'failed-precondition': 'Bu işlem şu anda gerçekleştirilemez. Sayfayı yenileyip tekrar deneyin.',
  aborted: 'İşlem bir çakışma nedeniyle iptal edildi. Lütfen tekrar deneyin.',
  internal: 'Beklenmeyen bir dizge hatası oluştu.',
  unknown: 'Beklenmeyen bir hata oluştu.',
};
const DEFAULT_FRIENDLY_MESSAGE = 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.';

export function isFirebaseSdkError(error: unknown): error is { code: string; message: string } {
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string';
}

// JS'in kendi çalışma-zamanı hata sınıfları — bu kod tabanında hiçbir yerde
// kasıtlı/kullanıcıya-yönelik bir mesaj için ATILMAZLAR (uygulama kodu her
// zaman düz `new Error('Türkçe mesaj')` fırlatır, bkz. mazeretKurallari.ts/
// timeoutUtils.ts örnekleri) — bunlar her zaman kazara bir programlama
// hatasının belirtisidir. `handleFirestoreError` her yerde genel bir
// `catch` bloğunda çağrıldığından, Firestore çağrısından ÖNCE oluşan
// beklenmedik bir `TypeError` vb. de (instanceof Error olduğu için)
// `toUserMessage`'ın "zaten kullanıcıya yönelik" dalına düşüp ham/İngilizce
// mesajını doğrudan kullanıcıya sızdırabiliyordu (bkz. mimari denetim).
const KAZARA_JS_HATA_SINIFLARI = [TypeError, RangeError, ReferenceError, SyntaxError, URIError, EvalError];

/**
 * Bir hatadan kullanıcıya gösterilecek kısa Türkçe mesajı türetir.
 *  - Firebase SDK hataları (permission-denied vb.) → sabit, anlaşılır mesaj.
 *  - JS'in kendi çalışma-zamanı hata sınıfları (TypeError vb.) → kazara bir
 *    programlama hatası sayılır, mesajı ASLA kullanıcıya gösterilmez.
 *  - Uygulama içinde elle fırlatılan düz `Error`lar (ör. "Ezan vaktine 50
 *    dakikadan az kaldı...") zaten kullanıcıya yönelik olduğundan olduğu
 *    gibi korunur.
 */
function toUserMessage(error: unknown): string {
  if (isFirebaseSdkError(error)) {
    return FRIENDLY_MESSAGES[error.code] ?? DEFAULT_FRIENDLY_MESSAGE;
  }
  if (KAZARA_JS_HATA_SINIFLARI.some((ctor) => error instanceof ctor)) {
    return DEFAULT_FRIENDLY_MESSAGE;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return DEFAULT_FRIENDLY_MESSAGE;
}

/**
 * Merkezi Firestore hata işleyicisi.
 * Teknik detay konsola ve telemetri servisine gider (sessiz hata kalmasın);
 * çağırana ise yalnızca kullanıcıya gösterilebilir kısa bir mesaj taşıyan
 * bir Error döner.
 */
export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): Error {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
    },
    operationType,
    path,
  };

  console.error('Firestore Error Detailed: ', JSON.stringify(errInfo));

  // Telemetri servisine ilet (statik, döngü riski yok)
  try {
    const wrappedError = error instanceof Error ? error : new Error(String(error));
    telemetryService.addBreadcrumb(`Firestore [${operationType}] hata: ${path ?? 'bilinmeyen yol'}`, 'network', {
      path,
      operationType,
      uid: auth.currentUser?.uid ?? null,
    });
    telemetryService.logError(wrappedError, `Firestore ${operationType} @ ${path ?? 'unknown'}`);
  } catch {
    /* telemetri servisine ulaşılamazsa sessizce devam et */
  }

  return new Error(toUserMessage(error));
}
