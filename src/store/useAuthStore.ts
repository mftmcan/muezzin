import { create } from 'zustand';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot, setDoc, deleteDoc, getDoc, getDocFromServer } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

let _authInitStarted = false;

interface AuthState {
  user: User | null;
  role: 'admin' | 'muezzin' | 'gozlemci' | null;
  // "admin rolü VEYA süper-admin" — firestore.rules `isAdmin()` ile AYNI
  // anlam. Admin panelinin tamamına erişimi bu belirler; anlamı bilinçli
  // olarak DEĞİŞTİRİLMEDİ (bkz. premium denetim P1.6).
  isAdmin: boolean;
  // Yalnızca `config/bootstrap.superAdminEmails` listesindeki gerçek
  // süper-adminler. `isAdmin`'in DAR bir alt kümesi — geri alınamaz, toplu
  // yıkıcı işlemler (operasyonel veri sıfırlama, hata günlüklerini toplu
  // silme) sıradan admin'e değil yalnızca buna açılır (bkz. premium
  // denetim P1.6; sunucu tarafı karşılığı: firestore.rules `isSuperAdmin()`).
  isSuperAdmin: boolean;
  // 'gozlemci' rolü salt-okuma: nöbete hiç atanmaz (bkz.
  // firestore.rules `isAssignableDutyUidVeri`) ve izin/mazeret/vekalet gibi
  // hiçbir yazma akışını kullanamaz. Bu bayrak İSTEMCİ tarafı bir
  // nezaket katmanıdır — gerçek sınır firestore.rules'tadır (bkz. premium
  // denetim P1.5).
  isReadOnly: boolean;
  isPending: boolean;
  loading: boolean;
  error: string | null;
  // `error`'dan kasıtlı olarak ayrı tutulur: `error` kullanıcı tarafından
  // "TEKRAR DENE" ile dismiss edilebilen geçici/ağ hatalarını taşır, ama
  // aktif:false (devre dışı hesap) sunucu tarafından belirlenen bir durumdur
  // ve yalnızca canlı `muezzins/{uid}` dinleyicisi aktif:true görünce
  // kendiliğinden temizlenmeli — yoksa "TEKRAR DENE" düğmesi devre dışı
  // hesabı AuthGuard zincirinden geçirip tam uygulamaya sokar (bkz. kod
  // denetimi: auth bypass).
  disabledReason: string | null;
  initialized: boolean;
  init: () => () => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  role: null,
  isAdmin: false,
  isSuperAdmin: false,
  isReadOnly: false,
  isPending: false,
  loading: false, // Start false to avoid initial flash, init will set it
  error: null,
  disabledReason: null,
  initialized: false,

  setError: (error) => set({ error }),
  setLoading: (loading) => set({ loading }),

