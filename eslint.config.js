import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default [
  {
    // coverage/**: `npm run test:unit -- --coverage` çıktısı (zaten
    // .gitignore'da) — istanbul'un ürettiği JS'i lintlemek anlamsız,
    // "unused eslint-disable" gibi sahte uyarılar üretiyordu.
    ignores: ['dist/**', 'dev-dist/**', 'node_modules/**', '.firebase/**', 'artifacts/**', 'coverage/**']
  },
  ...tseslint.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // "Yaygın örtük any" gerekçesi bayattı: 2026-09-03 ölçümünde src'de
      // `as any`/`: any` toplam 0 kullanım çıktı (bkz. premium denetim,
      // bölüm 9) — tsconfig'te strict:true zaten açık, burada da zorlanıyor.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // react-hooks v7'nin React Compiler odaklı yeni kuralları: kod
      // tabanında yaygın (~zararsız, sadece performans/idiom önerisi)
      // desenlerle çakışıyor. Gerçek bug sınıfı olan rules-of-hooks/
      // exhaustive-deps 'error' kalır; bunlar 'warn'a düşürüldü —
      // dosya dosya gözden geçirilip düzeltilmesi ayrı bir takip işi.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn'
    }
  },
  {
    // Yalnızca src/ — scripts/ (cron'ların stdout logu, CI özetlerinde
    // okunur) ve tests/ kasıtlı olarak dışarıda bırakıldı. `console.error`/
    // `console.warn` (merkezi hata işleyicisi `handleFirestoreError` zaten
    // bunları kullanıyor) serbest; yalnızca DEV/debug amaçlı `console.log`
    // kalıntıları production'a sızmasın diye engellenir (bkz. kod denetimi,
    // premium/kurumsal SaaS standardı analizi — üretimde 2 unutulmuş
    // console.log bulundu).
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }]
    }
  },
  firebaseRulesPlugin.configs['flat/recommended']
];
