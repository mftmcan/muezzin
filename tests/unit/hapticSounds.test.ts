import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hapticLight, kullaniciEtkilesimiVarMi } from '../../src/lib/haptic';

const vibrateMock = vi.fn();

function aktivasyonAyarla(isActive: boolean, hasBeenActive: boolean) {
  Object.defineProperty(navigator, 'userActivation', {
    configurable: true,
    value: { isActive, hasBeenActive },
  });
}

beforeEach(() => {
  vibrateMock.mockClear();
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrateMock });
  aktivasyonAyarla(false, false);
});

describe('ses ve haptik kullanıcı aktivasyonu koruması', () => {
  it('programatik sayfa açılışında vibration çağrısı yapmaz', () => {
    hapticLight();
    expect(kullaniciEtkilesimiVarMi()).toBe(false);
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it('gerçek kullanıcı etkileşiminden sonra haptik geri bildirime izin verir', () => {
    aktivasyonAyarla(false, true);
    hapticLight();
    expect(vibrateMock).toHaveBeenCalledWith(8);
  });

  it('AudioContext kullanıcı etkileşimi olmadan oluşturulmaz', async () => {
    const audioContextMock = vi.fn();
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: audioContextMock });
    const { getAudioContext } = await import('../../src/lib/sounds');

    expect(getAudioContext()).toBeNull();
    expect(audioContextMock).not.toHaveBeenCalled();
  });
});
