import { useState } from 'react';
import { motion } from 'motion/react';
import { Clock, Megaphone } from 'lucide-react';
import { vekaletKabulEt, vekaletReddet } from '../../services/vekaletServisi';
import { useNotificationStore } from '../../store/useNotificationStore';
import { useAuthStore } from '../../store/useAuthStore';
import { VAKIT_GORA_ISIMLERI, toTurkishUpperCase } from '../../lib/dateUtils';
import { zamanAsimiIle, IslemZamanAsimi } from '../../lib/timeoutUtils';
import { GOZLEMCI_SALT_OKUMA_IPUCU } from '../../lib/rolMetinleri';
import { Vakit, VekaletTalebi } from '../../types';

type TalepKaydi = VekaletTalebi & { id: string };

interface GelenVekaletTalepleriProps {
  gelenVekaletler: TalepKaydi[];
  /** Kabul edilmiş ama cron henüz plana işlemediği devirler (bkz. useVekaletTalepleri). */
  bekleyenDevirler: TalepKaydi[];
}

/**
 * Gelen vekalet teklifleri (P2P gelen kutusu) ve bekleyen devir bildirimleri.
 * Kabul/red aksiyon durumları (`processingVekaletId`, `pendingRejectId`) bu
 * bileşenin ÖZEL durumudur — ekranda yalnız bu kartlar kullanır.
 *
 * Gözlemci salt-okuma (bkz. premium denetim P1.5): kutu görüntülenir ama
 * aksiyonlar kapatılır; sunucu tarafı zaten reddeder (firestore.rules
 * isRecipientVekaletStatusUpdate), bu katman sebebi görünür kılar.
 *
 * MuezzinAnaEkran.tsx'ten FE-001 bileşenleme çalışmasında çıkarıldı; JSX ve
 * animasyon değerleri birebir korundu (görsel regresyon sıfır fark hedefi).
 */
