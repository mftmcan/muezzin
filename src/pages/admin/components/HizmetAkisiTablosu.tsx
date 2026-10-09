import { motion, AnimatePresence } from 'motion/react';
import { Check, X, ChevronRight, ServerCrash, Activity } from 'lucide-react';
import { EmptyState } from '../../../components/ui/EmptyState';
import { useNotificationStore } from '../../../store/useNotificationStore';
import { izinOnayCumaEngelMesaji, toTurkishUpperCase } from '../../../lib/dateUtils';

export interface HizmetAkisiKaydi {
  id: string;
  title: string;
  status: string;
  time: string;
  type: 'alarm' | 'izin';
  /** Cuma-kapsayan yıllık/haftalık izin onayını engelleyebilmek için
   * yalnızca 'izin' tipindeki kayıtlarda dolu (bkz. onay düğmesi onClick'i). */
  tip?: string;
  baslangic?: string;
  bitis?: string;
}

interface HizmetAkisiTablosuProps {
  kayitlar: HizmetAkisiKaydi[];
  alarmlarHatasi: string | null;
  izinlerHatasi: string | null;
  /** İzin onay/red kararı — onay düğmesi ConfirmModal'ı açar, ebeveynde kararVer. */
  onIzinKararIstegi: (id: string, durum: 'onaylandi' | 'reddedildi', title: string) => void;
  onOpenDrawer: (content: 'alarmlar' | 'duyurular' | null) => void;
  setActiveTab: (tab: 'ekip' | 'planlama', subtab?: string) => void;
  /** İşlem kilitli olan kayıt id'i (aktif izin kararı yazımı). */
  processingId: string | null;
  /** Genişletilmiş satır id'i — ebeveynde tutulur (resetlenme senaryoları için). */
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
}

/**
 * ExecutiveHeroScreen'in "HİZMET AKIŞI" canlı tablosu — alarm/izin kayıtlarının
 * genişleyen satırları, hızlı onay/red aksiyonları ve hata/boş durumları.
 *
 * FE-001 uzantısı: ExecutiveHeroScreen.tsx'ten çıkarıldı; JSX ve animasyon
 * değerleri birebir korundu (görsel regresyon sıfır fark hedefi). `expandedId`
 * bilinçli olarak ebeveynde kalır: kayıt listesi değiştiğinde açılan satırın
 * sıfırlanması kararını da ebevyn yönetir.
 */
