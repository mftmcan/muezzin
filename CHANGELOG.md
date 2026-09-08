# Changelog

Bu proje [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/) biçimini
izler. Sürüm etiketleri deploy anında otomatik oluşturulan
`release-YYYYMMDD-HHmmss` git tag'leriyle eşleşir (bkz.
`docs/RUNBOOK.md` §5) — bu dosya insan-okunur bir özet sağlar, tag'lerin
yerine geçmez.

## [Unreleased]

### Added
- `CONTRIBUTING.md`, `LICENSE`, bu `CHANGELOG.md`.
- Pre-commit hook (husky + lint-staged, `eslint --fix`).
- `format:check` artık `npm run test:all` zincirinin bir parçası.
- Deploy onay kapısı: `build_and_deploy` job'ı `environment: production`
  taşıyor (GitHub'da Required reviewers ile aktive edilir, bkz.
  `docs/RUNBOOK.md` §6).
- Zod ile form doğrulama (`src/lib/validation/`) + `verify-schema-parity`
  ile `firestore.rules` senkron denetimi — personel, duyuru, sistem
  ayarları ve izin talebi formları.
- Proaktif uyarı sistemi: `adminUyarilari`'nda çözülmemiş uyarılar artık
  30 dakikada bir tüm aktif admin'lere FCM push olarak gönderiliyor
  (`scripts/kritikUyariBildirimGonder.ts`); 8 cron workflow'u artık
  `UYARI_WEBHOOK_URL` tanımlıysa arızada dış kanala (Slack/Discord/
  ntfy.sh) da bildiriyor; yeni `hataEsigiKontrol.ts` aynı imzalı istemci
  hatalarının anormal tekrarını 6 saatte bir erken yakalıyor (bkz.
  `docs/RUNBOOK.md` §7).
- Otomatik Firestore yedekleme: haftalık, şifreli (GPG AES256) bir GitHub
  Actions artifact'ı olarak (90 gün saklanır) — `scripts/firestoreYedekle.ts`
  fail-closed koleksiyon keşfi + kota koruması ile export eder,
  `scripts/firestoreGeriYukle.ts` CI'da asla çalışmayan, dry-run varsayılan,
  proje-ID teyitli bir geri yükleme sağlar (bkz. `docs/RUNBOOK.md` §8).
  Yeni `verify-backup` (`test:all` zincirinde) `firestore.rules`↔yedek
  kapsamı senkronunu denetler.

## [2.2.0] — 2026-09-04

Bu sürümden itibaren geriye dönük ayrıntılı sürüm notu tutulmuyor; proje
geçmişi için `git log` ve `git tag -l 'release-*' --sort=creatordate`
kullanın.
