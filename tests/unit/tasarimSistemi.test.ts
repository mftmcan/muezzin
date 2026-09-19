import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Kaynak tarayan hızlı bir denetim seti — görsel tasarım denetiminde bulunan
 * ve düzeltilen üç kusur sınıfının (V7/V8/V9) SESSİZCE geri gelmesini
 * engeller. Kontrast/token kuralları önceden yalnızca index.css ve
 * CLAUDE.md içindeki yorumlarla korunuyordu; yorumların bir kısmı zamanla
 * kodla uyuşmaz hale gelmişti (ör. "sky ailesi tamamen elimine edildi"
 * iddiası, 9 canlı kullanım noktası varken). Bu test dosyası, ölçülen
 * gerçek durumu bir daha sessizce kaymaması için CI'ya bağlar.
 */

const SRC_DIR = path.resolve(__dirname, '../../src');
const INDEX_CSS_PATH = path.resolve(__dirname, '../../src/index.css');

function walkTsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTsxFiles(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const tsxFiles = walkTsxFiles(SRC_DIR);
const indexCss = fs.readFileSync(INDEX_CSS_PATH, 'utf8');

function relPath(absPath: string): string {
  return path.relative(path.resolve(__dirname, '../..'), absPath).replace(/\\/g, '/');
}

describe('tasarım sistemi — kaynak taraması (görsel tasarım denetimi V7/V8/V9)', () => {
  it('geçersiz Tailwind opaklık basamağı (V9) içermez', () => {
    // Tailwind'in standart opaklık ölçeği 5'in katlarıdır (0,5,10,…,100).
    // `opacity-8` gibi bir değer sessizce HİÇBİR kural üretmez — sınıf
    // DOM'a yazılır ama tarayıcı onu tanımadığından etkisizdir. Bracket
    // kaçışı (`opacity-[0.08]`) bu kontrolün dışında — o zaten geçerli.
    const GECERLI_BASAMAKLAR = new Set([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100]);
    const ihlaller: string[] = [];

    for (const file of tsxFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const regex = /(?:^|[\s"'`(])(?:[a-zA-Z-]+:)*opacity-(\d+)(?!\d)/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content))) {
        const deger = Number(match[1]);
        if (!GECERLI_BASAMAKLAR.has(deger)) {
          const satir = content.slice(0, match.index).split('\n').length;
          ihlaller.push(`${relPath(file)}:${satir} → opacity-${deger}`);
        }
      }
    }

    expect(
      ihlaller,
      `Geçersiz opacity-N sınıfı bulundu (Tailwind'in ölçeğinde yok, sessizce hiçbir şey yapmaz):\n${ihlaller.join('\n')}`
    ).toEqual([]);
  });

  it('doygun dolgu üzerine text-[var(--text-primary)] kullanmaz (V8)', () => {
    // CLAUDE.md "Doygun dolgu üzerine metin rengi" kuralı: renkli/doygun bir
    // arka plan üzerine metin yazarken her zaman text-[var(--app-bg)],
    // ASLA text-[var(--text-primary)] yazılmaz — ışık modunda --text-primary
    // neredeyse siyahtır ve koyu bir dolgu üzerinde okunamaz hale gelir.
    const DOYGUN_DOLGU_DESENI = /bg-gradient-to-[a-z]+|bg-(amber|rose|emerald|indigo|violet|purple|orange|red|teal|sky)-[4-9]00\b/;
    const ihlaller: string[] = [];

    for (const file of tsxFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const classNameRegex = /className=(?:\{`([^`]*)`\}|"([^"]*)"|\{'([^']*)'\})/g;
      let match: RegExpExecArray | null;
      while ((match = classNameRegex.exec(content))) {
        const className = match[1] ?? match[2] ?? match[3] ?? '';
        if (className.includes('text-[var(--text-primary)]') && DOYGUN_DOLGU_DESENI.test(className)) {
          const satir = content.slice(0, match.index).split('\n').length;
          ihlaller.push(`${relPath(file)}:${satir}`);
        }
      }
    }

    expect(
      ihlaller,
      `Doygun dolgu (bg-gradient-to-*, bg-<renk>-400+) üzerine text-[var(--text-primary)] bulundu — text-[var(--app-bg)] kullanılmalı (bkz. CLAUDE.md):\n${ihlaller.join('\n')}`
    ).toEqual([]);
  });

  it('rounded-[NNpx] yalnızca gerçekten tek seferlik değerler için kullanılır (CLAUDE.md kural 1-3)', () => {
    // Kod denetimi (premium/kurumsal SaaS standardı analizi, 2026-09-19) 24
    // dosyada 58 `rounded-[NNpx]` kalıntısı buldu: 14/18/20px (Tailwind
    // ölçeğinde karşılığı olmayan ama SIK tekrarlayan üç değer — token'a
    // taşındı: `rounded-chip`/`rounded-panel`/`rounded-control`, bkz.
    // src/index.css `@theme`) ve 8/12/16/24px (zaten adlandırılmış Tailwind
    // sınıflarıyla birebir aynı: rounded-lg/xl/2xl/3xl). Migrasyon tamamlandı;
    // bu test o yedi değerin YENİDEN sessizce sızmasını engeller. Kalan
    // `rounded-[NNpx]` kullanımları yalnızca CLAUDE.md kural 3'ün izin
    // verdiği, üçüncü bir bileşenle paylaşılmayan gerçek tek seferlik
    // değerlerdir — allowlist'te satır satır gerekçeli.
    const ROUNDED_REGEX = /rounded(?:-[tblr]{1,3})?-\[(\d+)px\]/g;
    const TOKENA_TASINMASI_GEREKEN = new Set([14, 18, 20]); // rounded-chip/panel/control
    const TAILWIND_OLCEGINDE_VAR = new Set([8, 12, 16, 24]); // rounded-lg/xl/2xl/3xl

    // Her satır TEK bir dosyaya ait tek seferlik bir değeri belgeliyor —
    // aynı dosyada aynı değerin birden çok kullanımı (ör. bir logonun üst
    // üste binen katmanları) dosya-yerel bir sabittir, token DEĞİL.
    const IZINLI_TEK_SEFERLIK = new Set([
      'src/components/auth/LoginScreen.tsx:70', // 36px — logo katmanı 1/3
      'src/components/auth/LoginScreen.tsx:71', // 36px — logo katmanı 2/3
      'src/components/auth/LoginScreen.tsx:72', // 36px — logo katmanı 3/3
      'src/components/ChunkErrorFallback.tsx:105', // 30px — hata ikonu kutusu 1/2
      'src/components/ChunkErrorFallback.tsx:146', // 30px — hata ikonu kutusu 2/2
      'src/components/Muezzinler.tsx:122', // 32px
      'src/components/SplashLoader.tsx:90', // 52px
      'src/pages/profil/ProfileBadges.tsx:71', // 26px
    ]);

    const ihlaller: string[] = [];

    for (const file of tsxFiles) {
      const content = fs.readFileSync(file, 'utf8');
      let match: RegExpExecArray | null;
      while ((match = ROUNDED_REGEX.exec(content))) {
        const deger = Number(match[1]);
        const satir = content.slice(0, match.index).split('\n').length;
        const anahtar = `${relPath(file)}:${satir}`;

        if (TOKENA_TASINMASI_GEREKEN.has(deger)) {
          ihlaller.push(`${anahtar} → rounded-[${deger}px] (token var: 14→rounded-chip, 18→rounded-panel, 20→rounded-control)`);
        } else if (TAILWIND_OLCEGINDE_VAR.has(deger)) {
          const isim = { 8: 'rounded-lg', 12: 'rounded-xl', 16: 'rounded-2xl', 24: 'rounded-3xl' }[deger];
          ihlaller.push(`${anahtar} → rounded-[${deger}px] (Tailwind sınıfı var: ${isim})`);
        } else if (!IZINLI_TEK_SEFERLIK.has(anahtar)) {
          ihlaller.push(`${anahtar} → rounded-[${deger}px] (yeni tek seferlik değer — allowlist'e ekle veya token'a taşı)`);
        }
      }
    }

    expect(
      ihlaller,
      `rounded-[NNpx] ihlali bulundu (bkz. CLAUDE.md "Köşe yarıçapı" bölümü):\n${ihlaller.join('\n')}`
    ).toEqual([]);
  });

  it('yeni stiffness/damping/bounce fizik değeri src/lib/motion.ts token\'ları dışında eklenmez', () => {
    // Kod denetimi (premium/kurumsal SaaS standardı analizi, 2026-09-19) 15
    // dosyada elle yazılmış stiffness/damping/bounce kombinasyonu buldu; sık
    // tekrarlananlar (`400/30`→SPRING.snappy, `320/28`→SPRING.sheet,
    // `260/28`→SPRING.gentle) src/lib/motion.ts'e taşındı. KALAN
    // kombinasyonların hepsi GERÇEKTEN tek kullanımlık (bkz. motion.ts
    // docblock'unun şikayet ettiği "14 farklı spring" durumuna geri
    // dönmemek için bilinçli olarak token'a terfi ettirilmedi) — bu test
    // YENİ bir tekil değerin sessizce eklenmesini engeller; sık tekrarlayan
    // bir değer görürsen (aynı sayı çifti 3+ dosyada) src/lib/motion.ts'e
    // yeni bir SPRING tadı ekleyip buraya taşımayı düşün.
    //
    // `repeat: Infinity` ile çalışan ambient nefes/pulse animasyonları
    // (ör. GeriSayim.tsx'teki geri sayım halkası) BİLEREK bu taramanın
    // dışındadır — onlar etkileşim fiziği değil, sürekli dekoratif döngü;
    // `DURATION` (0.12-0.5s) ölçeği onlara zorlanamaz.
    const FIZIK_REGEX = /(?:stiffness|damping|bounce):\s*[\d.]+/g;
    const IZINLI_TEKIL_DEGERLER = new Set([
      'src/components/FloatingDock.tsx:88', // bounce:0/0.3s — layout morph, süre-tabanlı spring API
      'src/components/FloatingDock.tsx:109', // stiffness:450/damping:32
      'src/components/FloatingDock.tsx:238', // bounce:0.1/0.4s
      'src/components/FloatingDock.tsx:294', // bounce:0.15/0.5s — layout morph
      'src/components/FloatingDock.tsx:295', // bounce:0.15/0.5s — borderRadius morph (294 ile eşleşen çift)
      'src/components/GeriSayim.tsx:32', // stiffness:380/damping:30
      'src/components/GorevliKarti.tsx:128', // stiffness:220/damping:25 — layout morph
      'src/components/HakkindaModal.tsx:94', // stiffness:200/damping:25/mass:1
      'src/components/Layout.tsx:121', // bounce:0.3/0.5s — sayfa geçişi
      'src/components/Layout.tsx:148', // bounce:0.3/0.5s (121 ile eşleşen çift)
      'src/components/ui/Switch.tsx:51', // stiffness:500/damping:30 — bilinçli olarak daha kıvrak
      'src/pages/admin/AdminPanel.tsx:423', // stiffness:220/damping:30
      'src/pages/admin/modules/ExecutiveHeroScreen.tsx:34', // HERO_SPRING dosya-yerel sabiti (stiffness:300/damping:24, 4 kullanım)
      'src/pages/admin/modules/ExecutiveHeroScreen.tsx:194', // stiffness:280/damping:22 — HERO_SPRING'den FARKLI, aynı dosyada ayrı bir jest
      'src/pages/admin/modules/ExecutiveHeroScreen.tsx:465', // stiffness:200/damping:25/delay
      'src/pages/admin/modules/IzinMazeretHub.tsx:45', // stiffness:400/damping:35 — snappy'nin damping'i 30, burada 35
    ]);

    const ihlaller: string[] = [];

    for (const file of tsxFiles) {
      const content = fs.readFileSync(file, 'utf8');
      if (!FIZIK_REGEX.test(content)) continue;
      FIZIK_REGEX.lastIndex = 0;

      // Ambient (repeat: Infinity) bloklarını dışla — satır bazında değil,
      // içeren `transition={{...}}`/obje bloğunu kabaca (±200 karakter
      // pencere) tarayarak.
      let match: RegExpExecArray | null;
      while ((match = FIZIK_REGEX.exec(content))) {
        const pencereBaslangic = Math.max(0, match.index - 200);
        const pencereBitis = Math.min(content.length, match.index + 200);
        const cevre = content.slice(pencereBaslangic, pencereBitis);
        if (/repeat:\s*Infinity/.test(cevre)) continue;

        const satir = content.slice(0, match.index).split('\n').length;
        const anahtar = `${relPath(file)}:${satir}`;
        if (!IZINLI_TEKIL_DEGERLER.has(anahtar)) {
          ihlaller.push(`${anahtar} → ${match[0]} (src/lib/motion.ts SPRING token'larından biri kullanılmalı ya da allowlist'e gerekçeyle eklenmeli)`);
        }
      }
    }

    expect(
      ihlaller,
      `Yeni/allowlist'siz motion fizik değeri bulundu (bkz. src/lib/motion.ts, CLAUDE.md "Motion fizik token'ları"):\n${ihlaller.join('\n')}`
    ).toEqual([]);
  });

  it("AA-altı ölçülmüş renk katmanları ışık modu remap'inde kalmaya devam eder (V7)", () => {
    // Bu altı katman ölçüldüğünde ışık modunda WCAG AA (4.5:1) eşiğinin
    // önemli ölçüde altındaydı (sky-400 1.91:1, sky-600 3.66:1, teal-400
    // 1.66:1, teal-600 3.34:1, indigo-400 2.66:1, slate-400 2.29:1) ama
    // `index.css`'in `[data-theme='light']` ham palet remap bloğunda hiç
    // karşılığı yoktu — bir yorum bunların "tamamen elimine edildiğini"
    // iddia ediyordu, kodla uyuşmuyordu. Remap'in bir gün tekrar
    // daraltılıp bu altısının sessizce düşürülmesini engeller.
    const ZORUNLU_REMAP_TOKENLARI = [
      '--color-sky-400',
      '--color-sky-600',
      '--color-teal-400',
      '--color-teal-600',
      '--color-indigo-400',
      '--color-slate-400',
    ];

    const lightBlockMatch = indexCss.match(/\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/);
    expect(lightBlockMatch, "index.css içinde [data-theme='light'] bloğu bulunamadı").toBeTruthy();
    const lightBlock = lightBlockMatch![1];

    const eksikler = ZORUNLU_REMAP_TOKENLARI.filter((token) => !lightBlock.includes(`${token}:`));
    expect(eksikler, `Şu token'lar [data-theme='light'] blogundan kayboldu: ${eksikler.join(', ')}`).toEqual([]);
  });
});
