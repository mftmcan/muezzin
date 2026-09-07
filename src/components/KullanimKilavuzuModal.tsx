import React, { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Home,
  Calendar,
  ListChecks,
  CalendarClock,
  User,
  Settings,
  LayoutDashboard,
  CalendarDays,
  Users,
  SlidersHorizontal,
  Eye,
} from 'lucide-react';
import { Modal } from './ui/Modal';
import { useAuthStore } from '../store/useAuthStore';
import { GOZLEMCI_SALT_OKUMA_IPUCU } from '../lib/rolMetinleri';

interface KullanimKilavuzuModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface KilavuzMaddesi {
  icon: LucideIcon;
  title: string;
  desc: string;
}

// İçerik, uygulamanın GERÇEK ekranlarını birebir yansıtır (bkz. FloatingDock.tsx
// ALL_NAV_ITEMS / navConfig.ts getAdminNavItems ile aynı etiketler) — Hakkında
// modalindeki aynı ilkeyle (bkz. HakkindaModal.tsx yorumu), burada da genel
// geçer bir "nasıl kullanılır" metni yerine ekranların gerçekte ne yaptığı
// anlatılıyor.
const MUEZZIN_MADDELERI: KilavuzMaddesi[] = [
  {
    icon: Home,
    title: 'Vakit (Ana Ekran)',
    desc: 'Şu anki ve sıradaki ezan vaktini, bugünün asil/yedek görevlilerini gösterir. Kendi göreviniz varsa burada vurgulanır; gelen vekalet teklifleri de bu ekrandan kabul/red edilir.'
  },
  {
    icon: ListChecks,
    title: 'Görev Kartı: Onay, Mazeret, Devir',
    desc: '"Okudum Onayla" ile görevi teyit edin. Gelemeyecekseniz "Mazeret Bildir" ile bildirin — yedek personel otomatik devreye girer (bu işlem geri alınamaz). "Görevi Devret" ile görevinizi başka bir müezzine teklif edebilirsiniz.'
  },
  {
    icon: CalendarClock,
    title: 'İzin & Mazeret Talebi',
    desc: 'Vakit ekranındaki karttan haftalık, yıllık veya mazeret izni talep edin. Yıllık izinde kalan kotanız gösterilir; talep yönetici onayına gider, onay bekleyenler iptal edilebilir.'
  },
  {
    icon: Calendar,
    title: 'Takvim',
    desc: 'Seçtiğiniz haftanın tüm günlerinde asil ve yedek görevlileri listeler. Bugün mavi, sizin göreviniz olan günler sarı renkle vurgulanır; önceki/sonraki haftaya geçilebilir.'
  },
  {
    icon: User,
    title: 'Profil',
    desc: 'Ad-soyad, hesap durumu, görev biriminiz (ilçe) ve aylık kaç vakitte hizmet ettiğiniz burada görünür. Ad-soyadınızı buradan düzenleyebilirsiniz.'
  },
  {
    icon: Settings,
    title: 'Ayarlar',
    desc: 'Bildirim tercihlerini, koyu/açık temayı ve sesli bildirim okumayı buradan yönetirsiniz. Bildirim geçmişinize ve bu kılavuza da buradan ulaşılır.'
  },
];

const ADMIN_MADDELERI: KilavuzMaddesi[] = [
  {
    icon: LayoutDashboard,
    title: 'Genel Bakış',
    desc: 'Sistem sağlığı skorunu, ekip sayısını, bekleyen davet/izin onaylarını ve aktif kriz uyarılarını özetler. Bekleyen izin taleplerini doğrudan buradan onaylayıp reddedebilirsiniz.'
  },
  {
    icon: CalendarDays,
    title: 'Hizmet Cetveli',
    desc: 'Haftalık nöbet dağılımını düzenlediğiniz ekran — her gün/vakit için asil ve yedek atarsınız ("Dizge Otomatik" veya elle seçim). İzinli personel otomatik devre dışı gösterilir; plan yeniden üretilebilir veya CSV olarak dışa aktarılabilir.'
  },
  {
    icon: Users,
    title: 'Kadro Yönetimi',
    desc: 'Ekibinizdeki müezzinleri ekler, düzenler, aktif/pasif yaparsınız. Bekleyen davetler ve alt sekmedeki izin/mazeret kayıtları da buradan onaylanır.'
  },
  {
    icon: SlidersHorizontal,
    title: 'Dizge Ayarları',
    desc: 'Görev biriminizin ilçesini ve Hicri takvim düzeltmesini ayarlar, ezan vakti önbelleğini günceller, sistem loglarını görüntülersiniz.'
  },
];

