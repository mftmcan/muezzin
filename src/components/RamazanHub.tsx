import React, { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { Star, BookOpen, Check, Award, Flame } from 'lucide-react';
import { useEzanVakitleri } from '../hooks/useEzanVakitleri';
import { useTime } from '../hooks/useTime';
import { parseVakitToDate } from '../lib/dateUtils';
import { parseHijriDate } from '../lib/islamicCalendar';

import { useSystemSettingsStore } from '../store/useSystemSettingsStore';

// Sabit etiketler — IDE'nin i18n taramasından kaçmak için JSX literal değil değişken olarak kullanilir.
const RAMAZAN_LABELS = {
  baslik: 'Ramazan-ı Şerif',
  mukabele: 'Mukabele',
  teravihTakipcisi: 'Teravih Takipçisi',
} as const;

// Ay Fazı Görsel Temsili
// Hicri günün (1-30) konumuna göre hilalin açısını ve büyüklüğünü taklit eder.
// Modül düzeyinde tanımlı — bileşen içinde tanımlanırsa her render'da yeniden
// oluşturulup React tarafından yeni bir component tipi olarak görülür.
const MoonPhaseView: React.FC<{ day: number }> = ({ day }) => {
  if (day <= 1 || day >= 29) {
    // İnce Hilal (Yeni Ay / Son Ay)
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-amber-300">
        <path d="M12 3a9 9 0 1 0 9 9 9.1 9.1 0 0 1-9-9Z" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M12 3a9 9 0 0 0 0 18 9 9 0 0 1 0-18Z" fill="currentColor" />
      </svg>
    );
  } else if (day > 1 && day < 7) {
    // Genişleyen Hilal
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-amber-300">
        <path d="M12 3a9 9 0 1 0 9 9 9.1 9.1 0 0 1-9-9Z" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M12 3a9 9 0 0 0 5 18 9 9 0 0 1-5-18Z" fill="currentColor" />
      </svg>
    );
  } else if (day >= 7 && day < 12) {
    // İlk Dördün
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-amber-300">
        <path d="M12 3a9 9 0 1 0 9 9 9.1 9.1 0 0 1-9-9Z" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M12 3v18a9 9 0 0 0 0-18Z" fill="currentColor" />
      </svg>
    );
  } else if (day >= 12 && day < 18) {
    // Şişkin Ay / Dolunay (14-15-16. Günler)
    return (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        className="text-amber-300 filter drop-shadow-[0_0_4px_rgba(251,191,36,0.4)]"
      >
        <circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity="0.9" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  } else if (day >= 18 && day < 23) {
    // Son Dördün
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-amber-300">
        <path d="M12 3a9 9 0 1 0 9 9 9.1 9.1 0 0 1-9-9Z" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M12 3a9 9 0 0 0 0 18V3Z" fill="currentColor" />
      </svg>
    );
  } else {
    // Küçülen Hilal
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-amber-300">
        <path d="M12 3a9 9 0 1 0 9 9 9.1 9.1 0 0 1-9-9Z" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M12 21a9 9 0 0 1-5-18 9 9 0 0 0 5 18Z" fill="currentColor" />
      </svg>
    );
  }
};

