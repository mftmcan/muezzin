import { describe, expect, it } from 'vitest';
import { firebaseConfigCoz, type AppFirebaseOptions } from '../../src/lib/firebaseConfig';

const fallback: AppFirebaseOptions = {
  apiKey: 'prod-key',
  projectId: 'prod-project',
  authDomain: 'prod.example.test',
};

describe('firebaseConfigCoz', () => {
  it('ortam değişkeni yoksa commit edilmiş yapılandırmayı kullanır', () => {
    expect(firebaseConfigCoz(undefined, fallback)).toBe(fallback);
  });

  it('eksiksiz staging JSON yapılandırmasını atomik olarak seçer', () => {
    const staging = { apiKey: 'stage-key', projectId: 'stage-project', authDomain: 'stage.example.test', appId: 'stage-app' };

    expect(firebaseConfigCoz(JSON.stringify(staging), fallback)).toEqual(staging);
  });

  it('bozuk JSON ile production yapılandırmasına sessizce düşmez', () => {
    expect(() => firebaseConfigCoz('{', fallback)).toThrow('geçerli JSON değil');
  });

  it.each([
    {},
    { apiKey: 'key', projectId: 'project' },
    { apiKey: '', projectId: 'project', authDomain: 'stage.example.test' },
    { apiKey: 'key', projectId: 42, authDomain: 'stage.example.test' },
  ])('eksik veya geçersiz zorunlu alanları reddeder: %j', (config) => {
    expect(() => firebaseConfigCoz(JSON.stringify(config), fallback)).toThrow('VITE_FIREBASE_CONFIG_JSON');
  });
});
