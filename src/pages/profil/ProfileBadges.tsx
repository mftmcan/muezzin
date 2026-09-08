import { Award, Shield, User } from 'lucide-react';
import { motion } from 'motion/react';

interface ProfileBadgesProps {
  toplamVakitSayisi: number;
}

const BADGES = [
  {
    label: 'Mihrap Görevlisi',
    desc: '5 Vakit Hizmet',
    threshold: 5,
    icon: <User size={20} strokeWidth={1.5} />,
    activeCard:
      'spatial-glass-elevated border-[var(--status-success)]/20 bg-gradient-to-b from-[var(--status-success)]/8 to-[var(--status-success)]/3',
    activeIcon:
      'bg-[var(--status-success)]/15 text-[var(--status-success)] border-[var(--status-success)]/25 shadow-[0_0_12px_color-mix(in_srgb,var(--status-success)_30%,transparent)] animate-pulse',
  },
  {
    label: 'Sadakat Hadimi',
    desc: '15 Vakit Hizmet',
    threshold: 15,
    icon: <Award size={20} strokeWidth={1.5} />,
    activeCard:
      'spatial-glass-elevated border-[var(--aura-indigo)]/20 bg-gradient-to-b from-[var(--aura-indigo)]/8 to-[var(--aura-indigo)]/3',
    activeIcon:
      'bg-[var(--aura-indigo)]/15 text-[var(--aura-indigo)] border-[var(--aura-indigo)]/25 shadow-[0_0_12px_color-mix(in_srgb,var(--aura-indigo)_30%,transparent)] animate-pulse',
  },
  {
    label: 'Vakit Emini',
    desc: '30 Vakit Hizmet',
    threshold: 30,
    icon: <Shield size={20} strokeWidth={1.5} />,
    activeCard:
      'spatial-glass-elevated border-[var(--status-warning)]/20 bg-gradient-to-b from-[var(--status-warning)]/8 to-[var(--status-warning)]/3',
    activeIcon:
      'bg-[var(--status-warning)]/15 text-[var(--status-warning)] border-[var(--status-warning)]/25 shadow-[0_0_12px_color-mix(in_srgb,var(--status-warning)_30%,transparent)] animate-pulse',
  },
] as const;

export default function ProfileBadges({ toplamVakitSayisi }: ProfileBadgesProps) {
  return (
    <motion.div
      whileHover={{ y: -4 }}
      className="p-8 spatial-glass rounded-card border-[var(--glass-border)] shadow-[var(--spatial-shadow)] relative overflow-hidden text-left"
    >
      {/* flex-col sm:flex-row: başlık + "BAŞARI NİŞANLARI" rozeti ikisi de metin
          ağırlıklı olduğundan dar mobil genişlikte (≤375px) yan yana sığmıyordu
          (bkz. KrizAlarmlari.tsx'teki aynı desen, mobil yerleşim denetimi). */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-6 relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--aura-rose)] animate-pulse" />
          <h4 className="premium-label !text-2xs !opacity-70 tracking-wide uppercase">HİZMET VE SADAKAT ROZETLERİ</h4>
        </div>
        <span className="self-start sm:self-auto text-2xs font-bold text-[var(--aura-rose)] bg-[var(--aura-rose)]/10 px-4 py-1.5 rounded-full uppercase tracking-wide">
          BAŞARI NİŞANLARI
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4 relative z-10">
        {BADGES.map((badge) => {
          const earned = toplamVakitSayisi >= badge.threshold;
          return (
            <div
              key={badge.label}
              className={`p-4 rounded-[26px] border flex flex-col items-center justify-center text-center gap-2.5 transition-all duration-500 ${
                earned ? badge.activeCard : 'bg-[var(--text-primary)]/[0.008] border-[var(--text-primary)]/5 opacity-35'
              }`}
            >
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-md border ${
                  earned ? badge.activeIcon : 'bg-[var(--text-primary)]/5 text-subtle border-[var(--text-primary)]/5'
                }`}
              >
                {badge.icon}
              </div>
              <div className="space-y-0.5">
                <p className="text-2xs font-bold text-[var(--text-primary)] leading-none">{badge.label}</p>
                <p className="text-2xs text-muted leading-tight mt-1">{badge.desc}</p>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
