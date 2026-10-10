import { useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { format, parseISO, isSameDay } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Edit2, Bot } from 'lucide-react';
import { getTurkeyNow } from '../../../lib/dateUtils';
import { SPRING } from '../../../lib/motion';
import { Vakit, VakitAtama, HaftaPlan, Bildirim } from '../../../types';

const VAKITLER: Vakit[] = ['sabah', 'ogle', 'ikindi', 'aksam', 'yatsi'];

/**
 * Haftalık çizelgenin 7 gün × 5 vakit hücre ızgarası — tıklanınca düzenleme
 * modalini açan atama kartları; durum noktası renk/etiket kuralları dahil.
 *
 * FE-001 uzantısı: HaftalikCizelge.tsx'teki `renderedGrid` useMemo bloğundan
 * ve dosya-yerel getStatusColor/getStatusLabel yardımcılarından çıkarıldı;
 * JSX ve animasyon değerleri birebir korundu (görsel regresyon sıfır fark
 * hedefi). `openEdit` → `onEditCell` olarak prop'a çevrildi.
 */
export function HaftaIzgara({
  plan,
  haftaBildirimleri,
  shouldAnimate,
  getMuezzinName,
  onEditCell,
}: {
  plan: HaftaPlan;
  haftaBildirimleri: Bildirim[];
  shouldAnimate: boolean;
  getMuezzinName: (uid: string) => string;
  onEditCell: (tarih: string, gunAdi: string, vakit: Vakit, data: VakitAtama) => void;
}) {
  const getStatusColor = (durum: string | undefined) => {
    if (!durum) return 'bg-slate-400/40';
    if (durum === 'onaylandi') return 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]';
    if (durum === 'reddedildi') return 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.8)]';
    return 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.8)]'; // bekliyor
  };

  // Renk kodlu noktanın (bkz. getStatusColor) anlamını açıklayan native
  // tooltip metni — ExecutiveHeroScreen'deki "N/M onay bekliyor" sayacına
  // tıklayan bir admin bu ızgarada hangi hücrelerin bekliyor/onaylandı/
  // reddedildi olduğunu ayırt edemiyordu (yalnızca 1-1.5px'lik bir renk
  // noktası, açıklama yoktu — bkz. kod denetimi, kullanıcı bildirimi).
  const getStatusLabel = (durum: string | undefined) => {
    if (!durum) return 'Bildirim yok';
    if (durum === 'onaylandi') return 'Onaylandı';
    if (durum === 'reddedildi') return 'Reddedildi (mazeret/vekalet)';
    return 'Onay bekliyor';
  };

  return useMemo(() => {
    // `tarih_vakit_uid` → bildirim ön-hesabı: aşağıdaki 7×5 hücre ızgarası
    // her hücrede `haftaBildirimleri.find(...)` ile lineer arama yapıyordu
    // (bkz. kod denetimi, premium/kurumsal SaaS standardı analizi) — veri
    // boyutu küçük olduğundan kritik değildi, ama Map ile O(1)'e inmesi
    // bedava.
    // `.find()`'ın "ilk eşleşme kazanır" davranışını korumak için, anahtar
    // zaten varsa üzerine YAZMA (aksi halde son eşleşme kazanırdı).
    const bildirimHaritasi = new Map<string, Bildirim>();
    for (const b of haftaBildirimleri) {
      const anahtar = `${b.tarih}_${b.vakit}_${b.uid}`;
      if (!bildirimHaritasi.has(anahtar)) bildirimHaritasi.set(anahtar, b);
    }
    return (
      <div className="flex flex-col gap-3 lg:gap-4">
        <AnimatePresence mode="popLayout">
          {Object.keys(plan.gunler)
            .sort()
            .map((tarih, idx) => {
              const gunObj = plan.gunler[tarih];
              const isToday = isSameDay(parseISO(tarih), getTurkeyNow());
              const gunAdi = format(parseISO(tarih), 'EEEE', { locale: tr });
              const parsedDate = parseISO(tarih);

              return (
                <motion.div
                  key={tarih}
                  layout
                  initial={shouldAnimate ? { opacity: 0, y: 20 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={shouldAnimate ? { ...SPRING.snappy, delay: idx * 0.05 } : { duration: 0.2 }}
                  className={`flex flex-col lg:flex-row items-stretch lg:items-center p-3 sm:p-4 gap-4 sm:gap-6 rounded-card border transition-all duration-700 relative overflow-hidden ${
                    isToday
                      ? 'bg-[var(--dynamic-aura,var(--aura-indigo))]/5 border-[var(--dynamic-aura,var(--aura-indigo))]/20 shadow-[var(--spatial-shadow)]'
                      : 'spatial-glass border-[var(--text-primary)]/5 hover:bg-[var(--text-primary)]/[0.02]'
                  }`}
                >
                  {isToday && (
                    <div className="absolute top-0 left-0 bottom-0 w-1 bg-[var(--dynamic-aura,var(--aura-indigo))]/40 shadow-[0_0_20px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_50%,transparent)]" />
                  )}

                  {/* Date Identity */}
                  <div className="flex items-center gap-4 sm:gap-5 min-w-[150px] shrink-0 pl-1 sm:pl-2">
                    <div
                      className={`flex flex-col items-center justify-center w-14 h-14 rounded-avatar border ${
                        isToday
                          ? 'bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] border-[var(--dynamic-aura,var(--aura-indigo))] shadow-elev2'
                          : 'bg-[var(--text-primary)]/[0.03] text-[var(--dynamic-aura,var(--aura-indigo))]/60 border-[var(--text-primary)]/5'
                      }`}
                    >
                      <span className="text-2xl font-light tracking-tighter leading-none">{format(parsedDate, 'd')}</span>
                      <span className="text-2xs font-bold uppercase tracking-wide mt-1 opacity-60">{format(parsedDate, 'MMM')}</span>
                    </div>
                    <div>
                      <h4
                        className={`text-lg font-light tracking-tight ${isToday ? 'text-[var(--dynamic-aura,var(--aura-indigo))]' : 'text-[var(--text-primary)]'}`}
                      >
                        {gunAdi}
                      </h4>
                      <p className="authority-title !text-2xs opacity-20 uppercase tracking-wide mt-1">
                        {format(parsedDate, 'dd/MM/yyyy')}
                      </p>
                    </div>
                  </div>

                  {/* Vakit Slots Grid */}
                  <div className="flex-1 grid grid-cols-1 min-[370px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3 w-full">
                    {VAKITLER.map((vakit) => {
                      const atama = gunObj[vakit] || { asil: 'Sistem', yedek: 'Sistem' };
                      const asilBildirim = bildirimHaritasi.get(`${tarih}_${vakit}_${atama?.asil}`);
                      const yedekBildirim = bildirimHaritasi.get(`${tarih}_${vakit}_${atama?.yedek}`);
                      // "Sistem" (Dizge) bir gerçek kişi değil, henüz elle atama
                      // yapılmamış vakit için otomatik-atama yer tutucusudur — bir
                      // ismin yanında aynı nokta+düz metin kalıbıyla gösterilirse
                      // gerçek bir "Dizge" adlı kişiyle ayırt edilemez hale geliyordu
                      // (bkz. görsel tasarım denetimi). Bot ikonu + soluk/italik
                      // metinle görsel olarak ayrıştırılır.
                      const asilIsSistem = (atama?.asil || 'Sistem') === 'Sistem';
                      const yedekIsSistem = (atama?.yedek || 'Sistem') === 'Sistem';

                      return (
                        <motion.button
                          key={vakit}
                          whileHover={{ y: -5, backgroundColor: 'var(--surface-medium)', zIndex: 50 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => onEditCell(tarih, gunAdi, vakit, atama)}
                          className="spatial-glass-elevated p-3 sm:p-4 rounded-panel sm:rounded-3xl text-left border border-[var(--text-primary)]/5 transition-all duration-500 group relative min-h-[84px]"
                        >
                          <div className="flex justify-between items-center mb-3">
                            <span className="authority-title !text-2xs opacity-40 uppercase tracking-wide font-bold text-[var(--dynamic-aura,var(--aura-indigo))]">
                              {vakit}
                            </span>
                            <Edit2
                              size={12}
                              strokeWidth={1.5}
                              className="group-hover:opacity-100 opacity-0 transition-all text-[var(--text-secondary)]"
                            />
                          </div>

                          <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-3">
                              {asilIsSistem ? (
                                <Bot size={11} strokeWidth={1.7} className="text-muted shrink-0" />
                              ) : (
                                <div
                                  className={`w-1.5 h-1.5 rounded-full ${getStatusColor(asilBildirim?.durum)}`}
                                  title={getStatusLabel(asilBildirim?.durum)}
                                />
                              )}
                              <span
                                className={`text-xs tracking-tight truncate ${asilIsSistem ? 'font-normal italic text-[var(--text-secondary)]/45' : 'font-medium text-[var(--text-primary)]'}`}
                              >
                                {asilIsSistem
                                  ? 'Atanmadı'
                                  : getMuezzinName(atama?.asil || '')
                                      .split(' ')
                                      .slice(-1)[0] || '—'}
                              </span>
                            </div>

                            {atama?.yedek && (
                              <div className="flex items-center gap-3 opacity-60">
                                {yedekIsSistem ? (
                                  <Bot size={9} strokeWidth={1.7} className="text-[var(--text-secondary)] shrink-0" />
                                ) : (
                                  <div
                                    className={`w-1.5 h-1.5 rounded-full ${getStatusColor(yedekBildirim?.durum)}`}
                                    title={getStatusLabel(yedekBildirim?.durum)}
                                  />
                                )}
                                <span
                                  className={`text-2xs uppercase tracking-wide truncate ${yedekIsSistem ? 'italic font-normal' : 'font-bold'} text-[var(--text-secondary)]`}
                                >
                                  {yedekIsSistem
                                    ? 'Atanmadı'
                                    : getMuezzinName(atama?.yedek || '')
                                        .split(' ')
                                        .slice(-1)[0]}
                                </span>
                              </div>
                            )}
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                </motion.div>
              );
            })}
        </AnimatePresence>
      </div>
    );
  }, [plan, haftaBildirimleri, onEditCell, getMuezzinName, shouldAnimate]);
}
