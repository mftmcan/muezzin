import type { FirebaseOptions } from 'firebase/app';

export type AppFirebaseOptions = FirebaseOptions & { firestoreDatabaseId?: string };

/**
 * Ortam Firebase yapılandırmasını fail-closed çözer. Web config bir sır
 * değildir; tek JSON değişkeni staging alanlarının production değerleriyle
 * kısmen karışmasını engeller.
 */
export function firebaseConfigCoz(raw: string | undefined, fallback: AppFirebaseOptions): AppFirebaseOptions {
  if (!raw) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('VITE_FIREBASE_CONFIG_JSON geçerli JSON değil. Yanlış ortama sessizce bağlanma engellendi.');
  }

  if (!parsed || typeof parsed !== 'object' || !('apiKey' in parsed) || !('projectId' in parsed) || !('authDomain' in parsed)) {
    throw new Error('VITE_FIREBASE_CONFIG_JSON apiKey, projectId ve authDomain alanlarını içermelidir.');
  }

  const config = parsed as Record<string, unknown>;
  if (
    typeof config.apiKey !== 'string' ||
    config.apiKey.trim() === '' ||
    typeof config.projectId !== 'string' ||
    config.projectId.trim() === '' ||
    typeof config.authDomain !== 'string' ||
    config.authDomain.trim() === ''
  ) {
    throw new Error('VITE_FIREBASE_CONFIG_JSON zorunlu alanları boş olmayan metin olmalıdır.');
  }

  return parsed as AppFirebaseOptions;
}
