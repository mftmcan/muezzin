import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Edit3, CheckCircle2, AlertCircle, Shield, User, Eye } from 'lucide-react';
import { User as FirebaseUser } from 'firebase/auth';
import { Muezzin } from '../../types';
import { kendiAdiniGuncelle } from '../../services/muezzinServisi';
import { zamanAsimiIle, IslemZamanAsimi } from '../../lib/timeoutUtils';

interface ProfileHeaderProps {
  userData: Muezzin | null;
  user: FirebaseUser | null;
}

export default function ProfileHeader({ userData, user }: ProfileHeaderProps) {
  const [editMode, setEditMode] = useState(false);
  const [newName, setNewName] = useState('');
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  // editMode veya displayName değiştiğinde (ör. düzenlemeden vazgeçilince
  // ismi geri yükle) state'i render sırasında ayarla — bkz.
  // useBugunkuGorevlerim.ts'teki aynı desen. Birleşik anahtar, orijinal
  // effect'in [userData?.displayName, editMode] bağımlılık dizisiyle
  // birebir aynı tetiklenme semantiğini korur.
  const syncKey = `${editMode}|${userData?.displayName ?? ''}`;
  const [lastSyncKey, setLastSyncKey] = useState(syncKey);
  if (syncKey !== lastSyncKey) {
    setLastSyncKey(syncKey);
    if (!editMode && userData?.displayName) {
      setNewName(userData.displayName);
    }
  }

  const handleUpdate = async () => {
    if (!user || !newName.trim() || isUpdating) return;
    const trimmedName = newName.trim();

    if (trimmedName.length < 3) {
      setUpdateError('Ad soyad en az 3 karakter olmalıdır.');
      return;
    }
    if (trimmedName.length > 40) {
      setUpdateError('Ad soyad en fazla 40 karakter olmalıdır.');
      return;
    }
    // Validasyon: Sadece harf ve boşluk
    if (!/^[a-zA-ZğüşıöçĞÜŞİÖÇ\s]+$/.test(trimmedName)) {
      setUpdateError('Lütfen geçerli bir isim giriniz (rakam veya özel karakter içermemeli).');
      return;
    }

    setUpdateError(null);
    setUpdateSuccess(false);
    setIsUpdating(true);

    try {
      // Servis katmanına devredildi (handleFirestoreError + audit log) ve
      // çevrimdışıyken sonsuza dek askıda kalabilecek yazım için diğer kritik
      // işlemlerle (okudumOnayla, vekaletKabulEt) AYNI zamanAsimiIle deseniyle
      // sarmalandı (bkz. kod denetimi — önceden bu tek nokta bu korumadan
      // yoksundu, "KAYDEDİLİYOR..." düğmesi çevrimdışıyken sonsuza kilitlenebilirdi).
      await zamanAsimiIle(kendiAdiniGuncelle(user.uid, trimmedName));
      setEditMode(false);
      setUpdateSuccess(true);
      setTimeout(() => setUpdateSuccess(false), 3000);
    } catch (err) {
      if (err instanceof IslemZamanAsimi) {
        setUpdateError(err.message);
      } else {
        setUpdateError(err instanceof Error ? err.message : 'Güncelleme başarısız. Lütfen tekrar deneyin.');
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const isAdmin = userData?.role === 'admin';
  const isObserver = userData?.role === 'gozlemci';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden p-8 md:p-10 spatial-glass rounded-card border-[var(--glass-border)] shadow-[var(--spatial-shadow)]"
    >
      <div className="relative z-10 flex flex-col items-center text-center gap-6">
        <div className="relative">
          <motion.div
            whileHover={{ scale: 1.05, rotate: 2 }}
            className="w-28 h-28 rounded-card bg-[var(--text-primary)]/[0.04] backdrop-blur-3xl border border-[var(--glass-border)] flex items-center justify-center text-6xl font-extralight shadow-[var(--spatial-shadow)] overflow-hidden transition-all duration-700 relative"
          >
            <span className="relative z-10 text-[var(--text-primary)]/90 drop-shadow-[var(--spatial-shadow)]">
              {userData?.photoURL ? (
                <img src={userData.photoURL} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                userData?.displayName?.charAt(0) || 'U'
              )}
            </span>

            <div className="absolute inset-0 bg-gradient-to-br from-[var(--aura-indigo)]/20 via-transparent to-[var(--aura-ruby)]/15" />
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--specular-glow)] to-transparent" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.1),transparent_70%)]" />
          </motion.div>
          {userData?.aktif && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -bottom-2 -right-2 w-9 h-9 rounded-2xl bg-[var(--status-success)] border-[4px] border-[var(--app-bg)] flex items-center justify-center shadow-[var(--spatial-shadow)] shadow-[var(--status-success)]/40"
            >
              <div className="w-2.5 h-2.5 rounded-full bg-[var(--app-bg)] animate-pulse" />
            </motion.div>
          )}
        </div>

        <div className="w-full space-y-3">
          <div className="flex items-center justify-center gap-4 w-full">
            {editMode ? (
              <div className="flex flex-col items-center gap-4 w-full max-w-sm">
                <div className="relative w-full">
                  <label htmlFor="profile-name-input" className="sr-only">
                    Ad Soyad
                  </label>
                  <input
                    id="profile-name-input"
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleUpdate()}
                    disabled={isUpdating}
                    className="bg-[var(--text-primary)]/[0.01] border border-[var(--dynamic-aura,var(--aura-indigo))]/30 px-6 py-4.5 rounded-3xl text-2xl font-light text-[var(--text-primary)] outline-none focus:bg-[var(--text-primary)]/[0.03] focus:border-[var(--dynamic-aura,var(--aura-indigo))]/50 text-center w-full transition-all apple-thin shadow-[0_0_30px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_20%,transparent)] disabled:opacity-50"
                    // Sayfa yüklenirken değil, kullanıcının "düzenle" eylemiyle açtığı bir
                    // inline edit modunda; odağın doğrudan isim alanına gitmesi burada
                    // beklenen davranış.
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                  />
                  <div className="absolute inset-0 rounded-3xl border border-[var(--dynamic-aura,var(--aura-indigo))]/20 blur-sm pointer-events-none" />
                </div>
                <div className="flex items-center gap-3">
                  <motion.button
                    whileHover={{ scale: isUpdating ? 1 : 1.05, y: isUpdating ? 0 : -1 }}
                    whileTap={{ scale: isUpdating ? 1 : 0.95 }}
                    onClick={handleUpdate}
                    disabled={isUpdating}
                    className={`px-5 py-2.5 bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] rounded-xl text-2xs font-extrabold uppercase tracking-wide shadow-lg flex items-center gap-1.5 ${isUpdating ? 'opacity-70 cursor-wait' : ''}`}
                  >
                    {isUpdating ? (
                      <div className="w-3 h-3 border-2 border-[var(--text-primary)]/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <CheckCircle2 size={11} />
                    )}
                    {isUpdating ? 'KAYDEDİLİYOR...' : 'GÜNCELLE'}
                  </motion.button>
                  {!isUpdating && (
                    <motion.button
                      whileHover={{ scale: 1.05, y: -1, backgroundColor: 'var(--surface-medium)' }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => {
                        setEditMode(false);
                        setNewName(userData?.displayName || '');
                        setUpdateError(null);
                      }}
                      className="px-5 py-2.5 bg-[var(--text-primary)]/[0.05] border border-[var(--text-primary)]/10 text-muted hover:text-[var(--text-primary)] rounded-xl text-2xs font-extrabold uppercase tracking-wide transition-all"
                    >
                      İPTAL
                    </motion.button>
                  )}
                </div>
              </div>
            ) : (
              // min-w-0 + truncate: uzun ad-soyadlar (Türkçe'de sık) düzenle butonuyla
              // aynı satırda dar mobil genişlikte kart dışına taşıp kesiliyordu (bkz.
              // HaftalikCizelge.tsx'teki aynı truncate savunması, mobil yerleşim
              // denetimi).
              <div className="flex items-center justify-center gap-4 w-full min-w-0">
                <h3 className="text-3xl md:text-5xl font-light text-[var(--text-primary)] tracking-tight apple-thin hover:font-normal transition-all duration-700 cursor-default truncate min-w-0">
                  {userData?.displayName}
                </h3>
                <motion.button
                  whileHover={{ scale: 1.1, backgroundColor: 'var(--surface-medium)' }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setEditMode(true)}
                  aria-label="İsmi düzenle"
                  className="w-12 h-12 shrink-0 flex items-center justify-center bg-[var(--text-primary)]/[0.03] border border-[var(--glass-border)] rounded-2xl transition-all shadow-lg"
                >
                  <Edit3 size={18} className="text-muted" />
                </motion.button>
              </div>
            )}
          </div>

          <AnimatePresence>
            {updateSuccess && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-2xs font-bold text-[var(--status-success)] text-center tracking-wide uppercase"
              >
                ✓ KİMLİK VERİSİ GÜNCELLENDİ
              </motion.p>
            )}
            {updateError && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-2xs font-bold text-[var(--status-danger)] text-center tracking-wide uppercase flex items-center justify-center gap-2"
              >
                <AlertCircle size={12} /> {updateError}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
          <div className="px-6 py-2.5 rounded-2xl text-2xs font-bold uppercase tracking-wide bg-[var(--text-primary)]/[0.03] border border-[var(--glass-border)] text-[var(--text-primary)]/60 shadow-lg backdrop-blur-md flex items-center gap-1.5">
            {isAdmin ? (
              <Shield size={10} className="text-[var(--aura-indigo)]" />
            ) : isObserver ? (
              <Eye size={10} className="text-[var(--aura-amber)]" />
            ) : (
              <User size={10} className="text-[var(--aura-ruby)]" />
            )}
            <span>{isAdmin ? 'DİZGE YÖNETİCİSİ' : isObserver ? 'MÜFTÜLÜK GÖZLEMCİSİ' : 'GÖREVLİ MÜEZZİN'}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