function KilavuzListesi({ maddeler }: { maddeler: KilavuzMaddesi[] }) {
  return (
    <div className="flex flex-col gap-1">
      {maddeler.map((madde) => (
        <div key={madde.title} className="flex items-start gap-3.5 py-3.5 border-b border-[var(--glass-border)] last:border-b-0">
          <div className="w-9 h-9 shrink-0 rounded-xl bg-[var(--dynamic-aura,var(--aura-indigo))]/10 text-[var(--dynamic-aura,var(--aura-indigo))] flex items-center justify-center">
            <madde.icon size={16} strokeWidth={1.7} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)]">{madde.title}</p>
            <p className="text-2xs text-[var(--text-secondary)]/75 leading-relaxed mt-0.5">{madde.desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export const KullanimKilavuzuModal: React.FC<KullanimKilavuzuModalProps> = ({ isOpen, onClose }) => {
  const isAdmin = useAuthStore(s => s.isAdmin);
  // GOZLEMCI_SALT_OKUMA_IPUCU birinci şahıs ("Gözlemci ROLÜNDESİNİZ") — bu
  // notu `!isAdmin` gibi geniş bir koşulla göstermek, sıradan bir müezzine
  // de yanlışlıkla "siz gözlemcisiniz" derdi. Yalnızca GERÇEKTEN gözlemci
  // rolündeki kullanıcıya (isReadOnly) gösteriliyor.
  const isReadOnly = useAuthStore(s => s.isReadOnly);
  const [aktifSekme, setAktifSekme] = useState<'muezzin' | 'admin'>('muezzin');

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Kullanım Kılavuzu">
      {/* Sekmeler yalnızca admin rolü için gösterilir — sıradan bir müezzinin
          hiç göremeyeceği "Kadro Yönetimi" gibi ekranları listelemek kafa
          karıştırırdı; admin ise iki tarafı da (kendi müezzin ekranları +
          yönetim paneli) kullanıyor. */}
      {isAdmin && (
        <div role="group" aria-label="Kılavuz bölümü" className="grid grid-cols-2 gap-2 mb-6">
          {(
            [
              { id: 'muezzin', label: 'Müezzin Ekranları' },
              { id: 'admin', label: 'Yönetim Paneli' }
            ] as const
          ).map(sekme => (
            <button
              type="button"
              key={sekme.id}
              aria-pressed={aktifSekme === sekme.id}
              onClick={() => setAktifSekme(sekme.id)}
              className={`py-3 rounded-xl text-2xs font-bold uppercase tracking-wider transition-all duration-300 border cursor-pointer ${
                aktifSekme === sekme.id
                  ? 'bg-[var(--dynamic-aura,var(--aura-indigo))]/20 border-[var(--dynamic-aura,var(--aura-indigo))]/30 text-[var(--dynamic-aura,var(--aura-indigo))]'
                  : 'bg-transparent border-[var(--glass-border)] text-muted hover:text-[var(--text-primary)]'
              }`}
            >
              {sekme.label}
            </button>
          ))}
        </div>
      )}

      <KilavuzListesi maddeler={!isAdmin || aktifSekme === 'muezzin' ? MUEZZIN_MADDELERI : ADMIN_MADDELERI} />

      {isReadOnly && (
        <div className="flex items-start gap-3.5 pt-5 mt-2 border-t border-[var(--glass-border)]">
          <div className="w-9 h-9 shrink-0 rounded-xl bg-[var(--text-primary)]/[0.04] text-[var(--text-secondary)]/60 flex items-center justify-center">
            <Eye size={16} strokeWidth={1.7} />
          </div>
          <p className="text-2xs text-[var(--text-secondary)]/75 leading-relaxed mt-0.5">{GOZLEMCI_SALT_OKUMA_IPUCU}</p>
        </div>
      )}
    </Modal>
  );
};
