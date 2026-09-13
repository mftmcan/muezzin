import { VitePWA } from 'vite-plugin-pwa';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig(({ mode }) => ({
  server: {
    port: 3000,
    strictPort: true, // Port kaymasını engelle (Firebase Auth için kritik)
    headers: {
      'Cross-Origin-Opener-Policy': 'unsafe-none',
    },
  },
  esbuild: {
    drop: mode === 'production' ? ['console', 'debugger'] : [],
  },
  define: {
    // package.json sürümü ve GERÇEK build zamanı, telemetride hata anının
    // değil derleme anının bilgisini taşısın diye derleme zamanında gömülür
    // (bkz. src/services/telemetryService.ts).
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIMESTAMP__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      manifestFilename: 'manifest.json',
      // 'autoUpdate' + boş onNeedRefresh, yeni sürüm geldiğinde sayfayı
      // kullanıcıya sormadan sessizce yenileyebiliyordu (bkz. premium
      // denetim, bölüm 10) — 'prompt' ile sw.js hazır olduğunda yalnızca
      // registerSW'nin onNeedRefresh callback'i tetiklenir, gerçek yenileme
      // main.tsx'teki bildirim üzerinden kullanıcı onayına bırakılır.
      registerType: 'prompt',
      injectRegister: 'auto',
      devOptions: {
        enabled: true,
        type: 'module',
        suppressWarnings: true
      },
      includeAssets: ['favicon.svg', 'pwa-192x192.svg', 'pwa-512x512.svg', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        name: "Müezzin - Hizmet Dizgesi",
        short_name: "Müezzin Dizgesi",
        description: "Cami ve Din Görevlileri Hizmet Planlama Sistemi",
        // index.html'deki FOUC injector'ın varsayılan teması 'dark' (kayıtlı
        // tercih yoksa ve sistem açık moda ayarlı değilse) — manifest statik
        // olduğundan (yüklenme/splash anında, JS henüz çalışmadan okunur;
        // useThemeStore'un runtime --app-bg senkronu buraya ulaşamaz) o
        // varsayılanla eşleşmeli. Önceden `#F5F5F7` ne açık (`#F4F2EE`) ne
        // koyu (`#08080A`) temanın gerçek --app-bg'siyle eşleşmiyordu; PWA
        // yükleme splash'i ve Android görev değiştirici bu üçüncü, hiçbir
        // temaya ait olmayan renkte görünüyordu (bkz. görsel tasarım
        // denetimi V11).
        theme_color: "#08080A",
        background_color: "#08080A",
        display: "standalone",
        id: "/",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        lang: "tr",
        categories: ["productivity", "utilities"],
        icons: [
          {
            src: '/pwa-192x192.svg?v=3',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any'
          },
          {
            src: '/pwa-512x512.svg?v=3',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any'
          },
          {
            src: '/pwa-512x512.svg?v=3',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable'
          },
          // PNG varyantları: bazı Android launcher'ları/OS entegrasyonları
          // SVG manifest ikonlarını desteklemez.
          {
            src: '/pwa-192x192.png?v=3',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/pwa-512x512.png?v=3',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/pwa-512x512.png?v=3',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globDirectory: 'dist',
        // Fontlar artık self-host (bkz. src/index.css @fontsource import'ları) — woff2/woff
        // build çıktısına dahil olduğundan burada da precache edilmesi gerekiyor. Google
        // Fonts CDN runtimeCaching kuralları bu nedenle kaldırıldı (artık hiçbir istek
        // fonts.googleapis.com/fonts.gstatic.com'a gitmiyor).
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,woff}'],
        // Admin paneli chunk'ları (bkz. aşağıdaki chunkFileNames — yalnızca
        // `src/pages/admin/**`'ten gelen lazy modüller `assets/admin/`
        // altına yazılır) precache manifest'inden hariç tutuluyor. Bu
        // chunk'lar zaten AdminPanel.tsx'te `lazy()` ile ayrı ayrı
        // bölünmüştü — ama vite-plugin-pwa'nın globPatterns'ı runtime'daki
        // lazy-loading'i bilmiyor, dist'teki HER js dosyasını (rol=muezzin
        // olup admin paneline hiç girmeyecek çoğunluk kullanıcı dahil)
        // kurulumdan hemen sonra arka planda indirip önbelleğe alıyordu
        // (bkz. performans analizi) — code-splitting'in ağ/pil tasarrufu
        // kazanımını sessizce geri veriyordu. Aşağıdaki runtimeCaching
        // kuralı, bir admin kullanıcısı panele gerçekten girdiğinde bu
        // dosyaları normal şekilde (ve bir daha ağa gitmeden) önbelleğe alır
        // — hash'li dosya adları içerik-adresli/immutable olduğundan
        // CacheFirst güvenli.
        globIgnores: ['**/*-cyrillic-*', '**/*-greek-*', '**/*-vietnamese-*', 'assets/admin/**'],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/admin\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'admin-chunks',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 24 * 60 * 60 },
            },
          },
        ],
        // @fontsource-variable/inter ve jetbrains-mono paketleri (opsz.css/wght.css)
        // her zaman TÜM script alt kümelerini (latin, latin-ext, cyrillic,
        // cyrillic-ext, greek, greek-ext, vietnamese) ayrı @font-face + unicode-range
        // kuralları olarak üretir — tarayıcı normalde yalnızca sayfada gerçekten
        // kullanılan unicode-range'i indirir (bu kısım zaten optimal), ama workbox'ın
        // globPatterns'ı unicode-range'i anlamaz ve DIST'teki her font dosyasını
        // körü körüne precache eder. Uygulama yalnızca Türkçe (lang: "tr") olduğundan
        // kiril/yunan/vietnamca alt kümeleri hiçbir zaman render edilmiyor ama yine de
        // her PWA kurulumunda/güncellemesinde indirilip önbelleğe alınıyordu (~330KB,
        // toplam font payload'ının ~%33'ü — bkz. performans analizi). Bu üç desen ile
        // yukarıdaki `assets/admin/**` yalnızca precache'i hedefliyor; tarayıcının
        // runtime unicode-range davranışına dokunmuyor, bu yüzden işlevsel bir risk
        // taşımıyor.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        importScripts: ['/firebase-messaging-sw.js']
      }
    })
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // false: prod stack trace'leri (error_logs'a yazılan errorStack) minified
    // isimlerden ibaretti — hata izleme altyapısı var ama çıktısı hata
    // ayıklanamıyordu (bkz. premium denetim, bölüm 7). 'hidden': .map
    // dosyaları üretilir ama JS'e referans yorumu EKLENMEZ, yani tarayıcıya
    // hiç servis edilmezler (kaynak kodu public'e sızdırmaz) — CI'da
    // dist/**/*.map ayrı bir build artifact olarak saklanır (bkz.
    // .github/workflows/test.yml), Sentry-tarzı harici bir sembolikasyon
    // servisi olmadığı için ayıklama şimdilik bu artifact'i indirip yerel
    // source-map araçlarıyla eşlemek şeklinde yapılır.
    sourcemap: 'hidden',
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      // zod/v4'ün esbuild için yazdığı `@__PURE__` yorumları (tree-shaking'i
      // zorlamak amacıyla bilinçli olarak IIFE dışında konumlandırılmış,
      // bkz. node_modules/zod/v4/core/util.js ve regexes.js) Rollup'ın
      // beklediği "çağrının hemen önü" konumunda değil. Rollup bunu build'i
      // bozmadan zararsızca göz ardı ediyor (yorumu silip devam ediyor) —
      // ama gürültülü bir uyarı basıyor; bu bizim kodumuzda değil zod'un
      // paket kaynağında olduğundan projeden düzeltilemez, sadece bu tek
      // uyarı türünü sessize alıyoruz.
      onwarn(warning, warn) {
        if (warning.code === 'INVALID_ANNOTATION') return;
        warn(warning);
      },
      output: {
        // Yalnızca `src/pages/admin/**`'ten gelen lazy chunk'ları (bkz.
        // AdminPanel.tsx'teki `lazy()` çağrıları) ayrı bir alt dizine
        // yazıyoruz ki workbox'ın globIgnores'ı (yukarıda `assets/admin/**`)
        // bunları hash bazlı bir desenle değil, dizin bazlı — build'den
        // build'e kırılmayan — sağlam bir kuralla precache'ten hariç
        // tutabilsin (bkz. performans analizi). `facadeModuleId`, bir
        // dinamik import()'un doğrudan hedef modülüdür; vendor chunk'ları
        // (manualChunks'tan gelen, facade'ı olmayan paylaşılan chunk'lar)
        // ve admin/muezzin arası PAYLAŞILAN alt chunk'lar (ör. ConfirmModal,
        // FormField — birden çok yerden erişilebildiği için facade'sız
        // ortak chunk'a düşerler) bu kontrolden etkilenmez, eski davranışta
        // kalıp normal şekilde precache edilir — bu kasıtlı: yalnızca admin
        // rotasına ÖZEL modüller taşınıyor, paylaşılan kod yanlışlıkla
        // dışlanmıyor.
        chunkFileNames(chunkInfo) {
          const facadeId = chunkInfo.facadeModuleId ?? '';
          if (facadeId.includes('/src/pages/admin/')) {
            return 'assets/admin/[name]-[hash].js';
          }
          return 'assets/[name]-[hash].js';
        },
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          // 1. Core Framework (strictly isolated — must not share with others)
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/scheduler/') ||
            id.includes('/object-assign/')
          ) {
            return 'vendor-react';
          }

          // 2. Firebase Messaging is lazy-loaded after app boot.
          if (id.includes('firebase/messaging') || id.includes('@firebase/messaging')) {
            return 'vendor-firebase-messaging';
          }

          // 3. Firebase Auth (+ App Check, which initializes synchronously
          // alongside it in src/lib/firebase.ts) — needed immediately at
          // boot (login gate), kept separate from Firestore so the login
          // screen doesn't wait on the larger Firestore bundle to parse.
          if (
            id.includes('firebase/auth') || id.includes('@firebase/auth') ||
            id.includes('firebase/app-check') || id.includes('@firebase/app-check')
          ) {
            return 'vendor-firebase-auth';
          }

          // 4. Firebase core/Firestore
          if (id.includes('firebase') || id.includes('@firebase')) {
            return 'vendor-firebase';
          }

          // 5. Animation library
          if (id.includes('motion') || id.includes('framer-motion')) {
            return 'vendor-motion';
          }

          // 6. Routing
          if (id.includes('react-router') || id.includes('@remix-run')) {
            return 'vendor-router';
          }

          // 7. State management
          if (id.includes('zustand')) {
            return 'vendor-state';
          }

          // 8-9. lucide-react + date-fns önceden "her şey" kovası
          // vendor-utils'e (63 KB gz) birlikte düşüyordu — eager admin
          // sayfalarının ikonları da lazy sayfalar için gereken ikonlarla
          // aynı chunk'ta boot'ta yükleniyordu (bkz. premium denetim,
          // bölüm 3). Ayrı chunk'larda önbellek isabeti de birbirinden
          // bağımsızlaşır: yalnızca ikon güncellenirse date-fns yeniden
          // indirilmez, tersi de geçerli.
          if (id.includes('lucide-react')) {
            return 'vendor-icons';
          }
          if (id.includes('date-fns')) {
            return 'vendor-date';
          }

          // 10. Zod (form doğrulama) — kendi chunk'ında, çünkü admin
          // formlarına özgü (muezzin tarafı boot yolunda hiç import etmiyor)
          // ve yalnızca form ekranı ziyaret edildiğinde parse edilmesi
          // gerekiyor.
          if (id.includes('/zod/')) {
            return 'vendor-zod';
          }

          // 11. Everything else
          return 'vendor-utils';
        }
      }
    }
  }
}));
