import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useHaftaPlan } from '../../../hooks/useHaftaPlan';
import { useMuezzinStore } from '../../../store/useMuezzinStore';
import { useAdminIzinlerStore } from '../../../store/useAdminIzinlerStore';
import { useHaftaBildirimleri } from '../../../hooks/useHaftaBildirimleri';
import { useNotificationStore } from '../../../store/useNotificationStore';
import { useAuthStore } from '../../../store/useAuthStore';
import { haftalikPlanOlustur, vakitAtamasiniGuncelle } from '../../../services/planServisi';
import { format, addWeeks, subWeeks, startOfWeek, parseISO, isSameDay } from 'date-fns';
import { tr } from 'date-fns/locale';
import { motion, AnimatePresence } from 'motion/react';
import { Modal } from '../../../components/ui/Modal';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Muezzin, Vakit, VakitAtama } from '../../../types';
import { AlertCircle, Bot, Edit2, ChevronLeft, ChevronRight, RotateCcw, Zap } from 'lucide-react';
import { telemetryService } from '../../../services/telemetryService';
import { getHaftaIdFromDate, getTurkeyNow, kisiGunIcinMusaitMi, toTurkishUpperCase } from '../../../lib/dateUtils';
import { exportCsv } from '../../../lib/csvExport';
import { selfHealingTetiklenmeliMi } from '../../../lib/planSelfHealing';
import { useOneShotAnimation } from '../../../hooks/useOneShotAnimation';

const VAKITLER: Vakit[] = ['sabah', 'ogle', 'ikindi', 'aksam', 'yatsi'];

interface PersonelSeciciProps {
  label: string;
  systemSubLabel: string;
  roleSubLabel: string;
  value: string;
  onSelect: (uid: string) => void;
  muezzinler: (Muezzin & { id: string })[];
  /** O gün izinli/sabit izin gününde olduğu için atanamaz olan kişilerin uid'leri — bu kişiler seçilebilir ama görsel olarak işaretlenir ve devre dışı bırakılır. */
  unavailableUids: Set<string>;
}

