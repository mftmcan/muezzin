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

## [2.2.0] — 2026-09-04

Bu sürümden itibaren geriye dönük ayrıntılı sürüm notu tutulmuyor; proje
geçmişi için `git log` ve `git tag -l 'release-*' --sort=creatordate`
kullanın.
