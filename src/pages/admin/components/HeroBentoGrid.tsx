import { motion } from 'motion/react';
import { ShieldAlert, CalendarClock, ClipboardCheck, Megaphone, ChevronRight, Activity } from 'lucide-react';
import { Skeleton } from '../../../components/ui/Skeleton';
import { toTurkishUpperCase } from '../../../lib/dateUtils';

const HERO_SPRING = { type: 'spring', stiffness: 300, damping: 24 } as const;

/**
 * ExecutiveHeroScreen'in BENTO GRID katmanı — kadro durumu büyük kutusu,
 * uyarı kutusu ve İZİN/PLAN/DUYURU üçlüsü. Hizmet Akışı tablosu ayrı
 * bileşendir (HizmetAkisiTablosu.tsx); bu dosya yalnızca ızgarayı taşır.
 *
 * FE-001 uzantısı: ExecutiveHeroScreen.tsx'ten çıkarıldı; JSX ve animasyon
 * değerleri birebir korundu (görsel regresyon sıfır fark hedefi).
 */
export function HeroBentoGrid({
  muezzinlerSayisi,
  cozulmamisSayisi,
  pendingIzinler,
  statsLoading,
  sonAlarmMesaji,
  setActiveTab,
  onOpenDrawer,
  planStatusBilgisi,
}: {
  muezzinlerSayisi: number;
  cozulmamisSayisi: number;
  pendingIzinler: number;
  statsLoading: boolean;
  /** Çözülmemiş uyarıların en yenisinin serbest metin mesajı (alarmlar[0].mesaj). */
  sonAlarmMesaji: string | undefined;
  setActiveTab: (tab: 'ekip' | 'planlama', subtab?: string) => void;
  onOpenDrawer: (content: 'alarmlar' | 'duyurular') => void;
  /** "HAFTALIK PLAN" kutusunun durum satırı — ebeveynde useHaftaPlan/
   * useHaftaBildirimleri dinleyicilerinden türetilir. */
  planStatusBilgisi: { planHazir: boolean; bekleyenOnaySayisi: number; haftalikGorevSayisi: number; planStatusLabel: string };
}) {
  const { planHazir, bekleyenOnaySayisi, haftalikGorevSayisi, planStatusLabel } = planStatusBilgisi;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-8">
      {/* Large Tile: Kadro Durumu */}
      <motion.div
        whileHover={{ y: -5, scale: 1.005 }}
        whileTap={{ scale: 0.995 }}
        transition={{ type: 'spring', stiffness: 280, damping: 22 }}
        onClick={() => setActiveTab('ekip')}
        className="col-span-1 md:col-span-1 lg:col-span-7 spatial-glass !rounded-card p-8 relative overflow-hidden group min-h-[300px] flex flex-col justify-between cursor-pointer shimmer-trigger"
      >
        <div className="kinetic-sheen" />
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--text-primary)]/[0.02] via-transparent to-transparent pointer-events-none" />

        {/* Header */}
        <div className="relative z-10 flex items-center justify-between mb-6">
          <div className="w-12 h-12 rounded-2xl bg-[var(--dynamic-aura,var(--aura-indigo))]/10 flex items-center justify-center text-[var(--dynamic-aura,var(--aura-indigo))] border border-[var(--dynamic-aura,var(--aura-indigo))]/20 shadow-elev2">
            <Activity size={24} strokeWidth={1.5} />
          </div>
          <span className="authority-title !text-2xs opacity-40 font-medium tracking-wide group-hover:font-bold transition-all duration-200">
            HİZMET KADROSU
          </span>
        </div>

        {/* Personnel Count — large number */}
        <div className="relative z-10 flex-1 flex flex-col justify-center">
          {statsLoading ? (
            <Skeleton className="w-28 h-16 lg:h-20 mb-2" />
          ) : (
            <div className="text-6xl lg:text-8xl font-extralight text-[var(--text-primary)] tracking-tighter leading-none tabular-nums mb-2">
              {muezzinlerSayisi}
            </div>
          )}
          <span className="authority-title !text-2xs opacity-25 tracking-widest">AKTİF MÜEZZİN KADROSU</span>

          {/* Status bars */}
          <div className="mt-8 flex flex-col gap-3">
            <div className="flex items-center gap-4">
              <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              <div className="flex-1 h-[2px] rounded-full bg-[var(--glass-border)] overflow-hidden">
                <div className="h-full bg-emerald-500/60 rounded-full" style={{ width: '100%' }} />
              </div>
              <span className="authority-title !text-2xs opacity-30 w-16 text-right">AKTİF</span>
            </div>
            <div className="flex items-center gap-4">
              <div
                className={`w-2 h-2 rounded-full ${cozulmamisSayisi > 0 ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]' : 'bg-[var(--glass-border)]'}`}
              />
              <div className="flex-1 h-[2px] rounded-full bg-[var(--glass-border)] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ${cozulmamisSayisi > 0 ? 'bg-rose-500/60' : 'bg-[var(--glass-border)]'}`}
                  style={{
                    width:
                      cozulmamisSayisi > 0 && muezzinlerSayisi > 0
                        ? `${Math.min((cozulmamisSayisi / muezzinlerSayisi) * 100, 100)}%`
                        : '0%',
                  }}
                />
              </div>
              <span className="authority-title !text-2xs opacity-30 w-16 text-right">UYARI</span>
            </div>
            <div className="flex items-center gap-4">
              <div
                className={`w-2 h-2 rounded-full ${pendingIzinler > 0 ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]' : 'bg-[var(--glass-border)]'}`}
              />
              <div className="flex-1 h-[2px] rounded-full bg-[var(--glass-border)] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ${pendingIzinler > 0 ? 'bg-amber-500/60' : 'bg-[var(--glass-border)]'}`}
                  style={{
                    width:
                      pendingIzinler > 0 && muezzinlerSayisi > 0 ? `${Math.min((pendingIzinler / muezzinlerSayisi) * 100, 100)}%` : '0%',
                  }}
                />
              </div>
              <span className="authority-title !text-2xs opacity-30 w-16 text-right">BEKLEYEN</span>
            </div>
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-between gap-4 mt-6 pt-4 border-t border-[var(--glass-border)]">
          <p className="authority-title !text-2xs opacity-35 font-medium tracking-wide">Nöbet alabilir aktif müezzin kadrosu</p>
          <ChevronRight
            size={18}
            className="text-[var(--text-primary)]/25 group-hover:text-[var(--dynamic-aura,var(--aura-indigo))] transition-colors"
          />
        </div>
      </motion.div>

      {/* Side Stack */}
      <div className="col-span-1 md:col-span-1 lg:col-span-5 flex flex-col gap-8">
        {/* Uyarı Tile */}
        <motion.div
          whileHover={{ y: -4, scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          transition={HERO_SPRING}
          onClick={() => onOpenDrawer('alarmlar')}
          className={`flex-1 spatial-glass !rounded-card p-6 relative overflow-hidden flex flex-col justify-between transition-all duration-200 cursor-pointer min-h-[140px] shimmer-trigger ${cozulmamisSayisi > 0 ? 'spatial-glass-elevated border-rose-500/30 bg-rose-500/[0.04]' : 'hover:bg-[var(--text-primary)]/[0.02]'}`}
        >
          <div className="kinetic-sheen" />
          <div className="flex items-center justify-between relative z-10">
            <div
              className={`relative flex flex-col items-center justify-center gap-2.5 w-[60px] h-[60px] rounded-3xl transition-all duration-200 group z-10 ${cozulmamisSayisi > 0 ? 'bg-rose-500/20 text-rose-500 border border-rose-500/30' : 'bg-[var(--surface-low)] text-[var(--text-secondary)] border border-[var(--glass-border)]'}`}
            >
              <ShieldAlert size={20} strokeWidth={1.5} />
            </div>
            <div className="text-right">
              {statsLoading ? (
                <Skeleton className="w-10 h-9 ml-auto" />
              ) : (
                <div
                  className={`text-4xl font-light tracking-tighter leading-none ${cozulmamisSayisi > 0 ? 'text-rose-500' : 'text-[var(--text-primary)]'}`}
                >
                  {cozulmamisSayisi}
                </div>
              )}
              <span className="authority-title !text-2xs opacity-40 mt-2 font-medium tracking-wide">NÖBET UYARILARI</span>
            </div>
          </div>
          {cozulmamisSayisi > 0 && (
            <div className="mt-4 pt-4 border-t border-rose-500/10 relative z-10">
              {/* alarmlar[0].mesaj planServisi.ts/mazeretServisi.ts'in ürettiği serbest,
     dinamik Türkçe metin (kişi adı/haftaId içerebilir) — record.time
     (aşağıda) gibi toTurkishUpperCase ile büyütülüyor; CSS `uppercase`
     tarayıcı/motor davranışına bağımlı bir varsayımdı (bkz. kod denetimi,
     ConfirmModal.tsx ile AYNI standart). */}
              <p className="text-2xs font-bold text-rose-400 tracking-wide truncate">
                SON: {toTurkishUpperCase(sonAlarmMesaji || 'Tespit Edilemedi')}
              </p>
            </div>
          )}
        </motion.div>

        {/* Leave & Announcements Row */}
        <div className="flex flex-col sm:flex-row gap-4 sm:gap-8 flex-1">
          <motion.div
            whileHover={{ y: -4, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={HERO_SPRING}
            onClick={() => setActiveTab('ekip', 'mazeretler')}
            className="flex-1 spatial-glass !rounded-card p-6 relative overflow-hidden flex flex-col justify-between transition-all duration-200 cursor-pointer min-h-[140px] shimmer-trigger"
          >
            <div className="kinetic-sheen" />
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-500 border border-amber-500/20 shadow-elev2 flex items-center justify-center">
                <CalendarClock size={18} strokeWidth={1.5} />
              </div>
              <div className="text-right">
                {statsLoading ? (
                  <Skeleton className="w-8 h-8 ml-auto" />
                ) : (
                  <div className="text-3xl font-light text-[var(--text-primary)] tracking-tighter leading-none tabular-nums">
                    {pendingIzinler}
                  </div>
                )}
                <span className="authority-title !text-2xs opacity-40 mt-2 font-medium tracking-wide">BEKLEYEN İZİN</span>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-[var(--glass-border)]">
              <p className="authority-title !text-2xs opacity-40 font-medium tracking-wide">AKTİF TALEPLER</p>
            </div>
          </motion.div>

          <motion.div
            whileHover={{ y: -4, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={HERO_SPRING}
            onClick={() => setActiveTab('planlama')}
            className="flex-1 spatial-glass !rounded-card p-6 relative overflow-hidden flex flex-col justify-between transition-all duration-200 cursor-pointer min-h-[140px] shimmer-trigger"
          >
            <div className="kinetic-sheen" />
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-2xl bg-[var(--dynamic-aura,var(--aura-indigo))]/10 text-[var(--dynamic-aura,var(--aura-indigo))] border border-[var(--dynamic-aura,var(--aura-indigo))]/20 shadow-elev2 flex items-center justify-center">
                <ClipboardCheck size={18} strokeWidth={1.5} />
              </div>
              <div className="text-right">
                <div
                  className={`text-2xl font-light tracking-tight leading-none tabular-nums ${!planHazir ? 'text-rose-500' : bekleyenOnaySayisi > 0 ? 'text-amber-500' : 'text-[var(--text-primary)]'}`}
                >
                  {planStatusLabel}
                </div>
                <span className="authority-title !text-2xs opacity-40 mt-2 font-medium tracking-wide">HAFTALIK PLAN</span>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-[var(--glass-border)]">
              {/* tracking-wide kaldırıldı + leading-snug eklendi + "görev" kelimesi
      çıkarıldı — bu üç eşit-genişlikli kartta (BEKLEYEN İZİN / HAFTALIK
      PLAN / DUYURULAR) "0/0 görev onay bekliyor" dar genişlikte 3 satıra
      sarıp kartın alt kenarına sıkışıyordu (manuel görsel denetimde
      bulundu — leading-snug/tracking normalizasyonu TEK BAŞINA yeterli
      olmadı, hâlâ 3 satırdı). "Görev" kelimesi bağlamdan zaten belli
      (kart başlığı "HAFTALIK PLAN") — kaldırılması anlamı korurken
      metni 2 satıra indiriyor. */}
              <p className="text-xs font-bold text-[var(--dynamic-aura,var(--aura-indigo))]/60 uppercase leading-snug">
                {planHazir ? `${bekleyenOnaySayisi}/${haftalikGorevSayisi} onay bekliyor` : 'Planlama ekranına git'}
              </p>
            </div>
          </motion.div>

          <motion.div
            whileHover={{ y: -4, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={HERO_SPRING}
            onClick={() => onOpenDrawer('duyurular')}
            className="flex-1 spatial-glass !rounded-card p-6 relative overflow-hidden flex flex-col justify-between transition-all duration-200 cursor-pointer min-h-[140px] shimmer-trigger"
          >
            <div className="kinetic-sheen" />
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shadow-elev2 flex items-center justify-center">
                <Megaphone size={18} strokeWidth={1.5} />
              </div>
              <div className="text-right">
                <ChevronRight size={18} className="text-[var(--text-primary)]/25 ml-auto" />
                <span className="authority-title !text-2xs opacity-40 mt-2 font-medium tracking-wide">DUYURULAR</span>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-[var(--glass-border)]">
              <p className="text-xs font-bold text-emerald-500/60 uppercase leading-snug">Duyuru panelini yönet</p>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
