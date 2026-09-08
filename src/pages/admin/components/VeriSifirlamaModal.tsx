import React, { useEffect, useState } from 'react';
import { useChangeKey } from '../../../hooks/useChangeKey';
import { Modal } from '../../../components/ui/Modal';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import {
  SIFIRLANABILIR_KOLEKSIYONLAR,
  SifirlanabilirKoleksiyonAnahtari,
  koleksiyonBelgeSayilariniGetir,
  operasyonelVeriyiSifirla,
} from '../../../services/veriSifirlamaServisi';
import { useAuthStore } from '../../../store/useAuthStore';
import { useNotificationStore } from '../../../store/useNotificationStore';
import { playSuccess, playWarning } from '../../../lib/sounds';
import { SUPER_ADMIN_GEREKLI_IPUCU } from '../../../lib/rolMetinleri';

// Tek tıkla onaydan (ConfirmModal) KASITLI olarak daha ağır bir sürtünme —
// bu işlem geri alınamaz ve düzinelerce belgeyi kalıcı olarak siler. Admin
// tam metni elle yazmadan buton hiç aktif olmaz (bkz. mimari tasarım
// notu — "reset all data" özelliği tartışması).
const ONAY_METNI = 'OPERASYONEL VERİYİ SIFIRLA';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function VeriSifirlamaModal({ isOpen, onClose }: Props) {
  const user = useAuthStore((s) => s.user);
  // Süper-admin kapısı SistemAyarlari.tsx'teki tetikleyici düğmede de var;
  // burada TEKRAR edilir çünkü modal ileride başka bir yerden de
  // açılabilir ve bu işlem geri alınamaz (bkz. premium denetim P1.6).
  // Gerçek sınır yine sunucudadır — firestore.rules `isSuperAdmin()`
  // yalnızca error_logs/telemetry_logs için daraltıldı, diğer
  // koleksiyonlar admin iş akışlarını kırmamak adına isAdmin()'de kaldı.
  const isSuperAdmin = useAuthStore((s) => s.isSuperAdmin);
  const showNotification = useNotificationStore((s) => s.showNotification);

  const [sayilar, setSayilar] = useState<Record<SifirlanabilirKoleksiyonAnahtari, number> | null>(null);
  const [sayilarYukleniyor, setSayilarYukleniyor] = useState(false);
  const [secili, setSecili] = useState<Set<SifirlanabilirKoleksiyonAnahtari>>(
    () => new Set(SIFIRLANABILIR_KOLEKSIYONLAR.filter((k) => k.varsayilanSecili).map((k) => k.anahtar))
  );
  const [sayaclariDaSifirla, setSayaclariDaSifirla] = useState(true);
  const [onayMetni, setOnayMetni] = useState('');
  const [calisiyor, setCalisiyor] = useState(false);
  const [ilerlemeMesaji, setIlerlemeMesaji] = useState('');

  // Modal her açıldığında onay metni/sayaç yükleniyor durumu render sırasında
  // sıfırlanır (bkz. useChangeKey, CLAUDE.md "render sırasında state
  // senkronu" deseni) — ASIL taze veri çekimi (gerçek bir dış sistem
  // çağrısı) ayrı, aşağıdaki useEffect'te kalır.
  if (useChangeKey(isOpen) && isOpen) {
    setOnayMetni('');
    setSayilarYukleniyor(true);
  }

  // fetchSayilar: hem modal ilk açıldığında hem de başarısız/yarım kalan bir
  // sıfırlama sonrası TEKRAR çağrılır — aksi halde ekranda işlem öncesinin
  // (artık kısmen silinmiş, bayat) belge sayıları asılı kalırdı (bkz. premium
  // standart denetimi). "Yükleniyor" bayrağını KENDİSİ ayarlamaz — ilk açılış
  // için bunu zaten yukarıdaki render-sırası useChangeKey bloğu yapıyor;
  // yeniden deneme çağrıları (handleSifirla'nın catch bloğu) kendi
  // setSayilarYukleniyor(true) çağrısını yapar. Böylece effect içinde eşzamanlı
  // setState tetiklenmez (react-hooks/set-state-in-effect).
  const fetchSayilar = () => {
    koleksiyonBelgeSayilariniGetir()
      .then(setSayilar)
      .catch(() => setSayilar(null))
      .finally(() => setSayilarYukleniyor(false));
  };

  useEffect(() => {
    if (!isOpen) return;
    fetchSayilar();
  }, [isOpen]);

  const toggleSecim = (anahtar: SifirlanabilirKoleksiyonAnahtari) => {
    setSecili((prev) => {
      const next = new Set(prev);
      if (next.has(anahtar)) next.delete(anahtar);
      else next.add(anahtar);
      return next;
    });
  };

  const secilenSayilarToplami = sayilar ? Array.from(secili).reduce((acc, k) => acc + (sayilar[k] || 0), 0) : null;

  // Kadro sayaçları (aylikVakitSayisi vb.) yalnızca bildirimler/izinler
  // silindiğinde anlamlı bir "sıfırla" seçeneği — bkz. veriSifirlamaServisi.ts
  // `kadroSayaclariniSifirla` yorumu.
  const sayaclarIlgiliMi = secili.has('bildirimler') || secili.has('izinler');

  const handleSifirla = async () => {
    if (!user || !isSuperAdmin) return;
    setCalisiyor(true);
    setIlerlemeMesaji('Başlatılıyor...');
    try {
      const adminAdi = user.displayName || user.email || 'Bilinmeyen Admin';
      const islemSonucu = await operasyonelVeriyiSifirla(Array.from(secili), sayaclariDaSifirla && sayaclarIlgiliMi, adminAdi, (mesaj) =>
        setIlerlemeMesaji(mesaj)
      );
      showNotification('Sıfırlama Tamamlandı', `${islemSonucu.toplamSilinenBelge} belge kalıcı olarak silindi.`, 'success');
      playSuccess();
      onClose();
    } catch (err) {
      showNotification(
        'Sıfırlama Başarısız/Yarım Kaldı',
        err instanceof Error ? err.message : 'İşlem sırasında bir hata oluştu — o ana kadar silinenler kalıcıdır, denetim kaydına bakın.',
        'error'
      );
      playWarning();
      // Kısmi sıfırlama bazı koleksiyonları gerçekten boşaltmış olabilir —
      // modal kapanmadığı için ekranda işlem-öncesi (artık bayat) sayılar
      // kalmasın diye tazelenir.
      setSayilarYukleniyor(true);
      fetchSayilar();
    } finally {
      setCalisiyor(false);
      setIlerlemeMesaji('');
    }
  };

  const onayHazir = isSuperAdmin && onayMetni.trim() === ONAY_METNI && secili.size > 0 && !calisiyor;

  return (
    <Modal isOpen={isOpen} onClose={calisiyor ? () => {} : onClose} title="Operasyonel Veriyi Sıfırla">
      <div className="space-y-8 py-2">
        <div className="spatial-glass-elevated p-5 rounded-card border border-rose-500/20 bg-rose-500/[0.03] flex items-start gap-4">
          <AlertTriangle className="text-rose-500 shrink-0 mt-0.5" size={22} strokeWidth={1.5} />
          <div className="text-xs text-[var(--text-secondary)] leading-relaxed space-y-1">
            <p className="font-semibold text-rose-400">Bu işlem GERİ ALINAMAZ.</p>
            <p>
              Seçtiğiniz koleksiyonlardaki TÜM belgeler kalıcı olarak silinir. Ekranı açık olan tüm kullanıcılar bunu ANINDA görür (bekleyen
              görevler/planlar boşalır).
            </p>
            <p className="opacity-70">Mazeret geçmişi ve denetim kayıtları bu işlemden etkilenmez — kalıcı olarak korunur.</p>
            {!isSuperAdmin && <p className="font-semibold text-amber-400 pt-1">{SUPER_ADMIN_GEREKLI_IPUCU}</p>}
          </div>
        </div>

        <div className="space-y-3">
          <p className="authority-title !text-2xs opacity-50 tracking-wide">SİLİNECEK KOLEKSİYONLAR</p>
          {SIFIRLANABILIR_KOLEKSIYONLAR.map((k) => (
            <label
              key={k.anahtar}
              className={`flex items-center justify-between gap-4 p-4 rounded-2xl border cursor-pointer transition-all ${
                secili.has(k.anahtar)
                  ? 'bg-rose-500/[0.04] border-rose-500/25'
                  : 'bg-[var(--text-primary)]/[0.02] border-[var(--glass-border)]'
              } ${calisiyor ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <div className="flex items-center gap-4 min-w-0">
                <input
                  type="checkbox"
                  checked={secili.has(k.anahtar)}
                  onChange={() => toggleSecim(k.anahtar)}
                  disabled={calisiyor}
                  className="w-5 h-5 accent-rose-500 shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">{k.etiket}</p>
                  <p className="text-2xs text-[var(--text-secondary)]/60 truncate">{k.aciklama}</p>
                </div>
              </div>
              <span className="text-2xs font-bold tabular-nums text-[var(--text-secondary)]/70 shrink-0">
                {sayilarYukleniyor ? '…' : sayilar ? `${sayilar[k.anahtar] ?? 0} belge` : '—'}
              </span>
            </label>
          ))}
        </div>

        {sayaclarIlgiliMi && (
          <label
            aria-label="Kadro sayaçlarını da sıfırla"
            className={`flex items-center gap-4 p-4 rounded-2xl border border-[var(--glass-border)] bg-[var(--text-primary)]/[0.02] cursor-pointer ${calisiyor ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <input
              type="checkbox"
              checked={sayaclariDaSifirla}
              onChange={(e) => setSayaclariDaSifirla(e.target.checked)}
              disabled={calisiyor}
              className="w-5 h-5 accent-rose-500 shrink-0"
            />
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Kadro sayaçlarını da sıfırla</p>
              <p className="text-2xs text-[var(--text-secondary)]/60">
                Aylık görev yükü ve yıllık izin kotası bu verilerden türetilir; sıfırlanmazsa kaynaksız (hayalet) değer olarak kalır.
              </p>
            </div>
          </label>
        )}

        {secilenSayilarToplami !== null && secili.size > 0 && (
          <p className="text-xs text-rose-400 font-semibold text-center">Toplam {secilenSayilarToplami} belge kalıcı olarak silinecek.</p>
        )}

        <div className="space-y-3">
          <label htmlFor="onay-metni" className="authority-title !text-2xs opacity-50 tracking-wide block">
            Onaylamak için aşağıya tam olarak yazın: <span className="text-rose-400">{ONAY_METNI}</span>
          </label>
          <input
            id="onay-metni"
            type="text"
            value={onayMetni}
            onChange={(e) => setOnayMetni(e.target.value)}
            disabled={calisiyor}
            aria-invalid={onayMetni.length > 0 && onayMetni.trim() !== ONAY_METNI}
            aria-describedby={onayMetni.length > 0 && onayMetni.trim() !== ONAY_METNI ? 'onay-metni-error' : undefined}
            className="w-full bg-[var(--surface-medium)] border border-rose-500/20 rounded-[14px] px-4 py-3.5 text-[var(--text-primary)] text-sm font-medium focus:border-rose-500/50 outline-none transition-colors"
            placeholder={ONAY_METNI}
            autoComplete="off"
          />
          {onayMetni.length > 0 && onayMetni.trim() !== ONAY_METNI && (
            <p id="onay-metni-error" role="alert" className="text-2xs text-rose-400 font-medium leading-relaxed">
              Girdiğiniz metin eşleşmiyor.
            </p>
          )}
        </div>

        {calisiyor && (
          <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
            <div className="w-4 h-4 border-2 border-rose-500/30 border-t-rose-500 rounded-full animate-spin shrink-0" />
            <span>{ilerlemeMesaji}</span>
          </div>
        )}

        <div className="flex items-center gap-4 pt-2">
          <motion.button
            whileHover={onayHazir ? { scale: 1.02 } : undefined}
            whileTap={onayHazir ? { scale: 0.98 } : undefined}
            type="button"
            disabled={!onayHazir}
            onClick={handleSifirla}
            className="flex-1 bg-rose-600 disabled:bg-[var(--text-primary)]/10 text-white disabled:text-muted text-2xs font-bold uppercase tracking-wide py-4 rounded-2xl transition-all flex items-center justify-center gap-3 disabled:cursor-not-allowed"
          >
            <Trash2 size={16} />
            {calisiyor ? 'SİLİNİYOR...' : 'KALICI OLARAK SİL'}
          </motion.button>
          <button
            type="button"
            onClick={onClose}
            disabled={calisiyor}
            className="px-8 py-4 text-2xs font-bold uppercase tracking-wide text-[var(--text-secondary)] opacity-50 hover:opacity-100 transition-all border border-[var(--text-primary)]/5 rounded-2xl disabled:opacity-20"
          >
            VAZGEÇ
          </button>
        </div>
      </div>
    </Modal>
  );
}
