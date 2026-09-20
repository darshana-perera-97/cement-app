import { useEffect, useState } from 'react';
import { getApiBase } from './apiBase';

export const COLLECTOR_UNLOAD_PRICE_SETTINGS_CHANGED = 'collector-unload-price-settings-changed';

const STORAGE_KEY = 'cs-store-collector-unload-price-enabled';

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

export function getCollectorUnloadPriceEnabled() {
  if (cachedEnabled != null) return cachedEnabled;
  return readStoredEnabled();
}

export function setCollectorUnloadPriceEnabledCache(enabled) {
  cachedEnabled = Boolean(enabled);
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, cachedEnabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function notifyCollectorUnloadPriceSettingsChanged(enabled) {
  if (enabled != null) {
    setCollectorUnloadPriceEnabledCache(enabled);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(COLLECTOR_UNLOAD_PRICE_SETTINGS_CHANGED));
  }
}

export async function fetchCollectorUnloadPriceEnabled() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/collector-unload-price-settings`);
      if (res.ok) {
        const data = await res.json();
        setCollectorUnloadPriceEnabledCache(Boolean(data.enabled));
        return Boolean(data.enabled);
      }
    } catch {
      /* keep cache */
    } finally {
      inflight = null;
    }
    return getCollectorUnloadPriceEnabled();
  })();
  return inflight;
}

export function useCollectorUnloadPriceEnabled() {
  const [enabled, setEnabled] = useState(() => getCollectorUnloadPriceEnabled());
  const [ready, setReady] = useState(() => cachedEnabled != null || hasStoredEnabled());

  useEffect(() => {
    const sync = () => {
      setEnabled(getCollectorUnloadPriceEnabled());
      setReady(true);
    };
    window.addEventListener(COLLECTOR_UNLOAD_PRICE_SETTINGS_CHANGED, sync);
    return () => window.removeEventListener(COLLECTOR_UNLOAD_PRICE_SETTINGS_CHANGED, sync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchCollectorUnloadPriceEnabled().then((value) => {
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
