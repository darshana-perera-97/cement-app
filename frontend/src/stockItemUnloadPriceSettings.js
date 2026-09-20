import { useEffect, useState } from 'react';
import { getApiBase } from './apiBase';

export const STOCK_ITEM_UNLOAD_PRICE_SETTINGS_CHANGED = 'stock-item-unload-price-settings-changed';

const STORAGE_KEY = 'cs-store-stock-item-unload-price-enabled';

let cachedEnabled = null;
let inflight = null;

function readStoredEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function hasStoredEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw === '1' || raw === '0';
  } catch {
    return false;
  }
}

export function getStockItemUnloadPriceEnabled() {
  if (cachedEnabled != null) return cachedEnabled;
  return readStoredEnabled();
}

export function setStockItemUnloadPriceEnabledCache(enabled) {
  cachedEnabled = Boolean(enabled);
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, cachedEnabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function notifyStockItemUnloadPriceSettingsChanged(enabled) {
  if (enabled != null) {
    setStockItemUnloadPriceEnabledCache(enabled);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(STOCK_ITEM_UNLOAD_PRICE_SETTINGS_CHANGED));
  }
}

export async function fetchStockItemUnloadPriceEnabled() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/stock-item-unload-price-settings`);
      if (res.ok) {
        const data = await res.json();
        setStockItemUnloadPriceEnabledCache(Boolean(data.enabled));
        return Boolean(data.enabled);
      }
    } catch {
      /* keep cache */
    } finally {
      inflight = null;
    }
    return getStockItemUnloadPriceEnabled();
  })();
  return inflight;
}

export function useStockItemUnloadPriceEnabled() {
  const [enabled, setEnabled] = useState(() => getStockItemUnloadPriceEnabled());
  const [ready, setReady] = useState(() => cachedEnabled != null || hasStoredEnabled());

  useEffect(() => {
    const sync = () => {
      setEnabled(getStockItemUnloadPriceEnabled());
      setReady(true);
    };
    window.addEventListener(STOCK_ITEM_UNLOAD_PRICE_SETTINGS_CHANGED, sync);
    return () => window.removeEventListener(STOCK_ITEM_UNLOAD_PRICE_SETTINGS_CHANGED, sync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchStockItemUnloadPriceEnabled().then((value) => {
      if (cancelled) return;
      setEnabled(value);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { enabled, ready };
}