function PersonelSecici({ label, systemSubLabel, roleSubLabel, value, onSelect, muezzinler, unavailableUids }: PersonelSeciciProps) {
  return (
    <div className="space-y-4 mt-2 first:mt-0">
      <label className="authority-title !text-2xs opacity-40 ml-1 tracking-wide">{label}</label>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => onSelect('Sistem')}
          className={`p-4 rounded-2xl flex items-center gap-3 transition-all border outline-none ${
            value === 'Sistem'
              ? 'bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] border-[var(--dynamic-aura,var(--aura-indigo))]/60 shadow-[0_10px_20px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_25%,transparent)]'
              : 'bg-[var(--text-primary)]/[0.02] text-[var(--text-secondary)] border-[var(--text-primary)]/5 hover:border-[var(--text-primary)]/10'
          }`}
        >
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-2xs ${
              value === 'Sistem' ? 'bg-[var(--text-primary)]/20' : 'bg-[var(--text-primary)]/5 text-[var(--text-secondary)]'
            }`}
          >
            <Bot size={16} strokeWidth={1.7} />
          </div>
          <div className="text-left">
            <span className="text-2xs font-black uppercase tracking-wider block">Dizge Otomatik</span>
            <span className="text-2xs opacity-60 block leading-tight">{systemSubLabel}</span>
          </div>
        </button>
        {muezzinler
          .filter((m) => m.aktif && m.role === 'muezzin' && m.onayBekliyor !== true)
          .map((m) => {
            const isSelected = value === m.id;
            const isUnavailable = unavailableUids.has(m.id);
            return (
              <button
                key={m.id}
                type="button"
                disabled={isUnavailable}
                title={isUnavailable ? 'Bu tarihte onaylı izinli veya sabit izin gününde — atanamaz.' : undefined}
                onClick={() => onSelect(m.id)}
                className={`p-4 rounded-2xl flex items-center gap-3 transition-all border outline-none ${
                  isUnavailable
                    ? 'bg-[var(--text-primary)]/[0.01] text-muted border-[var(--text-primary)]/5 opacity-50 cursor-not-allowed'
                    : isSelected
                      ? 'bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] border-[var(--dynamic-aura,var(--aura-indigo))]/60 shadow-[0_10px_20px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_25%,transparent)]'
                      : 'bg-[var(--text-primary)]/[0.02] text-[var(--text-secondary)] border-[var(--text-primary)]/5 hover:border-[var(--text-primary)]/10'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs ${
                    isSelected && !isUnavailable ? 'bg-[var(--text-primary)]/20' : 'bg-[var(--text-primary)]/5 text-[var(--text-secondary)]'
                  }`}
                >
                  {(m.displayName || 'M').charAt(0)}
                </div>
                <div className="text-left truncate">
                  <span className="text-2xs font-black uppercase tracking-wider block truncate">
                    {(m.displayName || '').split(' ').slice(-1)[0]}
                  </span>
                  <span className="text-2xs opacity-60 block leading-tight">{isUnavailable ? 'İzinli / Müsait Değil' : roleSubLabel}</span>
                </div>
              </button>
            );
          })}
      </div>
    </div>
  );
}

export default function HaftalikCizelge() {
  const shouldAnimate = useOneShotAnimation('haftalik-cizelge');

  // new Date() cihazın kendi saat dilimini kullanır — Türkiye dışı bir saat
  // diliminde açıldığında başlangıç haftası (ve "bugün" vurgusu) yanlış güne
  // kayabiliyordu (bkz. mantık denetimi, dateUtils.ts getTurkeyNow).
  const [currentDate, setCurrentDate] = useState(getTurkeyNow());
  const haftaId = getHaftaIdFromDate(format(currentDate, 'yyyy-MM-dd'));
  const { plan, loading: planLoading, sunucudanDogrulandi } = useHaftaPlan(haftaId);
  const muezzinler = useMuezzinStore((s) => s.muezzinler);
  const muezzinMap = useMuezzinStore((s) => s.muezzinMap);
  const izinler = useAdminIzinlerStore((s) => s.izinler);
  const onayliIzinler = useMemo(() => izinler.filter((i) => i.durum === 'onaylandi'), [izinler]);
  const { bildirimler: haftaBildirimleri, loading: bildirimLoading } = useHaftaBildirimleri(haftaId);
  const showNotification = useNotificationStore((s) => s.showNotification);
  const isAdmin = useAuthStore((s) => s.isAdmin);

  const loading = planLoading || bildirimLoading;

  const [modalOpen, setModalOpen] = useState(false);
  const [editingCell, setEditingCell] = useState<{ tarih: string; gunAdi: string; vakit: Vakit; data: VakitAtama } | null>(null);

  const [editFormData, setEditFormData] = useState({
    asil: '',
    yedek: '',
  });
  const [generating, setGenerating] = useState(false);
  const [confirmPlanRefreshOpen, setConfirmPlanRefreshOpen] = useState(false);

  // `tarih` verildiğinde, otomatik planlama motorunun (planlamaCekirdegi.ts)
  // mutlak saydığı "onaylı izinli/sabit izin gününde asla atama yok" kuralı
  // burada da uygulanır — bkz. dateUtils.ts kisiGunIcinMusaitMi yorumu.
  const isAssignableMuezzin = useCallback(
    (uid: string, tarih?: string) => {
      if (!uid || uid === 'Sistem' || uid === 'SISTEM') return true;
      const person = muezzinler.find((m) => m.id === uid);
      // onayBekliyor: true olan (admin henüz onaylamamış) bir davetli nöbete
      // atanabilir sayılmamalı — planlamaCekirdegi.ts'in `nobeteAtanabilirMi`'si
      // ve firestore.rules `isAssignableDutyUidVeri` bu kontrolü zaten mutlak
      // sayıyordu, ama manuel atama burada hiç kontrol etmiyordu (bkz. mimari
      // denetim Y4/O9'un manuel-atama karşılığı) — sunucu reddediyordu ama
      // istemci önceden hiç engellemiyordu.
      if (!person || person.aktif !== true || person.role !== 'muezzin' || person.onayBekliyor === true) return false;
      if (tarih && !kisiGunIcinMusaitMi(person, tarih, onayliIzinler)) return false;
      return true;
    },
    [muezzinler, onayliIzinler]
  );

  const unavailableUidsForEditingCell = useMemo(() => {
    if (!editingCell) return new Set<string>();
    const tarih = editingCell.tarih;
    return new Set(
      muezzinler
        .filter((m) => m.aktif && m.role === 'muezzin' && (m.onayBekliyor === true || !kisiGunIcinMusaitMi(m, tarih, onayliIzinler)))
        .map((m) => m.id)
    );
  }, [editingCell, muezzinler, onayliIzinler]);

  const handlePlanOlustur = useCallback(async () => {
    try {
      setGenerating(true);
      await haftalikPlanOlustur(haftaId);
      showNotification('Plan Oluşturuldu', `${haftaId} haftası için plan başarıyla oluşturuldu.`, 'success');
      await telemetryService.logAudit('Otomatik Plan Oluşturma', haftaId, 'Haftalık görev planı otonom motor tarafından oluşturuldu.');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Plan oluşturulurken bir hata oluştu.';
      showNotification('Hata', errorMessage, 'error');
    } finally {
      setGenerating(false);
    }
  }, [haftaId, showNotification]);

  // Self-healing'in her haftaId için EN FAZLA bir kez otomatik tetiklenmesini
  // garanti eden kilit — bkz. useBugunPlanDurumu.ts'teki aynı desen
  // (selfHealingFiredRef). Önceden `generating` (gerçek React state, effect
  // bağımlılık dizisinde) hem kilit hem tetikleyici olarak kullanılıyordu:
  // handlePlanOlustur başarısız olduğunda `finally` içinde generating
  // false'a dönüyor, bu da effect'i AYNI ANDA yeniden tetikleyip (plan hâlâ
  // yok) sonsuz bir yeniden-deneme döngüsüne (her başarısızlıkta art arda
  // Firestore yazımı + hata toast'ı) yol açıyordu (bkz. code-review,
  // dördüncü denetim turu). Ref, plan başarıyla gelene ya da haftaId
  // değişene kadar tekrar denemeyi engeller — admin "PLANLARI GÜNCELLE"
  // düğmesiyle hâlâ manuel deneyebilir.
  const selfHealingFiredHaftaIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Karar useBugunPlanDurumu.ts ile ORTAK saf fonksiyondan gelir
    // (src/lib/planSelfHealing.ts) — iki uygulama noktası ayrışmasın diye.
    // `sunucudanDogrulandi` şartı, çevrimdışı/bayat önbellekten gelen
    // yanlış-negatif bir "plan yok" okumasının yayınlanmış çizelgeyi ezmesini
    // engeller (elle "PLANLARI GÜNCELLE" düğmesi bundan etkilenmez).
    if (
      selfHealingTetiklenmeliMi({
        planVarMi: !!plan,
        planLoading,
        sunucudanDogrulandi,
        isAdmin,
        haftaId,
        dahaOnceTetiklenenHaftaId: selfHealingFiredHaftaIdRef.current,
        olusturuluyor: generating,
      })
    ) {
      selfHealingFiredHaftaIdRef.current = haftaId;
      if (import.meta.env.DEV) {
        console.log(`[Self-Healing] Cizelge sayfasında plan bulunamadı (${haftaId}). Otomatik oluşturma tetikleniyor...`);
      }
      // Effect gövdesinde senkron olarak handlePlanOlustur'u çağırmak,
      // içindeki ilk satır olan setGenerating(true)'nun aynı render turunda
      // senkron çalışmasına yol açıyordu. Bir microtask'a erteleyerek bunu
      // onSnapshot/event callback'leriyle aynı — "harici bir tetikleyiciye
      // yanıt olarak state güncelleme" — kalıba taşıyoruz.
      queueMicrotask(() => {
        void handlePlanOlustur();
      });
    }
  }, [plan, planLoading, sunucudanDogrulandi, isAdmin, haftaId, generating, handlePlanOlustur]);

  const exportWeeklyPlanCSV = () => {
    if (!plan) return;
    const headers = ['Tarih', 'Gün', 'Vakit', 'Asil Görevli', 'Yedek Görevli'];
    const rows: string[][] = [];

    Object.keys(plan.gunler)
      .sort()
      .forEach((tarih) => {
        const gunObj = plan.gunler[tarih];
        const gunAdi = format(parseISO(tarih), 'EEEE', { locale: tr });
        VAKITLER.forEach((vakit) => {
          const atama = gunObj[vakit] || { asil: '', yedek: '' };
          rows.push([tarih, gunAdi, toTurkishUpperCase(vakit), getMuezzinName(atama.asil), getMuezzinName(atama.yedek)]);
        });
      });

    exportCsv(headers, rows, `haftalik-nobet-plani-${plan.id}.csv`);

    telemetryService.logAudit('Plan Çıktısı Alma', plan.id, 'Haftalık nöbet çizelgesi CSV formatında dışa aktarıldı.');
  };

  const handleMubahale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCell || !plan) return;
    if (!editFormData.asil || !editFormData.yedek) {
      showNotification('Eksik Atama', 'Asil ve yedek alanları boş bırakılamaz.', 'warning');
      return;
    }
    if (editFormData.asil && editFormData.yedek && editFormData.asil !== 'Sistem' && editFormData.asil === editFormData.yedek) {
      showNotification('Hata', 'Asil ve yedek görevli aynı kişi olamaz.', 'error');
      return;
    }
    if (!isAssignableMuezzin(editFormData.asil, editingCell.tarih) || !isAssignableMuezzin(editFormData.yedek, editingCell.tarih)) {
      showNotification(
        'Atama Engellendi',
        'Seçilen personel bu tarihte onaylı izinli veya sabit haftalık izin gününde ya da aktif bir müezzin değil. Yalnızca o gün müsait aktif müezzinler görevlendirilebilir.',
        'error'
      );
      return;
    }

    try {
      const gunKey = Object.keys(plan.gunler).find((k) => k === editingCell.tarih);
      if (gunKey) {
        const sonuc = await vakitAtamasiniGuncelle({
          haftaId: plan.id,
          tarih: gunKey,
          vakit: editingCell.vakit,
          asilUid: editFormData.asil,
          yedekUid: editFormData.yedek,
          asilAdi: getMuezzinName(editFormData.asil),
          yedekAdi: getMuezzinName(editFormData.yedek),
        });

        if (sonuc === 'protected') {
          const msg = 'Bu vakitte onay/ret veya görev çağrısı geçmişi var. Güvenli güncelleme yapılamadı.';
          showNotification('Güncelleme Engellendi', msg, 'warning');
          return;
        }

        setModalOpen(false);
        showNotification('Güncelleme Başarılı', 'Seçili vakit için asil ve yedek ataması güncellendi.', 'success');
      }
    } catch (err: unknown) {
      // vakitAtamasiniGuncelle çağıranı handleFirestoreError ile spesifik,
      // Türkçe bir mesaja çevrilmiş hata fırlatır (yetki/çakışma vb.) — burada
      // jenerik bir metinle yutmak (bkz. handlePlanOlustur'daki aynı desenin
      // eksikliği) admin'in gerçek reddedilme sebebini hiç görmemesine yol
      // açıyordu.
      const errorMessage = err instanceof Error ? err.message : 'Güncelleme sırasında bir hata oluştu.';
      showNotification('Hata', errorMessage, 'error');
    }
  };

  const currentWeekStart = startOfWeek(currentDate, { weekStartsOn: 1 });

  const openEdit = useCallback((tarih: string, gunAdi: string, vakit: Vakit, data: VakitAtama) => {
    setEditingCell({ tarih, gunAdi, vakit, data });
    setEditFormData({ asil: data.asil, yedek: data.yedek });
    setModalOpen(true);
  }, []);

  const getMuezzinName = useCallback(
    (uid: string) => {
      if (!uid) return 'Bilinmiyor';
      if (uid === 'Sistem' || uid === 'SISTEM') return 'Dizge';
      const person = muezzinMap[uid];
      if (!person) return 'Bilinmiyor';
      if (person.role !== 'muezzin' || person.aktif !== true) return 'Geçersiz Atama';
      return person.displayName || 'Bilinmiyor';
    },
    [muezzinMap]
  );

  const getStatusColor = (durum: string | undefined) => {
    if (!durum) return 'bg-slate-400/40';
    if (durum === 'onaylandi') return 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]';
    if (durum === 'reddedildi') return 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.8)]';
    return 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.8)]'; // bekliyor
  };

  const renderedGrid = useMemo(() => {
    if (!plan) return null;
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
                  transition={shouldAnimate ? { type: 'spring', stiffness: 400, damping: 30, delay: idx * 0.05 } : { duration: 0.2 }}
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
                          ? 'bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] border-[var(--dynamic-aura,var(--aura-indigo))] shadow-lg'
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
                      const asilBildirim = haftaBildirimleri.find((b) => b.tarih === tarih && b.vakit === vakit && b.uid === atama?.asil);
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
                          onClick={() => openEdit(tarih, gunAdi, vakit, atama)}
                          className="spatial-glass-elevated p-3 sm:p-4 rounded-[18px] sm:rounded-3xl text-left border border-[var(--text-primary)]/5 transition-all duration-500 group relative min-h-[84px]"
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
                                <div className={`w-1.5 h-1.5 rounded-full ${getStatusColor(asilBildirim?.durum)}`} />
                              )}
                              <span
                                className={`text-xs tracking-tight truncate ${
                                  asilIsSistem
                                    ? 'font-normal italic text-[var(--text-secondary)]/45'
                                    : 'font-medium text-[var(--text-primary)]'
                                }`}
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
                                  <div className="w-1 h-1 rounded-full bg-[var(--text-primary)]/40" />
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
  }, [plan, haftaBildirimleri, openEdit, getMuezzinName, shouldAnimate]);

  return (
    <div className="flex flex-col gap-6 lg:gap-10">
      {/* TOOLBAR: Chronos Navigation */}
      <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-4 lg:gap-6">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-xl font-light tracking-tight text-[var(--text-primary)]">Hizmet Cetveli</h2>
          <p className="authority-title !text-2xs opacity-30 font-medium tracking-wide">OPERASYONEL GÖREV DAĞILIMI VE PLANLAMA</p>
        </div>

        <div className="flex items-center gap-2 sm:gap-4 bg-[var(--text-primary)]/[0.02] p-2 rounded-[20px] sm:rounded-3xl border border-[var(--text-primary)]/5 shadow-[var(--spatial-shadow)] w-full lg:w-auto justify-between">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setCurrentDate(subWeeks(currentDate, 1))}
            aria-label="Önceki hafta"
            className="w-12 h-12 flex items-center justify-center bg-[var(--text-primary)]/[0.03] text-[var(--text-secondary)] rounded-2xl hover:text-[var(--dynamic-aura,var(--aura-indigo))] border border-[var(--text-primary)]/5 transition-all shadow-lg"
          >
            <ChevronLeft size={20} />
          </motion.button>

          <div className="px-2 sm:px-6 text-center flex flex-col items-center min-w-0">
            <span className="text-xs sm:text-sm font-light text-[var(--text-primary)] tracking-tight truncate max-w-[170px] sm:max-w-none">
              {format(currentWeekStart, 'd MMMM yyyy', { locale: tr })}
            </span>
            <span className="authority-title !text-2xs opacity-40 mt-1 uppercase tracking-wide">PLANLAMA HAFTASI</span>
          </div>

          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setCurrentDate(addWeeks(currentDate, 1))}
            aria-label="Sonraki hafta"
            className="w-12 h-12 flex items-center justify-center bg-[var(--text-primary)]/[0.03] text-[var(--text-secondary)] rounded-2xl hover:text-[var(--dynamic-aura,var(--aura-indigo))] border border-[var(--text-primary)]/5 transition-all shadow-lg"
          >
            <ChevronRight size={20} />
          </motion.button>
        </div>

        <div className="flex flex-col lg:flex-row items-center gap-3 w-full lg:w-auto">
          <motion.button
            whileHover={{ y: -3, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={exportWeeklyPlanCSV}
            disabled={!plan || loading}
            className="bg-[var(--dynamic-aura,var(--aura-indigo))]/10 text-[var(--dynamic-aura,var(--aura-indigo))] border border-[var(--dynamic-aura,var(--aura-indigo))]/20 px-5 sm:px-8 py-3.5 sm:py-4 rounded-2xl text-2xs font-bold uppercase tracking-wide shadow-lg flex items-center justify-center gap-3 sm:gap-4 disabled:opacity-30 group w-full lg:w-auto cursor-pointer"
          >
            <Zap size={16} className="group-hover:scale-110 transition-transform duration-500" />
            ÇİZELGEYİ AKTAR
          </motion.button>

          <motion.button
            whileHover={{ y: -3, scale: 1.02, boxShadow: '0 15px 30px rgba(99,102,241,0.2)' }}
            whileTap={{ scale: 0.98 }}
            onClick={() => (plan ? setConfirmPlanRefreshOpen(true) : handlePlanOlustur())}
            disabled={generating || loading}
            className="bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] px-5 sm:px-8 py-3.5 sm:py-4 rounded-2xl text-2xs font-bold uppercase tracking-wide shadow-lg flex items-center justify-center gap-3 sm:gap-4 disabled:opacity-50 group w-full lg:w-auto cursor-pointer"
          >
            <RotateCcw
              size={16}
              className={`group-hover:rotate-180 transition-transform duration-700 ${generating ? 'animate-spin' : ''}`}
            />
            {generating ? 'YENİLENİYOR...' : 'PLANLARI GÜNCELLE'}
          </motion.button>
        </div>
      </div>

      {/* MAIN CONTENT: Weekly Flow */}
      <div className="relative">
        {!plan && !loading && (
          <EmptyState
            icon={<AlertCircle size={36} strokeWidth={1.2} />}
            title="Planlama Bulunamadı"
            description="SEÇİLEN HAFTA İÇİN HENÜZ BİR OPERASYONEL CETVEL OLUŞTURULMADI. OTOMATİK PLANLAMA MOTORUNU ÇALIŞTIRABİLİRSİNİZ."
            tone="indigo"
            size="md"
            action={{
              label: (
                <>
                  <Zap size={18} className="text-amber-500 fill-amber-500" />
                  DİZGEYİ ŞİMDİ PLANLA
                </>
              ),
              onClick: handlePlanOlustur,
              disabled: generating,
            }}
          />
        )}

        {loading && !plan && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-3 lg:gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex flex-col lg:flex-row items-stretch lg:items-center p-3 sm:p-4 gap-4 sm:gap-6 rounded-card border spatial-glass border-[var(--text-primary)]/5 opacity-50"
              >
                <div className="flex items-center gap-4 sm:gap-5 min-w-[150px] shrink-0 pl-1 sm:pl-2">
                  <div className="w-14 h-14 rounded-avatar bg-[var(--text-primary)]/5 animate-pulse" />
                  <div className="flex flex-col gap-2">
                    <div className="w-20 h-4 bg-[var(--text-primary)]/5 rounded-full animate-pulse" />
                    <div className="w-16 h-2 bg-[var(--text-primary)]/5 rounded-full animate-pulse" />
                  </div>
                </div>
                <div className="flex-1 grid grid-cols-1 min-[370px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3 w-full">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <div
                      key={j}
                      className="spatial-glass-elevated p-3 sm:p-4 rounded-[18px] sm:rounded-3xl border border-[var(--text-primary)]/5 min-h-[84px] animate-pulse bg-[var(--text-primary)]/[0.02]"
                    />
                  ))}
                </div>
              </div>
            ))}
          </motion.div>
        )}

        {plan && renderedGrid}
      </div>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Hizmet Operasyonu">
        <form onSubmit={handleMubahale} className="space-y-10 py-4">
          <div className="spatial-glass-elevated p-4 sm:p-6 rounded-card border border-[var(--dynamic-aura,var(--aura-indigo))]/15 relative overflow-hidden bg-[var(--dynamic-aura,var(--aura-indigo))]/[0.02]">
            <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--dynamic-aura,var(--aura-indigo))]/5 blur-3xl rounded-full" />
            <p className="authority-title !text-2xs opacity-30 mb-3 tracking-wide">SEÇİLİ VAKİT VE TARİH</p>
            <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
              <span className="text-xl sm:text-2xl font-light text-[var(--text-primary)] tracking-tighter">{editingCell?.gunAdi}</span>
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--dynamic-aura,var(--aura-indigo))] shadow-[0_0_10px_var(--dynamic-aura,var(--aura-indigo))]" />
              <span className="text-sm font-bold text-[var(--dynamic-aura,var(--aura-indigo))] uppercase tracking-wide">
                {editingCell?.vakit}
              </span>
            </div>
            <p className="text-2xs text-[var(--text-secondary)]/75 mt-2 font-medium tracking-wide">{editingCell?.tarih}</p>
          </div>

          <div className="flex flex-col gap-6">
            <PersonelSecici
              label="ASİL GÖREVLİ ATAMASI"
              systemSubLabel="Otomatik Planla"
              roleSubLabel="Görevli Kadro"
              value={editFormData.asil}
              onSelect={(uid) => setEditFormData({ ...editFormData, asil: uid })}
              muezzinler={muezzinler}
              unavailableUids={unavailableUidsForEditingCell}
            />
            <PersonelSecici
              label="YEDEK PERSONEL ATAMASI"
              systemSubLabel="Yedek Planla"
              roleSubLabel="Yedek Görevli"
              value={editFormData.yedek}
              onSelect={(uid) => setEditFormData({ ...editFormData, yedek: uid })}
              muezzinler={muezzinler}
              unavailableUids={unavailableUidsForEditingCell}
            />
          </div>

          <div className="pt-6 sm:pt-8 flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-3 sm:gap-6">
            <motion.button
              whileHover={{
                y: -3,
                scale: 1.01,
                boxShadow: '0 15px 30px color-mix(in srgb, var(--dynamic-aura, var(--aura-indigo)) 20%, transparent)',
              }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              className="flex-1 bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] text-2xs font-bold uppercase tracking-wide py-4 sm:py-5 rounded-2xl shadow-lg shadow-[var(--dynamic-aura,var(--aura-indigo))]/15 transition-all"
            >
              ATAMAYI GÜNCELLE
            </motion.button>
            <motion.button
              whileHover={{ backgroundColor: 'var(--surface-medium)' }}
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-6 sm:px-10 py-3.5 sm:py-5 text-2xs font-bold uppercase tracking-wide text-[var(--text-secondary)] opacity-40 hover:opacity-100 transition-all border border-[var(--text-primary)]/5 rounded-2xl"
            >
              İPTAL
            </motion.button>
          </div>
        </form>
      </Modal>
      <ConfirmModal
        isOpen={confirmPlanRefreshOpen}
        onClose={() => setConfirmPlanRefreshOpen(false)}
        onConfirm={() => {
          setConfirmPlanRefreshOpen(false);
          handlePlanOlustur();
        }}
        title="Planları Güncelle"
        message="Bu işlem yalnızca güvenli bekleyen atamaları yeniden planlar. Onaylanmış, reddedilmiş veya görev çağrısı geçmişi olan vakitler korunur."
        confirmText="GÜVENLİ GÜNCELLE"
        cancelText="VAZGEÇ"
      />
    </div>
  );
}
