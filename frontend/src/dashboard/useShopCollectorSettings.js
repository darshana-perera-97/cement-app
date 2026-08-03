import { useCallback, useEffect, useState } from 'react';
import { getApiBase } from '../apiBase';

const apiBase = getApiBase();

export const SHOP_COLLECTOR_SETTINGS_CHANGED = 'shop-collector-settings-changed';

export function notifyShopCollectorSettingsChanged() {
  window.dispatchEvent(new Event(SHOP_COLLECTOR_SETTINGS_CHANGED));
}

export function useShopCollectorSettings() {
  const [collectorSeparateBillSettlement, setCollectorSeparateBillSettlement] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/shop`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setCollectorSeparateBillSettlement(Boolean(data.collectorSeparateBillSettlement));
      } else {
        setCollectorSeparateBillSettlement(false);
      }
    } catch {
      setCollectorSeparateBillSettlement(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const onChanged = () => load();
    window.addEventListener(SHOP_COLLECTOR_SETTINGS_CHANGED, onChanged);
    return () => window.removeEventListener(SHOP_COLLECTOR_SETTINGS_CHANGED, onChanged);
  }, [load]);

  return { collectorSeparateBillSettlement, loading, reload: load };
}

/** When the shop setting is on, use the 2-step payment + invoice allocation flow. */
export function useSeparateBillSettlementFlow() {
  const { collectorSeparateBillSettlement, loading, reload } = useShopCollectorSettings();
  return {
    useSeparateBillSettlement: collectorSeparateBillSettlement && !loading,
    collectorSeparateBillSettlement,
    loading,
    reload,
  };
}
