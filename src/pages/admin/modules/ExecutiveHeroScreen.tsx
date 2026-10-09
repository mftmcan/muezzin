import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { useKrizAlarmlariStore } from '../../../store/useKrizAlarmlariStore';
import { useAdminIzinlerStore } from '../../../store/useAdminIzinlerStore';
import { useMuezzinStore } from '../../../store/useMuezzinStore';
import { useNotificationStore } from '../../../store/useNotificationStore';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { LiveClock } from '../../../components/LiveClock';
import { useHaftaPlan } from '../../../hooks/useHaftaPlan';
import { useHaftaBildirimleri } from '../../../hooks/useHaftaBildirimleri';
import { getHaftaIdFromDate, getTurkeyDateString } from '../../../lib/dateUtils';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { HeroBentoGrid } from '../components/HeroBentoGrid';
import { HizmetAkisiTablosu, type HizmetAkisiKaydi } from '../components/HizmetAkisiTablosu';
import { type ActiveModule } from '../config/navConfig';

interface HeroScreenProps {
  muezzinlerSayisi: number;
  cozulmamisSayisi: number;
  pendingIzinler: number;
  /** İlgili store'ların Firestore'dan ilk snapshot'ı henüz vermediğini belirtir —
   * true iken ham "0" yerine yükleniyor iskeleti gösterilir (bkz. tasarım denetimi). */
  statsLoading: boolean;
  setActiveTab: (tab: ActiveModule, subtab?: string) => void;
  onOpenDrawer: (content: 'alarmlar' | 'duyurular' | null) => void;
}

/**
 * Yönetim panelinin "Genel Bakış" hero ekranı. Görsel katman iki bileşene
 * bölündü (bkz. HeroBentoGrid.tsx / HizmetAkisiTablosu.tsx); bu dosya
 * veriyi (store dinleyicileri, hafta-geçişi zamanlayıcısı, izin kararı
 * akışı) türetip onlara aktarır.
 */
