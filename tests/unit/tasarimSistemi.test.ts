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
