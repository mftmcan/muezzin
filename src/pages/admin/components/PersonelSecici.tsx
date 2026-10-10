import { Bot } from 'lucide-react';
import { Muezzin } from '../../../types';

interface PersonelSeciciProps {
  label: string;
  systemSubLabel: string;
  roleSubLabel: string;
  value: string;
  onSelect: (uid: string) => void;
  muezzinler: (Muezzin & { id: string })[];
  /** O gün izinli/sabit izin gününde olduğu için atanamaz olan kişilerin uid'leri — bu kişiler seçilebilir ama görsel olarak işaretlenir ve devre dışı bırakılır. */
  unavailableUids: Set<string>;
}

/**
 * Haftalık çizelge düzenleme modalindeki asil/yedek personel seçici düğme
 * ızgarası. FE-001 uzantısı: HaftalikCizelge.tsx'ten dosya-yerel tanımdan
 * buraya taşındı; JSX birebir korundu (görsel regresyon sıfır fark hedefi).
 */
export function PersonelSecici({ label, systemSubLabel, roleSubLabel, value, onSelect, muezzinler, unavailableUids }: PersonelSeciciProps) {
  return (
    <div className="space-y-4 mt-2 first:mt-0">
      <label className="authority-title !text-2xs opacity-40 ml-1 tracking-wide">{label}</label>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => onSelect('Sistem')}
          className={`p-4 rounded-2xl flex items-center gap-3 transition-all border outline-none ${
            value === 'Sistem'
              ? 'bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] border-[var(--dynamic-aura,var(--aura-indigo))]/60 shadow-[0_10px_20px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_25%,transparent)]'
              : 'bg-[var(--text-primary)]/[0.02] text-[var(--text-secondary)] border-[var(--text-primary)]/5 hover:border-[var(--text-primary)]/10'
          }`}
        >
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-2xs ${
              value === 'Sistem' ? 'bg-[var(--text-primary)]/20' : 'bg-[var(--text-primary)]/5 text-[var(--text-secondary)]'
            }`}
          >
            <Bot size={16} strokeWidth={1.7} />
          </div>
          <div className="text-left">
            <span className="text-2xs font-black uppercase tracking-wider block">Dizge Otomatik</span>
            <span className="text-2xs opacity-60 block leading-tight">{systemSubLabel}</span>
          </div>
        </button>
        {muezzinler
          .filter((m) => m.aktif && m.role === 'muezzin' && m.onayBekliyor !== true)
          .map((m) => {
            const isSelected = value === m.id;
            const isUnavailable = unavailableUids.has(m.id);
            return (
              <button
                key={m.id}
                type="button"
                disabled={isUnavailable}
                title={isUnavailable ? 'Bu tarihte onaylı izinli veya sabit izin gününde — atanamaz.' : undefined}
                onClick={() => onSelect(m.id)}
                className={`p-4 rounded-2xl flex items-center gap-3 transition-all border outline-none ${
                  isUnavailable
                    ? 'bg-[var(--text-primary)]/[0.01] text-muted border-[var(--text-primary)]/5 opacity-50 cursor-not-allowed'
                    : isSelected
                      ? 'bg-[var(--dynamic-aura,var(--aura-indigo))] text-[var(--app-bg)] border-[var(--dynamic-aura,var(--aura-indigo))]/60 shadow-[0_10px_20px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_25%,transparent)]'
                      : 'bg-[var(--text-primary)]/[0.02] text-[var(--text-secondary)] border-[var(--text-primary)]/5 hover:border-[var(--text-primary)]/10'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs ${
                    isSelected && !isUnavailable ? 'bg-[var(--text-primary)]/20' : 'bg-[var(--text-primary)]/5 text-[var(--text-secondary)]'
                  }`}
                >
                  {(m.displayName || 'M').charAt(0)}
                </div>
                <div className="text-left truncate">
                  <span className="text-2xs font-black uppercase tracking-wider block truncate">
                    {(m.displayName || '').split(' ').slice(-1)[0]}
                  </span>
                  <span className="text-2xs opacity-60 block leading-tight">{isUnavailable ? 'İzinli / Müsait Değil' : roleSubLabel}</span>
                </div>
              </button>
            );
          })}
      </div>
    </div>
  );
}
