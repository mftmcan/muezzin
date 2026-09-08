import React, { useState } from 'react';
import { useChangeKey } from '../../../hooks/useChangeKey';
import { useSystemSettingsStore } from '../../../store/useSystemSettingsStore';
import { useThemeStore } from '../../../store/useThemeStore';
import { Save, MapPin, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { telemetryService } from '../../../services/telemetryService';
import { LoadingState } from '../../../components/ui/LoadingState';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { VeriSifirlamaModal } from '../components/VeriSifirlamaModal';
import { playSuccess, playWarning } from '../../../lib/sounds';
import { senkronizeGuncelVeGelecekAyCache } from '../../../services/vakitCacheServisi';
import { useAuthStore } from '../../../store/useAuthStore';
import { SUPER_ADMIN_GEREKLI_IPUCU } from '../../../lib/rolMetinleri';
import { sistemAyarlariFormSemasi } from '../../../lib/validation';

type StatusMessage = {
  type: 'success' | 'warning' | 'error';
  text: string;
} | null;

export default function SistemAyarlari() {
  const { settings, loading, updateSettings } = useSystemSettingsStore();
  const { theme } = useThemeStore();
  // Lazy init — settings.ilceId/ilceAdi'DAN türetilir, sabit '' DEĞİL. Admin
  // bu sekmeye ayarlar DAHA ÖNCEDEN (başka bir sekmede) yüklenmiş haldeyken
  // girerse, useChangeKey ilk render'da HER ZAMAN false döner (kendi
  // referans anahtarını o anki değerle tohumlar) — bu yüzden aşağıdaki
  // senkron bloğu hiç tetiklenmez ve form '' sabit değerinde TAKILI kalırdı
  // (manuel doğrulamada bulundu — bkz. premium standart denetimi). Lazy
  // init, mount anında ne varsa (yüklenmemişse defaultSettings, yüklenmişse
  // gerçek değer) doğru başlangıç durumunu garanti eder; sonraki gerçek
  // değişiklikleri hâlâ aşağıdaki useChangeKey bloğu yakalar.
  const [ilceId, setIlceId] = useState(() => settings.ilceId);
  const [ilceAdi, setIlceAdi] = useState(() => settings.ilceAdi);
  const [hicriDuzeltme, setHicriDuzeltme] = useState(() => settings.hicriDuzeltme ?? 0);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null);
  // İlçe kodu değişikliği, TÜM cemaatin ezan vakti kaynağını değiştiren
  // sistem geneli bir etkiye sahip — DuyuruYonetimi.tsx'in çok daha düşük
  // etkili silme işlemi için bile ConfirmModal kullanmasıyla karşılaştırılınca
  // buradaki tek-tıkla-kaydet tutarsızdı (bkz. mimari denetim, görsel/premium).
  const [pendingLocationChange, setPendingLocationChange] = useState<{
    ilceId: string;
    ilceAdi: string;
    hicriDuzeltme: number;
  } | null>(null);
  const [veriSifirlamaAcik, setVeriSifirlamaAcik] = useState(false);
  // Operasyonel veri sıfırlama TÜM ekibin bildirim/plan/izin geçmişini geri
  // alınamaz biçimde siler — bu, "admin panelini görebilen herkes" için
  // fazla geniş bir yetkiydi (bkz. premium denetim P1.6). Kart görünür kalır
  // (özelliğin varlığı sıradan admin'den saklanmaz) ama düğme yalnızca
  // config/bootstrap.superAdminEmails listesindeki baş yöneticiye açıktır;
  // sunucu tarafı karşılığı firestore.rules `isSuperAdmin()`.
  const isSuperAdmin = useAuthStore((s) => s.isSuperAdmin);

  // Uzak ayar dokümanı GERÇEKTEN değiştiğinde form alanlarını render
  // sırasında doldur (bkz. useChangeKey — proje standardı, aynı desen
  // VeriSifirlamaModal.tsx'te de kullanılıyor). Önceden `settings !== lastSettings`
  // OBJE REFERANSINI karşılaştırıyordu — ama useSystemSettingsStore'un
  // onSnapshot'ı HER tetiklenmede (değer aynı kalsa bile, ör. bu formun
  // kendi yazdığı updateSettings'in sunucu-onay yankısı) yeni bir obje
  // üretiyor. Bu da admin İlçe Tanımı gibi bir alana yazarken, arka planda
  // gelen ilgisiz bir echo snapshot'ının taslağı sessizce silmesine yol
  // açıyordu (bkz. kod denetimi bulgusu — useBugunkuGorevlerim.ts'teki AYNI
  // desen orada salt-okunur bir liste için kullanıldığından zararsızdı, bu
  // aktif düzenlenen forma yanlış uygulanmıştı). Anahtar artık türetilmiş
  // bir PRİMİTİF (obje referansı değil) — yalnızca gerçek bir alan değeri
  // değiştiğinde true döner.
  const settingsKey = `${settings.ilceId}|${settings.ilceAdi}|${settings.hicriDuzeltme ?? 0}`;
  if (useChangeKey(settingsKey)) {
    setIlceId(settings.ilceId);
    setIlceAdi(settings.ilceAdi);
    setHicriDuzeltme(settings.hicriDuzeltme ?? 0);
  }

  const performSave = async (cleanedIlceId: string, cleanedIlceAdi: string, normalizedHicriDuzeltme: number, locationChanged: boolean) => {
    setSaving(true);
    setStatusMessage(null);
    try {
      await updateSettings({
        ilceId: cleanedIlceId,
        ilceAdi: cleanedIlceAdi,
        hicriDuzeltme: normalizedHicriDuzeltme,
      });

      if (locationChanged) {
        try {
          await senkronizeGuncelVeGelecekAyCache({ ilceId: cleanedIlceId, ilceAdi: cleanedIlceAdi });
          setStatusMessage({ type: 'success', text: 'Ayarlar kaydedildi ve vakit önbelleği güncellendi.' });
          playSuccess();
        } catch (cacheError) {
          console.error('Vakit önbelleği senkronizasyon hatası:', cacheError);
          setStatusMessage({
            type: 'warning',
            text: 'Ayarlar kaydedildi; vakit önbelleği daha sonra Ezan Önbelleği ekranından yenilenmelidir.',
          });
          playWarning();
        }
      } else {
        setStatusMessage({ type: 'success', text: 'Dizge ayarları kaydedildi.' });
        playSuccess();
      }

      setTimeout(() => setStatusMessage(null), 5000);
      await telemetryService.logAudit(
        'Dizge Ayarı Güncelleme',
        'Vakit Bölgesi',
        `Diyanet İlçe Kodu: ${cleanedIlceId}, İlçe Adı: ${cleanedIlceAdi}, Hicri Düzeltme: ${normalizedHicriDuzeltme}`
      );
    } catch (error) {
      console.error('Ayar kaydetme hatası:', error);
      setStatusMessage({ type: 'error', text: 'Ayarlar kaydedilemedi. Yetki ve bağlantı durumunu kontrol edin.' });
      playWarning();
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    // firestore.rules isValidSystemSettings'in istemci tarafı aynası (bkz.
    // src/lib/validation) — dört ayrı manuel if-bloğu yerine tek bir şema
    // parse'ı, aynı Türkçe hata mesajlarını üretir.
    const sonuc = sistemAyarlariFormSemasi.safeParse({
      ilceId: ilceId.trim(),
      ilceAdi: ilceAdi.trim(),
      hicriDuzeltme: Number(hicriDuzeltme),
    });
    if (!sonuc.success) {
      setStatusMessage({ type: 'error', text: sonuc.error.issues[0].message });
      playWarning();
      return;
    }
    const { ilceId: cleanedIlceId, ilceAdi: cleanedIlceAdi, hicriDuzeltme: normalizedHicriDuzeltme } = sonuc.data;

    const locationChanged = cleanedIlceId !== settings.ilceId || cleanedIlceAdi !== settings.ilceAdi;
    if (locationChanged) {
      // Sistem geneli etki (TÜM cemaatin ezan vakti kaynağı değişiyor) —
      // doğrudan kaydetmek yerine önce onay istenir.
      setPendingLocationChange({ ilceId: cleanedIlceId, ilceAdi: cleanedIlceAdi, hicriDuzeltme: normalizedHicriDuzeltme });
      return;
    }

    await performSave(cleanedIlceId, cleanedIlceAdi, normalizedHicriDuzeltme, false);
  };

  if (loading) return <LoadingState label="Dizge ayarları okunuyor" />;

  return (
    <>
      {/* spatial-glass — bu kart önceden elle yazılmış "border-none sm:border
      ... bg-transparent" deseni kullanıyordu (Loglar sekmesindeki TÜM
      kartların aksine), mobilde tamamen çerçevesiz/şeffaf görünüyordu
      (bkz. kod denetimi bulgusu, premium standart). */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="spatial-glass !rounded-card p-1 sm:p-8 relative overflow-hidden"
      >
        <div className="flex items-center gap-3 sm:gap-5 mb-6 sm:mb-8 relative z-10">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-[14px] bg-[var(--surface-medium)] flex items-center justify-center border border-[var(--glass-border)]">
            <MapPin className="text-[var(--dynamic-aura,var(--aura-indigo))] w-5 h-5" strokeWidth={1.6} />
          </div>
          <div>
            {/* font-light: diğer tüm admin modül/bölüm başlıklarıyla (bkz. EzanOnbellegi.tsx,
      premium standart denetimi) tutarlı — font-semibold buradaki tek istisnaydı. */}
            <h3 className="text-lg sm:text-xl font-light text-[var(--text-primary)] tracking-tight leading-tight">Vakit Bölgesi</h3>
            <p className="authority-title !text-2xs opacity-45 uppercase tracking-wide">Diyanet ilçe kodu ve hicri tarih ayarı</p>
          </div>
        </div>

        {/* Şu an canlıda geçerli olan (form alanlarının aksine, henüz kaydedilmemiş
      taslak değişiklikleri değil) ayarların özeti — tek karttan sonra sayfanın
      geri kalanı boş kaldığı için eklendi (bkz. görsel tasarım denetimi);
      yeni bir Firestore dinleyicisi açmaz, zaten yüklenmiş `settings`'i okur. */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-6 sm:mb-8 px-4 py-3 rounded-xl bg-[var(--text-primary)]/[0.02] border border-[var(--glass-border)] relative z-10">
          <span className="authority-title !text-2xs opacity-45 tracking-wide">ŞU AN CANLIDA GEÇERLİ</span>
          <span className="text-xs text-[var(--text-secondary)]">
            <span className="text-[var(--text-primary)] font-medium">{settings.ilceAdi}</span> ({settings.ilceId})
          </span>
          <span className="text-xs text-[var(--text-secondary)]">
            Hicri düzeltme:{' '}
            <span className="text-[var(--text-primary)] font-medium">
              {settings.hicriDuzeltme ? `${settings.hicriDuzeltme > 0 ? '+' : ''}${settings.hicriDuzeltme} gün` : 'Normal'}
            </span>
          </span>
        </div>

        <form onSubmit={handleSave} className="space-y-6 sm:space-y-8 relative z-10">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="space-y-3">
              <label htmlFor="ayarlar-ilce-kodu" className="authority-title !text-2xs opacity-65 ml-1 tracking-wide">
                Diyanet İlçe Kodu
              </label>
              <div className="relative">
                <input
                  id="ayarlar-ilce-kodu"
                  type="text"
                  value={ilceId}
                  onChange={(e) => setIlceId(e.target.value)}
                  inputMode="numeric"
                  className="w-full bg-[var(--surface-medium)] border border-[var(--glass-border)] rounded-[14px] px-4 py-3.5 text-[var(--text-primary)] text-sm font-medium focus:border-[var(--dynamic-aura,var(--aura-indigo))]/50 outline-none transition-colors placeholder:text-muted placeholder:italic placeholder:font-normal"
                  placeholder="9148"
                  required
                />
              </div>
            </div>

            <div className="space-y-3">
              <label htmlFor="ayarlar-ilce-adi" className="authority-title !text-2xs opacity-65 ml-1 tracking-wide">
                İlçe Tanımı
              </label>
              <div className="relative">
                <input
                  id="ayarlar-ilce-adi"
                  type="text"
                  value={ilceAdi}
                  onChange={(e) => setIlceAdi(e.target.value)}
                  className="w-full bg-[var(--surface-medium)] border border-[var(--glass-border)] rounded-[14px] px-4 py-3.5 text-[var(--text-primary)] text-sm font-medium focus:border-[var(--dynamic-aura,var(--aura-indigo))]/50 outline-none transition-colors placeholder:text-muted placeholder:italic placeholder:font-normal"
                  placeholder="Ceyhan"
                  required
                />
              </div>
            </div>

            <div className="space-y-3">
              <label htmlFor="ayarlar-hicri-duzeltme" className="authority-title !text-2xs opacity-65 ml-1 tracking-wide">
                Hicri Tarih Düzeltmesi
              </label>
              <div className="relative">
                <select
                  id="ayarlar-hicri-duzeltme"
                  value={hicriDuzeltme}
                  onChange={(e) => setHicriDuzeltme(Number(e.target.value))}
                  className="w-full bg-[var(--surface-medium)] border border-[var(--glass-border)] rounded-[14px] px-4 py-3.5 text-[var(--text-primary)] text-sm font-medium focus:border-[var(--dynamic-aura,var(--aura-indigo))]/50 outline-none transition-colors"
                  style={{ colorScheme: theme }}
                >
                  <option value={-2} className="bg-[var(--card-elevated-bg)] text-[var(--text-primary)]">
                    -2 Gün (Geriye Al)
                  </option>
                  <option value={-1} className="bg-[var(--card-elevated-bg)] text-[var(--text-primary)]">
                    -1 Gün (Geriye Al)
                  </option>
                  <option value={0} className="bg-[var(--card-elevated-bg)] text-[var(--text-primary)]">
                    Normal (Diyanet Uyumlu)
                  </option>
                  <option value={1} className="bg-[var(--card-elevated-bg)] text-[var(--text-primary)]">
                    +1 Gün (İleriye Al)
                  </option>
                  <option value={2} className="bg-[var(--card-elevated-bg)] text-[var(--text-primary)]">
                    +2 Gün (İleriye Al)
                  </option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-5 pt-6 border-t border-[var(--glass-border)]">
            <div className="flex items-center justify-center sm:justify-start gap-4">
              <AnimatePresence>
                {statusMessage && (
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-[14px] border ${
                      statusMessage.type === 'success'
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                        : statusMessage.type === 'warning'
                          ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                          : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                    }`}
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-current" />
                    <span className="text-2xs font-semibold tracking-wide">{statusMessage.text}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <motion.button
              whileHover={{ y: -5, scale: 1.02, boxShadow: '0 20px 40px rgba(0,0,0,0.3)' }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={saving}
              className="bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] w-full sm:w-auto px-6 py-3.5 sm:px-8 sm:py-4 rounded-[14px] font-bold text-2xs uppercase tracking-wide shadow-[var(--spatial-shadow)] transition-all disabled:opacity-50 flex items-center justify-center gap-3 cursor-pointer"
            >
              {saving ? (
                <div className="w-4 h-4 border-2 border-[var(--text-primary)]/30 border-t-[var(--text-primary)] rounded-full animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {saving ? 'İŞLENİYOR...' : 'AYARLARI KAYDET'}
            </motion.button>
          </div>
        </form>
      </motion.div>

      {/* TEHLİKELİ BÖLGE: diğer tüm ayar kartlarından görsel olarak AYRIŞTIRILMIŞ
     (rose tonu, ayrı kart) — bu ekrandaki tek geri alınamaz işlem. Onay,
     tek-tıkla ConfirmModal DEĞİL, VeriSifirlamaModal'ın kendi "tam metni
     yaz" akışıyla — bkz. o dosyanın yorumu.
     spatial-glass — önceden elle yazılmış "border-none sm:border ...
     bg-transparent" deseni mobilde çerçevesiz görünüyordu (bkz. kod
     denetimi bulgusu). Rose tonuyla birlikte kullanım deseni
     MuezzinYonetimi.tsx:245'teki (aynı sınıf "tehlikeli bölge" kartı)
     AYNISI — !bg-rose-500 (spatial-glass'ın !important background'ını
     ezmek için) + plain border-rose-500 (spatial-glass'ın border'ını
     ezmek için codebase'de zaten kanıtlanmış kombinasyon). */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="spatial-glass !bg-rose-500/[0.02] border-rose-500/15 !rounded-card p-1 sm:p-8 relative overflow-hidden mt-6"
      >
        <div className="flex items-center gap-3 sm:gap-5 mb-6 relative z-10">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-[14px] bg-rose-500/10 flex items-center justify-center border border-rose-500/20">
            <AlertTriangle className="text-rose-500 w-5 h-5" strokeWidth={1.6} />
          </div>
          <div>
            <h3 className="text-lg sm:text-xl font-light text-[var(--text-primary)] tracking-tight leading-tight">Tehlikeli Bölge</h3>
            <p className="authority-title !text-2xs opacity-45 uppercase tracking-wide">Geri alınamaz veri işlemleri</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div className="space-y-2 max-w-lg">
            <p className="text-xs text-[var(--text-secondary)]/70 leading-relaxed">
              Bildirimler, haftalık planlar, izinler, vekalet talepleri gibi operasyonel verileri toplu olarak siler — yeni bir sezona
              sıfırdan başlamak için. Mazeret geçmişi ve denetim kayıtları bu işlemden etkilenmez.
            </p>
            {!isSuperAdmin && <p className="authority-title !text-2xs opacity-45 leading-relaxed">{SUPER_ADMIN_GEREKLI_IPUCU}</p>}
          </div>
          <motion.button
            whileHover={isSuperAdmin ? { y: -3, scale: 1.02 } : {}}
            whileTap={isSuperAdmin ? { scale: 0.98 } : {}}
            type="button"
            disabled={!isSuperAdmin}
            title={isSuperAdmin ? undefined : SUPER_ADMIN_GEREKLI_IPUCU}
            onClick={() => {
              if (isSuperAdmin) setVeriSifirlamaAcik(true);
            }}
            className="shrink-0 bg-rose-500/10 text-rose-400 border border-rose-500/25 px-6 py-3.5 rounded-[14px] font-bold text-2xs uppercase tracking-wide transition-all flex items-center justify-center gap-3 cursor-pointer hover:bg-rose-500/15 disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-rose-500/10"
          >
            Operasyonel Veriyi Sıfırla
          </motion.button>
        </div>
      </motion.div>

      <VeriSifirlamaModal isOpen={veriSifirlamaAcik} onClose={() => setVeriSifirlamaAcik(false)} />

      <ConfirmModal
        isOpen={pendingLocationChange !== null}
        onClose={() => setPendingLocationChange(null)}
        onConfirm={() => {
          if (!pendingLocationChange) return;
          const { ilceId: pId, ilceAdi: pAdi, hicriDuzeltme: pHicri } = pendingLocationChange;
          setPendingLocationChange(null);
          void performSave(pId, pAdi, pHicri, true);
        }}
        title="Vakit Bölgesi Değiştirilecek"
        message={`İlçe kodu "${settings.ilceId}" → "${pendingLocationChange?.ilceId}" olarak değiştirilecek. Bu, TÜM cemaatin ezan vakti kaynağını etkiler ve vakit önbelleği yeniden senkronize edilecektir.`}
        isDanger={false}
        confirmText="EVET, DEĞİŞTİR"
      />
    </>
  );
}
