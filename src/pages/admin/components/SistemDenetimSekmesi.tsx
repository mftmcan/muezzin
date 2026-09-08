import React, { useState, useEffect } from 'react';
import { db } from '../../../lib/firebase';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { motion } from 'motion/react';
import { ClipboardList, Shield, User } from 'lucide-react';
import { toTurkishLowerCase } from '../../../lib/dateUtils';
import { LoadingState } from '../../../components/ui/LoadingState';
import { EmptyState } from '../../../components/ui/EmptyState';

interface AuditLog {
  id: string;
  actionType: string;
  targetName: string;
  details: string;
  userId: string;
  userDisplayName: string;
  timestamp: unknown;
}

export const SistemDenetimSekmesi = React.memo(({ formatDate }: { formatDate: (ts: unknown) => string }) => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const auditQuery = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(30));
    const unsub = onSnapshot(
      auditQuery,
      (snap) => {
        setLogs(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as AuditLog));
        setLoading(false);
      },
      (err) => {
        console.error('Audit logs listen error:', err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const getActionBadgeColor = (type: string) => {
    // toTurkishLowerCase (bkz. src/lib/dateUtils.ts) — `type` denetim
    // kaydının Türkçe aksiyon adı (ör. "İzin Talebi Kararı", "Personel
    // Arşivleme"), locale'siz .toLowerCase() "İ"yi bozuk çeviriyordu.
    const t = toTurkishLowerCase(type);
    if (t.includes('sil') || t.includes('arşiv') || t.includes('red')) return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
    if (t.includes('ekle') || t.includes('onay') || t.includes('oluştur'))
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (t.includes('güncelle') || t.includes('düzenle') || t.includes('kaydet'))
      return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    return 'bg-[var(--dynamic-aura,var(--aura-indigo))]/10 text-[var(--dynamic-aura,var(--aura-indigo))] border-[var(--dynamic-aura,var(--aura-indigo))]/20';
  };

  // İlk onSnapshot paketi gelmeden önce erken dönüş yapılmazsa, gerçekte
  // henüz hiç veri okunmamışken "Kayıt Bulunmuyor" boş-durum ekranı yanlışlıkla
  // yanıp söner (bkz. premium standart denetimi — EzanOnbellegi.tsx'teki aynı
  // desen).
  if (loading) return <LoadingState label="Denetim izleri okunuyor" />;

  return (
    <div className="space-y-6">
      {/* flex-col sm:flex-row: başlık + sayaç rozeti dar mobil genişlikte
          (≤375px) yan yana sığmıyordu (bkz. KrizAlarmlari.tsx'teki aynı
          desen, mobil yerleşim / premium standart denetimi). */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
        <h4 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <ClipboardList size={16} className="text-[var(--dynamic-aura,var(--aura-indigo))]" />
          Yönetici Denetim İzleri (Audit Logs)
        </h4>
        <span className="premium-label !text-2xs !opacity-20">{logs.length} SON İŞLEM LİSTELENDİ</span>
      </div>

      <div className="space-y-4">
        {logs.length === 0 ? (
          <EmptyState
            icon={<Shield size={36} strokeWidth={1.2} />}
            title="Kayıt Bulunmuyor"
            description="DİZGEDE HENÜZ HİÇBİR YÖNETİCİ İŞLEMİ KAYDEDİLMEMİŞ."
            tone="indigo"
            size="md"
          />
        ) : (
          logs.map((log) => (
            <motion.div
              layout
              key={log.id}
              className="spatial-glass border border-[var(--glass-border)] p-5 rounded-card hover:bg-[var(--text-primary)]/[0.02] transition-colors"
            >
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-[14px] bg-[var(--text-primary)]/[0.03] border border-[var(--text-primary)]/5 flex items-center justify-center text-[var(--dynamic-aura,var(--aura-indigo))] flex-shrink-0 shadow-lg">
                    <User size={18} />
                  </div>
                  <div>
                    <div className="flex items-center flex-wrap gap-2.5">
                      <span className="text-sm font-medium text-[var(--text-primary)] tracking-tight">{log.userDisplayName}</span>
                      <span
                        className={`px-2 py-0.5 rounded-md text-2xs font-bold uppercase tracking-wider border ${getActionBadgeColor(log.actionType)}`}
                      >
                        {log.actionType}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)]/70 mt-1 font-light leading-relaxed">
                      <span className="font-semibold text-[var(--text-secondary)]">{log.targetName}:</span> {log.details}
                    </p>
                  </div>
                </div>
                <div className="text-right sm:flex-shrink-0">
                  <span className="text-2xs text-muted font-bold block">{formatDate(log.timestamp)}</span>
                  <span className="text-2xs text-muted font-mono block mt-1">LOG ID: {log.id}</span>
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
});
