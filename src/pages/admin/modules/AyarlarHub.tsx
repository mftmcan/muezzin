import { lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { SegmentedTabs } from '../../../components/ui/SegmentedTabs';
import { PageSkeleton } from '../../../components/ui/Skeleton';
import { useUrlTab } from '../../../hooks/admin/useUrlTab';

const EzanOnbellegi = lazy(() => import('./EzanOnbellegi'));
const SistemAyarlari = lazy(() => import('./SistemAyarlari'));
const SistemLoglari = lazy(() => import('./SistemLoglari'));

const SUBTAB_IDS = ['ayarlar', 'onbellek', 'loglar'] as const;
type SubTab = (typeof SUBTAB_IDS)[number];

export default function AyarlarHub() {
  const { activeTab, setActiveTab, isPending } = useUrlTab<SubTab>('subtab', SUBTAB_IDS, 'ayarlar');

  const navItems = [
    { id: 'ayarlar', label: 'Dizge Ayarları' },
    { id: 'onbellek', label: 'Ezan Önbelleği' },
    { id: 'loglar', label: 'Dizge Logları' },
  ];

  return (
    <div className="flex flex-col gap-10 relative min-h-[70dvh] min-w-0 w-full max-w-full">
      {/* Sub-Page Navigation - Spatial Glass Pill */}
      <div className="sticky top-0 z-40 py-2">
        <SegmentedTabs
          items={navItems}
          activeId={activeTab}
          onChange={(id) => setActiveTab(id as SubTab)}
          ariaLabel="Dizge ayarları sekmeleri"
          idPrefix="ayarlar"
          variant="pill"
        />
      </div>

      {/* Module Transition Area */}
      <div
        role="tabpanel"
        id={`ayarlar-panel-${activeTab}`}
        aria-labelledby={`ayarlar-tab-${activeTab}`}
        tabIndex={0}
        className={`relative transition-all duration-1000 ease-[cubic-bezier(0.25,1,0.5,1)] ${isPending ? 'opacity-20 blur-xl scale-[0.98]' : 'opacity-100 blur-0 scale-100'}`}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.6, ease: [0.25, 1, 0.5, 1] }}
          >
            <Suspense fallback={<PageSkeleton />}>
              {activeTab === 'ayarlar' && <SistemAyarlari />}
              {activeTab === 'onbellek' && <EzanOnbellegi />}
              {activeTab === 'loglar' && <SistemLoglari />}
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
