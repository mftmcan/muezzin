import { useTransition } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Admin panelindeki iç içe "Hub" modüllerinin (AyarlarHub, PersonelHub, ...)
 * hepsinde tekrarlanan URL-kalıcı sekme deseni: aktif sekme `?{paramName}=`
 * parametresinden türetilir (derin bağlantı/deep-link ve sayfa yenilemesinde
 * konumu korumak için — bkz. SistemLoglari.tsx'teki aynı gerekçe), geçersiz
 * bir değer sessizce `defaultId`'ye düşer (AyarlarHub'ta olduğu gibi;
 * PersonelHub'ın eski `searchParams.get('subtab') || 'kadro'` hali doğrulama
 * yapmıyordu — `?subtab=gecersiz` gibi bir bağlantı hiçbir sekmeyle eşleşmeyip
 * boş bir panel bırakıyordu).
 *
 * Her nesting seviyesi farklı bir `paramName` kullanmalı (ör. üst seviye
 * `subtab`, onun içindeki bir alt-hub `izintab`) — aksi halde iki seviye aynı
 * query param'ı paylaşıp birbirinin durumunu ezer.
 */
export function useUrlTab<T extends string>(paramName: string, validIds: readonly T[], defaultId: T) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const raw = searchParams.get(paramName);
  const activeTab = raw !== null && (validIds as readonly string[]).includes(raw) ? (raw as T) : defaultId;

  const setActiveTab = (tab: T) => {
    startTransition(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (tab === defaultId) {
          next.delete(paramName);
        } else {
          next.set(paramName, tab);
        }
        return next;
      });
    });
  };

  return { activeTab, setActiveTab, isPending };
}
