import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, AlertCircle, CheckCircle2, Hourglass, Trash2, Send } from 'lucide-react';
import { collection, query, where, onSnapshot, doc, writeBatch, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { User as FirebaseUser } from 'firebase/auth';
import { format, parseISO } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Modal } from './ui/Modal';
import { FormField } from './ui/FormField';
import { useMuezzinStore } from '../store/useMuezzinStore';
import { useAuthStore } from '../store/useAuthStore';
import { useNotificationStore } from '../store/useNotificationStore';
import { GOZLEMCI_SALT_OKUMA_IPUCU } from '../lib/rolMetinleri';
import { izinFormSemasiOlustur, alanHatalariniCikar } from '../lib/validation';

interface IzinFormAlanHatalari {
  baslangic?: string;
  bitis?: string;
  sebep?: string;
}

/** Yıllık izin kotası (takvim yılı başına gün) — bkz. useAdminIzinlerStore.ts
 *  YILLIK_IZIN_KOTASI ve firestore.rules isValidMuezzin. Sunucu tarafı sert
 *  sınırı orada uygulanır; burası yalnızca erken, kullanıcı dostu bir uyarı. */
const YILLIK_IZIN_KOTASI = 30;

interface VacationRequestCardProps {
  user: FirebaseUser | null;
}

interface IzinTalep {
  id?: string;
  uid: string;
  baslangic: string;
  bitis: string;
  tip: 'haftalik' | 'yillik' | 'mazeret';
  durum: 'onay_bekliyor' | 'onaylandi' | 'reddedildi';
  olusturmaTarihi: Timestamp;
}

