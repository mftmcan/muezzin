import React, { useState } from 'react';
import { useMazeretGecmisi } from '../../../hooks/admin/useMazeretGecmisi';
import { useMuezzinStore } from '../../../store/useMuezzinStore';
import { format, parseISO } from 'date-fns';
import { tr } from 'date-fns/locale';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, FileDown, Filter, Trash2, X } from 'lucide-react';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { LoadingState } from '../../../components/ui/LoadingState';
import { exportCsv } from '../../../lib/csvExport';
import { mazeretKaydiSil } from '../../../services/mazeretServisi';
import { toTurkishUpperCase } from '../../../lib/dateUtils';

export default function MazeretGecmisi() {
  const { gecmis, loading, arsivAySayisi } = useMazeretGecmisi();
  const muezzinler = useMuezzinStore((s) => s.muezzinler);
  const muezzinMap = useMuezzinStore((s) => s.muezzinMap);

  const [selectedMuezzin, setSelectedMuezzin] = useState<string>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [errorStatus, setErrorStatus] = useState<string | null>(null);

  const executeDelete = async () => {
    const id = confirmDelete.id;
    if (!id) return;
    try {
      setDeletingId(id);
      await mazeretKaydiSil(id);
      setConfirmDelete({ open: false, id: null });
    } catch (err) {
      if (import.meta.env.DEV) console.error('Mazeret silme hatasi:', err);
      setErrorStatus('Mazeret kaydı silinirken bir hata oluştu.');
      setConfirmDelete({ open: false, id: null });
    } finally {
      setDeletingId(null);
    }
  };

  const getMuezzinName = (uid: string) => {
    return muezzinMap[uid]?.displayName || 'Bilinmiyor';
  };

  const filtered = gecmis.filter((g) => {
    if (selectedMuezzin !== 'all' && g.uid !== selectedMuezzin) return false;
    return true;
  });

  const exportCSV = () => {
    const headers = ['Tarih', 'Vakit', 'Müezzin', 'Mazeret Sebebi'];
    const rows = filtered.map((g) => [g.tarih, g.vakit, getMuezzinName(g.uid), g.retSebebi || 'Belirtilmedi']);

    exportCsv(headers, rows, `mazeret-gecmisi-${format(new Date(), 'yyyy-MM-dd')}.csv`);
  };

  if (loading) return <LoadingState label="Arşiv Kayıtları Senkronize Ediliyor" heightClassName="h-96" />;

  return (
    <div className="flex flex-col gap-8">
      {/* TOOLBAR: Operational Intelligence */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-light tracking-tight text-[var(--text-primary)]">Mazeret Arşivi</h2>
          {/* Sorgu artık son `arsivAySayisi` ayla sınırlı (bkz. useMazeretGecmisi.ts) —
     etiket bunu açıkça söylemeli, aksi halde "TOPLAM" yanıltıcı olurdu. */}
          <p className="authority-title !text-2xs opacity-30 font-medium tracking-wide">
            SON {arsivAySayisi} AY • {filtered.length} KAYIT LİSTELENDİ
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
          <div className="w-full sm:w-64 relative group">
            <label htmlFor="mazeret-gecmisi-personel-filtre" className="sr-only">
              Personel filtrele
            </label>
            <select
              id="mazeret-gecmisi-personel-filtre"
              value={selectedMuezzin}
              onChange={(e) => setSelectedMuezzin(e.target.value)}
              className="w-full spatial-glass-elevated py-3.5 px-6 rounded-2xl text-2xs font-bold uppercase tracking-wide text-[var(--text-primary)] outline-none border border-[var(--text-primary)]/5 hover:bg-[var(--text-primary)]/[0.05] focus:border-[var(--dynamic-aura,var(--aura-indigo))]/30 transition-all appearance-none cursor-pointer"
            >
              <option value="all" className="bg-[var(--card-elevated-bg)] text-[var(--text-primary)]">
                TÜM PERSONEL
              </option>
              {muezzinler.map((m) => (
                <option key={m.id} value={m.id} className="bg-[var(--card-elevated-bg)] text-[var(--text-primary)]">
                  {toTurkishUpperCase(m.displayName)}
                </option>
              ))}
            </select>
            <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none opacity-20">
              <Filter size={14} />
            </div>
          </div>

          <motion.button
            whileHover={{ y: -3, scale: 1.02, boxShadow: '0 15px 30px rgba(99,102,241,0.2)' }}
            whileTap={{ scale: 0.98 }}
            onClick={exportCSV}
            className="flex items-center justify-center gap-3 bg-[var(--dynamic-aura,var(--aura-indigo))]/10 text-[var(--dynamic-aura,var(--aura-indigo))] border border-[var(--dynamic-aura,var(--aura-indigo))]/20 px-6 py-3.5 rounded-2xl text-2xs font-bold uppercase tracking-wide shadow-lg transition-all w-full sm:w-auto cursor-pointer"
          >
            <FileDown size={14} />
            DIŞA AKTAR
          </motion.button>
        </div>
      </div>

      <AnimatePresence>
        {errorStatus && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="spatial-glass !bg-rose-500/10 border-rose-500/30 p-4 flex items-center gap-3 text-rose-500 text-2xs font-bold uppercase tracking-wide shadow-[var(--spatial-shadow)] rounded-2xl"
          >
            <AlertCircle size={18} className="shrink-0" />
            <span className="leading-relaxed">{errorStatus}</span>
            <button
              type="button"
              onClick={() => setErrorStatus(null)}
              aria-label="Kapat"
              className="ml-auto text-rose-500/50 hover:text-rose-500 transition-colors"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* TIMELINE TABLE: Chronological Context */}
      <section className="spatial-glass p-5 sm:p-8 border border-[var(--text-primary)]/5 relative overflow-hidden min-h-[400px] !rounded-card">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[var(--dynamic-aura,var(--aura-indigo))]/10 to-transparent" />

        <div className="hidden md:block overflow-x-auto no-scrollbar">
          <table className="w-full text-left border-separate border-spacing-y-4">
            <thead>
              <tr className="border-b border-[var(--text-primary)]/5">
                <th className="px-6 pb-4 authority-title !text-2xs opacity-30 font-bold tracking-wide">ZAMAN DAMGASI</th>
                <th className="px-6 pb-4 authority-title !text-2xs opacity-30 font-bold tracking-wide">PERSONEL</th>
                <th className="px-6 pb-4 authority-title !text-2xs opacity-30 font-bold tracking-wide">MAZERET GEREKÇESİ</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence mode="popLayout">
                {filtered.length === 0 ? (
                  <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
                    <td colSpan={3} className="py-32 authority-title !text-2xs opacity-20 tracking-wide italic uppercase">
                      Arşivde kayıt bulunmuyor
                    </td>
                  </motion.tr>
                ) : (
                  filtered.map((g, idx) => (
                    <motion.tr
                      layout
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30, delay: idx * 0.03 }}
                      key={g.id}
                      className="group"
                    >
                      <td className="px-6 py-5 spatial-glass-elevated !rounded-l-3xl border-r-0">
                        <div className="flex flex-col gap-1.5">
                          <span className="text-sm font-medium text-[var(--text-primary)] tracking-tight">
                            {g.tarih ? format(parseISO(g.tarih), 'dd MMMM yyyy', { locale: tr }) : '-'}
                          </span>
                          <div className="flex items-center gap-2">
                            <div className="w-1 h-1 rounded-full bg-[var(--dynamic-aura,var(--aura-indigo))] shadow-[0_0_8px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_60%,transparent)]" />
                            <span className="authority-title !text-2xs opacity-40 uppercase tracking-wide">
                              {g.tarih ? format(parseISO(g.tarih), 'EEEE', { locale: tr }) : ''} • {toTurkishUpperCase(g.vakit)} VAKTİ
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-5 spatial-glass-elevated border-x-0">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-[14px] bg-[var(--text-primary)]/[0.03] border border-[var(--text-primary)]/5 flex items-center justify-center text-[var(--dynamic-aura,var(--aura-indigo))] font-light text-lg shadow-lg">
                            {getMuezzinName(g.uid).charAt(0)}
                          </div>
                          <span className="text-sm font-light text-[var(--text-primary)] tracking-tight">{getMuezzinName(g.uid)}</span>
                        </div>
                      </td>
                      <td className="px-6 py-5 spatial-glass-elevated !rounded-r-3xl border-l-0">
                        <div className="flex items-center justify-between gap-4 w-full">
                          <div className="bg-[var(--dynamic-aura,var(--aura-indigo))]/10 border border-[var(--dynamic-aura,var(--aura-indigo))]/20 px-5 py-2.5 rounded-xl inline-flex items-center gap-3 shadow-sm group-hover:bg-[var(--dynamic-aura,var(--aura-indigo))]/15 transition-all duration-500">
                            <div className="w-1 h-1 rounded-full bg-[var(--dynamic-aura,var(--aura-indigo))]" />
                            <span className="text-2xs font-medium text-[var(--dynamic-aura,var(--aura-indigo))] uppercase tracking-wide leading-none">
                              {g.retSebebi || 'SEBEP BELİRTİLMEDİ'}
                            </span>
                          </div>
                          <motion.button
                            type="button"
                            whileHover={{ scale: 1.1, backgroundColor: 'rgba(244,63,94,0.1)' }}
                            whileTap={{ scale: 0.9 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDelete({ open: true, id: g.id });
                            }}
                            disabled={deletingId === g.id}
                            aria-label="Kaydı sil"
                            className="p-2.5 rounded-xl text-rose-500/40 hover:text-rose-500 border border-transparent hover:border-rose-500/20 transition-all flex items-center justify-center shrink-0 disabled:opacity-20 disabled:cursor-not-allowed"
                          >
                            <Trash2 size={14} />
                          </motion.button>
                        </div>
                      </td>
                    </motion.tr>
                  ))
                )}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        {/* MOBILE ARCHIVE CARDS (Fallback) */}
        <div className="md:hidden flex flex-col gap-4 mt-6">
          {filtered.length === 0 ? (
            <div className="spatial-glass p-10 text-center rounded-card border border-dashed border-[var(--text-primary)]/5">
              <p className="authority-title !text-2xs opacity-35 uppercase tracking-wide font-bold italic">Arşivde kayıt bulunmuyor</p>
            </div>
          ) : (
            filtered.map((g, idx) => (
              <motion.div
                key={g.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="spatial-glass-elevated p-4 space-y-3 !rounded-[20px] sm:!rounded-3xl border border-[var(--text-primary)]/5"
              >
                <div className="flex justify-between items-start">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-sm font-medium text-[var(--text-primary)]">
                      {g.tarih ? format(parseISO(g.tarih), 'dd MMM yyyy', { locale: tr }) : '-'}
                    </h3>
                    <p className="authority-title !text-2xs text-[var(--dynamic-aura,var(--aura-indigo))] font-bold uppercase tracking-wide">
                      {g.vakit} VAKTİ
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xs font-bold text-[var(--text-primary)]">{getMuezzinName(g.uid)}</p>
                    <p className="authority-title !text-2xs opacity-30 uppercase tracking-wide mt-1">OPERASYONEL PERSONEL</p>
                  </div>
                </div>
                <div className="p-4 bg-[var(--text-primary)]/[0.02] rounded-2xl border border-[var(--text-primary)]/5 relative overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--dynamic-aura,var(--aura-indigo))]/40" />
                  <div className="flex justify-between items-start mb-2">
                    <p className="authority-title !text-2xs opacity-20 uppercase tracking-wide">MAZERET GEREKÇESİ</p>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete({ open: true, id: g.id })}
                      disabled={deletingId === g.id}
                      aria-label="Kaydı sil"
                      className="text-rose-500/40 hover:text-rose-500 transition-colors p-1 disabled:opacity-20"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <p className="text-2xs font-light text-[var(--text-primary)]/80 leading-relaxed italic">
                    "{g.retSebebi || 'Sebep belirtilmedi.'}"
                  </p>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </section>

      <ConfirmModal
        isOpen={confirmDelete.open}
        onClose={() => setConfirmDelete({ open: false, id: null })}
        onConfirm={executeDelete}
        title="Mazeret Kaydını Sil"
        message="Seçilen mazeret kaydı arşivden tamamen kaldırılacaktır. Bu işlem geri alınamaz."
        isDanger={true}
        confirmText="EVET, ARŞİVDEN SİL"
      />
    </div>
  );
}
