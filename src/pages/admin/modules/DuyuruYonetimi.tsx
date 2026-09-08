import React, { useState, useEffect } from 'react';
import { Duyuru } from '../../../hooks/useDuyurular';
import { motion, AnimatePresence } from 'motion/react';
import { Megaphone, Plus, Trash2, AlertCircle, Info, LayoutTemplate } from 'lucide-react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Modal } from '../../../components/ui/Modal';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { LoadingState } from '../../../components/ui/LoadingState';
import { duyurularAbone, duyuruYayinla, duyuruSil } from '../../../services/duyuruServisi';
import { toTurkishLowerCase, toJsDate } from '../../../lib/dateUtils';
import { useNotificationStore } from '../../../store/useNotificationStore';
import { duyuruFormSemasi } from '../../../lib/validation';

export const DuyuruYonetimi: React.FC = () => {
  const [duyurular, setDuyurular] = useState<Duyuru[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    baslik: '',
    icerik: '',
    tip: 'duyuru' as Duyuru['tip'],
  });
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const showNotification = useNotificationStore((s) => s.showNotification);

  // Hazır duyuru şablonu önerici — anahtar kelime eşleştirmesiyle çalışan
  // basit bir şablon seçicidir, yapay zeka içermez.
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateTone, setTemplateTone] = useState<'resmi' | 'hitabet' | 'kisa'>('resmi');
  const [suggestedTemplate, setSuggestedTemplate] = useState('');
  const [templateError, setTemplateError] = useState<string | null>(null);

  const handleSuggestTemplate = () => {
    if (!formData.icerik.trim()) {
      setTemplateError('Lütfen önce içerik detayı alanına kısa bir taslak veya anahtar kelimeler yazın.');
      return;
    }
    setTemplateError(null);
    const rawText = formData.icerik.trim();
    let generated = '';

    // toTurkishLowerCase (bkz. src/lib/dateUtils.ts) — yönetici metni BÜYÜK
    // harfle ("KESİNTİ", "YARDIM" gibi) yazdıysa locale'siz `.toLowerCase()`
    // "İ"yi/"I"yı bozuk çevirip aşağıdaki `.includes('kesint')`/`.includes('yardım')`
    // aramalarının SESSİZCE eşleşmemesine yol açardı.
    const rawTextLower = toTurkishLowerCase(rawText);
    const isWater = rawTextLower.includes('su') || rawTextLower.includes('kesint');
    const isFriday = rawTextLower.includes('cuma') || rawTextLower.includes('vaaz') || rawTextLower.includes('yardım');

    if (templateTone === 'resmi') {
      if (isWater) {
        generated = `Değerli Cemaatimiz,\n\nCamimizin altyapı iyileştirme çalışmaları kapsamında belediye ekipleri tarafından yapılacak olan su kesintisi nedeniyle, şadırvan ve lavabolarımız geçici olarak hizmet veremeyecektir. Mağduriyet yaşanmaması adına gerekli tedbirlerin alınmasını rica eder, anlayışınız için teşekkür ederiz.\n\nSaygılarımızla,\nCami Yönetimi`;
      } else if (isFriday) {
        generated = `Kıymetli Müminler,\n\nÖnümüzdeki Cuma günü eda edeceğimiz Cami Buluşmaları kapsamında, yardımlaşma ve dayanışmanın önemine dair özel bir sohbet ve vaaz programı icra edilecektir. Tüm mahalle sakinlerimizi ve cemaatimizi bu manevi iklimi paylaşmaya davet ediyoruz.\n\nSaygılarımızla,\nCami Yönetimi`;
      } else {
        generated = `Değerli Cemaatimiz,\n\nSizlere daha huzurlu ve temiz bir ibadet ortamı sunabilmek amacıyla ilettiğiniz konuyla ilgili gerekli planlamalar yapılmıştır: "${rawText}". Gelişmeler ve takvim hakkında sizleri bilgilendirmeye devam edeceğiz.\n\nSaygılarımızla,\nCami İdaresi`;
      }
    } else if (templateTone === 'hitabet') {
      if (isWater) {
        generated = `Muhterem Müslümanlar,\n\nCamimizde gerçekleştirilecek olan zorunlu temizlik ve altyapı bakım faaliyetleri sebebiyle şadırvanlarımızda kısa süreli su kesintisi yaşanacaktır. Maddi ve manevi temizliğin nişanesi olan ibadethanemizi daha güzel yarınlara hazırlamak için göstereceğiniz anlayış ve sabır için şimdiden teşekkür ederiz. Rabbim niyetlerinizi kabul eylesin.`;
      } else if (isFriday) {
        generated = `Aziz ve Muhterem Kardeşlerim,\n\nYüce Rabbimiz Kur'an-ı Kerim'de, "İyilik ve takva üzere yardımlaşın" buyurmaktadır. Peygamber Efendimiz (s.a.v) ise müminlerin bir beden gibi olduğunu bizlere müjdelemiştir. Bu Cuma vaazımızda yardımlaşma ahlakını ve gönül köprüleri kurmayı hep birlikte tefekkür edeceğiz. Gönüllerimizi bir kılmak adına tüm cemaatimizi bekliyoruz.`;
      } else {
        generated = `Aziz Cemaatimiz, Gönül Dostlarımız,\n\nİslam'ın güzel ahlakını ve cemaat olmanın rahmetini yaşatmak adına bizlere ulaştırdığınız "${rawText}" hususu, ibadethanemizin manevi havasına yakışır şekilde ele alınacaktır. Dualarımız ve gayretlerimiz bu kutlu yolda sizlerledir. Yüce Mevla birliğimizi ve beraberliğimizi daim eylesin.`;
      }
    } else {
      // kisa
      if (isWater) {
        generated = `Duyuru: Belediye altyapı çalışması sebebiyle camimiz şadırvanında geçici su kesintisi olacaktır. Tedbirli olunması rica olunur.`;
      } else if (isFriday) {
        generated = `Duyuru: Bu Cuma vaaz konusu yardımlaşma ahlakıdır. Vaazımız saat 12:15'te başlayacaktır. Tüm cemaatimiz davetlidir.`;
      } else {
        generated = `Duyuru: "${rawText}" hakkında gerekli idari ve teknik planlama başlatılmıştır. Bilgilerinize sunulur.`;
      }
    }

    setSuggestedTemplate(generated);
  };

  const applyTemplate = () => {
    if (suggestedTemplate) {
      setFormData((prev) => ({
        ...prev,
        icerik: suggestedTemplate,
        baslik: prev.baslik || (templateTone === 'kisa' ? 'Önemli Bilgilendirme' : 'Cemaatimize Duyuru'),
      }));
      setSuggestedTemplate('');
      setTemplatesOpen(false);
    }
  };

  useEffect(() => {
    const unsubscribe = duyurularAbone(
      (data) => {
        setDuyurular(data);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsubscribe();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    // firestore.rules isValidDuyuru'nun istemci tarafı aynası (bkz.
    // src/lib/validation) — HTML5 required/maxLength zaten aynı sınırları
    // uyguluyor ama trim edilmiş boş metin (yalnızca boşluk) veya tip
    // seçilmemişse burada erken, Türkçe bir mesajla yakalanır.
    const sonuc = duyuruFormSemasi.safeParse(formData);
    if (!sonuc.success) {
      showNotification('Form Geçersiz', sonuc.error.issues[0].message, 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      await duyuruYayinla(formData);
      setModalOpen(false);
      setFormData({ baslik: '', icerik: '', tip: 'duyuru' });
    } catch (error) {
      // Modal bu noktada hâlâ açık — burada eskiden Modal'ın (z-[500],
      // portallanmış) altında kalabilen yerel bir fixed banner kullanılıyordu
      // (bkz. PersonelFormModal.tsx'teki AYNI düzeltme, premium standart
      // denetimi); paylaşılan toast sistemi z-[9999]'da olduğundan modal'ın
      // üzerinde güvenle görünür.
      showNotification('Duyuru Yayınlanamadı', error instanceof Error ? error.message : 'Duyuru yayınlanırken bir hata oluştu.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const executeDelete = async () => {
    const id = confirmDelete.id;
    if (!id) return;
    try {
      setDeletingId(id);
      const match = duyurular.find((d) => d.id === id);
      const title = match ? match.baslik : 'Bilinmeyen Duyuru';
      await duyuruSil(id, title);
      setConfirmDelete({ open: false, id: null });
    } catch (error) {
      // handleCreate'in aksine bu catch önceden hiçbir kullanıcı geri
      // bildirimi vermiyordu — onay modalı başarıyla AYNI şekilde
      // kapanıyordu, admin silme isteği (yetki/ağ hatası) başarısız olsa
      // bile duyurunun silindiğine inanıyordu (bkz. mimari denetim).
      console.error('Duyuru silinemedi:', error);
      showNotification('Duyuru Silinemedi', error instanceof Error ? error.message : 'Duyuru silinirken bir hata oluştu.', 'error');
      setConfirmDelete({ open: false, id: null });
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <LoadingState label="Duyuru Havuzu Senkronize Ediliyor" heightClassName="h-96" />;

  return (
    <div className="flex flex-col gap-10">
      {/* HEADER: Action Control */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-light tracking-tight text-[var(--text-primary)]">Duyuru Panosu</h2>
          <p className="authority-title !text-2xs opacity-30 font-medium tracking-wide">DİZGE GENELİ BİLGİLENDİRME VE İLETİŞİM</p>
        </div>

        <motion.button
          whileHover={{
            y: -3,
            scale: 1.02,
            boxShadow: '0 15px 30px color-mix(in srgb, var(--dynamic-aura, var(--aura-indigo)) 20%, transparent)',
          }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setModalOpen(true)}
          className="flex items-center justify-center gap-4 bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] px-8 py-4 rounded-2xl text-2xs font-bold uppercase tracking-wide shadow-lg group w-full sm:w-auto"
        >
          <Plus size={16} strokeWidth={2.5} className="group-hover:rotate-90 transition-transform duration-500" />
          YENİ DUYURU YAYINLA
        </motion.button>
      </div>

      {/* GRID: Spatial Stream */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <AnimatePresence mode="popLayout">
          {duyurular.map((duyuru, idx) => (
            <motion.div
              key={duyuru.id}
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30, delay: idx * 0.05 }}
              className="spatial-glass !rounded-card p-6 group relative overflow-hidden flex flex-col min-h-[220px]"
            >
              {/* Type Accent Aura */}
              <div
                className={`absolute -top-12 -right-12 w-24 h-24 blur-[60px] opacity-20 ${
                  duyuru.tip === 'onemli'
                    ? 'bg-rose-500'
                    : duyuru.tip === 'bilgi'
                      ? 'bg-sky-500'
                      : 'bg-[var(--dynamic-aura,var(--aura-indigo))]'
                }`}
              />

              <div className="flex items-start justify-between mb-6">
                <div
                  className={`w-12 h-12 rounded-[18px] flex items-center justify-center shadow-lg border ${
                    duyuru.tip === 'onemli'
                      ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                      : duyuru.tip === 'bilgi'
                        ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
                        : 'bg-[var(--surface-low)] text-[var(--dynamic-aura,var(--aura-indigo))] border-[var(--glass-border)]'
                  }`}
                >
                  {duyuru.tip === 'onemli' ? (
                    <AlertCircle size={20} />
                  ) : duyuru.tip === 'bilgi' ? (
                    <Info size={20} />
                  ) : (
                    <Megaphone size={20} />
                  )}
                </div>

                <motion.button
                  whileHover={{ scale: 1.1, backgroundColor: 'rgba(244,63,94,0.1)' }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setConfirmDelete({ open: true, id: duyuru.id })}
                  disabled={deletingId === duyuru.id}
                  aria-label="Duyuruyu sil"
                  className="p-3 text-subtle hover:text-rose-500 transition-all rounded-xl border border-transparent hover:border-rose-500/20 disabled:opacity-40"
                >
                  <Trash2 size={16} />
                </motion.button>
              </div>

              <div className="flex-1">
                <h3 className="text-lg font-light text-[var(--text-primary)] tracking-tight mb-3 group-hover:text-[var(--dynamic-aura,var(--aura-indigo))] transition-colors duration-500">
                  {duyuru.baslik}
                </h3>
                <p className="text-xs font-light text-[var(--text-secondary)] leading-relaxed line-clamp-3">{duyuru.icerik}</p>
              </div>

              <div className="flex items-center justify-between pt-6 mt-6 border-t border-[var(--glass-border)]">
                <div className="flex flex-col gap-0.5">
                  <span className="authority-title !text-2xs opacity-20 uppercase tracking-wide">YAYIN TARİHİ</span>
                  <span className="text-2xs font-medium text-faint uppercase tracking-wide">
                    {toJsDate(duyuru.tarih) ? format(toJsDate(duyuru.tarih)!, 'd MMMM yyyy', { locale: tr }) : '—'}
                  </span>
                </div>

                <div
                  className={`px-4 py-1.5 rounded-full border text-2xs font-bold uppercase tracking-wide shadow-sm ${
                    duyuru.tip === 'onemli'
                      ? 'bg-rose-500/10 text-rose-400 border-rose-500/20 shadow-rose-500/5'
                      : duyuru.tip === 'bilgi'
                        ? 'bg-sky-500/10 text-sky-400 border-sky-500/20 shadow-sky-500/5'
                        : 'bg-[var(--surface-low)] text-[var(--dynamic-aura,var(--aura-indigo))] border-[var(--glass-border)] shadow-[var(--spatial-shadow)]'
                  }`}
                >
                  {duyuru.tip}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* PUBLISH MODAL: Operational Command */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Yeni Duyuru" className="items-start pt-24 sm:pt-32">
        <div className="flex flex-col gap-1.5 mb-10">
          <p className="authority-title !text-2xs opacity-30 uppercase tracking-wide">OPERASYONEL BİLGİLENDİRME PARAMETRELERİ</p>
        </div>

        <form onSubmit={handleCreate} className="space-y-8 pb-4">
          <div className="space-y-3 group">
            <label
              htmlFor="duyuru-baslik"
              className="authority-title !text-2xs opacity-40 ml-1 tracking-wide group-hover:opacity-100 transition-opacity"
            >
              DUYURU BAŞLIĞI
            </label>
            <div className="relative">
              <input
                id="duyuru-baslik"
                required
                maxLength={200}
                placeholder="Duyuru başlığını giriniz..."
                value={formData.baslik}
                onChange={(e) => setFormData({ ...formData, baslik: e.target.value })}
                className="w-full spatial-glass bg-[var(--text-primary)]/[0.01] p-5 rounded-2xl text-base font-light text-[var(--text-primary)] border border-[var(--text-primary)]/5 outline-none focus:bg-[var(--text-primary)]/[0.04] focus:border-[var(--dynamic-aura,var(--aura-indigo))]/40 focus:shadow-[0_0_35px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_15%,transparent)] transition-all duration-700 placeholder:text-[var(--text-secondary)]"
              />
            </div>
          </div>

          <div className="space-y-3 group">
            <label
              htmlFor="duyuru-icerik"
              className="authority-title !text-2xs opacity-40 ml-1 tracking-wide group-hover:opacity-100 transition-opacity"
            >
              İÇERİK DETAYI
            </label>
            <div className="relative">
              <textarea
                id="duyuru-icerik"
                required
                rows={5}
                maxLength={5000}
                placeholder="İçerik metnini buraya yazınız..."
                value={formData.icerik}
                onChange={(e) => setFormData({ ...formData, icerik: e.target.value })}
                className="w-full spatial-glass bg-[var(--text-primary)]/[0.01] p-5 rounded-2xl text-base font-light text-[var(--text-primary)] border border-[var(--text-primary)]/5 outline-none focus:bg-[var(--text-primary)]/[0.04] focus:border-[var(--dynamic-aura,var(--aura-indigo))]/40 focus:shadow-[0_0_35px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_15%,transparent)] transition-all duration-700 resize-none placeholder:text-[var(--text-secondary)]"
              />
            </div>
          </div>

          {/* Hazır Duyuru Şablonları — anahtar kelimeye göre şablon önerir, yapay zeka değildir */}
          <div className="spatial-glass border border-[var(--dynamic-aura,var(--aura-indigo))]/15 p-5 rounded-2xl space-y-4 bg-gradient-to-r from-[var(--dynamic-aura,var(--aura-indigo))]/[0.01] to-purple-500/[0.01]">
            {/* flex-col sm:flex-row: başlık + "Şablonları Göster/Gizle" ikisi de metin
     ağırlıklı olduğundan dar mobil genişlikte (≤375px) yan yana sığmıyordu
     (bkz. KrizAlarmlari.tsx'teki aynı desen, mobil yerleşim denetimi). */}
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
              <div className="flex items-center gap-2">
                <LayoutTemplate size={14} className="text-[var(--dynamic-aura,var(--aura-indigo))]" />
                <span className="text-2xs font-bold text-[var(--dynamic-aura,var(--aura-indigo))] uppercase tracking-wider">
                  Hazır Duyuru Şablonları
                </span>
              </div>
              <button
                type="button"
                onClick={() => setTemplatesOpen(!templatesOpen)}
                className="self-start sm:self-auto text-2xs font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all px-3 py-1.5 rounded-lg border border-[var(--text-primary)]/5 bg-[var(--text-primary)]/[0.01]"
              >
                {templatesOpen ? 'Şablonları Gizle' : 'Şablonları Göster'}
              </button>
            </div>

            {templatesOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="space-y-4 overflow-hidden pt-2 border-t border-[var(--text-primary)]/5"
              >
                <div className="space-y-2">
                  <span className="text-2xs text-[var(--text-secondary)] font-bold uppercase tracking-wider block">
                    Üslup ve Ton Seçimi
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { key: 'resmi', label: 'Resmi / Kurumsal' },
                        { key: 'hitabet', label: 'Edebi / Hitabet' },
                        { key: 'kisa', label: 'Kısa ve Net' },
                      ] as const
                    ).map((tone) => (
                      <button
                        key={tone.key}
                        type="button"
                        onClick={() => setTemplateTone(tone.key)}
                        className={`py-2 px-1 rounded-xl text-2xs font-bold uppercase tracking-wider transition-all border ${
                          templateTone === tone.key
                            ? 'bg-[var(--dynamic-aura,var(--aura-indigo))]/10 text-[var(--dynamic-aura,var(--aura-indigo))] border-[var(--dynamic-aura,var(--aura-indigo))]/30'
                            : 'bg-[var(--text-primary)]/[0.01] text-[var(--text-secondary)] border-[var(--text-primary)]/5 hover:border-[var(--text-primary)]/10'
                        }`}
                      >
                        {tone.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-4 items-center">
                  <button
                    type="button"
                    onClick={handleSuggestTemplate}
                    className="flex-1 py-3 bg-gradient-to-r from-[var(--dynamic-aura,var(--aura-indigo))] to-purple-500/60 text-[var(--text-primary)] rounded-xl text-2xs font-bold uppercase tracking-wide shadow-lg shadow-[var(--dynamic-aura,var(--aura-indigo))]/10 hover:opacity-90 transition-all flex items-center justify-center gap-2"
                  >
                    <LayoutTemplate size={10} />
                    Uygun Şablonu Öner
                  </button>
                </div>

                {templateError && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-2xs font-semibold leading-relaxed"
                  >
                    {templateError}
                  </motion.div>
                )}

                {suggestedTemplate && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-3 p-4 bg-[var(--text-primary)]/[0.02] border border-[var(--text-primary)]/5 rounded-xl"
                  >
                    <div className="flex justify-between items-center border-b border-[var(--text-primary)]/5 pb-2">
                      <span className="text-2xs text-purple-400 font-bold uppercase tracking-wider">ÖNERİLEN ŞABLON METNİ:</span>
                      <span className="text-2xs text-[var(--text-secondary)] uppercase tracking-wide">({templateTone} üslup)</span>
                    </div>
                    <p className="text-xs text-[var(--text-primary)]/80 leading-relaxed font-light whitespace-pre-wrap">
                      {suggestedTemplate}
                    </p>
                    <div className="flex gap-3 pt-2">
                      <button
                        type="button"
                        onClick={applyTemplate}
                        className="flex-1 py-2.5 bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] rounded-lg text-2xs font-bold uppercase tracking-wide shadow-md hover:opacity-90 transition-all"
                      >
                        Şablonu Metne Uygula
                      </button>
                      <button
                        type="button"
                        onClick={() => setSuggestedTemplate('')}
                        className="px-4 py-2.5 bg-[var(--text-primary)]/5 text-[var(--text-secondary)] rounded-lg text-2xs font-bold uppercase tracking-wide hover:text-[var(--text-primary)] transition-all"
                      >
                        Temizle
                      </button>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}
          </div>

          <div className="space-y-4">
            <span id="duyuru-kategori-label" className="authority-title !text-2xs opacity-40 ml-1 tracking-wide">
              DUYURU KATEGORİSİ
            </span>
            <div role="group" aria-labelledby="duyuru-kategori-label" className="grid grid-cols-3 gap-3">
              {(['onemli', 'bilgi', 'duyuru'] as const).map((type) => {
                const isSelected = formData.tip === type;
                let activeStyle = '';
                if (isSelected) {
                  if (type === 'onemli')
                    activeStyle =
                      'bg-rose-500 text-[var(--app-bg)] border-rose-400 shadow-[0_10px_20px_color-mix(in_srgb,var(--status-danger,red)_25%,transparent)]';
                  else if (type === 'bilgi')
                    activeStyle =
                      'bg-[var(--status-info)] text-[var(--app-bg)] border-[var(--status-info)] shadow-[0_10px_20px_color-mix(in_srgb,var(--status-info,sky)_25%,transparent)]';
                  else
                    activeStyle =
                      'bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] border-[var(--dynamic-aura,var(--aura-indigo))]/60 shadow-[0_10px_20px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_25%,transparent)]';
                } else {
                  activeStyle =
                    'bg-[var(--text-primary)]/[0.02] text-[var(--text-secondary)] border-[var(--text-primary)]/5 hover:border-[var(--text-primary)]/10';
                }
                return (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setFormData({ ...formData, tip: type })}
                    className={`py-3.5 rounded-2xl text-2xs font-bold uppercase tracking-wide transition-all border outline-none ${activeStyle}`}
                  >
                    {type === 'onemli' ? 'ÖNEMLİ' : type === 'bilgi' ? 'BİLGİ' : 'DUYURU'}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
            <motion.button
              whileHover={{
                y: -3,
                scale: 1.01,
                boxShadow: '0 15px 30px color-mix(in srgb, var(--dynamic-aura, var(--aura-indigo)) 20%, transparent)',
              }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={isSubmitting}
              className="flex-1 bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] border border-[var(--dynamic-aura,var(--aura-indigo))]/60 text-2xs font-bold uppercase tracking-wide py-5 rounded-2xl shadow-lg shadow-[var(--dynamic-aura,var(--aura-indigo))]/20 transition-all duration-700 text-center justify-center flex items-center disabled:opacity-50"
            >
              {isSubmitting ? 'YAYINLANIYOR...' : 'DUYURUYU ŞİMDİ YAYINLA'}
            </motion.button>
            <motion.button
              whileHover={{ backgroundColor: 'var(--surface-medium)' }}
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-10 py-5 text-2xs font-bold uppercase tracking-wide text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all border border-[var(--text-primary)]/5 rounded-2xl text-center justify-center flex items-center"
            >
              İPTAL
            </motion.button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        isOpen={confirmDelete.open}
        onClose={() => setConfirmDelete({ open: false, id: null })}
        onConfirm={executeDelete}
        title="Duyuruyu Sil"
        message="Bu duyuru panodan ve tüm kullanıcıların ekranından kalıcı olarak kaldırılacaktır. Bu işlem geri alınamaz."
        isDanger={true}
        confirmText="EVET, KALICI OLARAK SİL"
      />
    </div>
  );
};
