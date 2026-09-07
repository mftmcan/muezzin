import React, { Suspense, lazy, useState } from 'react';
import { LogOut, Info, Settings, ShieldCheck, BookOpen } from 'lucide-react';
import { motion } from 'motion/react';
import { useAuthStore } from '../store/useAuthStore';
import { useMuezzinStore } from '../store/useMuezzinStore';
import { HakkindaModal } from '../components/HakkindaModal';
import { KullanimKilavuzuModal } from '../components/KullanimKilavuzuModal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { playClick } from '../lib/sounds';
import { performLogout } from '../hooks/useFcmToken';
import { Skeleton } from '../components/ui/Skeleton';

const NotificationSettings = lazy(() => import('../components/NotificationSettings'));

function SettingsSkeleton() {
  return <Skeleton className="h-72" rounded="rounded-card" />;
}

export default function MuezzinAyarlari() {
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  const user = useAuthStore(s => s.user);
  const authInitialized = useAuthStore(s => s.initialized);

  // Kendi profilimiz zaten global useMuezzinStore aboneliğinde mevcut
  // (bkz. StoreInitializer) — burada ayrı bir muezzins/{uid} dinleyicisi
  // açmak yerine aynı veriyi paylaşılan store'dan okuyoruz (bkz. Profil.tsx'teki
  // aynı düzeltme; tasarım denetimi: önceden bu iki sayfa aynı dokümanı
  // birbirinden bağımsız iki kez dinliyordu).
  const userData = useMuezzinStore(s => (user ? s.muezzinMap[user.uid] : undefined)) ?? null;
  const muezzinlerLoading = useMuezzinStore(s => s.loading);
  const loading = !authInitialized || (!!user && muezzinlerLoading);

  const confirmLogout = async () => {
    setLogoutConfirmOpen(false);
    // Bu ekranın kendi "Oturumu Kapat" düğmesi önceden auth.signOut()'u
    // doğrudan çağırıyordu — normal kullanıcıların günlük akışta asıl
    // kullandığı çıkış yolu bu olduğundan, AuthGuard.tsx'e eklenen FCM token
    // temizliği düzeltmesi buradan hiç geçmiyordu (bkz. performLogout
    // yorumu, code-review — dördüncü denetim turu).
    //
    // `navigate('/')` (salt SPA yönlendirmesi) ARTIK YETERSİZ: performLogout
    // artık paylaşılan `db` Firestore istemcisini `terminate()` ediyor (bkz.
    // o fonksiyonun Firestore önbelleği temizliği yorumu) — sayfa sert bir
    // reload ile yeniden başlamazsa `db` sonlandırılmış durumda kalır ve
    // navigate sonrası mount olan HER bileşenin Firestore çağrısı sessizce
    // başarısız olurdu. AdminPanel.tsx'in kendi çıkış yoluyla AYNI desen.
    await performLogout();
    window.location.reload();
  };

  return (
    // pb-8: Layout.tsx'teki <main> zaten dock temizliği için pb ayırıyor (bkz.
    // MuezzinAnaEkran.tsx yorumu, mobil yerleşim denetimi) — pb-40 bununla üst
    // üste binip sayfa sonunda gereksiz boşluk bırakıyordu.
    <div className="min-h-screen pb-8 relative overflow-hidden">
      {/* Sabit (sirkadiyen sisteme katılmayan) bir aura blob katmanı önceden
          burada AYRICA render ediliyordu — Layout.tsx zaten global, canlı
          --dynamic-aura'yı okuyan bir 2-blob katman sağlıyor; bu sayfa artık
          o sirkadiyen sisteme katılıyor (bkz. premium denetim B34, O8). */}

      <div className="max-w-xl lg:max-w-2xl xl:max-w-3xl mx-auto px-6 pt-12 md:pt-20 relative z-10 space-y-8">
        <motion.header
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          className="spatial-glass p-8 rounded-card border-[var(--glass-border)] shadow-[var(--spatial-shadow)]"
        >
          <div className="flex items-center gap-5">
            <div className="w-14 h-14 rounded-avatar bg-[var(--dynamic-aura,var(--aura-indigo))]/10 text-[var(--dynamic-aura,var(--aura-indigo))] border border-[var(--dynamic-aura,var(--aura-indigo))]/20 flex items-center justify-center">
              <Settings size={24} strokeWidth={1.5} />
            </div>
            <div>
              <p className="premium-label !text-2xs !opacity-50 tracking-wide">KİŞİSEL UYGULAMA AYARLARI</p>
              <h1 className="text-3xl font-light text-[var(--text-primary)] tracking-tight mt-1">Ayarlar</h1>
            </div>
          </div>
        </motion.header>

        {loading ? (
          <SettingsSkeleton />
        ) : (
          <Suspense fallback={<SettingsSkeleton />}>
            <NotificationSettings userData={userData} user={user} />
          </Suspense>
        )}

        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="spatial-glass rounded-card p-5 sm:p-8 border-[var(--glass-border)] shadow-[var(--spatial-shadow)]"
        >
          <div className="divide-y divide-[var(--glass-border)]">
            <button
              type="button"
              onClick={() => {
                playClick();
                setIsGuideOpen(true);
              }}
              className="w-full flex items-center justify-between gap-5 py-5 first:pt-0 text-left group"
            >
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-2xl bg-[var(--text-primary)]/[0.04] border border-[var(--glass-border)] text-[var(--text-primary)]/55 flex items-center justify-center group-hover:text-[var(--dynamic-aura,var(--aura-indigo))] transition-colors">
                  <BookOpen size={18} strokeWidth={1.6} />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Kullanım Kılavuzu</p>
                  <p className="text-2xs text-[var(--text-secondary)]/75 mt-1">Ekranların ne işe yaradığını kısaca öğrenin</p>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                playClick();
                setIsAboutOpen(true);
              }}
              className="w-full flex items-center justify-between gap-5 py-5 first:pt-0 text-left group"
            >
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-2xl bg-[var(--text-primary)]/[0.04] border border-[var(--glass-border)] text-[var(--text-primary)]/55 flex items-center justify-center group-hover:text-[var(--dynamic-aura,var(--aura-indigo))] transition-colors">
                  <Info size={18} strokeWidth={1.6} />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Hakkında</p>
                  <p className="text-2xs text-[var(--text-secondary)]/75 mt-1">Sürüm, teknoloji ve uygulama bilgileri</p>
                </div>
              </div>
              {/* Hardcoded "v2.2.0" bir sonraki sürüm çıkışında güncellenmeyi
                  unutma riski taşıyordu (bkz. kod denetimi) — telemetryService.ts
                  zaten build-zamanı enjekte edilen __APP_VERSION__'ı kullanıyor. */}
              <span className="premium-label !text-2xs !opacity-35">v{__APP_VERSION__}</span>
            </button>

            <button
              type="button"
              onClick={() => setLogoutConfirmOpen(true)}
              className="w-full flex items-center justify-between gap-5 py-5 last:pb-0 text-left group"
            >
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500/70 flex items-center justify-center group-hover:text-rose-500 transition-colors">
                  <LogOut size={18} strokeWidth={1.6} />
                </div>
                <div>
                  <p className="text-sm font-medium text-rose-500/85">Oturumu Kapat</p>
                  <p className="text-2xs text-[var(--text-secondary)]/75 mt-1">Bu cihazdaki aktif oturumu sonlandırır</p>
                </div>
              </div>
              <ShieldCheck size={16} className="text-muted" />
            </button>
          </div>
        </motion.section>
      </div>

      <KullanimKilavuzuModal isOpen={isGuideOpen} onClose={() => setIsGuideOpen(false)} />
      <HakkindaModal isOpen={isAboutOpen} onClose={() => setIsAboutOpen(false)} />
      <ConfirmModal
        isOpen={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
        onConfirm={confirmLogout}
        title="Oturumu Kapat"
        message="Bu cihazdaki aktif oturumunuzu kapatmak üzeresiniz. Devam etmek istiyor musunuz?"
        confirmText="Çıkış Yap"
        cancelText="Vazgeç"
        isDanger
      />
    </div>
  );
}
