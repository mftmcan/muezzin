import React, { useState, useEffect } from 'react';
import { useMuezzinStore } from '../../../store/useMuezzinStore';
import { Muezzin, Invite } from '../../../types';
import { handleFirestoreError, OperationType } from '../../../lib/firestore-errors';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { PersonelFormModal } from '../components/PersonelFormModal';
import { Edit2, Power, Trash2, AlertCircle, UserPlus, CheckCircle2, RotateCcw, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GUNLER_TR } from '../../../lib/dateUtils';
import {
  invitesAbone,
  personelAktiflikDegistir,
  personelOnayla,
  personelGeriYukle,
  personelArsivle,
  davetSil,
} from '../../../services/muezzinServisi';
import { useOneShotAnimation } from '../../../hooks/useOneShotAnimation';

type PendingUser = ({ isInvite: false } & Muezzin & { id: string }) | ({ isInvite: true; isOnay: false } & Invite & { id: string });

export default function MuezzinYonetimi() {
  const shouldAnimate = useOneShotAnimation('muezzin-yonetimi');

  // ATOMIC ZUSTAND SELECTORS - (Engeller gereksiz renderları)
  const muezzinler = useMuezzinStore((state) => state.muezzinler);
  const loading = useMuezzinStore((state) => state.loading);

  const [invites, setInvites] = useState<(Invite & { id: string })[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<(Muezzin & { id: string }) | null>(null);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    const unsub = invitesAbone(setInvites, (error) => {
      console.error('Firestore Dinleme Hatası:', error.message);
      if (error.code === 'permission-denied') {
        setErrorStatus('Davetiyeleri görme yetkiniz yok.');
      } else {
        // handleFirestoreError'ın dönüş değeri (kullanıcıya gösterilebilir mesaj)
        // önceden atılıyordu — yalnızca yan-etki (console+telemetri) için
        // çağrılıyordu. permission-denied DIŞI bir dinleme hatasında (ağ
        // kopması, unavailable/deadline-exceeded) bekleyen davetler listesi
        // ekranda hiçbir uyarı olmadan sessizce donuk/eksik kalıyordu.
        const mesaj = handleFirestoreError(error, OperationType.GET, 'invites');
        setErrorStatus(mesaj.message);
      }
    });
    return () => unsub();
  }, []);

  type ConfirmActionType = 'delete' | 'toggle' | 'restore';
  const [confirmAction, setConfirmAction] = useState<{ type: ConfirmActionType; data: Muezzin & { id: string } } | null>(null);
  const closeConfirmAction = () => setConfirmAction(null);
  const confirmDeleteData = confirmAction?.type === 'delete' ? confirmAction.data : null;
  const confirmToggleData = confirmAction?.type === 'toggle' ? confirmAction.data : null;
  const confirmRestoreData = confirmAction?.type === 'restore' ? confirmAction.data : null;

  const openNew = () => {
    setEditingUser(null);
    setModalOpen(true);
  };

  const openEdit = (m: Muezzin & { id: string }) => {
    setEditingUser(m);
    setModalOpen(true);
  };

  const warnIfPlanNotRefreshed = (planRefreshed: boolean) => {
    if (!planRefreshed) {
      setErrorStatus(
        'Kadro güncellendi; mevcut hafta planı otomatik yenilenemedi. Hizmet Cetveli üzerinden güvenli güncelleme yapabilirsiniz.'
      );
    }
  };

  const toggleAktif = async (m: Muezzin & { id: string }) => {
    setErrorStatus(null);
    try {
      const { planRefreshed } = await personelAktiflikDegistir(m, muezzinler);
      warnIfPlanNotRefreshed(planRefreshed);
    } catch (err) {
      setErrorStatus(err instanceof Error ? err.message : 'Personel durumu güncellenemedi.');
    }
  };

  const handleApprove = async (m: Muezzin & { id: string }) => {
    setErrorStatus(null);
    try {
      const { planRefreshed } = await personelOnayla(m);
      warnIfPlanNotRefreshed(planRefreshed);
    } catch (err) {
      setErrorStatus(err instanceof Error ? err.message : 'Onay işlemi sırasında bir hata oluştu.');
    }
  };

  const restoreUser = async (m: Muezzin & { id: string }) => {
    setErrorStatus(null);
    try {
      const { planRefreshed } = await personelGeriYukle(m);
      warnIfPlanNotRefreshed(planRefreshed);
    } catch (err) {
      setErrorStatus(err instanceof Error ? err.message : 'Personel geri yüklenemedi.');
    }
  };

  const archiveUser = async (m: Muezzin & { id: string }) => {
    setErrorStatus(null);
    try {
      const { planRefreshed } = await personelArsivle(m, muezzinler);
      warnIfPlanNotRefreshed(planRefreshed);
    } catch (err) {
      setErrorStatus(err instanceof Error ? err.message : 'Kullanıcı kaydı arşivlenemedi.');
    }
  };

  const runConfirmedAction = async () => {
    if (!confirmAction) return;
    const { type, data } = confirmAction;
    setConfirmAction(null);
    if (type === 'toggle') await toggleAktif(data);
    else if (type === 'delete') await archiveUser(data);
    else await restoreUser(data);
  };

  const executeDeleteInvite = async (inviteEmail: string) => {
    try {
      await davetSil(inviteEmail);
    } catch (err) {
      setErrorStatus(err instanceof Error ? err.message : 'Davet silinemedi.');
    }
  };

  const pendingUsers = React.useMemo((): PendingUser[] => {
    const pendingMuezzins: PendingUser[] = muezzinler
      .filter((m) => m && m.onayBekliyor === true && m.arsivlendi !== true)
      .map((m) => ({ ...m, isInvite: false as const }));
    const knownEmails = new Set(muezzinler.map((m) => m.email?.trim().toLowerCase()).filter(Boolean));
    const pendingInvites: PendingUser[] = invites
      .filter((i) => !knownEmails.has(i.email?.trim().toLowerCase()))
      .map((i) => ({ ...i, isOnay: false as const, isInvite: true as const }));
    return [...pendingMuezzins, ...pendingInvites];
  }, [muezzinler, invites]);

  const activeUsers = React.useMemo(() => muezzinler.filter((m) => m && m.onayBekliyor !== true && m.arsivlendi !== true), [muezzinler]);

  const operationalUsers = React.useMemo(() => activeUsers.filter((m) => m.role === 'muezzin'), [activeUsers]);

  const archivedUsers = React.useMemo(() => muezzinler.filter((m) => m && m.arsivlendi === true), [muezzinler]);

  const displayedUsers = showArchived ? archivedUsers : activeUsers;

  // Performans Sıralaması ve Maksimum Vakit Hesabı (Memoized)
  const { maxVakit, sortedMuezzins } = React.useMemo(() => {
    const maxVal = Math.max(...operationalUsers.map((x) => x.aylikVakitSayisi || 0), 1);
    const sorted = [...operationalUsers].sort((a, b) => (b.aylikVakitSayisi || 0) - (a.aylikVakitSayisi || 0));
    return { maxVakit: maxVal, sortedMuezzins: sorted };
  }, [operationalUsers]);

  // Rules-of-Hooks: bu erken dönüş tüm hook çağrılarından SONRA gelmelidir
  // (bkz. src/pages/admin/AdminPanel.tsx'teki aynı sınıf düzeltme).
  if (loading)
    return (
      <div className="flex flex-col gap-10">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="flex flex-col gap-2">
            <div className="w-48 h-6 bg-[var(--text-primary)]/5 rounded-full animate-pulse" />
            <div className="w-32 h-3 bg-[var(--text-primary)]/5 rounded-full animate-pulse" />
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="w-32 h-10 bg-[var(--text-primary)]/5 rounded-2xl animate-pulse" />
            <div className="w-48 h-10 bg-[var(--text-primary)]/5 rounded-2xl animate-pulse" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="p-4 sm:p-6 spatial-glass border-[var(--glass-border)] rounded-card opacity-50 flex flex-col gap-6">
              <div className="flex items-center gap-5">
                <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-[18px] sm:rounded-3xl bg-[var(--text-primary)]/5 animate-pulse" />
                <div className="flex flex-col gap-2">
                  <div className="w-32 h-4 bg-[var(--text-primary)]/5 rounded-full animate-pulse" />
                  <div className="w-20 h-2 bg-[var(--text-primary)]/5 rounded-full animate-pulse" />
                </div>
              </div>
              <div className="w-full h-16 bg-[var(--text-primary)]/5 rounded-[20px] animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-10">
      {/* ACTION BAR: Executive Authority */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-light tracking-tight text-[var(--text-primary)]">Kadro Yönetimi</h2>
          <p className="authority-title !text-2xs opacity-40 font-medium tracking-wide">{muezzinler.length} TOPLAM PERSONEL TANIMLI</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
          <motion.button
            whileHover={{ y: -3, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowArchived(!showArchived)}
            className={`flex-1 sm:flex-initial px-6 py-3 sm:py-4 rounded-xl text-2xs font-bold uppercase tracking-wide border transition-all ${showArchived ? 'bg-[var(--dynamic-aura,var(--aura-indigo))]/10 border-[var(--dynamic-aura,var(--aura-indigo))]/30 text-[var(--dynamic-aura,var(--aura-indigo))] shadow-lg' : 'bg-[var(--text-primary)]/[0.03] border-[var(--text-primary)]/5 text-[var(--text-secondary)]/55 hover:text-[var(--text-primary)]'}`}
          >
            {showArchived ? 'KADROYU GÖSTER' : 'ARŞİVİ GÖSTER'}
          </motion.button>
          <motion.button
            whileHover={{ y: -3, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={openNew}
            className="flex-1 sm:flex-initial px-8 py-3 sm:py-4 bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] rounded-xl text-2xs font-bold uppercase tracking-wide shadow-[0_12px_24px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_18%,transparent)] flex items-center justify-center gap-4 group"
          >
            <UserPlus size={16} className="group-hover:rotate-12 transition-transform" />
            YENİ PERSONEL TANIMLA
          </motion.button>
        </div>
      </div>

      {/* PENDING ACTIONS: Spatial Context Alert */}
      {pendingUsers.length > 0 && (
        <motion.section
          initial={shouldAnimate ? { opacity: 0, y: 20 } : false}
          animate={{ opacity: 1, y: 0 }}
          className="spatial-glass p-4 sm:p-8 !bg-rose-500/[0.03] border-rose-500/20 relative overflow-hidden !rounded-card"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/5 blur-3xl rounded-full -translate-y-1/2 translate-x-1/2" />

          <div className="flex items-center gap-4 mb-8">
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center shadow-lg border border-rose-500/20">
              <AlertCircle size={20} strokeWidth={1.5} />
            </div>
            <div>
              <h3 className="text-sm font-medium text-rose-500/80 tracking-tight">Bekleyen Onaylar & Davetler</h3>
              <p className="authority-title !text-2xs opacity-45 mt-1 font-medium tracking-wide">
                DİZGEYE ERİŞİM BEKLEYEN {pendingUsers.length} KAYIT VAR
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {pendingUsers.map((m, idx) => (
              <motion.div
                layout
                initial={shouldAnimate ? { opacity: 0, x: -10 } : false}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: shouldAnimate ? idx * 0.1 : 0 }}
                key={m.id}
                className="spatial-glass-elevated p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-0 group hover:bg-[var(--text-primary)]/[0.04] transition-all duration-500"
              >
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <div className="w-10 h-10 shrink-0 rounded-2xl bg-[var(--dynamic-aura,var(--aura-indigo))]/5 border border-[var(--dynamic-aura,var(--aura-indigo))]/10 flex items-center justify-center text-[var(--dynamic-aura,var(--aura-indigo))] font-light text-lg">
                    {m.displayName.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-light text-[var(--text-primary)] tracking-tight truncate">{m.displayName}</p>
                    <p className="text-2xs text-[var(--text-secondary)]/60 font-bold uppercase tracking-wide mt-1 break-all">{m.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {!m.isInvite ? (
                    <motion.button
                      whileHover={{ scale: 1.1, backgroundColor: 'rgba(16,185,129,0.15)' }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => handleApprove(m)}
                      aria-label="Personeli onayla"
                      className="p-3 bg-emerald-500/10 text-emerald-500 rounded-xl border border-emerald-500/20 shadow-sm"
                    >
                      <CheckCircle2 size={16} />
                    </motion.button>
                  ) : (
                    <div className="px-3 py-1 bg-[var(--surface-medium)] rounded-xl border border-[var(--glass-border)]">
                      <span className="text-2xs font-bold uppercase tracking-wide text-[var(--text-secondary)] opacity-55">DAVETLİ</span>
                    </div>
                  )}
                  <motion.button
                    whileHover={{ scale: 1.1, backgroundColor: 'rgba(244,63,94,0.15)' }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => (m.isInvite ? executeDeleteInvite(m.id) : setConfirmAction({ type: 'delete', data: m }))}
                    // Davet (isInvite) dalı GERÇEKTEN siler (davetSil -> deleteDoc); bekleyen
                    // bir müezzin kaydı (isInvite:false) dalı ise arşivler (bkz. yukarıdaki
                    // ana liste butonundaki AYNI düzeltme) — statik "Sil" etiketi ikinci
                    // durumda yanıltıcıydı.
                    aria-label={m.isInvite ? 'Daveti sil' : 'Personeli arşive al'}
                    className="p-3 bg-[var(--text-primary)]/5 text-muted rounded-xl border border-[var(--text-primary)]/5 hover:text-rose-500 hover:border-rose-500/20 transition-all shadow-sm"
                  >
                    <Trash2 size={16} />
                  </motion.button>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.section>
      )}

      {/* MAIN PERSONNEL LIST: Living Card Grid */}
      <section className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0 mb-2 px-2">
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-6 bg-[var(--dynamic-aura,var(--aura-indigo))] rounded-full" />
            <h2 className="text-lg font-light tracking-tight text-[var(--text-primary)]">
              {showArchived ? 'Arşivlenmiş Kadro' : 'Aktif Kadro'}
            </h2>
          </div>
          <span className="premium-label !text-2xs !opacity-20">{displayedUsers.length} PERSONEL LİSTELENDİ</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {displayedUsers.length > 0 ? (
            displayedUsers.map((m, idx) => {
              const isOperationalMuezzin = m.role === 'muezzin';
              const rank = isOperationalMuezzin ? sortedMuezzins.findIndex((x) => x.id === m.id) + 1 : 0;
              const efficiency = isOperationalMuezzin ? Math.min(100, ((m.aylikVakitSayisi || 0) / maxVakit) * 100) : 0;

              return (
                <motion.div
                  initial={shouldAnimate ? { opacity: 0, y: 20 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: shouldAnimate ? idx * 0.05 : 0 }}
                  key={m.id}
                  className="group relative p-4 sm:p-6 spatial-glass border-[var(--glass-border)] rounded-card overflow-hidden transition-all duration-700 hover:shadow-[var(--spatial-shadow)]"
                >
                  {/* Left Status Pillar */}
                  <div
                    className={`absolute left-0 top-6 bottom-6 w-[4px] rounded-r-full transition-all duration-700 shadow-lg ${
                      m.aktif ? 'bg-emerald-500 shadow-emerald-500/40' : 'bg-rose-500 shadow-rose-500/40'
                    }`}
                  />

                  <div className="relative z-10 flex flex-col gap-6">
                    {/* Header: Identity */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between items-start gap-4 sm:gap-0 min-w-0">
                      <div className="flex items-center gap-5 min-w-0 flex-1">
                        <div className="relative shrink-0">
                          <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-[18px] sm:rounded-3xl bg-[var(--text-primary)]/[0.03] border border-[var(--glass-border)] flex items-center justify-center font-light text-xl sm:text-2xl text-[var(--dynamic-aura,var(--aura-indigo))] shadow-inner group-hover:rotate-3 transition-all duration-700 relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-[var(--dynamic-aura,var(--aura-indigo))]/10 to-transparent z-0" />
                            {m.photoURL ? (
                              <img src={m.photoURL} alt={m.displayName} className="w-full h-full object-cover relative z-10" />
                            ) : (
                              <span className="relative z-10">{m.displayName.charAt(0)}</span>
                            )}
                          </div>
                          <div
                            className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-[3px] border-[var(--app-bg)] shadow-[var(--spatial-shadow)] ${
                              m.aktif ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
                            }`}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="text-xl font-light tracking-tight text-[var(--text-primary)] apple-thin group-hover:font-normal transition-all duration-500 truncate">
                            {m.displayName}
                          </h4>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="relative flex h-2 w-2">
                              {m.fcmToken && (
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--dynamic-aura,var(--aura-indigo))] opacity-75" />
                              )}
                              <span
                                className={`relative inline-flex rounded-full h-2 w-2 ${m.fcmToken ? 'bg-[var(--dynamic-aura,var(--aura-indigo))]' : 'bg-[var(--text-primary)]/10'}`}
                              />
                            </div>
                            <span
                              className={`text-2xs font-bold tracking-wide uppercase transition-colors duration-500 ${
                                m.fcmToken ? 'text-[var(--dynamic-aura,var(--aura-indigo))]/85' : 'text-muted'
                              }`}
                            >
                              {m.fcmToken ? 'Bildirim Aktif' : 'Bildirim Kapalı'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-row flex-wrap items-center sm:flex-col sm:items-end gap-1.5 w-full sm:w-auto mt-2 sm:mt-0">
                        {/* Sıralama rozeti tek biçimde ("#N SIRALAMA") yazılır — ilk 3 sıra yalnızca
 renk kademesiyle (amber/slate/amber-700) ayrılır, ayrı bir kelime dilbilgisi
 kullanılmaz (bkz. görsel denetim, tutarlılık bulgusu). */}
                        {rank === 1 && !showArchived && (
                          <span className="px-2.5 py-1 rounded-md text-2xs font-black tracking-wide bg-amber-500/10 text-amber-500 border border-amber-500/20 shadow-[0_0_12px_rgba(245,158,11,0.2)]">
                            #1 SIRALAMA
                          </span>
                        )}
                        {rank === 2 && !showArchived && (
                          <span className="px-2.5 py-1 rounded-md text-2xs font-black tracking-wide bg-slate-400/10 text-slate-400 border border-slate-400/20">
                            #2 SIRALAMA
                          </span>
                        )}
                        {rank === 3 && !showArchived && (
                          <span className="px-2.5 py-1 rounded-md text-2xs font-black tracking-wide bg-amber-700/10 text-amber-700 border border-amber-700/20">
                            #3 SIRALAMA
                          </span>
                        )}
                        {rank > 3 && !showArchived && (
                          <span className="px-2.5 py-1 rounded-md text-2xs font-bold tracking-wide bg-[var(--text-primary)]/[0.03] text-[var(--text-secondary)]/45 border border-[var(--glass-border)]">
                            #{rank} SIRALAMA
                          </span>
                        )}
                        <span
                          className={`px-2.5 py-1 rounded-md text-2xs font-bold tracking-wide uppercase border shadow-sm ${
                            m.role === 'admin'
                              ? 'bg-[var(--dynamic-aura,var(--aura-indigo))]/10 text-[var(--dynamic-aura,var(--aura-indigo))] border-[var(--dynamic-aura,var(--aura-indigo))]/20'
                              : 'bg-[var(--text-primary)]/[0.02] text-muted border-[var(--glass-border)]'
                          }`}
                        >
                          {m.role === 'admin' ? 'YÖNETİCİ' : m.role === 'gozlemci' ? 'GÖZLEMCİ' : 'MÜEZZİN'}
                        </span>
                      </div>
                    </div>

                    {/* Body: Stats Bento Grid */}
                    <div className="grid grid-cols-2 gap-3 sm:gap-4 p-3.5 sm:p-5 bg-[var(--text-primary)]/[0.02] rounded-[20px] sm:rounded-icon border border-[var(--glass-border)]">
                      <div className="space-y-1.5">
                        <p className="premium-label !text-2xs !opacity-35 uppercase tracking-wide">İZİN GÜNÜ</p>
                        <p className="text-xs font-light text-[var(--text-primary)] tracking-wide">
                          {m.haftalikIzinGunu && m.haftalikIzinGunu > 0 ? GUNLER_TR[m.haftalikIzinGunu] : 'BELİRTİLMEMİŞ'}
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <p className="premium-label !text-2xs !opacity-35 uppercase tracking-wide">GÖREV YÜKÜ</p>
                        <p className="text-xs font-medium text-[var(--dynamic-aura,var(--aura-indigo))] tabular-nums">
                          {isOperationalMuezzin ? `${m.aylikVakitSayisi || 0} Vakit` : 'Yönetim'}
                        </p>
                      </div>

                      {/* Full-width Relative Efficiency */}
                      <div className="col-span-2 space-y-2 border-t border-[var(--glass-border)] pt-3 mt-1">
                        <div className="flex justify-between items-center">
                          <p className="premium-label !text-2xs !opacity-35 uppercase tracking-wide">HİZMET VERİMİ</p>
                          <span
                            className={`text-2xs font-bold tabular-nums ${
                              !isOperationalMuezzin
                                ? 'text-muted'
                                : efficiency >= 70
                                  ? 'text-emerald-500'
                                  : efficiency >= 40
                                    ? 'text-amber-500'
                                    : 'text-rose-500'
                            }`}
                          >
                            {isOperationalMuezzin ? `%${Math.round(efficiency)}` : 'Kadro dışı'}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-[var(--text-primary)]/[0.05] rounded-full overflow-hidden border border-[var(--glass-border)]">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${efficiency}%` }}
                            transition={{ duration: 1, ease: 'easeOut' }}
                            className={`h-full ${
                              !isOperationalMuezzin
                                ? 'bg-[var(--text-primary)]/10'
                                : efficiency >= 70
                                  ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                                  : efficiency >= 40
                                    ? 'bg-amber-500/60'
                                    : 'bg-rose-500/60'
                            }`}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Footer: Actions */}
                    <div className="flex items-center justify-between gap-2 pt-2">
                      <div className="flex items-center gap-2">
                        <div
                          className={`px-2.5 py-1 rounded-md text-2xs font-bold tracking-wide border ${
                            m.aktif
                              ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                              : 'bg-rose-500/10 text-rose-500 border-rose-500/20'
                          }`}
                        >
                          {m.aktif ? 'AKTİF' : 'PASİF'}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 sm:gap-2">
                        {showArchived ? (
                          <motion.button
                            whileHover={{ scale: 1.1, backgroundColor: 'rgba(16,185,129,0.1)' }}
                            whileTap={{ scale: 0.9 }}
                            onClick={() => setConfirmAction({ type: 'restore', data: m })}
                            aria-label="Arşivden geri yükle"
                            className="p-2.5 sm:p-3 bg-[var(--text-primary)]/[0.03] text-emerald-400 hover:text-emerald-500 rounded-xl sm:rounded-2xl border border-[var(--glass-border)] hover:border-emerald-500/30 transition-all shadow-lg cursor-pointer"
                          >
                            <RotateCcw className="w-[14px] h-[14px] sm:w-4 sm:h-4" strokeWidth={1.5} />
                          </motion.button>
                        ) : (
                          <>
                            <motion.button
                              whileHover={{ scale: 1.1, backgroundColor: 'var(--surface-medium)' }}
                              whileTap={{ scale: 0.9 }}
                              onClick={() => openEdit(m)}
                              aria-label="Personeli düzenle"
                              className="p-2.5 sm:p-3 bg-[var(--text-primary)]/[0.03] text-muted hover:text-[var(--text-primary)] rounded-xl sm:rounded-2xl border border-[var(--glass-border)] transition-all shadow-lg cursor-pointer"
                            >
                              <Edit2 className="w-[14px] h-[14px] sm:w-4 sm:h-4" strokeWidth={1.5} />
                            </motion.button>
                            <motion.button
                              whileHover={{ scale: 1.1, backgroundColor: m.aktif ? 'rgba(244,63,94,0.1)' : 'rgba(16,185,129,0.1)' }}
                              whileTap={{ scale: 0.9 }}
                              onClick={() => setConfirmAction({ type: 'toggle', data: m })}
                              aria-label={m.aktif ? 'Personeli pasife al' : 'Personeli aktife al'}
                              className={`p-2.5 sm:p-3 bg-[var(--text-primary)]/[0.03] rounded-xl sm:rounded-2xl border border-[var(--glass-border)] transition-all shadow-lg cursor-pointer ${
                                m.aktif ? 'text-rose-400 hover:border-rose-400/30' : 'text-emerald-400 hover:border-emerald-400/30'
                              }`}
                            >
                              <Power className="w-[14px] h-[14px] sm:w-4 sm:h-4" strokeWidth={1.5} />
                            </motion.button>
                            <motion.button
                              whileHover={{ scale: 1.1, backgroundColor: 'rgba(244,63,94,0.1)' }}
                              whileTap={{ scale: 0.9 }}
                              onClick={() => setConfirmAction({ type: 'delete', data: m })}
                              // "sil" DEĞİL "arşive al" — bu aksiyon gerçekte hiçbir şeyi silmiyor
                              // (bkz. runConfirmedAction -> archiveUser -> personelArsivle), yalnızca
                              // arşivliyor; aria-label önceden "Personeli sil" diyip ekran okuyucu
                              // kullanıcısını yanlış yönlendiriyordu, doğrulama diyaloğunun kendi
                              // başlığı ("ARŞİVE AL") ve metniyle çelişiyordu (bkz. kod denetimi
                              // bulgusu).
                              aria-label="Personeli arşive al"
                              className="p-2.5 sm:p-3 bg-[var(--text-primary)]/[0.03] text-muted hover:text-rose-500 rounded-xl sm:rounded-2xl border border-[var(--glass-border)] hover:border-rose-500/30 transition-all shadow-lg cursor-pointer"
                            >
                              <Trash2 className="w-[14px] h-[14px] sm:w-4 sm:h-4" strokeWidth={1.5} />
                            </motion.button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })
          ) : (
            <div className="col-span-full py-20 text-center spatial-glass !rounded-card border-dashed border-[var(--glass-border)]">
              <p className="premium-label !opacity-20 italic">DİZGEYE KAYITLI PERSONEL BULUNAMADI</p>
            </div>
          )}
        </div>
      </section>

      <AnimatePresence>
        {errorStatus && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="spatial-glass !bg-rose-500/10 border-rose-500/30 p-5 flex items-center gap-4 text-rose-500 text-2xs font-bold uppercase tracking-wide shadow-[var(--spatial-shadow)] w-full max-w-full overflow-hidden"
          >
            <AlertCircle size={20} className="shrink-0" />
            <p className="break-all whitespace-normal flex-1 font-mono text-2xs tracking-normal lowercase select-all">{errorStatus}</p>
            <button
              type="button"
              onClick={() => setErrorStatus(null)}
              aria-label="Uyarıyı kapat"
              className="shrink-0 p-1 rounded-lg hover:bg-rose-500/20 transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <PersonelFormModal isOpen={modalOpen} onClose={() => setModalOpen(false)} editingUser={editingUser} />

      <ConfirmModal
        isOpen={!!confirmDeleteData}
        onClose={closeConfirmAction}
        onConfirm={runConfirmedAction}
        title="Arşive Al"
        message={`${confirmDeleteData?.displayName} adlı personel pasife alınacak ve aktif panelden arşivlenecektir. Geçmiş plan ve bildirim kayıtları korunur.`}
        isDanger={true}
        confirmText="EVET, ARŞİVE AL"
      />

      <ConfirmModal
        isOpen={!!confirmToggleData}
        onClose={closeConfirmAction}
        onConfirm={runConfirmedAction}
        title={confirmToggleData?.aktif ? 'Pasife Al' : 'Aktifleştir'}
        message={
          confirmToggleData?.aktif
            ? `${confirmToggleData?.displayName} adlı personel dondurulacaktır. Mevcut haftanın güvenli plan yenilemesi otomatik çalıştırılır; onay/ret geçmişi korunur.`
            : `${confirmToggleData?.displayName} adlı personel aktif kadroya geri dahil edilecektir. Mevcut hafta planı güvenli şekilde yeniden dengelenir.`
        }
        isDanger={confirmToggleData?.aktif}
        confirmText="OPERASYONU ONAYLA"
      />

      <ConfirmModal
        isOpen={!!confirmRestoreData}
        onClose={closeConfirmAction}
        onConfirm={runConfirmedAction}
        title="Personeli Geri Yükle"
        message={`${confirmRestoreData?.displayName} adlı personel arşivden çıkartılacak ve aktif kadroya geri eklenecektir.`}
        isDanger={false}
        confirmText="EVET, GERİ YÜKLE"
      />
    </div>
  );
}
