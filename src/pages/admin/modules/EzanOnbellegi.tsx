import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { AlertCircle, CheckCircle2, DatabaseZap, Info, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { useSystemSettingsStore } from '../../../store/useSystemSettingsStore';
import { LoadingState } from '../../../components/ui/LoadingState';
import { EmptyState } from '../../../components/ui/EmptyState';
import { listeleVakitCacheleri, senkronizeGuncelVeGelecekAyCache, VakitCacheKaydi } from '../../../services/vakitCacheServisi';
import { toJsDate, toTurkishUpperCase } from '../../../lib/dateUtils';
import { telemetryService } from '../../../services/telemetryService';

type UiMessage = { type: 'success' | 'error'; text: string } | null;

function formatCacheDate(value: unknown) {
  const date = toJsDate(value);
  if (!date) return 'Dizge kaydı yok';
  return format(date, 'dd MMMM yyyy - HH:mm', { locale: tr });
}

export default function EzanOnbellegi() {
  const { settings } = useSystemSettingsStore();
  const [onbellekler, setOnbellekler] = useState<VakitCacheKaydi[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [uiMessage, setUiMessage] = useState<UiMessage>(null);

  const refreshList = async () => {
    const data = await listeleVakitCacheleri(settings.ilceId);
    setOnbellekler(data);
  };

  useEffect(() => {
    let mounted = true;
    const timeoutId = setTimeout(() => {
      if (mounted) {
        setLoading(false);
        setUiMessage({ type: 'error', text: 'Sunucu yanıt vermedi.' });
      }
    }, 15000);

    const fetchVakitler = async () => {
      try {
        // Yalnızca aktif ilçenin kayıtları listelenir — aksi halde ilçe kodu
        // daha önce değiştirilmişse eski ilçenin kalıcı olarak biriken önbellek
        // kayıtları da bu listede görünür (bkz. mimari denetim).
        const data = await listeleVakitCacheleri(settings.ilceId);
        if (mounted) {
          setOnbellekler(data);
          setLoading(false);
          // 15sn timeout zaten ateşlenip 'Sunucu yanıt vermedi.' hatasını
          // set etmiş olabilir — istek bundan kısa süre sonra yine de
          // başarıyla tamamlanırsa bu eski mesaj temizlenmezse tablo doğru
          // veriyle dolu görünürken ekranda hâlâ hata bandı asılı kalırdı
          // (bkz. mimari denetim).
          setUiMessage(null);
          clearTimeout(timeoutId);
        }
      } catch {
        if (mounted) {
          setLoading(false);
          setUiMessage({ type: 'error', text: 'Veritabanı kayıtları okunamadı.' });
          clearTimeout(timeoutId);
        }
      }
    };

    fetchVakitler();
    return () => {
      mounted = false;
      clearTimeout(timeoutId);
    };
  }, [settings.ilceId]);

  const handleSenkronizeEt = async () => {
    setSyncing(true);
    setUiMessage(null);
    try {
      const results = await senkronizeGuncelVeGelecekAyCache(settings);
      await refreshList();
      setUiMessage({
        type: 'success',
        text: `${results.length} aylık vakit önbelleği güncellendi.`,
      });
      // Otomatik senkronizasyon (SistemAyarlari.tsx ilçe kodu değişiminde)
      // audit_logs'a yazarken bu manuel tetikleme hiç yazmıyordu — kimin ne
      // zaman manuel senkron başlattığı iz bırakmıyordu (bkz. mimari denetim).
      await telemetryService.logAudit(
        'Ezan Vakti Manuel Senkronizasyon',
        settings.ilceAdi || settings.ilceId,
        `${results.length} aylık vakit önbelleği manuel olarak güncellendi.`
      );
    } catch (error) {
      console.error('Ezan vakti senkronizasyon hatası:', error);
      setUiMessage({ type: 'error', text: 'Vakit servislerine erişilemedi. Daha sonra tekrar deneyin.' });
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return <LoadingState label="Önbellek kayıtları okunuyor" />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        {/* font-light: diğer tüm admin modül başlıkları (Kadro Yönetimi, Nöbet
        Uyarıları, Hizmet Cetveli, Duyuru Panosu, Mazeret Arşivi, İzin ve
        Mazeret Masası...) tutarlı olarak font-light kullanıyor — burada tek
        istisna olan font-semibold buna hizalandı (bkz. premium standart
        denetimi). Sabit/koşulsuz "Servis hazır" rozeti de kaldırıldı: gerçek
        durumu hiç yansıtmıyordu, aşağıdaki hata banner'ıyla (uiMessage) aynı
        anda görünüp kendi kendini yalanlayabiliyordu. */}
        <h2 className="text-xl font-light tracking-tight text-[var(--text-primary)]">Ezan Önbelleği</h2>
        <p className="authority-title !text-2xs opacity-45 font-medium tracking-wide uppercase">
          Diyanet öncelikli, Aladhan yedekli vakit verisi
        </p>
      </div>

      <AnimatePresence mode="wait">
        {uiMessage && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className={`p-4 rounded-2xl flex items-center gap-3 border ${
              uiMessage.type === 'success'
                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                : 'border-rose-500/20 bg-rose-500/10 text-rose-300'
            }`}
          >
            {uiMessage.type === 'success' ? <CheckCircle2 size={20} strokeWidth={1.7} /> : <AlertCircle size={20} strokeWidth={1.7} />}
            <p className="text-xs font-semibold tracking-wide">{uiMessage.text}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* spatial-glass — bu kart önceden elle yazılmış "border-none sm:border
       ... bg-transparent" deseni kullanıyordu (Loglar sekmesindeki TÜM
       kartların aksine), mobilde tamamen çerçevesiz/şeffaf görünüyordu
       (bkz. kod denetimi bulgusu, premium standart). */}
      <section className="spatial-glass !rounded-card p-1 sm:p-8 relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5 mb-6">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-[14px] bg-[var(--surface-medium)] text-[var(--dynamic-aura,var(--aura-indigo))] flex items-center justify-center border border-[var(--glass-border)]">
              <DatabaseZap className="w-5 h-5" strokeWidth={1.7} />
            </div>
            <div>
              <h3 className="text-lg font-light text-[var(--text-primary)] tracking-tight leading-tight">Senkronizasyon Merkezi</h3>
              <p className="text-xs text-[var(--text-secondary)]/80">
                {settings.ilceAdi} için mevcut ay ve gelecek ay cache kaydı hazırlanır.
              </p>
            </div>
          </div>

          <motion.button
            whileHover={{ y: -2, scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleSenkronizeEt}
            disabled={syncing}
            className="w-full sm:w-auto px-6 py-3.5 bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] rounded-[14px] uppercase tracking-wide text-2xs flex items-center justify-center gap-3 transition-all font-bold shadow-[var(--spatial-shadow)] cursor-pointer disabled:opacity-60"
          >
            <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
            <span>{syncing ? 'Senkronize ediliyor' : 'Verileri senkronize et'}</span>
          </motion.button>
        </div>

        <div className="hidden md:block rounded-[18px] overflow-hidden border border-[var(--glass-border)] bg-[var(--surface-medium)]">
          <table className="w-full text-left">
            <thead>
              <tr className="authority-title !text-2xs opacity-55 uppercase tracking-wide border-b border-[var(--glass-border)]">
                <th className="px-6 py-4 font-bold">Zaman Referansı</th>
                <th className="px-6 py-4 font-bold">Sağlayıcı</th>
                <th className="px-6 py-4 font-bold">Son Güncelleme</th>
                <th className="px-6 py-4 font-bold text-right">Durum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--glass-border)]">
              {onbellekler.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-8">
                    <EmptyState
                      icon={<DatabaseZap size={36} strokeWidth={1.2} />}
                      title="Kayıtlı Önbellek Yok"
                      description="BU İLÇE İÇİN HENÜZ BİR VAKİT ÖNBELLEĞİ OLUŞTURULMADI — YUKARIDAKİ BUTONLA SENKRONİZE EDEBİLİRSİNİZ."
                      tone="neutral"
                      size="md"
                    />
                  </td>
                </tr>
              ) : (
                onbellekler.map((o, idx) => (
                  <motion.tr
                    key={o.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="hover:bg-[var(--surface-high)] transition-colors"
                  >
                    <td className="px-6 py-4">
                      <span className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">{o.id.toUpperCase()}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-3 py-1 rounded-lg bg-[var(--surface-low)] border border-[var(--glass-border)] text-2xs font-bold text-[var(--text-secondary)] uppercase">
                        {o.kaynakApi ? toTurkishUpperCase(o.kaynakApi) : 'OTONOM'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs font-medium text-[var(--text-secondary)]">{formatCacheDate(o.guncellenmeTarihi)}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2 text-emerald-400">
                        <span className="authority-title !text-2xs font-bold uppercase tracking-wide">Hazır</span>
                        <CheckCircle2 size={15} strokeWidth={1.8} />
                      </div>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="md:hidden flex flex-col gap-3">
          {onbellekler.length === 0 ? (
            <EmptyState
              icon={<DatabaseZap size={36} strokeWidth={1.2} />}
              title="Kayıtlı Önbellek Yok"
              description="BU İLÇE İÇİN HENÜZ BİR VAKİT ÖNBELLEĞİ OLUŞTURULMADI."
              tone="neutral"
              size="md"
            />
          ) : (
            onbellekler.map((o, idx) => (
              <motion.div
                key={o.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03 }}
                className="bg-[var(--surface-medium)] p-4 rounded-2xl space-y-3 border border-[var(--glass-border)]"
              >
                <div className="flex justify-between items-center gap-3">
                  <h4 className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">{o.id.toUpperCase()}</h4>
                  <span className="px-2.5 py-1 rounded-lg bg-[var(--surface-low)] border border-[var(--glass-border)] text-2xs font-bold text-[var(--text-secondary)] tracking-wide uppercase">
                    {o.kaynakApi ? toTurkishUpperCase(o.kaynakApi) : 'OTONOM'}
                  </span>
                </div>
                <div className="flex flex-col gap-1 text-xs">
                  <span className="authority-title !text-2xs opacity-45 uppercase tracking-wide">Son senkronizasyon</span>
                  <span className="text-xs font-medium text-[var(--text-secondary)]/90">{formatCacheDate(o.guncellenmeTarihi)}</span>
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-[var(--glass-border)] text-emerald-400">
                  <CheckCircle2 size={14} strokeWidth={1.8} />
                  <span className="authority-title !text-2xs font-bold uppercase tracking-wide">Hazır</span>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </section>

      <div className="p-4 sm:p-5 bg-[var(--surface-low)] rounded-2xl border border-[var(--glass-border)] flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-4">
        <div className="w-10 h-10 rounded-xl bg-[var(--surface-medium)] flex items-center justify-center text-[var(--text-secondary)] shrink-0">
          <Info className="w-5 h-5" strokeWidth={1.7} />
        </div>
        <div className="flex flex-col gap-1">
          <p className="authority-title !text-2xs font-bold text-[var(--text-primary)] tracking-wide uppercase opacity-70">
            Senkronizasyon protokolü
          </p>
          <p className="text-xs font-medium text-[var(--text-secondary)]/85 leading-relaxed max-w-3xl">
            Dizge önce Diyanet kaynağını kullanır; erişim sorunu olursa Aladhan yedek kaynağına geçer. Manuel işlem mevcut ve gelecek ay
            kayıtlarını birlikte günceller.
          </p>
        </div>
      </div>
    </div>
  );
}