export function HizmetAkisiTablosu({
  kayitlar,
  alarmlarHatasi,
  izinlerHatasi,
  onIzinKararIstegi,
  onOpenDrawer,
  setActiveTab,
  processingId,
  expandedId,
  setExpandedId,
}: HizmetAkisiTablosuProps) {
  const showNotification = useNotificationStore((s) => s.showNotification);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.5, duration: 1 }}
      className="mt-6 flex flex-col gap-6"
    >
      <div className="flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <div className="w-1 h-3 bg-[var(--dynamic-aura,var(--aura-indigo))] rounded-full shadow-[0_0_10px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_80%,transparent)]" />
          <h2 className="text-xl font-light tracking-tight text-[var(--text-primary)] uppercase tracking-wide">Hizmet Akışı</h2>
        </div>
        <button
          // Liste (kayitlar) alarm+izin karışımı — koşulsuz olarak her zaman
          // 'ekip'e gitmek, listenin altındaki satır-bazlı "DETAYLARI
          // İNCELE" yönlendirmesiyle (alarmlar için onOpenDrawer('alarmlar'),
          // aşağıda) çelişiyordu: alarm ağırlıklı bir listede admin'i beklemediği
          // bir sekmeye götürüyordu (bkz. kod denetimi bulgusu). Aynı dallanma
          // üst düğmeye de uygulanıyor.
          onClick={() => (kayitlar.some((r) => r.type === 'alarm') ? onOpenDrawer('alarmlar') : setActiveTab('ekip', 'mazeretler'))}
          className="authority-title !text-2xs !text-[var(--dynamic-aura,var(--aura-indigo))] cursor-pointer hover:text-[var(--text-primary)] transition-all flex items-center gap-2 group tracking-wide font-medium"
        >
          TÜMÜNÜ GÖR <ChevronRight size={12} className="group-hover:translate-x-1 transition-transform" />
        </button>
      </div>

      <div className="flex flex-col gap-4">
        <AnimatePresence>
          {kayitlar.length > 0 ? (
            <>
              {/* Alarm/izin dinleyicilerinden biri hata verse bile (bkz. kod
     denetimi) diğer kaynaktan gelen geçerli veri artık tüm listeyi
     silip atan bir EmptyState'in altında GİZLENMİYOR — yalnızca hangi
     kaynağın etkilendiğini bildiren küçük bir şerit, mevcut kayıtların
     üstünde gösterilir. */}
              {(alarmlarHatasi || izinlerHatasi) && (
                <div className="spatial-glass !rounded-card p-4 flex items-center gap-3 border border-rose-500/20 bg-rose-500/[0.04]">
                  <ServerCrash size={16} className="text-rose-500 shrink-0" strokeWidth={1.5} />
                  <p className="text-2xs font-medium text-rose-400 tracking-wide">
                    {[alarmlarHatasi, izinlerHatasi].filter(Boolean).join(' ')}
                  </p>
                </div>
              )}
              {kayitlar.map((record, idx) => {
                const isExpanded = expandedId === record.id;

                return (
                  <motion.div
                    layout
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 200, delay: idx * 0.05 }}
                    key={record.id}
                    onClick={() => setExpandedId(isExpanded ? null : record.id)}
                    className={`spatial-glass !rounded-card p-5 cursor-pointer group transition-all duration-500 relative overflow-hidden ${isExpanded ? 'spatial-glass-elevated border-[var(--dynamic-aura,var(--aura-indigo))]/30' : 'hover:bg-[var(--text-primary)]/[0.02]'}`}
                  >
                    {/* Item Sheen */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[var(--specular-glow)] to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />

                    <motion.div layout className="flex items-center justify-between relative z-10">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-8 flex-1 min-w-0">
                        {/* record.time date-fns'in tr locale'iyle üretilen serbest metin ("3
     dakika önce" gibi) — toTurkishUpperCase (bkz. src/lib/dateUtils.ts)
     kullanılır. record.id.substring(...).toUpperCase() (aşağıda) BİLEREK
     dokunulmadı — o rastgele/opak bir Firestore ID'si, doğal dil değil.
     Sabit w-20 (80px) genişlik + satır sarma koruması yoktu — "yaklaşık
     2 ay önce" gibi daha uzun aralıklar üreten kayıtlarda metin 2 satıra
     sarıp satırı "1 GÜN ÖNCE" gibi kısa etiketlerle aynı hizada
     durdurmuyordu (manuel görsel denetimde bulundu). Sabit genişlik
     kaldırıldı, whitespace-nowrap ile her zaman tek satır garanti edilir
     — sütun artık içeriğine göre doğal genişlik alır. */}
                        <div className="authority-title !text-2xs opacity-30 tracking-wide shrink-0 whitespace-nowrap">
                          {toTurkishUpperCase(record.time)}
                        </div>
                        <div
                          className={`text-sm tracking-tight transition-colors duration-500 ${isExpanded ? 'font-medium text-[var(--text-primary)]' : 'font-light text-[var(--text-primary)]/60'}`}
                        >
                          {record.title}
                        </div>
                      </div>

                      <div className="flex items-center gap-6">
                        <div
                          className={`flex items-center gap-3 px-4 py-1.5 rounded-full border shadow-elev1 transition-all duration-500 ${
                            record.status === 'active'
                              ? 'bg-rose-500/10 border-rose-500/20'
                              : record.status === 'pending'
                                ? 'bg-amber-500/10 border-amber-500/20'
                                : 'bg-emerald-500/10 border-emerald-500/20'
                          }`}
                        >
                          <motion.div
                            animate={record.status === 'active' ? { scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] } : {}}
                            transition={{ repeat: Infinity, duration: 2 }}
                            className={`w-1.5 h-1.5 rounded-full ${
                              record.status === 'active'
                                ? 'bg-rose-500 shadow-[0_0_8px_rgb(244,63,94)]'
                                : record.status === 'pending'
                                  ? 'bg-amber-500 shadow-[0_0_8px_rgb(245,158,11)]'
                                  : 'bg-emerald-500 shadow-[0_0_8px_rgb(16,185,129)]'
                            }`}
                          />
                          <span
                            className={`authority-title !text-2xs relative z-10 transition-all duration-200 font-bold tracking-wide ${isExpanded ? 'opacity-100 font-black' : 'opacity-30 font-medium group-hover:font-bold'} ${
                              record.status === 'active'
                                ? 'text-rose-500'
                                : record.status === 'pending'
                                  ? 'text-amber-500'
                                  : 'text-emerald-500'
                            }`}
                          >
                            {record.status === 'active' ? 'UYARI' : record.status === 'pending' ? 'BEKLEYEN' : 'ÇÖZÜLDÜ'}
                          </span>
                        </div>

                        <motion.div
                          animate={{ rotate: isExpanded ? 90 : 0 }}
                          className="text-subtle group-hover:text-faint transition-colors"
                        >
                          <ChevronRight size={18} />
                        </motion.div>
                      </div>
                    </motion.div>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="pt-10 pb-4 grid grid-cols-2 lg:grid-cols-4 gap-10">
                            <div className="flex flex-col gap-3">
                              <span className="authority-title !text-2xs opacity-30 tracking-wide">KAYIT KİMLİĞİ</span>
                              <span className="text-[var(--text-primary)] font-mono text-xs tracking-wide opacity-80">
                                #{record.id.substring(0, 10).toUpperCase()}
                              </span>
                            </div>
                            <div className="flex flex-col gap-3">
                              <span className="authority-title !text-2xs opacity-30 tracking-wide">KATEGORİZASYON</span>
                              <span
                                className={`text-xs font-medium uppercase tracking-wide ${record.type === 'alarm' ? 'text-rose-500' : 'text-[var(--dynamic-aura,var(--aura-indigo))]'}`}
                              >
                                {record.type === 'alarm' ? 'Nöbet Uyarısı' : 'İzin Talebi'}
                              </span>
                            </div>
                            <div className="flex flex-col gap-3 col-span-2">
                              <span className="authority-title !text-2xs opacity-30 tracking-wide">HIZLI İŞLEMLER</span>
                              <div className="flex flex-wrap gap-3">
                                {record.type === 'izin' && record.status === 'pending' ? (
                                  <>
                                    <motion.button
                                      whileHover={{ y: -2, backgroundColor: 'rgba(16,185,129,0.15)' }}
                                      whileTap={{ scale: 0.98 }}
                                      disabled={processingId === record.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (record.baslangic && record.bitis) {
                                          const engelMesaji = izinOnayCumaEngelMesaji({
                                            baslangic: record.baslangic,
                                            bitis: record.bitis,
                                          });
                                          if (engelMesaji) {
                                            showNotification('Onaylanamaz', engelMesaji, 'warning');
                                            return;
                                          }
                                        }
                                        onIzinKararIstegi(record.id, 'onaylandi', record.title);
                                      }}
                                      className="px-6 py-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 text-2xs uppercase tracking-wide font-bold flex items-center gap-3 shadow-elev2 disabled:opacity-40 disabled:cursor-wait"
                                    >
                                      <Check size={14} strokeWidth={3} /> ONAYLA
                                    </motion.button>
                                    <motion.button
                                      whileHover={{ y: -2, backgroundColor: 'rgba(244,63,94,0.15)' }}
                                      whileTap={{ scale: 0.98 }}
                                      disabled={processingId === record.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onIzinKararIstegi(record.id, 'reddedildi', record.title);
                                      }}
                                      className="px-6 py-2.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-2xs uppercase tracking-wide font-bold flex items-center gap-3 shadow-elev2 disabled:opacity-40 disabled:cursor-wait"
                                    >
                                      <X size={14} strokeWidth={3} /> REDDET
                                    </motion.button>
                                  </>
                                ) : (
                                  <motion.button
                                    whileHover={{ y: -2, backgroundColor: 'var(--surface-medium)' }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (record.type === 'alarm') {
                                        onOpenDrawer('alarmlar');
                                      } else {
                                        setActiveTab('ekip', 'mazeretler');
                                      }
                                    }}
                                    className="px-6 py-2.5 rounded-2xl bg-[var(--text-primary)]/5 border border-[var(--text-primary)]/10 text-[var(--text-primary)] text-2xs uppercase tracking-wide font-bold shadow-elev2"
                                  >
                                    DETAYLARI İNCELE
                                  </motion.button>
                                )}
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </>
          ) : alarmlarHatasi || izinlerHatasi ? (
            // İkisi de (ya da gösterilecek veri kalmayacak şekilde tek çalışan
            // kaynak da) hata verdiğinde liste sessizce boş görünmesin — bağlantı
            // sorununu açıkça göster, "aktif kayıt yok" ile karıştırılmasın.
            <EmptyState
              icon={<ServerCrash size={36} strokeWidth={1.2} />}
              title="Hizmet Akışı Yüklenemedi"
              description={[alarmlarHatasi, izinlerHatasi].filter(Boolean).join(' ')}
              tone="rose"
              size="md"
            />
          ) : (
            <EmptyState
              icon={<Activity size={36} strokeWidth={1.2} />}
              title="Aktif Kayıt Yok"
              description="ŞU AN AKTİF BİR HİZMET KAYDI (UYARI/İZİN) BULUNMUYOR."
              tone="neutral"
              size="md"
            />
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
