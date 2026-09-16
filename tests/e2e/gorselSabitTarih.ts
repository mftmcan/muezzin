/**
 * Görsel regresyon testlerinin (visual.spec.ts) sabitlediği TEK referans
 * takvim günü — Çarşamba (Cuma DEĞİL, bkz. visual.spec.ts dosya başı yorumu
 * "Cuma'ya özgü vurgular" bilinen sınırı).
 *
 * Önceden `seed-visual.ts`'teki SABIT_TARIH `format(new Date(), 'yyyy-MM-dd')`
 * idi — yani her CI koşusunda GERÇEK "bugün"e yazılıyordu. `saatiSabitle()`
 * (visual.spec.ts) yalnızca SAATi (`page.clock.setFixedTime`) donduruyordu,
 * TARİHi değil — bu yüzden baseline PNG'leri hangi takvim gününde
 * üretildiyse yalnızca O gün geçerli kalıyordu. "Kişisel Görevlerim" (ana
 * ekran, bugünün nöbet kartları) ve gün numarası/"BUGÜN" rozeti (haftalık
 * takvim) her gerçek takvim günü ilerledikçe baseline'dan kaçınılmaz olarak
 * sapıp CI'ı kırıyordu — bu bir yarış koşulu ya da flake DEĞİLDİ, statik bir
 * PNG'nin doğası gereği her gün geçersiz hale gelmesiydi (bkz. 2026-09-16 CI
 * koşusu: haftalık takvim ve ana ekran %3-4 piksel farkı — diff görselinde
 * baseline'ın "13 EYL Çarşamba" gösterdiği, gerçek render'ın farklı bir
 * güne kaymış olduğu doğrudan görülüyordu).
 *
 * Artık TAMAMEN sabit: hem seed (Admin SDK, gerçek saat dilimine tabi Node
 * süreci) hem `saatiSabitle()` (tarayıcı, `page.clock`) AYNI gerçek-olmayan
 * günü kullanıyor — böylece render, hangi gerçek takvim gününde CI
 * çalışırsa çalışsın deterministik kalır ve baseline bir daha tarih
 * kaymasından dolayı bayatlamaz.
 */
export const GORSEL_SABIT_TARIH = '2026-01-14';