export default function VacationRequestCard({ user }: VacationRequestCardProps) {
  const [baslangic, setBaslangic] = useState('');
  const [bitis, setBitis] = useState('');
  const [tip, setTip] = useState<'haftalik' | 'yillik' | 'mazeret'>('haftalik');
  const [sebep, setSebep] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<IzinFormAlanHatalari>({});
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Gözlemci salt-okuma: MuezzinAnaEkran bu kartı bugün yalnızca
  // role === 'muezzin' için render ediyor, ama bileşenin kendisi bu
  // varsayıma bağlı kalmamalı — sunucu (firestore.rules isValidIzin,
  // role == 'muezzin' şartı) zaten reddediyor, burası kullanıcıya sebebi
  // gösteren istemci katmanı (bkz. premium denetim P1.5).
  const isReadOnly = useAuthStore((s) => s.isReadOnly);
  const showNotification = useNotificationStore((s) => s.showNotification);

  const yillikKullanilan = useMuezzinStore((s) => (user ? s.muezzinMap[user.uid]?.yillikIzinKullanilanGun : undefined)) || 0;
  const yillikKalanKota = Math.max(0, YILLIK_IZIN_KOTASI - yillikKullanilan);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const [talepler, setTalepler] = useState<IzinTalep[]>([]);
  const [loadingTalepler, setLoadingTalepler] = useState(true);
  // `sebep` artık `izinler` belgesinde değil, ayrı `izin_detaylari`
  // koleksiyonunda (bkz. firestore.rules `isValidIzinDetay` — premium hata
  // analizi FR-O3: `izinler`in `list` kuralı, tüm ekibin "kimin onaylı izni
  // var" görebilmesi için `durum=='onaylandi'` belgelerini herkese açıyordu,
  // bu da izin gerekçesini istemeden tüm ekibe açık ediyordu). İzin ID'sine
  // göre eşleşir.
  const [sebepMap, setSebepMap] = useState<Record<string, string>>({});

  // Kullanıcı değiştiğinde yükleme durumunu render sırasında ayarla —
  // bkz. useBugunkuGorevlerim.ts'teki aynı desen.
  const [lastUserUid, setLastUserUid] = useState(user?.uid);
  if (user?.uid !== lastUserUid) {
    setLastUserUid(user?.uid);
    if (user) {
      setLoadingTalepler(true);
    }
  }

  // Real-time listener for current user's leaves
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'izinler'), where('uid', '==', user.uid));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as IzinTalep[];

        // Sort by creation date descending
        data.sort((a, b) => {
          const timeA = a.olusturmaTarihi?.toMillis() || 0;
          const timeB = b.olusturmaTarihi?.toMillis() || 0;
          return timeB - timeA;
        });

        setTalepler(data);
        setLoadingTalepler(false);
      },
      (err) => {
        console.error('İzin talepleri dinlenirken hata:', err);
        setLoadingTalepler(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  // Kendi izin gerekçelerini ayrı koleksiyondan (bkz. yukarıdaki sebepMap
  // yorumu) dinler — yalnızca sahibi ve admin okuyabildiğinden bu sorgu
  // güvenle "kendi uid'im" ile sınırlanır.
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'izin_detaylari'), where('uid', '==', user.uid));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const map: Record<string, string> = {};
        snapshot.docs.forEach((d) => {
          const sebepDeger = d.data().sebep;
          if (typeof sebepDeger === 'string') map[d.id] = sebepDeger;
        });
        setSebepMap(map);
      },
      (err) => {
        console.error('İzin gerekçeleri dinlenirken hata:', err);
      }
    );

    return () => unsubscribe();
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || isSubmitting) return;
    if (isReadOnly) {
      setErrorMessage(GOZLEMCI_SALT_OKUMA_IPUCU);
      return;
    }

    // firestore.rules isValidIzin + isValidIzinTarihAraligi'nin istemci
    // tarafı aynası (bkz. src/lib/validation) — her hata ilişkili olduğu
    // alana bağlanır (aria-invalid/aria-describedby FormField'da otomatik).
    // Yıllık izin kotası: erken, kullanıcı dostu bir uyarı — asıl sert sınır
    // onay anında sunucu tarafında uygulanır (bkz. useAdminIzinlerStore.ts
    // izinGuncelle, firestore.rules isValidMuezzin). Bekleyen (henüz
    // onaylanmamış) diğer yıllık izin talepleri bu hesaba katılmaz — kota
    // yalnızca ONAYLANMIŞ günler üzerinden işler.
    const sonuc = izinFormSemasiOlustur(yillikKalanKota).safeParse({ baslangic, bitis, tip, sebep });
    if (!sonuc.success) {
      const errors: IzinFormAlanHatalari = alanHatalariniCikar(sonuc.error);
      setFieldErrors(errors);
      const firstErrorField = errors.baslangic ? 'izin-baslangic-tarihi' : errors.bitis ? 'izin-bitis-tarihi' : 'izin-gerekce';
      document.getElementById(firstErrorField)?.focus();
      return;
    }

    setFieldErrors({});
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      // izinler + izin_detaylari (sebep) AYNI batch'te, deterministik olarak
      // eşleşen ID ile yazılır (bkz. firestore.rules `isValidIzinDetay`
      // create kuralı — karşılık gelen izinler belgesinin uid'ini doğrular,
      // FR-O3).
      const izinRef = doc(collection(db, 'izinler'));
      const batch = writeBatch(db);
      batch.set(izinRef, {
        uid: user.uid,
        baslangic,
        bitis,
        tip,
        durum: 'onay_bekliyor',
        olusturmaTarihi: Timestamp.now(),
      });
      batch.set(doc(db, 'izin_detaylari', izinRef.id), {
        uid: user.uid,
        sebep: sebep.trim(),
        olusturmaTarihi: Timestamp.now(),
      });
      await batch.commit();

      // Kart-içi mesajın YANINDA global toast da gösterilir — GorevKarti.tsx'teki
      // AYNI çift-kanallı desen (bkz. kod denetimi, premium standart analizi):
      // bu kart modal kapanınca (3sn sonra) unmount olur, toast ise Ayarlar'a
      // geçilse bile ekranda kalıp kalıcı bir onay bırakır.
      const basariMetni = 'İzin talebiniz başarıyla oluşturuldu, yönetici onayına gönderildi.';
      setSuccessMessage(basariMetni);
      showNotification('Talep Gönderildi', basariMetni, 'success');
      setSebep('');
      setBaslangic('');
      setBitis('');
      setTimeout(() => {
        setSuccessMessage(null);
        setIsModalOpen(false);
      }, 3000);
    } catch (err) {
      console.error('İzin talebi oluşturulamadı:', err);
      const hataMetni = 'Talep gönderilirken dizgesel bir hata oluştu.';
      setErrorMessage(hataMetni);
      showNotification('Hata Oluştu', hataMetni, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelRequest = async (id: string) => {
    if (pendingDeleteId !== id) {
      setPendingDeleteId(id);
      setTimeout(() => setPendingDeleteId(null), 3000);
      return;
    }
    setPendingDeleteId(null);
    try {
      // izin_detaylari da AYNI batch'te silinir — aksi halde artık var
      // olmayan bir izinler belgesine referans veren, yalnızca sahibi ve
      // admin tarafından okunabilen (zararsız ama gereksiz) bir yetim kayıt
      // kalırdı.
      const batch = writeBatch(db);
      batch.delete(doc(db, 'izinler', id));
      batch.delete(doc(db, 'izin_detaylari', id));
      await batch.commit();
    } catch (err) {
      console.error('İzin talebi iptal edilemedi:', err);
    }
  };

  return (
    <div className="space-y-8">
      {/* Compact Interactive Station Bento Card */}
      <motion.div
        whileHover={isReadOnly ? {} : { y: -4, scale: 1.01, boxShadow: '0 20px 40px -15px var(--dynamic-aura, rgba(99, 102, 241, 0.15))' }}
        whileTap={isReadOnly ? {} : { scale: 0.99 }}
        onClick={() => {
          if (!isReadOnly) setIsModalOpen(true);
        }}
        title={isReadOnly ? GOZLEMCI_SALT_OKUMA_IPUCU : undefined}
        className={`p-8 spatial-glass rounded-card border-[var(--glass-border)] shadow-[var(--spatial-shadow)] relative overflow-hidden group transition-all duration-500 text-left ${
          isReadOnly ? 'opacity-55 cursor-not-allowed' : 'cursor-pointer hover:border-[var(--dynamic-aura,var(--aura-indigo))]/30'
        }`}
      >
        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-[var(--specular-glow)] to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 pointer-events-none" />
        <div className="absolute right-[-10%] top-[-10%] w-40 h-40 bg-[var(--dynamic-aura,var(--aura-indigo))]/5 blur-[60px] rounded-full pointer-events-none" />

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              <h4 className="premium-label !text-2xs !opacity-70 tracking-wide uppercase">İZİN & MAZERET TALEBİ</h4>
            </div>
            <p className="text-2xs text-muted leading-relaxed max-w-sm font-light">
              {isReadOnly
                ? GOZLEMCI_SALT_OKUMA_IPUCU
                : 'Haftalık izin, yıllık izin ve mazeret taleplerinizi yönetici onayına iletmek için dokunun.'}
            </p>
          </div>

          <button
            type="button"
            disabled={isReadOnly}
            title={isReadOnly ? GOZLEMCI_SALT_OKUMA_IPUCU : undefined}
            className="px-6 py-5 bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] rounded-2xl text-2xs font-bold uppercase tracking-wider flex items-center gap-3 shadow-lg group-hover:scale-105 transition-all duration-300 border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:group-hover:scale-100"
          >
            <Calendar size={13} strokeWidth={2} />
            <span>TALEP OLUŞTUR</span>
          </button>
        </div>
      </motion.div>

      {/* Vacation Request Form Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="İzin ve Mazeret Talebi">
        <div className="flex flex-col py-2 relative text-left">
          <div className="flex flex-col gap-1.5 mb-6 opacity-60">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              <p className="text-2xs font-bold tracking-wide uppercase text-amber-500">YÖNETİCİ ONAYINA GÖNDERİLİR</p>
            </div>
            <span className="text-2xs opacity-40 font-mono">LÜTFEN BİLGİLERİ EKSİKSİZ VE DOĞRU BİR ŞEKİLDE DOLDURUNUZ.</span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {/* Start Date */}
              <FormField
                label="Başlangıç Tarihi"
                htmlFor="izin-baslangic-tarihi"
                error={fieldErrors.baslangic}
                labelClassName="text-2xs font-bold uppercase tracking-wider text-[var(--text-secondary)]/60"
              >
                <input
                  type="date"
                  value={baslangic}
                  onChange={(e) => {
                    setBaslangic(e.target.value);
                    setFieldErrors((prev) => ({ ...prev, baslangic: undefined }));
                  }}
                  required
                  className="w-full bg-[var(--text-primary)]/[0.02] border border-[var(--glass-border)] aria-[invalid=true]:border-[var(--status-danger)]/40 aria-[invalid=true]:bg-[var(--status-danger)]/[0.04] rounded-2xl p-5 text-[var(--text-primary)] focus:outline-none focus:border-[var(--dynamic-aura,var(--aura-indigo))]/50 transition-all font-light text-sm shadow-inner"
                />
              </FormField>

              {/* End Date */}
              <FormField
                label="Bitiş Tarihi"
                htmlFor="izin-bitis-tarihi"
                error={fieldErrors.bitis}
                labelClassName="text-2xs font-bold uppercase tracking-wider text-[var(--text-secondary)]/60"
              >
                <input
                  type="date"
                  value={bitis}
                  onChange={(e) => {
                    setBitis(e.target.value);
                    setFieldErrors((prev) => ({ ...prev, bitis: undefined }));
                  }}
                  required
                  className="w-full bg-[var(--text-primary)]/[0.02] border border-[var(--glass-border)] aria-[invalid=true]:border-[var(--status-danger)]/40 aria-[invalid=true]:bg-[var(--status-danger)]/[0.04] rounded-2xl p-5 text-[var(--text-primary)] focus:outline-none focus:border-[var(--dynamic-aura,var(--aura-indigo))]/50 transition-all font-light text-sm shadow-inner"
                />
              </FormField>
            </div>

            {/* Leave Type Select — bir input'u değil bir düğme grubunu etiketliyor,
                bu yüzden <label htmlFor> yerine role="group" + aria-labelledby kullanılıyor. */}
            <div className="space-y-2">
              <span id="izin-tip-label" className="text-2xs font-bold uppercase tracking-wider text-[var(--text-secondary)]/60">
                Muafiyet Türü
              </span>
              <div role="group" aria-labelledby="izin-tip-label" className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'haftalik', label: 'Haftalık' },
                    { id: 'yillik', label: 'Yıllık' },
                    { id: 'mazeret', label: 'Mazeret' },
                  ] as const
                ).map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    aria-pressed={tip === item.id}
                    onClick={() => setTip(item.id)}
                    className={`py-3.5 rounded-xl text-2xs font-bold uppercase tracking-wider transition-all duration-300 border cursor-pointer ${
                      tip === item.id
                        ? 'bg-[var(--dynamic-aura,var(--aura-indigo))]/20 border-[var(--dynamic-aura,var(--aura-indigo))]/30 text-[var(--dynamic-aura,var(--aura-indigo))]'
                        : 'bg-transparent border-[var(--glass-border)] text-muted hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {tip === 'yillik' && (
                <p className="text-2xs text-muted font-light pt-1">
                  Bu yıl için kalan yıllık izin kotanız:{' '}
                  <span className="font-bold text-[var(--text-primary)]/70">
                    {yillikKalanKota} / {YILLIK_IZIN_KOTASI} gün
                  </span>
                </p>
              )}
            </div>

            {/* Reason Text Area */}
            <FormField
              label="İzin Gerekçesi"
              htmlFor="izin-gerekce"
              error={fieldErrors.sebep}
              labelClassName="text-2xs font-bold uppercase tracking-wider text-[var(--text-secondary)]/60"
            >
              <textarea
                value={sebep}
                onChange={(e) => {
                  setSebep(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, sebep: undefined }));
                }}
                placeholder="Gerekçenizi detaylıca belirtiniz..."
                rows={3}
                maxLength={1000}
                required
                className="w-full bg-[var(--text-primary)]/[0.02] border border-[var(--glass-border)] rounded-2xl p-5 text-[var(--text-primary)] focus:outline-none focus:border-[var(--dynamic-aura,var(--aura-indigo))]/50 transition-all font-light text-sm shadow-inner placeholder:opacity-20 placeholder:font-extralight"
              />
            </FormField>

            {/* Alerts Feedback */}
            <AnimatePresence>
              {errorMessage && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="p-5 rounded-avatar bg-rose-500/10 border border-rose-500/20 text-rose-500 text-2xs leading-relaxed flex items-start gap-3.5"
                >
                  <AlertCircle size={18} className="shrink-0 mt-0.5" />
                  <span>{errorMessage}</span>
                </motion.div>
              )}
              {successMessage && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="p-5 rounded-avatar bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-2xs leading-relaxed flex items-start gap-3.5"
                >
                  <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
                  <span>{successMessage}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Actions Grid */}
            <div className="pt-4 flex items-center gap-6">
              <motion.button
                whileHover={{ y: -3, scale: 1.01, boxShadow: '0 15px 30px rgba(99,102,241,0.2)' }}
                whileTap={{ scale: 0.98 }}
                type="submit"
                disabled={isSubmitting || isReadOnly}
                title={isReadOnly ? GOZLEMCI_SALT_OKUMA_IPUCU : undefined}
                className={`flex-1 py-5 rounded-2xl bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] text-2xs font-bold uppercase tracking-wider shadow-lg flex items-center justify-center gap-3 border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${isSubmitting ? 'opacity-70 cursor-wait' : ''}`}
              >
                {isSubmitting ? (
                  <div className="w-4 h-4 border-2 border-[var(--text-primary)]/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Send size={14} strokeWidth={2} />
                )}
                {isSubmitting ? 'TALEBİNİZ GÖNDERİLİYOR...' : 'İZİN TALEBİNİ GÖNDER'}
              </motion.button>

              <motion.button
                whileHover={{ backgroundColor: 'var(--surface-medium)' }}
                whileTap={{ scale: 0.95 }}
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-8 py-5 text-2xs font-bold uppercase tracking-wide text-[var(--text-secondary)] opacity-40 hover:opacity-100 transition-all border border-[var(--glass-border)] rounded-2xl cursor-pointer bg-transparent"
              >
                VAZGEÇ
              </motion.button>
            </div>
          </form>
        </div>
      </Modal>

      {/* Leave Requests History (Bento Flow) */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pl-2">
          <Calendar size={16} className="text-muted" />
          <h4 className="premium-label !text-2xs !opacity-70 tracking-wide uppercase">İzin Taleplerim ve Durum Akışı</h4>
        </div>

        {loadingTalepler ? (
          <div className="p-8 text-center spatial-glass rounded-card border border-[var(--glass-border)]">
            <div className="w-6 h-6 border-2 border-[var(--dynamic-aura,var(--aura-indigo))]/20 border-t-[var(--dynamic-aura,var(--aura-indigo))] rounded-full animate-spin mx-auto" />
          </div>
        ) : talepler.length === 0 ? (
          <div className="p-8 text-center spatial-glass rounded-card border-dashed border-[var(--text-primary)]/5 flex flex-col items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[var(--text-primary)]/[0.03] border border-[var(--text-primary)]/[0.06] flex items-center justify-center">
              <Calendar size={18} className="text-subtle" strokeWidth={1.5} />
            </div>
            <p className="text-2xs text-[var(--text-secondary)]/75 font-light">Kayıtlı aktif bir izin talebiniz bulunmamaktadır.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3.5">
            {talepler.map((talep) => {
              const startFmt = format(parseISO(talep.baslangic), 'd MMM yyyy', { locale: tr });
              const endFmt = format(parseISO(talep.bitis), 'd MMM yyyy', { locale: tr });
              const typeLabel = talep.tip === 'yillik' ? 'Yıllık İzin' : talep.tip === 'haftalik' ? 'Haftalık İzin' : 'Mazeret İzni';

              return (
                <motion.div
                  key={talep.id}
                  whileHover={{ y: -2 }}
                  className="p-5 sm:p-6 spatial-glass rounded-card border border-[var(--glass-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-5 relative overflow-hidden"
                >
                  {/* Status Indicator Bar */}
                  <div
                    className={`absolute top-0 left-0 bottom-0 w-[3px] ${
                      talep.durum === 'onaylandi'
                        ? 'bg-[var(--status-success)]/40'
                        : talep.durum === 'reddedildi'
                          ? 'bg-[var(--status-danger)]/40'
                          : 'bg-[var(--status-warning)]/40'
                    }`}
                  />

                  <div className="flex items-start gap-4">
                    <div
                      className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border ${
                        talep.durum === 'onaylandi'
                          ? 'bg-[var(--status-success)]/10 text-[var(--status-success)] border-[var(--status-success)]/20'
                          : talep.durum === 'reddedildi'
                            ? 'bg-[var(--status-danger)]/10 text-[var(--status-danger)] border-[var(--status-danger)]/20'
                            : 'bg-[var(--status-warning)]/10 text-[var(--status-warning)] border-[var(--status-warning)]/20'
                      }`}
                    >
                      {talep.durum === 'onaylandi' ? (
                        <CheckCircle2 size={18} />
                      ) : talep.durum === 'reddedildi' ? (
                        <AlertCircle size={18} />
                      ) : (
                        <Hourglass size={18} />
                      )}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[var(--text-primary)]">{typeLabel}</span>
                        <span className="text-2xs opacity-40 font-mono">
                          ({startFmt} - {endFmt})
                        </span>
                      </div>
                      <p className="text-2xs text-muted leading-relaxed font-light italic">
                        "{talep.id ? (sebepMap[talep.id] ?? '…') : ''}"
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 ml-auto sm:ml-0">
                    <span
                      className={`px-4 py-1.5 rounded-full text-2xs font-bold uppercase tracking-wider border shadow-sm ${
                        talep.durum === 'onaylandi'
                          ? 'bg-[var(--status-success)]/10 border-[var(--status-success)]/20 text-[var(--status-success)]'
                          : talep.durum === 'reddedildi'
                            ? 'bg-[var(--status-danger)]/10 border-[var(--status-danger)]/20 text-[var(--status-danger)]'
                            : 'bg-[var(--status-warning)]/10 border-[var(--status-warning)]/20 text-[var(--status-warning)]'
                      }`}
                    >
                      {talep.durum === 'onaylandi' ? 'ONAYLI' : talep.durum === 'reddedildi' ? 'RED' : 'ONAY BEKLİYOR'}
                    </span>

                    {talep.durum === 'onay_bekliyor' && (
                      <motion.button
                        whileHover={{
                          scale: 1.1,
                          backgroundColor:
                            pendingDeleteId === talep.id
                              ? 'color-mix(in srgb, var(--status-danger) 20%, transparent)'
                              : 'color-mix(in srgb, var(--status-danger) 10%, transparent)',
                        }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => handleCancelRequest(talep.id!)}
                        className={`w-8 h-8 rounded-xl bg-transparent border flex items-center justify-center transition-all cursor-pointer ${
                          pendingDeleteId === talep.id
                            ? 'border-[var(--status-danger)]/50 text-[var(--status-danger)] animate-pulse'
                            : 'border-[var(--text-primary)]/5 text-muted hover:text-[var(--status-danger)] hover:border-[var(--status-danger)]/25'
                        }`}
                        title={pendingDeleteId === talep.id ? 'Onaylamak için tekrar tıklayın' : 'İptale tıklayın'}
                        aria-label={pendingDeleteId === talep.id ? 'Onaylamak için tekrar tıklayın' : 'İzin talebini iptal et'}
                      >
                        <Trash2 size={13} />
                      </motion.button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
