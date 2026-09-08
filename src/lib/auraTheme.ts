import { Vakit } from '../types';

/**
 * Aktif vakte göre "sirkadiyen" arka plan aura rengi. AdminPanel.tsx,
 * useDashboardLogic.ts, HaftalikTakvim.tsx ve AnaEkranHero.tsx arasında
 * birebir kopyalanmış bir eşlemeydi (5 bağımsız kopya) — tek kaynağa
 * indirgendi (bkz. mimari denetim). NOT: `useCircadianTheme.ts`'in
 * `--dynamic-aura` için yazdığı DAHA ZENGİN, kerahat/cuma/teheccüd
 * dönemlerini de hesaba katan eşleme KASITLI OLARAK AYRI tutuldu — bu
 * fonksiyon yalnızca basit "hangi vakit" ambient arkaplanları için, o ise
 * canlı/global durum için. aksam/yatsi bucket'ı için renk (ruby) görsel
 * denetimle (bkz. görsel tasarım denetimi) her iki eşlemede de hizalandı —
 * aksi halde admin ve müezzin panelleri aynı anda aynı token için farklı
 * renk render ediyordu (bkz. GeriSayim.tsx, useCircadianTheme.ts).
 */
export function getActiveAuraColor(vakit: Vakit | 'gunes' | null | undefined): string {
  switch (vakit) {
    case 'aksam':
      return 'var(--aura-ruby)';
    case 'yatsi':
      return 'var(--aura-ruby)';
    case 'ogle':
    case 'ikindi':
    case 'gunes':
      return 'var(--aura-amber)';
    case 'sabah':
      return 'var(--aura-emerald)';
    default:
      return 'var(--aura-indigo)';
  }
}

/** Ana aura ile kontrast oluşturan sekonder tamamlayıcı renk. */
export function getSecondaryAuraColor(vakit: Vakit | null | undefined): string {
  switch (vakit) {
    case 'aksam':
      return 'var(--aura-indigo)';
    case 'yatsi':
      return 'var(--aura-emerald)';
    case 'ogle':
    case 'ikindi':
      return 'var(--aura-rose)';
    case 'sabah':
      return 'var(--aura-amber)';
    default:
      return 'var(--aura-emerald)';
  }
}
