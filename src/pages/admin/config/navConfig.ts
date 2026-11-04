import type { ComponentType } from 'react';
import { LayoutDashboard, CalendarDays, Users, Settings, Home, Calendar, User, SlidersHorizontal } from 'lucide-react';

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

/** Admin panelinin üst seviye sekmeleri — yeni bir sekme eklerken bu union'a eklemek,
 * AdminPanel'in renderContent/pageTitle switch'lerindeki eksik case'leri derleme
 * zamanında yakalamayı sağlar. */
export type ActiveModule = 'dashboard' | 'planlama' | 'ekip' | 'ayarlar';

export const ACTIVE_MODULES: ActiveModule[] = ['dashboard', 'planlama', 'ekip', 'ayarlar'];

/** `?tab=` URL parametresini güvenli bir ActiveModule'e indirger — tanınmayan/eksik
 * değerlerde 'dashboard'a düşer. AdminPanel ve FloatingDock aynı `tab` parametresini
 * ayrı ayrı okuyup yazdığı için (tek doğruluk kaynağı URL'nin kendisi) bu fonksiyon
 * ikisinde de aynı davranışı garantilemek için tek yerde tanımlı. */
export function toActiveModule(raw: string | null): ActiveModule {
  return ACTIVE_MODULES.includes(raw as ActiveModule) ? (raw as ActiveModule) : 'dashboard';
}

export interface AdminNavItemConfig {
  id: ActiveModule;
  /** Kısa görünür etiket (SlimSidebar'da metin olarak gösterilir) */
  shortLabel: string;
  /** Tam betimleyici etiket (title için tek başına; FloatingDock ve SlimSidebar
   * aria-label'ında görünür kısa etiketle birleştirilir, böylece WCAG 2.5.3
   * label-in-name korunur) */
  fullLabel: string;
  icon: IconComponent;
  badge: number;
}

export function getAdminNavItems(counts: { cozulmamisSayisi: number; pendingIzinler: number }): AdminNavItemConfig[] {
  return [
    { id: 'dashboard', shortLabel: 'Özet', fullLabel: 'Genel Bakış', icon: LayoutDashboard, badge: counts.cozulmamisSayisi },
    { id: 'planlama', shortLabel: 'Cetvel', fullLabel: 'Hizmet Cetveli', icon: CalendarDays, badge: 0 },
    { id: 'ekip', shortLabel: 'Kadro', fullLabel: 'Kadro Yönetimi', icon: Users, badge: counts.pendingIzinler },
    { id: 'ayarlar', shortLabel: 'Dizge', fullLabel: 'Dizge Ayarları', icon: Settings, badge: 0 },
  ];
}

export interface AppLinkConfig {
  path: string;
  label: string;
  icon: IconComponent;
}

export const APP_LINKS: AppLinkConfig[] = [
  { path: '/', label: 'Vakit', icon: Home },
  { path: '/takvim', label: 'Takvim', icon: Calendar },
  { path: '/profil', label: 'Profil', icon: User },
  { path: '/ayarlar', label: 'Ayarlar', icon: SlidersHorizontal },
];
