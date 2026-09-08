import { OperationType } from '../../src/lib/operationType.ts';

// Geriye dönük uyumluluk için tekrar dışa aktarılır — bu dosyayı
// `import { OperationType } from './lib/errors.ts'` şeklinde kullanan
// mevcut script'ler değişmeden çalışmaya devam eder. Enum'un TEK tanımı
// artık src/lib/operationType.ts'te (bkz. src/lib/firestore-errors.ts'teki
// AYNI enum'la kod denetiminde tespit edilen kopya) — bu dosya (~0 bağımlılık)
// hem tarayıcı hem Admin SDK bağlamında güvenle import edilebiliyor.
export { OperationType };

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
  };
}

/** Admin SDK cron script'leri için ortak hata biçimlendirici (console + throw). */
export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: 'SERVICE_ACCOUNT', // Admin SDK doesn't have a current user in the same way
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
