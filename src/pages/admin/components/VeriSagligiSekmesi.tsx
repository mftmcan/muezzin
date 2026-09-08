import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { HeartPulse, CheckCircle2, AlertOctagon, RefreshCw, ShieldCheck, Terminal } from 'lucide-react';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { EmptyState } from '../../../components/ui/EmptyState';
import { veriSagligiTara, veriHatalariniOnar, type AuditError } from '../../../services/veriOnarimServisi';

export const VeriSagligiSekmesi = React.memo(() => {
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [errors, setErrors] = useState<AuditError[]>([]);
  const [stats, setStats] = useState({ totalPersonnel: 0, totalVacations: 0, totalPlans: 0 });
  const [repairLogs, setRepairLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [confirmRepairOpen, setConfirmRepairOpen] = useState(false);

  const runAudit = async () => {
    setLoading(true);
    setAuditError(null);
    setRepairLogs([]);

    const sonuc = await veriSagligiTara();
    setStats(sonuc.stats);
    setErrors(sonuc.errors);
    setAuditError(sonuc.auditError);
    setLoading(false);
  };

  const executeAutoRepair = async () => {
    if (errors.length === 0) return;
    setConfirmRepairOpen(false);

    setRepairing(true);
    setShowLogs(true);
    const logs: string[] = [];

    const logMessage = (msg: string) => {
      const time = new Date().toLocaleTimeString('tr-TR');
      logs.push(`[${time}] ${msg}`);
      setRepairLogs([...logs]);
    };

    try {
      await veriHatalariniOnar(errors, logMessage);
      // Refresh audit list
      setTimeout(() => {
        runAudit();
      }, 1000);
    } catch (err) {
      logMessage(`ONARIM HATASI: ${err instanceof Error ? err.message : err}`);
    } finally {
      setRepairing(false);
    }
  };

  useEffect(() => {
    runAudit();
  }, []);

  return (
    <div className="space-y-8">
      {/* Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-6">
        <div className="spatial-glass border border-[var(--glass-border)] p-4 rounded-card">
          <span className="premium-label !text-2xs !opacity-30 block mb-1">SAĞLIK DURUMU</span>
          <div className="flex items-center gap-2">
            {errors.length === 0 ? (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)] animate-pulse" />
                <span className="text-xs sm:text-sm font-semibold text-emerald-400">Kararlı</span>
              </>
            ) : (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)] animate-pulse" />
                <span className="text-xs sm:text-sm font-semibold text-rose-400">{errors.length} Hata</span>
              </>
            )}
          </div>
        </div>

        <div className="spatial-glass border border-[var(--glass-border)] p-4 rounded-card">
          <span className="premium-label !text-2xs !opacity-30 block mb-1">MÜEZZİN KADROSU</span>
          <span className="text-sm sm:text-xl font-light text-[var(--text-primary)]">{stats.totalPersonnel} Aktif</span>
        </div>

        <div className="spatial-glass border border-[var(--glass-border)] p-4 rounded-card">
          <span className="premium-label !text-2xs !opacity-30 block mb-1">ONAYLI İZİNLER</span>
          <span className="text-sm sm:text-xl font-light text-[var(--text-primary)]">{stats.totalVacations} Kayıt</span>
        </div>

        <div className="spatial-glass border border-[var(--glass-border)] p-4 rounded-card">
          <span className="premium-label !text-2xs !opacity-30 block mb-1">PLANLAMA ARŞİVİ</span>
          <span className="text-sm sm:text-xl font-light text-[var(--text-primary)]">{stats.totalPlans} Plan</span>
        </div>
      </div>

      {/* Main Audit Control Screen */}
      <div className="spatial-glass border border-[var(--glass-border)] p-4 sm:p-8 rounded-card relative overflow-hidden bg-[var(--text-primary)]/[0.005]">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[var(--dynamic-aura,var(--aura-indigo))]/5 blur-3xl rounded-full" />

        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8">
          <div>
            <h4 className="text-base font-medium text-[var(--text-primary)] flex items-center gap-2">
              <HeartPulse size={18} className="text-[var(--dynamic-aura,var(--aura-indigo))]" />
              Veritabanı Uyuşmazlık Tarayıcısı
            </h4>
            <p className="premium-label !text-2xs !opacity-30 mt-1 uppercase tracking-wider">
              VERİ BÜTÜNLÜĞÜ, YETİM KAYITLAR VE OTOMATİK DÜZELTME
            </p>
          </div>

          <div className="flex items-center gap-3">
            <motion.button
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={runAudit}
              disabled={loading || repairing}
              className="px-4 py-2.5 bg-[var(--text-primary)]/5 border border-[var(--glass-border)] text-[var(--text-primary)]/80 hover:bg-[var(--text-primary)]/10 rounded-xl text-2xs font-bold uppercase tracking-wide shadow-lg disabled:opacity-30 flex items-center gap-2"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> YENİDEN TARA
            </motion.button>

            <motion.button
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setConfirmRepairOpen(true)}
              // auditError doluyken errors[] yalnızca bilgilendirici "okunamadı"
              // girdileri taşır (repairData'sız) — servis bu durumda zaten hiçbir
              // onarım üretmiyor (premium hata analizi HS-K1), ama düğme yine de
              // yanıltıcı biçimde etkin görünüp sahte bir "başarı" günlüğü
              // üretebiliyordu; burada da devre dışı bırakılır (savunma katmanı).
              disabled={errors.length === 0 || repairing || loading || !!auditError}
              className="px-5 py-2.5 bg-[var(--dynamic-aura,var(--aura-indigo))] hover:opacity-90 text-[var(--app-bg)] border border-[var(--dynamic-aura,var(--aura-indigo))]/60 rounded-xl text-2xs font-bold uppercase tracking-wide shadow-[0_10px_20px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_20%,transparent)] disabled:opacity-30 disabled:pointer-events-none flex items-center gap-2"
            >
              <ShieldCheck size={12} /> OTOMATİK ONAR
            </motion.button>
          </div>
        </div>

        {/* List of Detected Issues */}
        <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
          {loading ? (
            <div className="py-16 text-center text-xs text-muted tracking-wider">Veritabanı taranıyor, lütfen bekleyin...</div>
          ) : auditError ? (
            <div className="p-10 text-center border border-dashed border-rose-500/20 rounded-card bg-rose-500/[0.01] space-y-4">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/10 text-rose-500 flex items-center justify-center mx-auto border border-rose-500/20">
                <AlertOctagon size={18} />
              </div>
              <h5 className="text-xs font-semibold text-rose-400">Veri Tarama Hatası Oluştu</h5>
              <pre className="text-2xs font-mono bg-black/40 p-4 rounded-xl text-rose-300 max-h-24 overflow-y-auto border border-rose-500/10 max-w-lg mx-auto text-left leading-relaxed">
                {auditError}
              </pre>
              <p className="text-2xs text-muted leading-relaxed max-w-sm mx-auto">
                Bu hata genellikle yetki sınırlarından (Missing or insufficient permissions) veya internet bağlantı uyuşmazlıklarından
                kaynaklanır. Firebase Firestore kurallarında bu koleksiyonları listeleme izniniz olduğundan emin olun.
              </p>
            </div>
          ) : errors.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={36} strokeWidth={1.2} />}
              title="Veritabanı Tamamen Sağlıklı!"
              description="PERSONELLER, İZİNLER VE NÖBET PLANLARI ARASINDA HİÇBİR UYUMSUZLUK VEYA YETİM KAYIT BULUNAMADI."
              tone="emerald"
              size="md"
            />
          ) : (
            errors.map((err) => (
              <div
                key={err.id}
                className={`p-5 rounded-2xl border flex items-start gap-4 transition-colors ${
                  err.severity === 'critical'
                    ? 'bg-rose-500/[0.02] border-rose-500/10 hover:bg-rose-500/[0.04]'
                    : 'bg-amber-500/[0.02] border-amber-500/10 hover:bg-amber-500/[0.04]'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 border ${
                    err.severity === 'critical'
                      ? 'bg-rose-500/10 text-rose-500 border-rose-500/20'
                      : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                  }`}
                >
                  <AlertOctagon size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`text-2xs font-bold tracking-wider px-2 py-0.5 rounded-md uppercase ${
                        err.severity === 'critical' ? 'bg-rose-500/10 text-rose-400' : 'bg-amber-500/10 text-amber-400'
                      }`}
                    >
                      {err.severity === 'critical' ? 'Kritik Hata' : 'Uyarı'}
                    </span>
                    <span className="text-2xs font-bold text-muted tracking-wide uppercase">Kategori: {err.category}</span>
                  </div>
                  <h5 className="text-xs font-medium text-[var(--text-primary)] mt-1.5 leading-tight">{err.message}</h5>
                  <p className="text-2xs text-[var(--text-secondary)]/60 mt-1 font-sans font-light leading-relaxed">{err.details}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Terminal Log Console */}
      <AnimatePresence>
        {showLogs && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="spatial-glass border border-[var(--glass-border)] p-6 rounded-card bg-black/40 overflow-hidden"
          >
            <div className="flex justify-between items-center mb-4">
              <span className="text-2xs font-bold text-[var(--dynamic-aura,var(--aura-indigo))] tracking-wide flex items-center gap-2 uppercase">
                <Terminal size={12} /> Onarım Konsol Çıktısı (Live logs)
              </span>
              <button
                onClick={() => setShowLogs(false)}
                className="text-2xs text-muted hover:text-[var(--text-primary)] transition-colors uppercase tracking-wide font-bold"
              >
                GİZLE
              </button>
            </div>
            <pre className="text-2xs font-mono text-emerald-400/90 leading-relaxed overflow-x-auto max-h-48 p-4 rounded-xl bg-black/60 border border-[var(--text-primary)]/5 space-y-1">
              {repairLogs.length === 0 ? (
                <span className="text-[var(--text-secondary)] italic">Onarım başlatılması bekleniyor...</span>
              ) : (
                repairLogs.map((log, idx) => <div key={idx}>{log}</div>)
              )}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmModal
        isOpen={confirmRepairOpen}
        onClose={() => setConfirmRepairOpen(false)}
        onConfirm={executeAutoRepair}
        title="Verileri Otomatik Onar"
        message={`Toplam ${errors.length} adet veri uyuşmazlığı tespit edildi. Otomatik onarım işlemine devam etmek istiyor musunuz?`}
        isDanger={false}
        confirmText="ONARIMI BAŞLAT"
      />
    </div>
  );
});
