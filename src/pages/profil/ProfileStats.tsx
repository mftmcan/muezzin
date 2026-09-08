import React from 'react';
import { Award, MapPin, Shield, Calendar, Mail } from 'lucide-react';
import { Muezzin } from '../../types';
import { auth } from '../../lib/firebase';
import { useSystemSettingsStore } from '../../store/useSystemSettingsStore';

interface ProfileStatsProps {
  userData: Muezzin | null;
}

export default function ProfileStats({ userData }: ProfileStatsProps) {
  const settings = useSystemSettingsStore((s) => s.settings);

  // Not: rol bilgisi burada tekrar edilmiyor — ProfileHeader'daki rozette
  // zaten gösteriliyor (bkz. tasarım denetimi: aynı bilgi sayfada iki kez
  // farklı biçimde tekrarlanıyordu).
  const menuItems = [
    {
      icon: <MapPin size={16} />,
      label: 'Görev Birimi',
      value: settings.ilceAdi ? `${settings.ilceAdi} Müftülüğü` : 'Belirsiz',
      color: 'text-[var(--aura-indigo)]',
      bg: 'bg-[var(--aura-indigo)]/10',
    },
    {
      icon: <Shield size={16} />,
      label: 'Hesap Durumu',
      value: userData?.aktif ? 'Aktif ve Doğrulanmış' : 'Pasif',
      color: userData?.aktif ? 'text-[var(--status-success)]' : 'text-[var(--status-danger)]',
      bg: userData?.aktif ? 'bg-[var(--status-success)]/10' : 'bg-[var(--status-danger)]/10',
    },
    {
      icon: <Calendar size={16} />,
      label: 'Haftalık Sabit İzin Günü',
      value: userData?.haftalikIzinGunu
        ? ['Tanımlanmamış', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'][userData.haftalikIzinGunu] ||
          'Tanımlanmamış'
        : 'Tanımlanmamış',
      color: 'text-[var(--aura-amber)]',
      bg: 'bg-[var(--aura-amber)]/10',
    },
    {
      icon: <Mail size={16} />,
      label: 'E-posta',
      value: userData?.email || auth.currentUser?.email || 'Belirsiz',
      color: 'text-[var(--text-primary)]/60',
      bg: 'bg-[var(--text-primary)]/[0.04]',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Performance Card */}
      <div className="p-8 spatial-glass rounded-card flex flex-col sm:flex-row items-center justify-between gap-6 border-[var(--glass-border)] relative overflow-hidden shadow-[var(--spatial-shadow)]">
        <div className="flex items-center gap-6">
          <div className="w-16 h-16 rounded-avatar bg-[var(--status-info)]/10 text-[var(--status-info)] flex items-center justify-center border border-[var(--status-info)]/20 shadow-[var(--spatial-shadow)]">
            <Award size={28} strokeWidth={1.5} />
          </div>
          <div className="text-left space-y-1">
            <p className="premium-label !text-2xs !opacity-65 tracking-wide">AYLIK İSTATİSTİK</p>
            <h3 className="text-xl font-light text-[var(--text-primary)] tracking-tight">Hizmet Edilen Vakit</h3>
          </div>
        </div>

        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-light text-[var(--text-primary)] tracking-tight tabular-nums">
            {userData?.aylikVakitSayisi || 0}
          </span>
          <span className="text-2xs font-bold text-faint tracking-wide uppercase"> Vakit</span>
        </div>
      </div>

      {/* Quick Glance Info Cards */}
      <div className="spatial-glass rounded-card p-4 sm:p-8 shadow-[var(--spatial-shadow)] border-[var(--glass-border)] relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--text-primary)]/[0.01] to-transparent pointer-events-none" />

        <div className="divide-y divide-[var(--glass-border)] relative z-10">
          {menuItems.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between py-6 first:pt-0 last:pb-0 group transition-all">
              <div className="flex items-center gap-6">
                <div className={`w-12 h-12 rounded-2xl ${item.bg} ${item.color} flex items-center justify-center transition-all shadow-sm`}>
                  {React.cloneElement(item.icon as React.ReactElement<{ size?: number; strokeWidth?: number }>, {
                    size: 20,
                    strokeWidth: 1.5,
                  })}
                </div>
                <div>
                  <p className="premium-label !text-2xs !opacity-55 mb-1.5 leading-tight tracking-wide">{item.label}</p>
                  <p className="text-lg font-light text-[var(--text-primary)] tracking-tight leading-tight transition-all duration-500">
                    {item.value}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
