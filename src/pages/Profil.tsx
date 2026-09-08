import React, { useState, useEffect, Suspense, lazy, useRef } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useMuezzinStore } from '../store/useMuezzinStore';

// Kritik bileşenler — hemen yükle
import ProfileHeader from './profil/ProfileHeader';
import ProfileBadges from './profil/ProfileBadges';
import ProfileStats from './profil/ProfileStats';

// Ağır bileşenler — lazy: yalnızca ekrana gelince yüklensin
const PersonalHistoryCard = lazy(() => import('./profil/PersonalHistoryCard'));

/** Hafif bir inline yükleme iskeleti */
function SectionSkeleton() {
  return <div className="skeleton-shimmer h-40 rounded-card border border-[var(--text-primary)]/[0.04]" />;
}

/**
 * LazySection: İçeriği yalnızca viewport'a girdiğinde render eder.
 * Bu, mobil cihazlarda sayfa açılışındaki eş zamanlı ağır yükü dağıtır.
 */
function LazySection({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Intersection Observer: bileşen %10 göründüğünde aktifleştir
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect(); // Bir kez görününce görevini tamamladı
        }
      },
      { rootMargin: '120px', threshold: 0.1 } // 120px önceden başlat (akıcı deneyim)
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return <div ref={ref}>{visible ? children : (fallback ?? <SectionSkeleton />)}</div>;
}

export default function Profil() {
  const user = useAuthStore((s) => s.user);
  const authInitialized = useAuthStore((s) => s.initialized);

  // Kendi profilimiz zaten global useMuezzinStore aboneliğinde mevcut
  // (bkz. StoreInitializer, tüm oturum boyunca `muezzins` koleksiyonunun
  // tamamını dinler) — burada ayrı bir muezzins/{uid} dinleyicisi açmak
  // yerine aynı veriyi paylaşılan store'dan okuyoruz. Önceden Profil.tsx ve
  // MuezzinAyarlari.tsx aynı dokümanı birbirinden bağımsız iki kez
  // dinliyordu (bkz. tasarım denetimi).
  const userData = useMuezzinStore((s) => (user ? s.muezzinMap[user.uid] : undefined)) ?? null;
  const muezzinlerLoading = useMuezzinStore((s) => s.loading);
  const loading = !authInitialized || (!!user && muezzinlerLoading);

  // Rozetler KASITLI OLARAK aylikVakitSayisi değil toplamVakitSayisi
  // kullanır — aksi halde ay değişince sıfırlanan bir sayaç yüzünden
  // kazanılmış bir hizmet rozeti sessizce kaybolurdu (bkz. ProfileBadges.tsx,
  // types.ts toplamVakitSayisi yorumu, kod denetimi).
  const currentToplamVakit = userData?.toplamVakitSayisi || 0;

  return (
    // pb-8: Layout.tsx'teki <main> zaten dock temizliği için pb ayırıyor (bkz.
    // MuezzinAnaEkran.tsx yorumu, mobil yerleşim denetimi) — pb-40 bununla üst
    // üste binip sayfa sonunda gereksiz boşluk bırakıyordu.
    <div className="min-h-screen pb-8 relative overflow-hidden">
      {/* Sabit (sirkadiyen sisteme katılmayan) bir aura blob katmanı önceden
          burada AYRICA render ediliyordu — Layout.tsx zaten global, canlı
          --dynamic-aura'yı okuyan bir 2-blob katman sağlıyor; bu sayfa artık
          o sirkadiyen sisteme katılıyor (bkz. premium denetim B34, O8). */}

      <div className="max-w-xl lg:max-w-2xl xl:max-w-3xl mx-auto px-6 pt-12 md:pt-20 relative z-10">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-6">
            <div className="w-16 h-16 border border-[var(--glass-border)] rounded-full flex items-center justify-center">
              <div className="w-8 h-8 border-t-2 border-[var(--aura-indigo)] rounded-full animate-spin" />
            </div>
            <p className="premium-label !text-2xs !opacity-55 animate-pulse">VERİLER SENKRONİZE EDİLİYOR</p>
          </div>
        ) : (
          <div className="space-y-10">
            {/* 1. Header Profile Box — kritik, hemen render */}
            <ProfileHeader userData={userData} user={user} />

            {/* 2. Rozet İstasyonu — hafif, hemen render */}
            <ProfileBadges toplamVakitSayisi={currentToplamVakit} />

            {/* 3. Core Profile Stats — hafif, hemen render */}
            <ProfileStats userData={userData} />

            {/* 4. Ağır bileşen — LazySection ile kademeli yükleme */}
            <LazySection>
              <Suspense fallback={<SectionSkeleton />}>
                <PersonalHistoryCard user={user} />
              </Suspense>
            </LazySection>
          </div>
        )}
      </div>
    </div>
  );
}
