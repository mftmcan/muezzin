import React, { useMemo } from 'react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { motion, AnimatePresence } from 'motion/react';
import { Logo } from './ui/Logo';
import { LiveClock } from './LiveClock';
import { GeriSayim } from './GeriSayim';
import { parseVakitToDate, getHijriDate, getMinutesDiff, getTurkeyNow } from '../lib/dateUtils';
import { GunlukVakit, Vakit } from '../types';
import { useMinuteTick } from '../hooks/useTime';
import { useGpsVakitStore } from '../store/useGpsVakitStore';
import { useSystemSettingsStore } from '../store/useSystemSettingsStore';
import { useEzanVakitleri } from '../hooks/useEzanVakitleri';
import { useOzelVakitMesaji } from '../hooks/useOzelVakitMesaji';
import { OzelVakitBanner } from './OzelVakitBanner';
import { RamazanHub } from './RamazanHub';
import { useThemeStore } from '../store/useThemeStore';
import { getActiveAuraColor } from '../lib/auraTheme';

// Tip-güvenli vakit saati okuyucu — dinamik bracket notasyonu uyarisini engeller
function getVakitSaati(vakitler: GunlukVakit, vakit: string): string {
  switch (vakit) {
    case 'sabah':
      return vakitler.sabah ?? '';
    case 'gunes':
      return vakitler.gunes ?? '';
    case 'ogle':
      return vakitler.ogle ?? '';
    case 'ikindi':
      return vakitler.ikindi ?? '';
    case 'aksam':
      return vakitler.aksam ?? '';
    case 'yatsi':
      return vakitler.yatsi ?? '';
    default:
      return '';
  }
}

interface AnaEkranHeroProps {
  isLoading: boolean;
  mevcutVakit: Vakit | null;
  sonraki: {
    vakit: Vakit;
    ezanSaati: Date;
  } | null;
  bugunDate: Date;
  bugunVakitler: GunlukVakit | null;
}

const UI_VAKIT_LISTESI = [
  { key: 'sabah', label: 'SABAH' },
  { key: 'gunes', label: 'GÜNEŞ' },
  { key: 'ogle', label: 'ÖĞLE' },
  { key: 'ikindi', label: 'İKİNDİ' },
  { key: 'aksam', label: 'AKŞAM' },
  { key: 'yatsi', label: 'YATSI' },
] as const;

// Aktif vakit kartının dark/light stilleri ve gösterge noktasının rengi.
// Faz 1'de bu, iki ödünç aileye (amber/ruby) düşen bir switch-case'di.
// Faz 2: her vakit artık kendi --vakit-* token'ına sahip (bkz. index.css,
// auraTheme.ts, V15) — altı ayrı Tailwind reçetesi yazmak yerine TEK paylaşılan
// reçete, rengi `--card-accent` yerel CSS değişkeninden okuyor; değişkenin
// kendisi her hücrede `style` ile o vaktin token'ına bağlanıyor (aşağıda
// `getActiveAuraColor(key)`). Işık modunda dolgu artık iki vakitte bir
// tekrar eden bir gradyan değil, doğrudan vaktin kendi tonu.
const AKTIF_VAKIT_KART_DARK =
  'bg-[var(--card-accent)]/25 border-[var(--card-accent)]/65 shadow-[0_0_24px_color-mix(in_srgb,var(--card-accent)_12%,transparent)] scale-[1.02] z-20';
const AKTIF_VAKIT_KART_LIGHT =
  'bg-[var(--card-accent)] border-[var(--card-accent)]/30 shadow-[0_10px_20px_-8px_color-mix(in_srgb,var(--card-accent)_35%,transparent)] scale-[1.02] z-20';
const AKTIF_VAKIT_DOT_SHADOW = 'shadow-[0_0_10px_color-mix(in_srgb,var(--card-accent)_80%,transparent)]';

