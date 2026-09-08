import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Modal } from '../../../components/ui/Modal';
import { FormField } from '../../../components/ui/FormField';
import { formatName } from '../../../lib/stringUtils';
import { Muezzin } from '../../../types';
import { useMuezzinStore } from '../../../store/useMuezzinStore';
import { personelKaydet } from '../../../services/muezzinServisi';
import { useNotificationStore } from '../../../store/useNotificationStore';
import { personelFormSemasi } from '../../../lib/validation';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  editingUser: (Muezzin & { id: string }) | null;
}

export const PersonelFormModal = React.memo(({ isOpen, onClose, editingUser }: Props) => {
  const muezzinler = useMuezzinStore((state) => state.muezzinler);
  const [formData, setFormData] = useState({
    email: '',
    ad: '',
    soyad: '',
    role: 'muezzin' as 'muezzin' | 'admin' | 'gozlemci',
    haftalikIzinGunu: 0,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const showNotification = useNotificationStore((s) => s.showNotification);

  useEffect(() => {
    if (isOpen) {
      if (editingUser) {
        const parts = (editingUser.displayName || '').split(' ');
        const soyad = parts.length > 1 ? parts.pop() || '' : '';
        const ad = parts.join(' ');
        setFormData({
          email: editingUser.email || '',
          ad,
          soyad,
          role: editingUser.role,
          haftalikIzinGunu: editingUser.haftalikIzinGunu || 0,
        });
      } else {
        setFormData({ email: '', ad: '', soyad: '', role: 'muezzin', haftalikIzinGunu: 0 });
      }
    }
  }, [isOpen, editingUser]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);

    // Zod, firestore.rules isValidMuezzin'in istemci tarafı aynası — sunucu
    // opak bir "Kayıt sırasında bir hata oluştu" ile reddetmeden önce burada
    // erken ve net bir mesajla yakalar (bkz. src/lib/validation). Cuma (5)
    // kısıtlaması (UI'da buton disabled, ama kural eklenmeden önce kaydedilmiş
    // bir personelde bu alan hâlâ 5 olabilir) ve ad+soyad birleşik uzunluk
    // sınırı burada tek yerde doğrulanıyor.
    const sonuc = personelFormSemasi.safeParse(formData);
    if (!sonuc.success) {
      const ilkHata = sonuc.error.issues[0];
      if (ilkHata.path[0] === 'email') {
        setEmailError(ilkHata.message);
        document.getElementById('personel-email')?.focus();
      } else {
        showNotification('Form Geçersiz', ilkHata.message, 'error');
      }
      return;
    }

    setIsSubmitting(true);
    try {
      const fullName = `${formatName(formData.ad)} ${formatName(formData.soyad)}`.trim();
      const { planRefreshed } = await personelKaydet({
        editingUser,
        muezzinler,
        fullName,
        role: formData.role,
        haftalikIzinGunu: formData.haftalikIzinGunu,
        email: formData.email,
      });
      onClose();
      // Kayıt kendisi başarılı oldu (modal kapandı) — yalnızca artçı plan
      // yenilemesi başarısız oldu. Bu, MuezzinYonetimi.tsx'teki kardeş
      // işlemlerin (aktiflik/onay/geri yükle/arşivle) hepsinde zaten
      // `warnIfPlanNotRefreshed` ile bildiriliyordu; personelKaydet aynı
      // riski (rol/izin günü değişimi sonrası +1/+2 hafta yenilemesi)
      // taşıdığı halde önceden hiç bildirmiyordu, yalnızca console.warn'a
      // düşüyordu (bkz. mimari denetim). Toast kullanılıyor çünkü modal
      // zaten kapandı — inline errorStatus burada görünmez olurdu.
      if (!planRefreshed) {
        showNotification(
          'Plan Yenilenemedi',
          'Kadro güncellendi; mevcut hafta planı otomatik yenilenemedi. Hizmet Cetveli üzerinden güvenli güncelleme yapabilirsiniz.',
          'warning'
        );
      }
    } catch (err) {
      // "Geçerli bir e-posta adresi giriniz." (muezzinServisi.ts
      // personelKaydet) e-posta alanına özgü bir doğrulama hatası — diğer
      // tüm hatalar (yetki/yazma/ağ) alana bağlanamayacak kadar genel
      // olduğu için toast'ta kalıyor (bkz. premium denetim, bölüm 14).
      const message = err instanceof Error ? err.message : 'Kayıt sırasında bir hata oluştu. Yetkiniz olmayabilir.';
      if (message === 'Geçerli bir e-posta adresi giriniz.') {
        setEmailError(message);
        document.getElementById('personel-email')?.focus();
        return;
      }
      // Modal bu noktada hâlâ açık — eskiden burada modal'ın (z-[500],
      // portallanmış) altında kalabilen yerel bir fixed banner kullanılıyordu
      // (bkz. premium standart / mimari denetim); paylaşılan toast sistemi
      // z-[9999]'da olduğundan modal'ın üzerinde güvenle görünür.
      showNotification('Kayıt Başarısız', message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editingUser ? 'Profil Güncelleme' : 'Yeni Personel Tanımı'}>
      <form onSubmit={handleSubmit} className="space-y-8 py-4">
        <FormField
          label="ERİŞİM E-POSTASI"
          htmlFor="personel-email"
          error={emailError}
          className="group"
          labelClassName="authority-title !text-2xs opacity-50 ml-1 tracking-wide group-hover:opacity-100 group-hover:font-black transition-all duration-700"
        >
          <input
            type="email"
            required
            maxLength={100}
            value={formData.email}
            onChange={(e) => {
              setFormData({ ...formData, email: e.target.value });
              setEmailError(null);
            }}
            disabled={!!editingUser || isSubmitting}
            className={`w-full spatial-glass-elevated p-6 rounded-3xl text-sm font-light text-[var(--text-primary)] border border-[var(--text-primary)]/5 aria-[invalid=true]:border-[var(--status-danger)]/40 aria-[invalid=true]:bg-[var(--status-danger)]/[0.04] outline-none transition-all duration-700 ${editingUser ? 'opacity-30 cursor-not-allowed' : 'focus:border-[var(--dynamic-aura,var(--aura-indigo))]/40 focus:bg-[var(--text-primary)]/[0.05] focus:shadow-[0_0_30px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_15%,transparent)]'}`}
            placeholder="kurumsal@muezzin.app"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-3">
            <label htmlFor="personel-ad" className="authority-title !text-2xs opacity-50 ml-1 tracking-wide">
              PERSONEL ADI
            </label>
            <input
              id="personel-ad"
              type="text"
              required
              maxLength={100}
              value={formData.ad}
              onChange={(e) => setFormData({ ...formData, ad: formatName(e.target.value) })}
              disabled={isSubmitting}
              className="w-full spatial-glass-elevated p-5 rounded-2xl text-sm font-light text-[var(--text-primary)] border border-[var(--text-primary)]/5 outline-none focus:border-[var(--dynamic-aura,var(--aura-indigo))]/40 focus:shadow-[0_0_20px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_10%,transparent)] transition-all duration-700"
              placeholder="Örn: Ahmet"
            />
          </div>
          <div className="space-y-3">
            <label htmlFor="personel-soyad" className="authority-title !text-2xs opacity-50 ml-1 tracking-wide">
              SOYADI
            </label>
            <input
              id="personel-soyad"
              type="text"
              required
              maxLength={100}
              value={formData.soyad}
              onChange={(e) => setFormData({ ...formData, soyad: formatName(e.target.value) })}
              disabled={isSubmitting}
              className="w-full spatial-glass-elevated p-5 rounded-2xl text-sm font-light text-[var(--text-primary)] border border-[var(--text-primary)]/5 outline-none focus:border-[var(--dynamic-aura,var(--aura-indigo))]/40 focus:shadow-[0_0_20px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_10%,transparent)] transition-all duration-700"
              placeholder="Örn: Yılmaz"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="col-span-2 md:col-span-1 space-y-4 group">
            <span
              id="personel-yetki-label"
              className="authority-title !text-2xs opacity-50 ml-1 tracking-wide group-hover:opacity-100 group-hover:font-black transition-all duration-700"
            >
              YETKİ SEVİYESİ
            </span>
            <div role="group" aria-labelledby="personel-yetki-label" className="grid grid-cols-3 gap-2.5">
              {(
                [
                  { value: 'muezzin', label: 'MÜEZZİN', desc: 'Görevli Kadro' },
                  { value: 'gozlemci', label: 'GÖZLEMCİ', desc: 'Sadece İzleyici' },
                  { value: 'admin', label: 'YÖNETİCİ', desc: 'Tam Yetkili' },
                ] as const
              ).map((role) => (
                <button
                  key={role.value}
                  type="button"
                  disabled={isSubmitting}
                  aria-pressed={formData.role === role.value}
                  onClick={() => setFormData({ ...formData, role: role.value })}
                  className={`p-3.5 rounded-2xl flex flex-col items-center justify-center text-center transition-all border outline-none ${
                    formData.role === role.value
                      ? 'bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] border-[var(--dynamic-aura,var(--aura-indigo))]/60 shadow-[0_10px_20px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_25%,transparent)]'
                      : 'bg-[var(--text-primary)]/[0.02] text-[var(--text-secondary)] border-[var(--text-primary)]/5 hover:border-[var(--text-primary)]/10 focus:border-[var(--text-primary)]/10'
                  }`}
                >
                  <span className="text-2xs font-black uppercase tracking-wide">{role.label}</span>
                  <span className="text-2xs mt-1 opacity-55 block leading-normal">{role.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="col-span-2 md:col-span-1 space-y-4">
            <span id="personel-izin-gunu-label" className="authority-title !text-2xs opacity-50 ml-1 tracking-wide">
              HAFTALIK İZİN GÜNÜ
            </span>
            <div role="group" aria-labelledby="personel-izin-gunu-label" className="flex flex-wrap gap-2">
              {[
                { value: 0, label: 'İZİNSİZ' },
                { value: 1, label: 'PZT' },
                { value: 2, label: 'SAL' },
                { value: 3, label: 'ÇAR' },
                { value: 4, label: 'PER' },
                { value: 5, label: 'CUM', disabled: true },
                { value: 6, label: 'CMT' },
                { value: 7, label: 'PAZ' },
              ].map((day) => {
                const isSelected = formData.haftalikIzinGunu === day.value;
                return (
                  <button
                    key={day.value}
                    type="button"
                    disabled={day.disabled || isSubmitting}
                    aria-pressed={isSelected}
                    onClick={() => setFormData({ ...formData, haftalikIzinGunu: day.value })}
                    className={`px-3 py-2.5 rounded-xl text-2xs font-bold uppercase tracking-wide transition-all border outline-none ${
                      day.disabled
                        ? 'opacity-10 cursor-not-allowed border-transparent bg-transparent'
                        : isSelected
                          ? 'bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] border-[var(--dynamic-aura,var(--aura-indigo))]/60 shadow-[0_8px_16px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_25%,transparent)]'
                          : 'bg-[var(--text-primary)]/[0.02] text-[var(--text-secondary)] border-[var(--text-primary)]/5 hover:border-[var(--text-primary)]/10 focus:border-[var(--text-primary)]/10'
                    }`}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="pt-10 flex items-center gap-6">
          <motion.button
            whileHover={{
              y: -3,
              scale: 1.01,
              boxShadow: '0 15px 30px color-mix(in srgb, var(--dynamic-aura, var(--aura-indigo)) 20%, transparent)',
            }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={isSubmitting}
            className="flex-1 bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] text-2xs font-bold uppercase tracking-wide py-5 rounded-2xl shadow-lg shadow-[var(--dynamic-aura,var(--aura-indigo))]/10 transition-all disabled:opacity-50"
          >
            {isSubmitting ? 'İŞLENİYOR...' : editingUser ? 'PROFİLİ GÜNCELLE' : 'PERSONELİ DİZGEYE EKLE'}
          </motion.button>
          <motion.button
            whileHover={{ backgroundColor: 'var(--surface-medium)' }}
            whileTap={{ scale: 0.95 }}
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-8 py-5 text-2xs font-bold uppercase tracking-wide text-[var(--text-secondary)] opacity-40 hover:opacity-100 transition-all border border-[var(--text-primary)]/5 rounded-2xl"
          >
            İPTAL
          </motion.button>
        </div>
      </form>
    </Modal>
  );
});