export default function ExecutiveHeroScreen({
  muezzinlerSayisi,
  cozulmamisSayisi,
  pendingIzinler,
  statsLoading,
  setActiveTab,
  onOpenDrawer,
}: HeroScreenProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [decisionConfirm, setDecisionConfirm] = useState<{
    open: boolean;
    id: string | null;
    durum: 'onaylandi' | 'reddedildi' | null;
    title: string;
  }>({ open: false, id: null, durum: null, title: '' });
  const alarmlar = useKrizAlarmlariStore((s) => s.alarmlar);
  const alarmlarHatasi = useKrizAlarmlariStore((s) => s.error);
  const izinler = useAdminIzinlerStore((s) => s.izinler);
  const izinlerHatasi = useAdminIzinlerStore((s) => s.error);
  const izinGuncelle = useAdminIzinlerStore((s) => s.izinGuncelle);
  const izinGeriAl = useAdminIzinlerStore((s) => s.izinGeriAl);
  const muezzinMap = useMuezzinStore((s) => s.muezzinMap);
  const showNotification = useNotificationStore((s) => s.showNotification);

  const kararVer = async (id: string, durum: 'onaylandi' | 'reddedildi', title: string) => {
    setProcessingId(id);
    try {
      await izinGuncelle(id, durum);
      showNotification(durum === 'onaylandi' ? 'İzin Onaylandı' : 'İzin Reddedildi', title, durum === 'onaylandi' ? 'success' : 'warning', {
        action: {
          label: 'Geri Al',
          onClick: () => {
            izinGeriAl(id).catch((err) => {
              // kararVer'in ana catch'iyle AYNI desen — izinGeriAl
              // handleFirestoreError üzerinden anlamlı Türkçe mesajlar fırlatır
              // (ör. "İzin talebi bulunamadı."), bunlar önceden sabit bir genel
              // mesajla eziliyordu (bkz. kod denetimi).
              showNotification(
                'Geri Alma Başarısız',
                err instanceof Error ? err.message : 'Karar geri alınamadı, lütfen tekrar deneyin.',
                'error'
              );
            });
          },
        },
        durationMs: 8000,
      });
    } catch (err) {
      // Yıllık izin kotasını aşan bir onay burada anlamlı bir hata mesajıyla
      // (bkz. useAdminIzinlerStore.ts izinGuncelle) reddedilir — genel mesaj
      // bu bilgiyi gizleyip admin'in nedeni anlamasını engellerdi.
      showNotification(
        'İşlem Başarısız',
        err instanceof Error ? err.message : 'İzin kararı işlenemedi. Bağlantı veya yetki durumunu kontrol edin.',
        'error'
      );
    } finally {
      setProcessingId(null);
    }
  };
  // `haftaId` önceden mount anında bir kez hesaplanıp donuyordu (bkz. kod
  // denetimi bulgusu) — bu sekme arka planda açık kalıp Pazartesi gece
  // yarısını (hafta sınırını) geçerse "HAFTALIK PLAN" kutusu, hiçbir store
  // değişmediği sürece (dashboard'da başka bir onSnapshot tetiklenmedikçe)
  // GEÇEN haftanın verisini göstermeye devam ederdi. useBugunkuGorevlerim.ts'teki
  // AYNI gün-geçişi izleme deseni: 60sn'de bir Türkiye takvim gününü kontrol
  // eden bir zamanlayıcı, değiştiğinde state'i günceller.
  const [currentTarihStr, setCurrentTarihStr] = useState(getTurkeyDateString());
  useEffect(() => {
    const interval = setInterval(() => {
      const yeni = getTurkeyDateString();
      if (yeni !== currentTarihStr) setCurrentTarihStr(yeni);
    }, 60000);
    return () => clearInterval(interval);
  }, [currentTarihStr]);
  const haftaId = useMemo(() => getHaftaIdFromDate(currentTarihStr), [currentTarihStr]);
  const { plan, loading: planLoading } = useHaftaPlan(haftaId);
  const { bildirimler: haftaBildirimleri, loading: bildirimLoading } = useHaftaBildirimleri(haftaId);
  const planHazir = Boolean(plan);
  const bekleyenOnaySayisi = haftaBildirimleri.filter((b) => b.durum === 'bekliyor').length;
  const haftalikGorevSayisi = haftaBildirimleri.length;
  const planStatusLabel =
    planLoading || bildirimLoading ? 'Yükleniyor' : planHazir ? (bekleyenOnaySayisi > 0 ? 'Onay bekliyor' : 'Yayında') : 'Plan yok';

  const combinedOperations: HizmetAkisiKaydi[] = [
    ...alarmlar.slice(0, 5).map((a) => ({
      id: a.id,
      title: a.mesaj,
      status: a.cozuldu ? 'completed' : 'active',
      time: a.olusturmaTarihi ? formatDistanceToNow(a.olusturmaTarihi.toDate(), { addSuffix: true, locale: tr }) : 'Az önce',
      type: 'alarm' as const,
    })),
    ...izinler
      .filter((i) => i.durum === 'onay_bekliyor')
      .slice(0, 5)
      .map((i) => ({
        id: i.id,
        title: `${muezzinMap[i.uid]?.displayName || 'Bilinmiyor'} - İzin Talebi`,
        status: 'pending',
        time: i.olusturmaTarihi ? formatDistanceToNow(i.olusturmaTarihi.toDate(), { addSuffix: true, locale: tr }) : 'Az önce',
        type: 'izin' as const,
        tip: i.tip,
        baslangic: i.baslangic,
        bitis: i.bitis,
      })),
  ].sort((a, b) => {
    // Nöbet uyarıları izin taleplerinden önce görünür.
    const weight = { alarm: 0, izin: 1 };
    return weight[a.type as keyof typeof weight] - weight[b.type as keyof typeof weight];
  });

  return (
    <div className="w-full flex flex-col gap-12">
      {/* HEADER SECTION: Executive Calm */}
      <motion.header
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col lg:flex-row lg:items-end justify-between gap-8"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)] animate-pulse" />
            <span className="authority-title !text-2xs !text-emerald-500 font-medium">CANLI DİZGE DURUMU</span>
          </div>
          <h1 className="text-3xl lg:text-5xl font-light text-[var(--text-primary)] tracking-tight leading-none max-w-2xl group-hover:font-medium transition-all duration-1000">
            Yönetim <span className="text-[var(--dynamic-aura,var(--aura-indigo))] italic">Senkronize</span> ve{' '}
            <span className="font-normal group-hover:font-bold transition-all duration-1000">Aktif.</span>
          </h1>
        </div>

        <div className="flex items-center gap-10 px-8 py-4 spatial-glass border border-[var(--glass-border)]">
          <div className="flex flex-col items-end">
            <LiveClock className="text-2xl font-light text-[var(--text-primary)] tracking-tighter leading-none" />
            <span className="authority-title !text-2xs opacity-30 mt-2">YEREL ZAMAN</span>
          </div>
        </div>
      </motion.header>

      {/* BENTO GRID: Immersive Layout */}
      <HeroBentoGrid
        muezzinlerSayisi={muezzinlerSayisi}
        cozulmamisSayisi={cozulmamisSayisi}
        pendingIzinler={pendingIzinler}
        statsLoading={statsLoading}
        sonAlarmMesaji={alarmlar[0]?.mesaj}
        setActiveTab={setActiveTab}
        onOpenDrawer={onOpenDrawer}
        planStatusBilgisi={{ planHazir, bekleyenOnaySayisi, haftalikGorevSayisi, planStatusLabel }}
      />

      {/* LIVE STREAM TABLE: Contextual Intelligence */}
      <HizmetAkisiTablosu
        kayitlar={combinedOperations}
        alarmlarHatasi={alarmlarHatasi}
        izinlerHatasi={izinlerHatasi}
        onIzinKararIstegi={(id, durum, title) => setDecisionConfirm({ open: true, id, durum, title })}
        onOpenDrawer={onOpenDrawer}
        setActiveTab={setActiveTab}
        processingId={processingId}
        expandedId={expandedId}
        setExpandedId={setExpandedId}
      />

      <ConfirmModal
        isOpen={decisionConfirm.open}
        onClose={() => setDecisionConfirm({ open: false, id: null, durum: null, title: '' })}
        onConfirm={() => {
          kararVer(decisionConfirm.id!, decisionConfirm.durum!, decisionConfirm.title);
        }}
        title={decisionConfirm.durum === 'onaylandi' ? 'İzni Onayla' : 'İzni Reddet'}
        message={`${decisionConfirm.title}${decisionConfirm.durum === 'onaylandi' ? ' onaylanacak' : ' reddedilecek'}. Bu kararı daha sonra geri alabilirsiniz.`}
        confirmText={decisionConfirm.durum === 'onaylandi' ? 'EVET, ONAYLA' : 'EVET, REDDET'}
        isDanger={decisionConfirm.durum === 'reddedildi'}
      />
    </div>
  );
}
