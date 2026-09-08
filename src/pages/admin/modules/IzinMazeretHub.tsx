import { motion, AnimatePresence } from 'motion/react';
import IzinYonetimi from './IzinYonetimi';
import MazeretGecmisi from './MazeretGecmisi';
import { Calendar, FileText } from 'lucide-react';
import { SegmentedTabs } from '../../../components/ui/SegmentedTabs';
import { useUrlTab } from '../../../hooks/admin/useUrlTab';

const SUBTAB_IDS = ['izinler', 'mazeretler'] as const;
type SubTab = (typeof SUBTAB_IDS)[number];

export default function IzinMazeretHub() {
  // Diğer admin hub'larıyla aynı desen (bkz. AyarlarHub/PersonelHub): önceden
  // burada yalnızca yerel useState tutuluyordu, bu da PersonelHub'ın kendisi
  // deep-link/sayfa yenilemesinde konumunu koruduğu hâlde bu iç sekmenin her
  // yenilemede "izinler"e sıfırlanmasına yol açıyordu. Üst seviye zaten
  // `subtab` parametresini kullandığından çakışmayı önlemek için burada ayrı
  // bir isim (`izintab`) kullanılır.
  const { activeTab, setActiveTab } = useUrlTab<SubTab>('izintab', SUBTAB_IDS, 'izinler');

  const tabs = [
    { id: 'izinler', label: 'AKTİF İZİN TALEPLERİ', icon: Calendar },
    { id: 'mazeretler', label: 'GEÇMİŞ MAZERET KAYITLARI', icon: FileText },
  ];

  return (
    <div className="flex flex-col gap-10">
      {/* INTERNAL SUB-NAV: Luminous Segmented Control */}
      <SegmentedTabs
        items={tabs}
        activeId={activeTab}
        onChange={(id) => setActiveTab(id as SubTab)}
        ariaLabel="İzin ve mazeret sekmeleri"
        idPrefix="izin"
        variant="segmented"
      />

      {/* CONTENT: Spatial Context Stream */}
      <div className="relative" role="tabpanel" id={`izin-panel-${activeTab}`} aria-labelledby={`izin-tab-${activeTab}`} tabIndex={0}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 16, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -16, filter: 'blur(4px)' }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
          >
            {activeTab === 'izinler' ? <IzinYonetimi /> : <MazeretGecmisi />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