export const RamazanHub: React.FC = () => {
  const now = useTime();
  const { bugunVakitler, yarinVakitler, loading } = useEzanVakitleri();
  const { settings } = useSystemSettingsStore();

  // 1. Ramazan Ayı & Gün Bilgisi Tespiti
  const hijriGunu = useMemo(() => {
    if (loading || !bugunVakitler?.tarih) return { day: 1, isRamazan: false };
    const dateParts = bugunVakitler.tarih.split('-').map(Number);
    const parsedDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
    const { day, month } = parseHijriDate(parsedDate);
    return { day, isRamazan: month === 9 };
    // `settings.hicriDuzeltme` parseHijriDate'e doğrudan geçilmiyor — hicri
    // düzeltme değeri getHijriDate() (dateUtils.ts) içinde globalThis.__hicriOffset
    // üzerinden okunuyor (bkz. useSystemSettingsStore.ts). Bu yüzden eslint
    // statik olarak kullanımı göremiyor; kasıtlı olarak listede tutuluyor —
    // aksi halde admin düzeltmeyi değiştirdiğinde bu memo yeniden hesaplanmaz
    // ve gün stale kalır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bugunVakitler?.tarih, loading, settings.hicriDuzeltme]);

  const ramazanGunuStr = `Ramazan-ı Şerif'in ${hijriGunu.day}. Günü`;

  // 2. LocalStorage Yardımıyla Günlük Takip Kayıtları
  // Anahtara Hicri gün SAYISI (1-30) YANI SIRA miladi tarih de eklenir —
  // yalnızca hijriGunu.day kullanılsaydı, Ramazan her yıl aynı gün
  // numaralarını tekrarladığından bir sonraki yılın aynı Ramazan gününde
  // önceki yıldan kalan "oruç tuttum/cüz okudum/teravih kıldım" işaretleri
  // otomatik olarak geri gelirdi (bkz. kod denetimi, kritik bulgu). Miladi
  // tarih (bugunVakitler.tarih) her gün için biriciktir.
  const storageKeys = useMemo(() => {
    const gunAnahtari = bugunVakitler?.tarih ?? `gun-${hijriGunu.day}`;
    return {
      cuz: `muezzin_ramazan_cuz_${gunAnahtari}`,
      teravih: `muezzin_ramazan_teravih_${gunAnahtari}`,
      oruc: `muezzin_ramazan_oruc_${gunAnahtari}`,
    };
  }, [bugunVakitler?.tarih, hijriGunu.day]);

  const gunlukKayitOku = (keys: typeof storageKeys) => {
    if (typeof window === 'undefined') {
      return { cuzOkundu: false, teravihRekat: 0, orucTutuldu: false };
    }
    return {
      cuzOkundu: localStorage.getItem(keys.cuz) === 'true',
      teravihRekat: Number(localStorage.getItem(keys.teravih) || '0'),
      orucTutuldu: localStorage.getItem(keys.oruc) === 'true',
    };
  };

  const [cuzOkundu, setCuzOkundu] = useState(() => gunlukKayitOku(storageKeys).cuzOkundu);
  const [teravihRekat, setTeravihRekat] = useState(() => gunlukKayitOku(storageKeys).teravihRekat);
  const [orucTutuldu, setOrucTutuldu] = useState(() => gunlukKayitOku(storageKeys).orucTutuldu);

  // Hicri gün değiştiğinde (storageKeys değişir) kayıtları render sırasında
  // yeniden oku — bkz. useBugunkuGorevlerim.ts'teki aynı desen.
  const [lastStorageKeys, setLastStorageKeys] = useState(storageKeys);
  if (storageKeys !== lastStorageKeys) {
    setLastStorageKeys(storageKeys);
    const kayit = gunlukKayitOku(storageKeys);
    setCuzOkundu(kayit.cuzOkundu);
    setTeravihRekat(kayit.teravihRekat);
    setOrucTutuldu(kayit.orucTutuldu);
  }

  const toggleCuz = () => {
    const val = !cuzOkundu;
    setCuzOkundu(val);
    localStorage.setItem(storageKeys.cuz, String(val));
  };

  const incrementTeravih = () => {
    const next = (teravihRekat + 4) % 24; // 0, 4, 8, 12, 16, 20, reset to 0
    setTeravihRekat(next);
    localStorage.setItem(storageKeys.teravih, String(next));
  };

  const toggleOruc = () => {
    const val = !orucTutuldu;
    setOrucTutuldu(val);
    localStorage.setItem(storageKeys.oruc, String(val));
  };

  // 3. İftar / Sahur Sayaç ve İlerleme Hesaplamaları
  const zamanVerileri = useMemo(() => {
    if (loading || !bugunVakitler || !yarinVakitler) {
      return { mod: 'gunduz' as const, yuzde: 0, kalanSaniye: 0, metin: '00:00:00', etiket: 'İftara Kalan' };
    }

    const imsakDate = parseVakitToDate(bugunVakitler.tarih, bugunVakitler.sabah);
    const iftarDate = parseVakitToDate(bugunVakitler.tarih, bugunVakitler.aksam);
    const yatsiDate = parseVakitToDate(bugunVakitler.tarih, bugunVakitler.yatsi);

    if (!imsakDate || !iftarDate || !yatsiDate) {
      return { mod: 'gunduz' as const, yuzde: 0, kalanSaniye: 0, metin: '00:00:00', etiket: 'İftara Kalan' };
    }

    const time = now.getTime();

    // A. Oruçlu Dönem (İmsak ile İftar Arası)
    if (time >= imsakDate.getTime() && time < iftarDate.getTime()) {
      const toplamMs = iftarDate.getTime() - imsakDate.getTime();
      const gecenMs = time - imsakDate.getTime();
      const yuzde = Math.min(100, Math.max(0, (gecenMs / toplamMs) * 100));
      const kalanSaniye = Math.floor((iftarDate.getTime() - time) / 1000);

      const h = String(Math.floor(kalanSaniye / 3600)).padStart(2, '0');
      const m = String(Math.floor((kalanSaniye % 3600) / 60)).padStart(2, '0');
      const s = String(kalanSaniye % 60).padStart(2, '0');

      return {
        mod: 'gunduz' as const,
        yuzde,
        kalanSaniye,
        metin: `${h}:${m}:${s}`,
        etiket: 'İftara Kalan',
      };
    }

    // B. Yeme-İçme/Sahur Hazırlığı Dönemi (İftar sonrası)
    let baslangicMs = iftarDate.getTime();
    let bitisMs = 0;

    const yarinImsakDate = parseVakitToDate(yarinVakitler.tarih, yarinVakitler.sabah);
    if (yarinImsakDate) {
      bitisMs = yarinImsakDate.getTime();
    } else {
      // Yedek durum: İftardan 8 saat sonrası
      bitisMs = iftarDate.getTime() + 8 * 60 * 60 * 1000;
    }

    // Eğer gece yarısından sonraysak ve bugünkü imsaktan önceysek
    if (time < imsakDate.getTime()) {
      bitisMs = imsakDate.getTime();
      // Başlangıç: dün akşamki iftar
      baslangicMs = imsakDate.getTime() - 8 * 60 * 60 * 1000;
    }

    const toplamMs = bitisMs - baslangicMs;
    const gecenMs = time - baslangicMs;
    const yuzde = Math.min(100, Math.max(0, (gecenMs / toplamMs) * 100));
    const kalanSaniye = Math.floor((bitisMs - time) / 1000);

    const h = String(Math.floor(kalanSaniye / 3600)).padStart(2, '0');
    const m = String(Math.floor((kalanSaniye % 3600) / 60)).padStart(2, '0');
    const s = String(kalanSaniye % 60).padStart(2, '0');

    return {
      mod: 'gece' as const,
      yuzde,
      kalanSaniye,
      metin: `${h}:${m}:${s}`,
      etiket: 'Sahura Kalan',
    };
  }, [now, bugunVakitler, yarinVakitler, loading]);

  // 4. Teravih Nabız Efekt Kontrolü (Yatsıdan sonra gece yarısına kadar parıldama efekti)
  const teravihAktif = useMemo(() => {
    if (!bugunVakitler?.tarih || !bugunVakitler?.yatsi) return false;
    const yatsiDate = parseVakitToDate(bugunVakitler.tarih, bugunVakitler.yatsi);
    if (!yatsiDate) return false;

    const yatsiTime = yatsiDate.getTime();
    const geceYarisiTime = yatsiTime + 4.5 * 60 * 60 * 1000; // Yatsıdan sonra 4.5 saat aktif
    const time = now.getTime();

    return time >= yatsiTime && time < geceYarisiTime;
  }, [now, bugunVakitler]);

  if (loading || !hijriGunu.isRamazan) return null;

  // Çember uzunluğu parametreleri (radius: 48, çevre: 2 * PI * r = 301.59)
  const strokeCircumference = 301.59;
  const strokeOffset = strokeCircumference - (zamanVerileri.yuzde / 100) * strokeCircumference;

  return (
    <motion.div
      initial={{ opacity: 0, y: 15, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="relative w-full p-4 sm:p-5 mt-4 overflow-hidden rounded-card spatial-glass border border-amber-500/20 shadow-[0_12px_36px_rgba(245,158,11,0.06),_inset_0_1px_1px_rgba(255,255,255,0.04)] text-[var(--text-primary)]"
    >
      {/* Uzaysal parıltı efekti arka planı */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(245,158,11,0.06)_0%,transparent_50%)] pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_80%,rgba(139,92,246,0.04)_0%,transparent_40%)] pointer-events-none" />

      {/* 1. Üst Başlık & Kozmik Günlük */}
      <div className="flex justify-between items-center z-10 relative">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <Star size={10} className="text-amber-500 fill-amber-500 animate-pulse" />
            <span className="text-2xs font-black uppercase tracking-[0.25em] text-amber-500/95 font-sans">{RAMAZAN_LABELS.baslik}</span>
          </div>
          <h2 className="text-xs sm:text-sm font-black text-[var(--text-primary)] tracking-wide font-sans mt-0.5">
            {hijriGunu.day}. Gün Hub
          </h2>
        </div>

        {/* Ay Fazı Göstergesi */}
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/[0.04] border border-amber-500/10">
          <span className="text-2xs font-bold tracking-wider text-[var(--text-secondary)] uppercase">{ramazanGunuStr}</span>
          <div className="flex items-center justify-center">
            <MoonPhaseView day={hijriGunu.day} />
          </div>
        </div>
      </div>

      {/* 2. Merkez: Dairesel SVG İlerleme Göstergesi */}
      <div className="my-5 sm:my-6 flex flex-col sm:flex-row justify-center items-center gap-5 sm:gap-8 z-10 relative">
        {/* İlerleme Çemberi */}
        <div className="relative w-28 h-28 flex-shrink-0">
          <svg className="w-full h-full transform -rotate-90">
            <circle cx="56" cy="56" r="48" className="stroke-violet-950/40 fill-none" strokeWidth="5.5" />
            <motion.circle
              cx="56"
              cy="56"
              r="48"
              className={`fill-none transition-all duration-1000 ${
                zamanVerileri.mod === 'gunduz' ? 'stroke-amber-500' : 'stroke-violet-400'
              }`}
              strokeWidth="5.5"
              strokeLinecap="round"
              strokeDasharray={strokeCircumference}
              initial={{ strokeDashoffset: strokeCircumference }}
              animate={{ strokeDashoffset: strokeOffset }}
              transition={{ duration: 1, ease: 'easeOut' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col justify-center items-center text-center">
            <span className="text-2xs font-extrabold text-[var(--text-secondary)]/85 uppercase tracking-[0.12em]">
              {zamanVerileri.etiket}
            </span>
            <span className="text-lg font-black font-mono text-[var(--text-primary)] tracking-tight leading-none mt-1">
              {zamanVerileri.metin}
            </span>
            <span className="text-2xs font-black text-amber-500 uppercase tracking-widest mt-1">%{Math.round(zamanVerileri.yuzde)}</span>
          </div>
        </div>

        {/* Günlük Oruç Durumu & Teşvik */}
        <div className="flex flex-col text-center sm:text-left gap-2 sm:gap-2.5">
          <h3 className="text-2xs sm:text-xs font-extrabold text-[var(--text-primary)] leading-tight">
            {zamanVerileri.mod === 'gunduz'
              ? 'Niyetliyiz, Ruhumuzu ve Bedenimizi Arındırıyoruz'
              : 'İftar Edildi, Şükürler Olsun. Sahur Hazırlığı'}
          </h3>
          <p className="text-2xs sm:text-2xs text-[var(--text-secondary)]/70 leading-relaxed max-w-[220px]">
            {zamanVerileri.mod === 'gunduz'
              ? 'Rabbimiz oruçlarımızı kabul eylesin. Akşam ezanı vakti ile iftar şerefine nail olacağız.'
              : 'Sahura kadar beslenmemize dikkat edip, ibadet ve teheccüd vakitlerini gözleyelim.'}
          </p>

          {/* Hızlı Oruç Kontrol Checkbox */}
          <button
            onClick={toggleOruc}
            className={`flex items-center justify-center sm:justify-start gap-1.5 self-center sm:self-start text-2xs font-bold px-3 py-1 rounded-full border transition-all duration-300 ${
              orucTutuldu
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-amber-500/[0.04] border-amber-500/15 text-amber-300/70 hover:bg-amber-500/[0.08]'
            }`}
          >
            <div
              className={`w-3.5 h-3.5 rounded-md border flex items-center justify-center transition-all ${
                orucTutuldu ? 'bg-emerald-500/20 border-emerald-500' : 'border-amber-500/30'
              }`}
            >
              {orucTutuldu && <Check size={10} strokeWidth={3} />}
            </div>
            <span>{orucTutuldu ? 'Bugünkü Oruç Tamamlandı' : 'Bugün Oruçluyum'}</span>
          </button>
        </div>
      </div>

      {/* 3. Alt: Mukabele & Teravih İnteraktif Görev Kartları */}
      <div className="grid grid-cols-2 gap-2.5 mt-3 pt-3.5 border-t border-amber-500/10 z-10 relative">
        {/* Mukabele Kartı */}
        <button
          onClick={toggleCuz}
          className={`group flex items-center gap-2.5 p-2.5 rounded-2xl border transition-all duration-300 ${
            cuzOkundu
              ? 'bg-emerald-500/[0.07] border-emerald-500/25 text-emerald-400'
              : 'bg-amber-500/[0.03] border-amber-500/12 text-amber-200/90 hover:bg-amber-500/[0.06] hover:border-amber-500/20'
          }`}
        >
          <div
            className={`w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 transition-all ${
              cuzOkundu ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
            }`}
          >
            <BookOpen size={14} strokeWidth={2} />
          </div>
          <div className="flex flex-col text-left overflow-hidden">
            <span className="text-2xs font-black uppercase tracking-wider text-amber-500/80 leading-none">{RAMAZAN_LABELS.mukabele}</span>
            <span className="text-2xs font-extrabold truncate mt-0.5">{hijriGunu.day}. Cüz Okuması</span>
            <span className="text-2xs font-bold text-amber-200/40 leading-none mt-0.5">{cuzOkundu ? 'Okundu ✓' : 'Tamamla'}</span>
          </div>
        </button>

        {/* Teravih Kartı (Ezan vaktinde pulsing efektiyle parlar) */}
        <button
          onClick={incrementTeravih}
          className={`relative flex items-center gap-2.5 p-2.5 rounded-2xl border transition-all duration-300 bg-amber-500/[0.03] border-amber-500/12 text-amber-200/90 hover:bg-amber-500/[0.06] hover:border-amber-500/20 ${
            teravihAktif && teravihRekat < 20 ? 'shadow-[0_0_12px_rgba(245,158,11,0.15)] animate-[pulse_2s_infinite]' : ''
          }`}
        >
          {/* Teravih aktiflik bildirim noktası */}
          {teravihAktif && teravihRekat < 20 && (
            <span className="absolute top-1 right-1 flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
            </span>
          )}

          <div
            className={`w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 transition-all ${
              teravihRekat > 0 ? 'bg-amber-500/15 text-amber-400' : 'bg-amber-500/10 text-amber-400'
            }`}
          >
            {teravihRekat === 20 ? (
              <Award size={14} strokeWidth={2} />
            ) : (
              <Flame size={14} strokeWidth={2} className={teravihRekat > 0 ? 'animate-pulse' : ''} />
            )}
          </div>
          <div className="flex flex-col text-left overflow-hidden">
            <span className="text-2xs font-black uppercase tracking-wider text-amber-500/80 leading-none">Sünnet-i Müekkede</span>
            <span className="text-2xs font-extrabold truncate mt-0.5">{RAMAZAN_LABELS.teravihTakipcisi}</span>
            <span className="text-2xs font-bold text-amber-200/40 leading-none mt-0.5">
              {teravihRekat === 20 ? '20 Rekat Tamam ✓' : teravihRekat > 0 ? `${teravihRekat} Rekat Kılındı` : 'Rekat Seç (+4)'}
            </span>
          </div>
        </button>
      </div>
    </motion.div>
  );
};
