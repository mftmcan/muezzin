import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, AlertCircle, Clock, BookOpen } from 'lucide-react';
import { collection, query, where, getDocs, limit, orderBy } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { User as FirebaseUser } from 'firebase/auth';
import { format, parseISO } from 'date-fns';
import { tr } from 'date-fns/locale';
import { VAKIT_GORA_ISIMLERI, toTurkishUpperCase } from '../../lib/dateUtils';
import { Vakit } from '../../types';

interface PersonalHistoryCardProps {
  user: FirebaseUser | null;
}

interface TarihselGorev {
  id: string;
  tarih: string;
  vakit: Vakit;
  durum: 'onaylandi' | 'reddedildi' | 'bekliyor';
  tip: 'asil' | 'yedek' | 'gorev_cagrisi';
}

export default function PersonalHistoryCard({ user }: PersonalHistoryCardProps) {
  const [history, setHistory] = useState<TarihselGorev[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const fetchHistory = async () => {
      setLoading(true);
      try {
        const q = query(
          collection(db, 'bildirimler'),
          where('uid', '==', user.uid),
          where('durum', 'in', ['onaylandi', 'reddedildi']),
          orderBy('tarih', 'desc'),
          limit(30)
        );

        const snapshot = await getDocs(q);
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as TarihselGorev[];

        // Further sort on client by date (just in case) and then updates
        data.sort((a, b) => b.tarih.localeCompare(a.tarih));

        setHistory(data);
      } catch (err) {
        console.error('Görev geçmişi yüklenirken hata:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [user]);

  return (
    <motion.div
      whileHover={{ y: -4 }}
      className="p-8 spatial-glass rounded-card border-[var(--glass-border)] shadow-[var(--spatial-shadow)] relative overflow-hidden text-left"
    >
      {/* flex-col sm:flex-row: başlık + "SON 30 GÖREV" rozeti ikisi de metin
          ağırlıklı olduğundan dar mobil genişlikte (≤375px) yan yana sığmıyordu
          (bkz. KrizAlarmlari.tsx'teki aynı desen, mobil yerleşim denetimi). */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-8 relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <h4 className="premium-label !text-2xs !opacity-70 tracking-wide">KİŞİSEL HİZMET GÜNLÜĞÜ</h4>
        </div>
        <span className="self-start sm:self-auto text-2xs font-bold text-emerald-400 bg-emerald-500/10 px-4 py-1.5 rounded-full uppercase tracking-wide">
          SON 30 GÖREV
        </span>
      </div>

      {loading ? (
        <div className="py-12 text-center">
          <div className="w-6 h-6 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="premium-label !text-2xs !opacity-55 animate-pulse">HİZMET KÜTÜĞÜ SORGULANIYOR</p>
        </div>
      ) : history.length === 0 ? (
        <div className="py-12 text-center border border-dashed border-[var(--text-primary)]/5 rounded-3xl">
          <BookOpen className="text-[var(--text-secondary)] mx-auto mb-4" size={32} strokeWidth={1.5} />
          {/* "Son 30 gün" yanlıştı — sorgu bir tarih aralığı değil, sayı
              (limit(30)) sınırlıdır; hiç kaydı olmayan biri için "30 gün
              içinde bulunamadı" ifadesi var olmayan bir zaman penceresi
              kontrol edilmiş gibi yanıltıyordu (bkz. kod denetimi). */}
          <p className="text-2xs text-[var(--text-secondary)]/75 font-light">
            Henüz onaylanmış veya mazeret bildirilmiş bir göreviniz bulunmamaktadır.
          </p>
        </div>
      ) : (
        <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-[1px] before:bg-[var(--glass-border)]">
          {history.map((gorev, idx) => {
            const isConfirmed = gorev.durum === 'onaylandi';
            const dateObj = parseISO(gorev.tarih);
            const dateFormatted = format(dateObj, 'd MMMM yyyy', { locale: tr });
            const dayName = format(dateObj, 'EEEE', { locale: tr });
            const vakitName = VAKIT_GORA_ISIMLERI[gorev.vakit] || gorev.vakit;

            // Dynamic badge color
            const statusColor = isConfirmed
              ? 'text-[var(--status-success)] border-[var(--status-success)]/10 bg-[var(--status-success)]/5'
              : 'text-[var(--status-danger)] border-[var(--status-danger)]/10 bg-[var(--status-danger)]/5';

            return (
              <motion.div
                key={gorev.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: idx * 0.03 }}
                className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-3 group pb-1.5"
              >
                {/* Timeline node */}
                <div
                  className={`absolute -left-[22px] top-1.5 w-3 h-3 rounded-full border-2 border-[var(--app-bg)] shadow-[var(--spatial-shadow)] ${
                    isConfirmed
                      ? 'bg-[var(--status-success)] shadow-[var(--status-success)]/20'
                      : 'bg-[var(--status-danger)] shadow-[var(--status-danger)]/20'
                  }`}
                />

                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">{toTurkishUpperCase(vakitName)} VAKTİ</span>
                    <span className={`px-2.5 py-0.5 rounded-lg border text-2xs font-extrabold uppercase tracking-wide ${statusColor}`}>
                      {isConfirmed ? 'HİZMET EDİLDİ' : 'MAZERETLİ DEVR'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-2xs text-muted font-light">
                    <Clock size={11} className="text-[var(--dynamic-aura,var(--aura-indigo))]/50" />
                    <span>
                      {dateFormatted}, {dayName}
                    </span>
                    <span className="opacity-40">•</span>
                    <span className="uppercase tracking-wider font-semibold text-2xs">
                      {gorev.tip === 'asil' ? 'ASİL VARDİYA' : 'DESTEK NÖBETİ'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 ml-auto sm:ml-0">
                  {isConfirmed ? (
                    <CheckCircle2 size={16} className="text-[var(--status-success)]/40" />
                  ) : (
                    <AlertCircle size={16} className="text-[var(--status-danger)]/40" />
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
