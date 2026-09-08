import { useMemo } from 'react';
import { GunlukVakit } from '../types';
import { mevcutVaktiHesapla } from '../services/ezanVaktiServisi';
import { useMinuteTick } from './useTime';

export function useMevcutVakit(bugunVakitler: GunlukVakit | null) {
  const tick = useMinuteTick();

  const mevcut = useMemo(() => {
    if (!bugunVakitler) return null;
    return mevcutVaktiHesapla(bugunVakitler);
    // `tick` gövdede doğrudan okunmuyor — mevcutVaktiHesapla içeride "şimdi"yi
    // kendi çağırır, `tick` yalnızca dakikada bir bu memo'yu yeniden
    // tetiklemek için var (bkz. useMinuteTick). Kaldırılırsa "mevcut vakit"
    // görüntüsü mount anındaki değerde donar kalır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bugunVakitler, tick]);

  return mevcut;
}