export const AnaEkranHero = React.memo(({ isLoading, mevcutVakit, sonraki, bugunDate, bugunVakitler }: AnaEkranHeroProps) => {
  // Hero'nun kendisi (GeriSayim/KalanSure'nin aksine) saniyelik hassasiyete
  // ihtiyaç duymuyor — hem sabah→güneş geçiş kontrolü hem de
  // useOzelVakitMesaji zaten dakika hassasiyetinde çalışıyor (vakit
  // verileri "HH:MM" olarak yalnızca dakika hassasiyetinde geliyor). Önceden
  // buradaki `useTime()` tüm Hero'yu (header + 6 vakit kartlı grid + aura
  // gradyanı) saniyede bir yeniden render ediyordu — geri sayımın kendisi
  // zaten kendi izole `useTime()`'ına sahip (bkz. GeriSayim.tsx), bu yüzden
  // Hero'nun her saniye tekrar render olması gereksiz CPU/pil maliyetiydi
  // (bkz. performans analizi). `useMinuteTick` ile bu render sıklığı 60'ta
  // 1'e iner, görsel/mantıksal doğruluk değişmez.
  const minuteTick = useMinuteTick();
  // `minuteTick` yalnızca "dakika değişti, yeniden oku" tetikleyicisi —
  // `getTurkeyNow()` onu argüman olarak almıyor, eslint statik olarak
  // kullanımı göremiyor (bkz. yukarıdaki `hicriDuzeltme` ile aynı desen).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => getTurkeyNow(), [minuteTick]);
  const { gpsEnabled, gpsCoords, gpsKonumAdi } = useGpsVakitStore();
  const { settings } = useSystemSettingsStore();
  // NOT: useEzanVakitleri()'nin `bugunVakitler`'ı GPS açıkken zaten GPS
  // verisine döner — bu yüzden fark rozeti karşılaştırması için GPS'ten
  // bağımsız `resmiBugunVakitler` kullanılır (aksi halde her iki taraf da
  // aynı GPS verisi olur ve fark her zaman 0 çıkardı).
  const { resmiBugunVakitler: officialVakitler } = useEzanVakitleri();
  const { theme } = useThemeStore();
  const isDark = theme === 'dark';

  const currentStatus = useMemo(() => {
    if (!bugunVakitler || !mevcutVakit) return null;

    const dateStr = format(bugunDate, 'yyyy-MM-dd');
    const vakitSaati = getVakitSaati(bugunVakitler, mevcutVakit);
    const baslangicZamani = parseVakitToDate(dateStr, vakitSaati);

    if (!baslangicZamani) return null;

    return {
      mevcutVakit,
      baslangicZamani,
      imsakSaati: parseVakitToDate(dateStr, bugunVakitler.imsak || bugunVakitler.sabah) || undefined,
      sabahEzanSaati: parseVakitToDate(dateStr, bugunVakitler.sabah) || undefined,
      gunesSaati: parseVakitToDate(dateStr, bugunVakitler.gunes) || undefined,
      ogleSaati: parseVakitToDate(dateStr, bugunVakitler.ogle) || undefined,
      aksamSaati: parseVakitToDate(dateStr, bugunVakitler.aksam) || undefined,
    };
  }, [bugunVakitler, mevcutVakit, bugunDate]);

  const uiMevcutVakit = useMemo(() => {
    if (!bugunVakitler || !mevcutVakit || !currentStatus) return mevcutVakit;
    const { gunesSaati } = currentStatus;
    if (!gunesSaati) return mevcutVakit;

    if (mevcutVakit === 'sabah' && now >= gunesSaati) {
      return 'gunes';
    }
    return mevcutVakit;
  }, [mevcutVakit, bugunVakitler, currentStatus, now]);

  // `settings.hicriDuzeltme` getHijriDate()'e argüman olarak geçilmiyor —
  // düzeltme değeri fonksiyon içinde globalThis.__hicriOffset üzerinden
  // okunuyor (bkz. useSystemSettingsStore.ts) — eslint statik olarak
  // kullanımı göremiyor; kasıtlı olarak listede tutuluyor, aksi halde admin
  // düzeltmeyi değiştirdiğinde bu memo yeniden hesaplanmaz.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hijriDate = useMemo(() => getHijriDate(bugunDate), [bugunDate, settings.hicriDuzeltme]);
  const isRamazan = useMemo(() => hijriDate.includes('Ramazan'), [hijriDate]);

  const auraColor = useMemo(() => getActiveAuraColor(uiMevcutVakit), [uiMevcutVakit]);

  // Özel vakit mesajı (kerahat, teheccüd, bayram, teşrik)
  const ozelVakitDurumu = useOzelVakitMesaji(bugunVakitler, bugunDate, now);

  return (
    <div className="w-full flex flex-col items-center justify-center min-h-0 sm:min-h-[640px] lg:h-[calc(100dvh-128px)] lg:min-h-[680px] lg:max-h-[860px] h-auto mt-2">
      <AnimatePresence mode="popLayout">
        {isLoading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="w-full flex-1 min-h-[520px] sm:min-h-[600px] lg:min-h-0 flex items-center justify-center bg-[var(--surface-medium)] rounded-card border border-[var(--glass-border)]"
          >
            <div className="w-12 h-12 rounded-full border-2 border-[var(--dynamic-aura,var(--aura-indigo))]/20 border-t-[var(--dynamic-aura,var(--aura-indigo))] animate-spin" />
          </motion.div>
        ) : (
          // AnimatePresence'ın doğrudan çocuğu tek, kararlı `key`+`exit`'i olan bir
          // motion bileşeni olmalı — burada bir Fragment (`<>`) idi, bu da her
          // saniye (GeriSayim tick'iyle) React'in "Invalid prop `ref` supplied to
          // React.Fragment" uyarısını konsola basmasına yol açıyordu (Fragment ref
          // kabul edemez). Presence takibini bu dıştaki motion.div üstleniyor,
          // içteki kart kendi giriş animasyonunu (y kayması) ayrıca sürdürüyor.
          <motion.div
            key="content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="w-full flex flex-col"
          >
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full flex-1 flex flex-col justify-between min-h-[520px] sm:min-h-[600px] lg:min-h-0 p-4 sm:p-6 xl:p-8 bg-[var(--spatial-glass-bg)] backdrop-blur-xl rounded-card border border-[var(--glass-border)] relative overflow-hidden shadow-[var(--spatial-shadow)]"
            >
              {/* Top specular highlight */}
              <div className="absolute inset-0 bg-gradient-to-b from-[var(--specular-glow)] via-transparent to-transparent pointer-events-none z-0 rounded-card" />
              {/* Single deep sirkadiyen aura — subtle, non-competing */}
              <div
                className="absolute inset-0 rounded-card pointer-events-none transition-all duration-1000"
                style={{
                  background: `radial-gradient(ellipse 80% 50% at 50% 100%, color-mix(in srgb, ${auraColor} 12%, transparent), transparent)`,
                }}
              />

              {/* Header */}
              <div className="w-full flex justify-between items-start z-10 relative">
                {/* Sol: Logo + Tarih + Hicri + Müftülük/GPS */}
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="p-2 sm:p-2.5 bg-[var(--surface-medium)] rounded-xl border border-[var(--glass-border)] flex-shrink-0">
                    <Logo size={28} className="text-[var(--text-primary)]" />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-base sm:text-lg font-light text-[var(--text-primary)] tracking-tight leading-tight">
                      {format(bugunDate, 'd MMMM yyyy', { locale: tr })}
                    </span>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-1.5">
                        <span className="text-2xs font-medium tracking-wide text-[var(--text-secondary)]/80">
                          {gpsEnabled && gpsKonumAdi
                            ? `${gpsKonumAdi} (GPS)`
                            : settings.ilceAdi
                              ? `${settings.ilceAdi} Müftülüğü`
                              : 'Müftülük'}
                        </span>
                        <span className="text-2xs font-medium tracking-wide opacity-75 hidden sm:inline">•</span>
                        {/* Hicri tarih için serif italik — Gregoryen tarihin (üstte,
                            sans-serif) yanında ayrı bir "kayıt sistemi" hissi verir;
                            display katmanının ilk kullanım noktası (bkz. görsel
                            tasarım denetimi V16). */}
                        <span className="text-xs font-serif italic tracking-tight" style={{ color: auraColor }}>
                          {hijriDate}
                        </span>
                      </div>
                    </div>

                    {gpsEnabled && gpsCoords && (
                      <span className="text-2xs font-extrabold text-[var(--status-success)]/90 tracking-wide uppercase mt-0.5 flex items-center gap-1">
                        <span className="relative w-1.5 h-1.5 shrink-0">
                          <span className="absolute inset-0 rounded-full bg-[var(--status-success)]" />
                          <span className="absolute inset-0 rounded-full bg-[var(--status-success)] animate-ping-slow" />
                        </span>
                        GPS AKTİF
                      </span>
                    )}
                  </div>
                </div>
                {/* Sağ: Canlı Saat + Gün adı */}
                <div className="flex flex-col items-end gap-0.5">
                  <LiveClock />
                  <span className="text-2xs text-[var(--text-secondary)]/70 tracking-widest uppercase font-medium">
                    {format(bugunDate, 'EEEE', { locale: tr })}
                  </span>
                </div>
              </div>

              {/* Countdown / Chronograph */}
              <div className="flex-1 flex items-center justify-center z-10 relative py-4 sm:py-6 lg:py-8">
                {sonraki && currentStatus ? (
                  <GeriSayim
                    ezanSaati={sonraki.ezanSaati}
                    baslangicZamani={currentStatus.baslangicZamani}
                    mevcutVakit={uiMevcutVakit ?? currentStatus.mevcutVakit}
                    sonrakiVakit={sonraki.vakit}
                    imsakSaati={currentStatus.imsakSaati}
                    sabahEzanSaati={currentStatus.sabahEzanSaati}
                    gunesSaati={currentStatus.gunesSaati}
                    ogleSaati={currentStatus.ogleSaati}
                    aksamSaati={currentStatus.aksamSaati}
                  />
                ) : (
                  // Ay sonu geçişi gibi geçici veri boşluklarında geri sayım alanının
                  // sessizce boş kalması yerine kullanıcıya durum bildirilir.
                  <div className="flex flex-col items-center gap-3 text-center px-6">
                    <div className="w-8 h-8 rounded-full border-2 border-[var(--dynamic-aura,var(--aura-indigo))]/20 border-t-[var(--dynamic-aura,var(--aura-indigo))] animate-spin" />
                    <span className="text-xs text-[var(--text-secondary)]/60 font-medium">Vakitler güncelleniyor, lütfen bekleyin…</span>
                  </div>
                )}
              </div>

              {/* Vakit Matrix — 6-Column Responsive Grid */}
              {/* `data-testid` yalnızca görsel regresyon testi (tests/e2e/visual.spec.ts)
              bu bölgeyi maskeleyebilsin diye var — aktif/sıradaki vakit vurgusu
              günde ~6 kez değiştiğinden (bkz. `isActive`/`isNext` altta),
              maskelenmezse baseline birkaç saat içinde bayatlar ve gerçek bir
              regresyon olmadan CI'ı kırar (bkz. performans/deploy denetimi). */}
              <div className="w-full z-10 relative mt-4" data-testid="vakit-matrisi">
                {bugunVakitler && (
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {UI_VAKIT_LISTESI.map(({ key, label }, idx) => {
                      const isActive = uiMevcutVakit === key;
                      const isNext = sonraki?.vakit === key;
                      const timeStr = getVakitSaati(bugunVakitler, key);

                      // Determine if this vakit is in the past
                      const mevcutIndex = UI_VAKIT_LISTESI.findIndex((v) => v.key === uiMevcutVakit);
                      const isPast = mevcutIndex !== -1 && idx < mevcutIndex;

                      // Compute dynamic premium styles based on state
                      let cardStyle = '';
                      let cardVars: React.CSSProperties | undefined;
                      let indicatorDot: React.ReactNode = null;
                      let labelColor = '';
                      let timeColor = '';

                      if (isActive) {
                        // Koyu modda: saydam glow gradyan (ince, sinema etkisi)
                        // Acık modda: daha düz, hafif opasiteli kart — vaktin kendi tonu
                        // (bkz. index.css --vakit-* token'ları, V15) her zaman yeterince
                        // koyu/doygun olduğundan ışık modunda da text-primary (neredeyse
                        // siyah) yazılırsa kart okunamaz hale geliyordu (bkz. premium
                        // denetim B3); metin bu yüzden text-[var(--app-bg)] kalıyor.
                        labelColor = isDark ? 'text-[var(--text-primary)] font-bold opacity-90' : 'text-[var(--app-bg)] font-bold';
                        timeColor = isDark
                          ? 'text-[var(--text-primary)] font-semibold drop-shadow-[0_0_12px_rgba(255,255,255,0.4)]'
                          : 'text-[var(--app-bg)] font-semibold drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)]';

                        // Altı vakit artık altı ayrı Tailwind reçetesi yerine TEK paylaşılan
                        // reçeteyi (yukarıda) `--card-accent` yerel değişkeniyle besliyor.
                        cardVars = { '--card-accent': getActiveAuraColor(key as Vakit) } as React.CSSProperties;
                        cardStyle = isDark ? AKTIF_VAKIT_KART_DARK : AKTIF_VAKIT_KART_LIGHT;
                        const dotBg = isDark ? 'bg-[var(--card-accent)]' : 'bg-white/85';
                        indicatorDot = (
                          <div
                            className={`absolute top-2 right-2 w-1.5 h-1.5 rounded-full ${AKTIF_VAKIT_DOT_SHADOW} animate-pulse ${dotBg}`}
                          />
                        );
                      } else if (isNext) {
                        cardStyle =
                          'bg-[var(--dynamic-aura,var(--aura-indigo))]/5 border-[var(--dynamic-aura,var(--aura-indigo))]/30 border-dashed shadow-[0_0_15px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_20%,transparent)] hover:bg-[var(--dynamic-aura,var(--aura-indigo))]/10 hover:border-[var(--dynamic-aura,var(--aura-indigo))]/40';
                        indicatorDot = (
                          <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-[var(--dynamic-aura,var(--aura-indigo))] shadow-[0_0_8px_color-mix(in_srgb,var(--dynamic-aura,var(--aura-indigo))_80%,transparent)] animate-pulse" />
                        );
                        labelColor = 'text-[var(--aura-indigo)] font-bold';
                        timeColor = 'text-[var(--text-primary)] font-medium';
                      } else if (isPast) {
                        cardStyle = 'bg-[var(--surface-low)] border-[var(--glass-border)] opacity-45 hover:opacity-60 scale-[0.98]';
                        labelColor = 'text-[var(--text-secondary)]/55 font-medium';
                        timeColor = 'text-[var(--text-secondary)]/45 font-light';
                      } else {
                        cardStyle =
                          'bg-[var(--surface-low)] border-[var(--glass-border)] hover:bg-[var(--surface-medium)] hover:border-[var(--glass-border)]';
                        labelColor = 'text-[var(--text-secondary)]/60 font-medium';
                        timeColor = 'text-[var(--text-secondary)]/85 font-medium';
                      }

                      let offsetBadge: React.ReactNode = null;
                      if (gpsEnabled && bugunVakitler && officialVakitler) {
                        const officialTimeStr = getVakitSaati(officialVakitler, key);
                        const gpsTimeStr = getVakitSaati(bugunVakitler, key);
                        const diff = getMinutesDiff(officialTimeStr, gpsTimeStr);

                        if (diff !== 0) {
                          const sign = diff > 0 ? '+' : '';
                          const badgeColor =
                            diff > 0
                              ? 'bg-[var(--status-danger)]/15 border-[var(--status-danger)]/20 text-[var(--status-danger)]'
                              : 'bg-[var(--status-success)]/15 border-[var(--status-success)]/20 text-[var(--status-success)]';
                          offsetBadge = (
                            <span
                              className={`absolute -bottom-1 sm:-bottom-1.5 px-1.5 py-0.5 rounded-full border text-2xs font-extrabold tracking-normal transition-all ${badgeColor}`}
                            >
                              {sign}
                              {diff}dk
                            </span>
                          );
                        }
                      }

                      return (
                        // Önceden cursor-pointer + whileHover/whileTap taşıyordu ama onClick
                        // hiç yoktu — dokunan kullanıcı bir tepki görüp hiçbir şeyin
                        // olmadığını fark ediyordu (bkz. görsel tasarım denetimi V10). Bu
                        // hücreler yalnızca bilgi amaçlı; sahte afordans kaldırıldı.
                        <motion.div
                          key={key}
                          style={cardVars}
                          className={`relative flex flex-col items-center justify-center min-h-[72px] sm:min-h-[96px] py-3 sm:py-5 px-2 rounded-xl sm:rounded-2xl border transition-all duration-500 overflow-visible ${cardStyle}`}
                        >
                          {indicatorDot}

                          <span
                            className={`text-2xs sm:text-2xs tracking-wide font-bold mb-1.5 transition-colors duration-500 uppercase ${labelColor}`}
                          >
                            {label}
                          </span>

                          <span className={`text-xs sm:text-base tabular-nums tracking-tight transition-colors duration-500 ${timeColor}`}>
                            {timeStr}
                          </span>

                          {offsetBadge}
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>

            {/* Özel Vakit Banner — Kerahat / Teheccüd / Bayram / Teşrik / Kandil */}
            <OzelVakitBanner durum={ozelVakitDurumu} />

            {/* Ramazan Ayı Özel Hub Bileşeni */}
            {isRamazan && <RamazanHub />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
