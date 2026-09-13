import { Vakit } from '../types';

interface VakitKimligi {
  aura: string;
  auraSecondary: string;
}

/**
 * Vakit → renk kimliğinin TEK kaynağı (bkz. görsel tasarım denetimi V1).
 *
 * Önceden bu eşleme dört ayrı yerde birbirinden bağımsız tanımlıydı:
 * useCircadianTheme.ts (--dynamic-aura'yı besleyen, 355 çağrı noktası), bu
 * dosyanın eski hâli, AnaEkranHero.tsx'teki AKTIF_VAKIT_RENKLERI tablosu, ve
 * GeriSayim.tsx'teki bağımsız bir ternary zinciri. Sonuç: sabah vaktinde aynı
 * ekranda zemin aurası amber, hero'nun iç parıltısı zümrüt, aktif vakit kartı
 * indigo, geri sayım halkası da zümrüt gösterebiliyordu.
 *
 * Faz 1 tüm tüketicileri hizaladı ama altı vakti iki ödünç aileye (amber/
 * ruby) düşürüyordu. Faz 2: her vakit `index.css`'teki kendi `--vakit-*`
 * token'ına (bkz. o dosyadaki "Vakte özgü gökyüzü paleti" yorumu, V15)
 * bağlanır — gün doğumundan geceye altı ayrı ton. `auraSecondary`, gün
 * içinde bir ÖNCEKİ vaktin tonu: zemindeki ikinci aura blob'u (Layout.tsx)
 * "bir önceki ışığın henüz sönmemiş izi" hissi verir — vaktin kendisi kadar
 * anlamlı, rastgele bir tamamlayıcı renk değil.
 */
const VAKIT_KIMLIGI: Record<string, VakitKimligi> = {
  sabah: { aura: 'var(--vakit-sabah)', auraSecondary: 'var(--vakit-yatsi)' },
  gunes: { aura: 'var(--vakit-gunes)', auraSecondary: 'var(--vakit-sabah)' },
  ogle: { aura: 'var(--vakit-ogle)', auraSecondary: 'var(--vakit-gunes)' },
  ikindi: { aura: 'var(--vakit-ikindi)', auraSecondary: 'var(--vakit-ogle)' },
  aksam: { aura: 'var(--vakit-aksam)', auraSecondary: 'var(--vakit-ikindi)' },
  yatsi: { aura: 'var(--vakit-yatsi)', auraSecondary: 'var(--vakit-aksam)' },
};

/** Vakit henüz bilinmiyorken (yükleme durumu) kullanılan nötr kimlik — hiçbir gerçek vakitle çakışmaz. */
const VARSAYILAN_KIMLIK: VakitKimligi = { aura: 'var(--aura-indigo)', auraSecondary: 'var(--aura-indigo)' };

export function getVakitKimligi(vakit: Vakit | 'gunes' | null | undefined): VakitKimligi {
  if (!vakit) return VARSAYILAN_KIMLIK;
  return VAKIT_KIMLIGI[vakit] ?? VARSAYILAN_KIMLIK;
}

export function getActiveAuraColor(vakit: Vakit | 'gunes' | null | undefined): string {
  return getVakitKimligi(vakit).aura;
}

/** Ana aura ile kontrast oluşturan sekonder tamamlayıcı renk. */
export function getSecondaryAuraColor(vakit: Vakit | 'gunes' | null | undefined): string {
  return getVakitKimligi(vakit).auraSecondary;
}
