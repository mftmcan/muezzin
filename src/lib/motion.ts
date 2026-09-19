/**
 * Paylaşılan motion/react fizik token'ları (bkz. premium denetim B22, Y4).
 * Kod tabanında aynı jest (kart hover, modal açılış, liste stagger) için 14
 * farklı spring konfigürasyonu ve 3 farklı easing dizisi bağımsız olarak
 * yazılmıştı — aynı elemanın farklı ekranlarda farklı bir fizikle çalışmasına
 * yol açıyordu. Buradaki gruplar en sık tekrarlanan (ölçülen) değerleri
 * temsil eder.
 *
 * Kod denetimi (premium/kurumsal SaaS standardı analizi, 2026-09-19)
 * sonrası: `SPRING.snappy`/`sheet`/`gentle` ve `EASE.in`'e birebir eşleşen
 * TÜM çağrı noktaları buraya taşındı (artık geriye dönük uyumluluk
 * istisnası yok). Aynı geçişte `EASE.outQuart` YENİ eklendi (6 noktada
 * tekrarlanan `[0.25,1,0.5,1]` — bkz. aşağıdaki yorum). Kalan tekil/bounce
 * spring değerleri (ör. FloatingDock.tsx, Layout.tsx, Switch.tsx) BİLİNÇLİ
 * olarak burada YOK — her biri gerçekten tek kullanımlık ve token'a
 * zorlanması "14 farklı spring" durumuna geri dönüş olurdu; bunlar
 * `tests/unit/tasarimSistemi.test.ts`'teki ratchet guard'da gerekçeleriyle
 * allowlist'te kayıtlı.
 */

export const SPRING = {
  /** Sekme/pill göstergesi, layoutId morph'ları — en sık kullanılan (13 kullanım). */
  snappy: { type: 'spring', stiffness: 400, damping: 30 } as const,
  /** Kart hover/tilt gibi daha yumuşak, ağırlıklı hareketler. */
  gentle: { type: 'spring', stiffness: 260, damping: 28 } as const,
  /** Modal/drawer/bottom-sheet açılışı. */
  sheet: { type: 'spring', stiffness: 320, damping: 28 } as const,
} as const;

export const EASE = {
  /** Apple-style "ease-out" — giriş animasyonlarının büyük çoğunluğu (24 kullanım). */
  out: [0.16, 1, 0.3, 1] as const,
  in: [0.4, 0, 1, 1] as const,
  /**
   * easeOutQuart — `EASE.out`'tan belirgin biçimde daha yumuşak bir çıkış;
   * kod denetimi 6 noktada (4 dosya, JS dizisi + Tailwind `ease-[cubic-bezier(...)]`
   * sınıfı formunda) elle tekrarlanmış bulunca token'a taşındı (bkz.
   * `--ease-out-quart` CSS değişkeni, src/index.css `@theme`).
   */
  outQuart: [0.25, 1, 0.5, 1] as const,
} as const;

export const DURATION = {
  instant: 0.12,
  fast: 0.2,
  normal: 0.32,
  slow: 0.5,
} as const;

/** Sayfa/sekme içeriği geçişi için hazır bir `motion.div` transition objesi. */
export const pageTransition = { duration: DURATION.slow, ease: EASE.out } as const;
