import React, { useState, useMemo, useCallback } from 'react';
import { format, startOfWeek, subWeeks, addWeeks, isSameDay, addDays } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useHaftaPlan } from '../hooks/useHaftaPlan';
import { useMuezzinStore } from '../store/useMuezzinStore';
import { auth } from '../lib/firebase';
import { ChevronLeft, ChevronRight, Info, Bot } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Vakit } from '../types';
import { IslamicGeometricBg } from '../components/ui/IslamicGeometricBg';
import { useHaftaBildirimleri } from '../hooks/useHaftaBildirimleri';
import { getHaftaIdFromDate, getTurkeyNow, toTurkishUpperCase } from '../lib/dateUtils';
import { EmptyState } from '../components/ui/EmptyState';

const VAKIT_LISTESI: Vakit[] = ['sabah', 'ogle', 'ikindi', 'aksam', 'yatsi'];

export default function HaftalikTakvim() {
  // new Date() cihazın kendi saat dilimini kullanır — Türkiye dışı bir saat
  // diliminde açıldığında başlangıç haftası (ve "bugün" vurgusu) yanlış güne
  // kayabiliyordu (bkz. mantık denetimi, dateUtils.ts getTurkeyNow).
  const [currentDate, setCurrentDate] = useState(getTurkeyNow());
  const haftaId = getHaftaIdFromDate(format(currentDate, 'yyyy-MM-dd'));
  const { plan, loading: planLoading } = useHaftaPlan(haftaId);
  const { bildirimler: haftaBildirimleri, loading: bildirimLoading } = useHaftaBildirimleri(haftaId);
  const muezzinMap = useMuezzinStore((s) => s.muezzinMap);
  const usersLoading = useMuezzinStore((s) => s.loading);
  const currentUser = auth.currentUser;

  const loading = planLoading || usersLoading || bildirimLoading;

  const currentWeekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekLabel = `${format(currentWeekStart, 'd MMMM', { locale: tr })}`;

  const getMuezzinName = (uid: string) => {
    if (!uid) return 'Atanmamış';
    if (uid === 'SISTEM' || uid === 'Sistem') return 'Dizge';
    return muezzinMap[uid]?.displayName || 'Bilinmiyor';
  };

  const isAssignableUid = useCallback(
    (uid: string | undefined) => {
      if (!uid || uid === 'Sistem' || uid === 'SISTEM') return true;
      const person = muezzinMap[uid];
      return !!person && person.aktif === true && person.role === 'muezzin';
    },
    [muezzinMap]
  );

  const gunlukVeriler = useMemo(() => {
    if (!plan) return [];

    return Array.from({ length: 7 }).map((_, idx) => {
      const parsedDate = addDays(currentWeekStart, idx);
      const tarih = format(parsedDate, 'yyyy-MM-dd');
      const gunObj = plan.gunler[tarih] || {};
      // new Date() cihazın kendi saat dilimini kullanır — uygulama Türkiye'ye
      // özel bir hizmet olduğundan (bkz. dateUtils.ts getTurkeyNow), "bugün"
      // vurgusu cihaz Türkiye dışı bir saat diliminde olduğunda yanlış güne
      // düşebiliyordu (bkz. mantık denetimi).
      const isToday = isSameDay(parsedDate, getTurkeyNow());
      const gunAdi = format(parsedDate, 'EEEE', { locale: tr });
      const gunAyi = format(parsedDate, 'MMMM', { locale: tr });

      const getLiveUid = (vakit: Vakit, tip: 'asil' | 'yedek', fallbackUid: string | undefined) => {
        return (
          haftaBildirimleri.find((b) => b.tarih === tarih && b.vakit === vakit && b.tip === tip && b.durum !== 'reddedildi')?.uid ||
          fallbackUid
        );
      };

      // NOT (mimari denetim — bütünsel hata analizi): planlamaCekirdegi.ts'in
      // kendi yorumu, normal üretimde bir günün 5 vaktinin AYNI ekibi
      // paylaştığını ama `korunmusAtama`'nın (self-healing/vekalet devri/
      // mazeret reddi) bir günün vakitlerini birbirinden FARKLI kişilere
      // atayabileceğini — bunun kasıtlı, beklenen bir kenar durum olduğunu
      // belgeliyor. Önceden burada `pickCanonicalUid` bu 5 vakitlik listeyi
      // ÇOĞUNLUK OYUNA indirgeyip günde tek bir asil/yedek gösteriyordu —
      // azınlıkta kalan kişi (ör. yalnızca sabah vaktini vekaletle devralan
      // biri) haftalık görünümden VE kendi "GÖREVİNİZ VAR" rozetinden
      // tamamen düşüyordu. Artık gün için o vakitlerde görev alan TÜM
      // farklı kişiler (tekilleştirilmiş, ilk-görülen sırayla) gösteriliyor
      // — JSX zaten çoklu asil/yedek render etmek üzere tasarlanmıştı.
      const asilGunlukListe = VAKIT_LISTESI.map((v) => getLiveUid(v, 'asil', gunObj[v]?.asil)).filter(
        (uid): uid is string => !!uid && isAssignableUid(uid)
      );
      const yedekGunlukListe = VAKIT_LISTESI.map((v) => getLiveUid(v, 'yedek', gunObj[v]?.yedek)).filter(
        (uid): uid is string => !!uid && isAssignableUid(uid)
      );
      const asiller = Array.from(new Set(asilGunlukListe));
      const yedekler = Array.from(new Set(yedekGunlukListe));
      const isPersonalDuty = !!(currentUser && (asiller.includes(currentUser.uid) || yedekler.includes(currentUser.uid)));

      return {
        tarih,
        parsedDate,
        isToday,
        gunAdi,
        gunAyi,
        asiller,
        yedekler,
        isPersonalDuty,
      };
    });
  }, [plan, currentWeekStart, currentUser, haftaBildirimleri, isAssignableUid]);

  return (
    <div className="w-full min-h-screen bg-[var(--app-bg)] relative overflow-hidden transition-colors duration-[3000ms]">
      {/* Sayfaya özgü ikinci bir aura blob katmanı önceden burada AYRICA render
     ediliyordu — Layout.tsx zaten global bir 2-blob sirkadiyen katman
     sağlıyor (aynı --dynamic-aura'yı okuyarak); üst üste 4 blur katmanı
     doygunluğun katlanmasına yol açıyordu (bkz. premium denetim B34, O8). */}
      <IslamicGeometricBg />

      {/* pb-8: Layout.tsx'teki <main> zaten dock temizliği için pb ayırıyor (bkz.
     MuezzinAnaEkran.tsx yorumu, mobil yerleşim denetimi) — eskiden buradaki
     pb-32 bununla üst üste binip sayfa sonunda gereksiz ~220px boşluk
     bırakıyordu. */}
      <div className="w-full max-w-7xl mx-auto px-0 md:px-8 pb-8 min-h-screen relative z-10">
        <header className="relative z-10 mb-10 pt-10 md:pt-16 px-6 md:px-0">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
            <div className="flex-1">
              <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-2 mb-3">
                <div className="w-1 h-1 rounded-full bg-[var(--aura-indigo)] animate-pulse" />
                <span className="premium-label !text-2xs !opacity-40 uppercase tracking-wide">GÖREV TAKVİMİ</span>
              </motion.div>
              <motion.h1
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                className="text-3xl md:text-4xl font-light text-[var(--text-primary)] tracking-tight leading-none apple-thin"
              >
                Haftalık Görev Akışı
              </motion.h1>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="flex items-center bg-[var(--text-primary)]/[0.03] p-1.5 rounded-[20px] border border-[var(--glass-border)] backdrop-blur-3xl shadow-[0_10px_30px_-10px_rgba(0,0,0,0.1)] self-start"
            >
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => setCurrentDate(subWeeks(currentDate, 1))}
                aria-label="Önceki hafta"
                className="w-11 h-11 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--text-primary)]/[0.05] rounded-2xl transition-all"
              >
                <ChevronLeft size={18} />
              </motion.button>
              <div className="px-6 py-2 text-2xs font-bold tracking-wide text-[var(--text-secondary)] uppercase min-w-[180px] text-center">
                {/* gunlukVeriler Pazartesi (+0) - Pazar (+6) aralığını render ediyor;
 önceden burada addWeeks(currentWeekStart, 1) (+7, bir sonraki Pazartesi)
 kullanılıyordu — başlık her zaman aşağıdaki tablonun son gününden bir
 gün ileriyi gösteriyordu (bkz. code-review, dördüncü denetim turu). */}
                {weekLabel} – {format(addDays(currentWeekStart, 6), 'd MMMM', { locale: tr })}
              </div>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => setCurrentDate(addWeeks(currentDate, 1))}
                aria-label="Sonraki hafta"
                className="w-11 h-11 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--text-primary)]/[0.05] rounded-2xl transition-all"
              >
                <ChevronRight size={18} />
              </motion.button>
            </motion.div>
          </div>
        </header>

        <AnimatePresence mode="wait">
          {loading && !plan ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="relative z-10 flex flex-col gap-4 px-4 md:px-0"
            >
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="spatial-glass p-6 md:p-8 rounded-card border-[var(--glass-border)] flex flex-col md:flex-row gap-8 opacity-50"
                >
                  <div className="flex gap-6 items-center">
                    <div className="w-16 h-16 rounded-2xl skeleton-shimmer" />
                    <div className="flex flex-col gap-2">
                      <div className="w-32 h-6 rounded-full skeleton-shimmer" />
                      <div className="w-20 h-3 rounded-full skeleton-shimmer" />
                    </div>
                  </div>
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <div className="w-24 h-2 rounded-full skeleton-shimmer" />
                      <div className="w-full h-10 rounded-xl skeleton-shimmer" />
                    </div>
                    <div className="space-y-4">
                      <div className="w-24 h-2 rounded-full skeleton-shimmer" />
                      <div className="w-full h-10 rounded-xl skeleton-shimmer" />
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>
          ) : !plan ? (
            <motion.div
              key="no-plan"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="relative z-10 max-w-4xl mx-auto"
            >
              {/* Elle kopyalanmış boş-durum kartı `EmptyState`'ten (admin tarafında 8
     tüketicisi vardı, müezzin tarafında hiç) görsel olarak sapıyordu —
     farklı dolgu/ikon boyutu/başlık ölçeği/açıklama tipografisi (bkz.
     premium denetim, bölüm 4). */}
              <EmptyState
                icon={<Info size={36} strokeWidth={1.2} />}
                title="Plan Henüz Hazır Değil"
                description="Seçilen haftaya ait görev dağılımı henüz onaylanmamış veya dizgeye girilmemiş olabilir."
                tone="indigo"
                size="lg"
                action={{ label: 'GÜNCEL HAFTAYA DÖN', onClick: () => setCurrentDate(new Date()) }}
              />
            </motion.div>
          ) : (
            <motion.div
              key="plan"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="relative z-10 flex flex-col gap-4 px-4 md:px-0"
            >
              {gunlukVeriler.map((dayData, idx) => {
                const { tarih, parsedDate, isToday, gunAdi, gunAyi, asiller, yedekler, isPersonalDuty } = dayData;

                return (
                  <motion.div
                    key={tarih}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className={`group relative p-6 md:p-8 rounded-card transition-all duration-700 overflow-hidden ${
                      isToday
                        ? 'spatial-glass border-[var(--status-info)]/30 spatial-glow-primary bg-[var(--status-info)]/[0.03]'
                        : isPersonalDuty
                          ? 'spatial-glass border-[var(--status-warning)]/30 spatial-glow-amber bg-[var(--status-warning)]/[0.02]'
                          : 'spatial-glass hover:bg-[var(--text-primary)]/[0.02] border-[var(--glass-border)]'
                    }`}
                  >
                    {/* Left status pillar for today */}
                    {isToday && (
                      <div className="absolute left-0 top-6 bottom-6 w-[3px] rounded-r-full bg-[var(--status-info)] shadow-[0_0_12px_var(--status-info)]" />
                    )}
                    {isPersonalDuty && !isToday && (
                      <div className="absolute left-0 top-6 bottom-6 w-[3px] rounded-r-full bg-[var(--status-warning)] shadow-[0_0_12px_var(--status-warning)]" />
                    )}
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8 relative z-10">
                      {/* Tarih Bloğu */}
                      <div className="flex items-center gap-6 min-w-[180px]">
                        <div
                          className={`w-16 h-16 rounded-2xl flex flex-col items-center justify-center border shadow-inner transition-all duration-700 ${
                            isToday
                              ? 'bg-[var(--status-info)]/20 border-[var(--status-info)]/30 text-[var(--status-info)]'
                              : isPersonalDuty
                                ? 'bg-[var(--status-warning)]/20 border-[var(--status-warning)]/30 text-[var(--status-warning)]'
                                : 'bg-[var(--text-primary)]/[0.03] border-[var(--glass-border)] text-[var(--text-secondary)]'
                          }`}
                        >
                          <span className="text-2xl font-sans font-light leading-none">{format(parsedDate, 'd')}</span>
                          {/* toTurkishUpperCase — gunAyi Türkçe ay adı ("Nisan"/"Ekim" gibi "i"
     içerenler), locale'siz .toUpperCase() "İ" yerine "I" üretirdi. */}
                          <span className="text-2xs font-bold uppercase tracking-wider mt-1">
                            {gunAyi ? toTurkishUpperCase(gunAyi.substring(0, 3)) : ''}
                          </span>
                        </div>
                        <div>
                          <h4
                            className={`text-xl font-light tracking-tight apple-thin ${isToday ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}
                          >
                            {gunAdi}
                          </h4>
                          {isToday && (
                            <div className="flex items-center gap-2 mt-1">
                              <div className="w-1 h-1 rounded-full bg-[var(--status-info)] shadow-[0_0_8px_var(--status-info)]" />
                              <span className="text-2xs font-bold uppercase tracking-wide text-[var(--status-info)]">BUGÜN</span>
                            </div>
                          )}
                          {isPersonalDuty && !isToday && (
                            <div className="flex items-center gap-2 mt-1">
                              <div className="w-1 h-1 rounded-full bg-[var(--status-warning)] shadow-[0_0_8px_var(--status-warning)]" />
                              <span className="text-2xs font-bold uppercase tracking-wide text-[var(--status-warning)]">GÖREVİNİZ VAR</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Görevli Listesi */}
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-8 w-full md:pl-10 border-[var(--glass-border)] md:border-l">
                        {/* Asil Görevliler */}
                        <div className="space-y-4">
                          <span className="premium-label !text-2xs !opacity-20">ASİL GÖREVLİLER</span>
                          <div className="flex flex-wrap gap-2">
                            {asiller.length > 0 ? (
                              (asiller as string[]).map((uid) => {
                                // "Sistem" (Dizge) henüz elle atanmamış bir vakit için otomatik-atama
                                // yer tutucusudur, gerçek bir kişi değil — aynı dolu pill görünümüyle
                                // gösterilirse gerçek bir isimle ayırt edilemiyordu (bkz. görsel
                                // tasarım denetimi).
                                const isSistem = uid === 'Sistem' || uid === 'SISTEM';
                                return (
                                  <div
                                    key={uid}
                                    className={`px-4 py-2 rounded-xl text-sm border transition-all duration-500 flex items-center gap-2 ${
                                      isSistem
                                        ? 'border-dashed border-[var(--text-secondary)]/20 text-[var(--text-secondary)]/45 italic font-normal'
                                        : uid === currentUser?.uid
                                          ? 'font-medium bg-[var(--status-warning)]/20 border-[var(--status-warning)]/30 text-[var(--status-warning)] shadow-lg shadow-[var(--status-warning)]/10 ring-1 ring-[var(--status-warning)]/50'
                                          : 'font-medium bg-[var(--text-primary)]/[0.03] border-[var(--glass-border)] text-[var(--text-secondary)]'
                                    }`}
                                  >
                                    {isSistem && <Bot size={13} strokeWidth={1.7} />}
                                    {isSistem ? 'Atanmadı' : getMuezzinName(uid)}
                                  </div>
                                );
                              })
                            ) : (
                              <span className="text-xs text-muted font-light italic">Atanmamış</span>
                            )}
                          </div>
                        </div>

                        {/* Yedek Görevliler */}
                        <div className="space-y-4">
                          <span className="premium-label !text-2xs !opacity-20">YEDEK GÖREVLİLER</span>
                          <div className="flex flex-wrap gap-2">
                            {yedekler.length > 0 ? (
                              (yedekler as string[]).map((uid) => {
                                const isSistem = uid === 'Sistem' || uid === 'SISTEM';
                                return (
                                  <div
                                    key={uid}
                                    className={`px-4 py-2 rounded-xl text-sm border transition-all duration-500 flex items-center gap-2 ${
                                      isSistem
                                        ? 'border-dashed border-[var(--text-secondary)]/20 text-[var(--text-secondary)]/45 italic font-normal'
                                        : uid === currentUser?.uid
                                          ? 'font-medium bg-[var(--status-warning)]/20 border-[var(--status-warning)]/30 text-[var(--status-warning)] shadow-lg shadow-[var(--status-warning)]/10 ring-1 ring-[var(--status-warning)]/50'
                                          : 'font-medium bg-[var(--text-primary)]/[0.03] border-[var(--glass-border)] text-[var(--text-secondary)]'
                                    }`}
                                  >
                                    {isSistem && <Bot size={13} strokeWidth={1.7} />}
                                    {isSistem ? 'Atanmadı' : getMuezzinName(uid)}
                                  </div>
                                );
                              })
                            ) : (
                              <span className="text-xs text-muted font-light italic">Atanmamış</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="absolute inset-0 bg-gradient-to-br from-[var(--specular-glow)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-1000 pointer-events-none" />
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