  init: () => {
    if (get().initialized || _authInitStarted) return () => {};
    _authInitStarted = true;

    set({ loading: true });

    let unsubscribeDoc: (() => void) | null = null;
    let snapshotFailsafe: ReturnType<typeof setTimeout> | null = null;
    let authInitFailsafe: ReturnType<typeof setTimeout> | null = null;
    // firestore.rules `isAdmin()` iki dalı OR'lar: muezzins.role=='admin' VEYA
    // config/bootstrap superAdminEmails üyeliği. Bu store eskiden yalnızca
    // role alanına bakıyordu — bir admin, MuezzinYonetimi üzerinden bir süper-
    // admin'in rolünü yanlışlıkla 'muezzin'e çekerse sunucu hâlâ tam yetki
    // verirdi ama UI admin panelini tamamen gizlerdi (kilitlenme, bkz. yetki
    // denetimi). Bootstrap dokümanı nadiren değiştiğinden bu kontrol uid
    // başına yalnızca BİR kez yapılır; getDoc (cache-öncelikli) kullanılır,
    // getDocFromServer DEĞİL — offline-first davranışı bozmamak için.
    //
    // ÖNCEDEN buraya bir kısayol eklenmişti: kontrol yalnızca role 'admin'
    // DEĞİLSE çalışıyordu (sıradan admin'ler için bir okumayı kısmak adına).
    // Bu, rolü zaten 'admin' olan GERÇEK bir süper-admin için
    // `cachedIsSuperAdminSelf`'i yanlışlıkla `false` bırakıyordu — `isAdmin`
    // için sonuç aynı çıktığından o zaman zararsızdı, ama `isSuperAdmin`
    // (yıkıcı işlem kapısı, bkz. premium denetim P1.6) bu değerden
    // türetildiğinden artık yanlış bir cevap üretirdi. Kısayol kaldırıldı:
    // ekstra okuma uid başına yalnızca BİR kez ve yalnızca oturum başına
    // olduğundan maliyeti ihmal edilebilir.
    let superAdminCheckedForUid: string | null = null;
    let cachedIsSuperAdminSelf = false;

    // Cold start failsafe: if Firebase Auth does not fire within 4.5 seconds (network lag, locked DB, etc.), force load
    authInitFailsafe = setTimeout(() => {
      if (!get().initialized) {
        console.warn('AuthStore: Cold start failsafe triggered (onAuthStateChanged took too long)');
        set({ loading: false, initialized: true });
      }
    }, 4500);

    const handleAuthStateChange = (currentUser: User | null) => {
      if (authInitFailsafe) {
        clearTimeout(authInitFailsafe);
        authInitFailsafe = null;
      }
      // Clean up previous doc listener AND any pending failsafe timer
      unsubscribeDoc?.();
      unsubscribeDoc = null;
      if (snapshotFailsafe) {
        clearTimeout(snapshotFailsafe);
        snapshotFailsafe = null;
      }

      // Only show loading if we are actually checking for a new user
      const currentStoreState = get();
      const shouldShowLoading = !currentStoreState.initialized || currentStoreState.user?.uid !== currentUser?.uid;

      set({
        user: currentUser,
        error: null,
        disabledReason: null,
        loading: currentUser ? shouldShowLoading : false,
      });

      if (!currentUser) {
        set({ role: null, isAdmin: false, isSuperAdmin: false, isReadOnly: false, isPending: false, loading: false, initialized: true });
        return;
      }

      // Failsafe: If snapshot doesn't arrive in 6 seconds, force-stop loading
      // This prevents being stuck on the splash screen indefinitely
      snapshotFailsafe = setTimeout(() => {
        if (get().loading) {
          console.warn('AuthStore: Snapshot failsafe triggered');
          set({ loading: false, initialized: true });
        }
      }, 6000);

      // Bu snapshot callback'i ASENKRON (aşağıda config/bootstrap ve invites
      // okumaları için `await` var). `handleAuthStateChange` yeni bir auth
      // durumunda `unsubscribeDoc?.()` ile dinleyiciyi iptal eder, ama ZATEN
      // UÇUŞTA olan bir callback'i iptal EDEMEZ. Paylaşılan bir cihazda (cami
      // ofisi tableti) admin A çıkış yapıp müezzin B girdiğinde, A'nın
      // `await`te bekleyen callback'i çözülüp `set({role, isAdmin, ...})`
      // çağırıyordu — store'daki `user` artık B olmasına rağmen B'ye A'nın
      // rolü/yetkileri gösteriliyordu (bkz. kod denetimi).
      //
      // `auth.currentUser` yerine store'un kendi `user`'ı ölçüt alınır: e2e
      // testlerinin TEST_USER_UID sahte-auth yolunda (aşağıda)
      // `auth.currentUser` hiç dolmaz, ama `handleAuthStateChange` en başta
      // `set({ user: currentUser })` yaptığından store her iki yolda da güncel
      // auth durumunun TEK doğru kaynağıdır.
      const buCallbackGecerliMi = () => get().user?.uid === currentUser.uid;

      unsubscribeDoc = onSnapshot(
        doc(db, 'muezzins', currentUser.uid),
        async (docSnap) => {
          clearTimeout(snapshotFailsafe!);
          if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.aktif === false) {
              set({
                disabledReason: 'Hesabınız devre dışı bırakılmış.',
                error: null,
                role: null,
                isAdmin: false,
                isSuperAdmin: false,
                isReadOnly: false,
                isPending: false,
                loading: false,
                initialized: true,
              });
            } else {
              if (superAdminCheckedForUid !== currentUser.uid) {
                try {
                  const currentEmail = currentUser.email?.toLowerCase().trim() || '';
                  const bootstrapDoc = currentEmail ? await getDoc(doc(db, 'config', 'bootstrap')) : null;
                  const superAdminEmails: string[] = bootstrapDoc?.exists() ? bootstrapDoc.data().superAdminEmails || [] : [];
                  cachedIsSuperAdminSelf = !!currentEmail && superAdminEmails.includes(currentEmail);
                } catch {
                  // Çevrimdışı/erişim hatası: role alanına güven, güvenli varsayılan.
                  // (Yıkıcı işlemler bu durumda UI'da kapalı kalır — fail-closed.)
                  cachedIsSuperAdminSelf = false;
                }
                superAdminCheckedForUid = currentUser.uid;
              }
              // `await` sırasında oturum değiştiyse (kullanıcı çıkış yaptı ya da
              // başka biri giriş yaptı) bu sonuç artık BAŞKA birine ait — yazma.
              if (!buCallbackGecerliMi()) return;
              const isSuperAdminResolved = cachedIsSuperAdminSelf;
              const isAdminResolved = data.role === 'admin' || isSuperAdminResolved;
              set({
                role: data.role,
                isAdmin: isAdminResolved,
                isSuperAdmin: isSuperAdminResolved,
                // `!isAdminResolved` şartı, yukarıdaki kilitlenme senaryosunun
                // aynısını salt-okuma tarafında da önler: rolü yanlışlıkla
                // 'gozlemci'ye çekilmiş bir süper-admin, sunucu ona hâlâ tam
                // yetki verirken UI'da kendi aksiyonlarından kilitlenmemeli.
                isReadOnly: data.role === 'gozlemci' && !isAdminResolved,
                isPending: !!data.onayBekliyor,
                disabledReason: null,
                loading: false,
                initialized: true,
              });
            }
          } else {
            // New user detection
            try {
              const currentEmail = currentUser.email?.toLowerCase().trim() || '';
              if (!currentEmail) {
                set({ error: 'Google hesabınızda bir e-posta adresi bulunamadı.', loading: false, initialized: true });
                return;
              }

              let inviteData: { displayName?: string; role?: 'admin' | 'muezzin' | 'gozlemci'; haftalikIzinGunu?: number } | null = null;

              // Süper-admin e-postaları config/bootstrap dokümanında tutulur (bkz. firestore.rules
              // isSuperAdminEmail ve scripts/seedSuperAdminConfig.ts).
              const bootstrapDoc = await getDocFromServer(doc(db, 'config', 'bootstrap'));
              const superAdminEmails: string[] = bootstrapDoc.exists() ? bootstrapDoc.data().superAdminEmails || [] : [];
              const isSuperAdmin = superAdminEmails.includes(currentEmail);

              if (isSuperAdmin) {
                inviteData = { displayName: 'Baş Yönetici', role: 'admin' };
              } else {
                // Check invites collection
                const inviteRef = doc(db, 'invites', currentEmail);
                const inviteDoc = await getDocFromServer(inviteRef);
                if (inviteDoc.exists()) {
                  inviteData = inviteDoc.data();
                }
              }

              // Yukarıdaki getDocFromServer okumaları sırasında oturum değiştiyse
              // ne profil yazılmalı ne de store güncellenmeli (bkz.
              // buCallbackGecerliMi tanımındaki gerekçe).
              if (!buCallbackGecerliMi()) return;

              if (!inviteData) {
                set({
                  error: `Dizgede kaydınız bulunamadı. Lütfen yöneticiye e-postanızı (${currentEmail}) bildirin.`,
                  loading: false,
                  initialized: true,
                });
                return;
              }

              const profileData = {
                displayName: inviteData.displayName || currentUser.displayName || 'İsimsiz Kullanıcı',
                aktif: true,
                aylikVakitSayisi: 0,
                role: inviteData.role || 'muezzin',
                fcmToken: '',
                photoURL: currentUser.photoURL || '',
                onayBekliyor: inviteData.role === 'admin' ? false : true,
                email: currentEmail,
                kayitTarihi: new Date().toISOString(),
              };

              if (typeof inviteData.haftalikIzinGunu === 'number') {
                (profileData as typeof profileData & { haftalikIzinGunu: number }).haftalikIzinGunu = inviteData.haftalikIzinGunu;
              }

              await setDoc(doc(db, 'muezzins', currentUser.uid), profileData);

              if (!isSuperAdmin) {
                await deleteDoc(doc(db, 'invites', currentEmail));
              }
              // loading will be set to false on the next snapshot trigger
            } catch (err) {
              // Önceden yalnızca console.error'a yazılıyordu — kimlik doğrulama,
              // uygulamanın en kritik iki veri akışından biri (diğeri: namaz vakitleri)
              // olmasına rağmen telemetri/hata izleme dışı kalıyordu (bkz. kod
              // denetimi). Kullanıcıya gösterilecek Türkçe mesaj zaten elle
              // hazırlanmış olduğundan handleFirestoreError'ın döndürdüğü mesaj
              // kullanılmıyor, yalnızca yapılandırılmış log + telemetri için çağrılıyor.
              handleFirestoreError(err, OperationType.WRITE, `muezzins/${currentUser.uid}`);
              if (!buCallbackGecerliMi()) return;
              set({ error: 'Profiliniz oluşturulurken bir hata oluştu.', loading: false, initialized: true });
            }
          }
        },
        (err) => {
          clearTimeout(snapshotFailsafe!);
          handleFirestoreError(err, OperationType.GET, `muezzins/${currentUser.uid}`);
          set({ loading: false, initialized: true });
        }
      );
    }; // end handleAuthStateChange

    let unsubscribeAuth = () => {};
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const mockUid = isLocalhost ? localStorage.getItem('TEST_USER_UID') : null;

    if (mockUid) {
      console.warn(`TEST MODE: Mocking auth for ${mockUid}`);
      handleAuthStateChange({
        uid: mockUid,
        email: `${mockUid}@example.test`,
        displayName: `Mock ${mockUid}`,
        photoURL: '',
      } as User);
    } else {
      unsubscribeAuth = onAuthStateChanged(auth, handleAuthStateChange);
    }

    return () => {
      unsubscribeAuth();
      unsubscribeDoc?.();
      if (snapshotFailsafe) clearTimeout(snapshotFailsafe);
      if (authInitFailsafe) clearTimeout(authInitFailsafe);
    };
  },
}));