export function GelenVekaletTalepleri({ gelenVekaletler, bekleyenDevirler }: GelenVekaletTalepleriProps) {
  const [pendingRejectId, setPendingRejectId] = useState<string | null>(null);
  const [processingVekaletId, setProcessingVekaletId] = useState<string | null>(null);
  const showNotification = useNotificationStore((s) => s.showNotification);
  const isReadOnly = useAuthStore((s) => s.isReadOnly);

  if (gelenVekaletler.length === 0 && bekleyenDevirler.length === 0) return null;

  return (
    <>
      {/* Gelen Vekalet Talepleri (Real-time P2P Inbox) */}
      {gelenVekaletler.length > 0 && (
        <div className="space-y-3 mb-6 relative z-10">
          {gelenVekaletler.map((talep) => (
            <motion.div
              key={talep.id}
              initial={{ opacity: 0, y: -10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="p-6 spatial-glass border-emerald-500/25 bg-emerald-500/[0.015] shadow-lg shadow-emerald-500/5 rounded-card flex flex-col sm:flex-row sm:items-center justify-between gap-5 relative overflow-hidden"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center shrink-0">
                  <Megaphone size={18} />
                </div>
                <div className="text-left">
                  <span className="text-2xs font-extrabold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2.5 py-1 rounded uppercase tracking-wide leading-none">
                    VEKALET TEKLİFİ
                  </span>
                  <p className="text-sm font-light text-[var(--text-primary)] mt-1">
                    {talep.gonderenIsim} Hocam, size{' '}
                    <strong className="text-[var(--dynamic-aura,var(--aura-indigo))]">{talep.tarih}</strong> günü{' '}
                    <strong className="text-[var(--dynamic-aura,var(--aura-indigo))]">
                      {toTurkishUpperCase(VAKIT_GORA_ISIMLERI[talep.vakit as Vakit] || talep.vakit)}
                    </strong>{' '}
                    vakti vekaletini teklif ediyor.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-auto sm:ml-0">
                <motion.button
                  whileHover={isReadOnly ? {} : { y: -1, scale: 1.03 }}
                  whileTap={isReadOnly ? {} : { scale: 0.97 }}
                  disabled={processingVekaletId === talep.id || isReadOnly}
                  title={isReadOnly ? GOZLEMCI_SALT_OKUMA_IPUCU : undefined}
                  onClick={async () => {
                    if (processingVekaletId || isReadOnly) return;
                    setProcessingVekaletId(talep.id);
                    try {
                      // vekaletKabulEt bir runTransaction kullanır — çevrimdışıyken
                      // sonsuza dek askıda kalabildiğinden (bkz. timeoutUtils.ts
                      // yorumu, beşinci denetim turu) zamanAsimiIle ile sarmalanır;
                      // düğme sonsuza dek "İŞLENİYOR" durumunda kilitli kalmasın.
                      await zamanAsimiIle(vekaletKabulEt(talep.id));
                      // NOT: transfer artık ANLIK değil — bkz. src/services/vekaletServisi.ts
                      // yorumu ("1000 ifade tavanı" kök neden çözümü). Gerçek uid
                      // transferi scripts/vekaletDevirleriniIsle.ts'in bir sonraki
                      // çalışmasına kadar (~10-15 dk) gecikmeli.
                      showNotification(
                        'Kabulünüz Alındı',
                        'Kabulünüz kaydedildi, göreviniz planınıza kısa süre içinde işlenecektir.',
                        'success'
                      );
                    } catch (err: unknown) {
                      if (err instanceof IslemZamanAsimi) {
                        showNotification('Bağlantı Sorunu', err.message, 'warning');
                      } else {
                        showNotification('Hata', err instanceof Error ? err.message : 'Vekalet kabul edilemedi.', 'error');
                      }
                    } finally {
                      setProcessingVekaletId(null);
                    }
                  }}
                  className="px-4 py-2.5 bg-emerald-500 text-[var(--app-bg)] rounded-xl text-2xs font-extrabold uppercase tracking-wide cursor-pointer shadow-md shadow-emerald-500/20 border-none disabled:opacity-45 disabled:cursor-wait"
                >
                  {processingVekaletId === talep.id ? 'İŞLENİYOR' : 'KABUL ET'}
                </motion.button>
                {pendingRejectId === talep.id ? (
                  <motion.button
                    initial={{ scale: 0.95 }}
                    animate={{ scale: 1 }}
                    whileTap={{ scale: 0.97 }}
                    disabled={processingVekaletId === talep.id || isReadOnly}
                    title={isReadOnly ? GOZLEMCI_SALT_OKUMA_IPUCU : undefined}
                    onClick={async () => {
                      if (processingVekaletId || isReadOnly) return;
                      setProcessingVekaletId(talep.id);
                      setPendingRejectId(null);
                      try {
                        await zamanAsimiIle(vekaletReddet(talep.id));
                        showNotification('Reddedildi', 'Vekalet teklifi reddedildi.', 'info');
                      } catch (err: unknown) {
                        if (err instanceof IslemZamanAsimi) {
                          showNotification('Bağlantı Sorunu', err.message, 'warning');
                        } else {
                          showNotification('Hata', err instanceof Error ? err.message : 'İşlem başarısız.', 'error');
                        }
                      } finally {
                        setProcessingVekaletId(null);
                      }
                    }}
                    className="px-4 py-2.5 bg-rose-500 text-[var(--app-bg)] rounded-xl text-2xs font-extrabold uppercase tracking-wide cursor-pointer shadow-md shadow-rose-500/20 border-none disabled:opacity-45 disabled:cursor-wait"
                  >
                    {processingVekaletId === talep.id ? 'İŞLENİYOR' : 'EMİN MİSİNİZ?'}
                  </motion.button>
                ) : (
                  <motion.button
                    whileHover={isReadOnly ? {} : { y: -1, scale: 1.03, backgroundColor: 'rgba(244,63,94,0.15)' }}
                    whileTap={isReadOnly ? {} : { scale: 0.97 }}
                    disabled={!!processingVekaletId || isReadOnly}
                    title={isReadOnly ? GOZLEMCI_SALT_OKUMA_IPUCU : undefined}
                    onClick={() => {
                      if (!isReadOnly) setPendingRejectId(talep.id);
                    }}
                    className="px-4 py-2.5 bg-transparent border border-rose-500/20 text-rose-500 hover:text-rose-400 rounded-xl text-2xs font-extrabold uppercase tracking-wide cursor-pointer hover:bg-rose-500/5 transition-all disabled:opacity-45 disabled:cursor-wait"
                  >
                    REDDET
                  </motion.button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Kabul edilmiş ama scripts/vekaletDevirleriniIsle.ts tarafından henüz
      uygulanmamış devirler — "1000 ifade tavanı" kök neden çözümü sonrası
      transfer artık anlık değil (~10-15 dk gecikmeli), bkz. useVekaletTalepleri
      yorumu. Alıcı, kabul ettiği görevin planına henüz yansımadığını
      görebilsin diye. */}
      {bekleyenDevirler.length > 0 && (
        <div className="space-y-3 mb-6 relative z-10">
          {bekleyenDevirler.map((talep) => (
            <motion.div
              key={talep.id}
              initial={{ opacity: 0, y: -10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="p-6 spatial-glass border-amber-500/25 bg-amber-500/[0.015] shadow-lg shadow-amber-500/5 rounded-card flex items-center gap-4 relative overflow-hidden"
            >
              <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center shrink-0">
                <Clock size={18} />
              </div>
              <div className="text-left">
                <span className="text-2xs font-extrabold bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2.5 py-1 rounded uppercase tracking-wide leading-none">
                  DEVİR İŞLENİYOR
                </span>
                <p className="text-sm font-light text-[var(--text-primary)] mt-1">
                  <strong className="text-[var(--dynamic-aura,var(--aura-indigo))]">{talep.tarih}</strong> günü{' '}
                  <strong className="text-[var(--dynamic-aura,var(--aura-indigo))]">
                    {toTurkishUpperCase(VAKIT_GORA_ISIMLERI[talep.vakit as Vakit] || talep.vakit)}
                  </strong>{' '}
                  vakti için kabulünüz alındı, kısa süre içinde planınıza işlenecektir.
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </>
  );
}
