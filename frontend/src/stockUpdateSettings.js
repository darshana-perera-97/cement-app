import { useEffect, useState } from 'react';
import { getApiBase } from './apiBase';

export const STOCK_UPDATE_SETTINGS_CHANGED = 'stock-update-settings-changed';
export const DEFAULT_STOCK_STALE_DAYS = 7;
export const MAX_LOW_STOCK_ALERTS = 5;

const STORAGE_KEY = 'cs-store-stock-update-enabled';
const STALE_DAYS_KEY = 'cs-store-stock-update-stale-days';
const LOW_STOCK_KEY = 'cs-store-stock-update-low-alerts';

let cachedEnabled = null;
let cachedStaleDays = DEFAULT_STOCK_STALE_DAYS;
let cachedLowStockAlerts = [];
let inflight = null;

function clampStaleDays(raw) {
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_STOCK_STALE_DAYS;
  return Math.min(365, n);
}

function clampMinBags(raw) {
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(99999, n);
}

export function normalizeLowStockAlerts(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const next = [];
  const seen = new Set();
  for (const row of list) {
    const key = String(row?.key ?? '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push({ key, minBags: clampMinBags(row.minBags) });
    if (next.length >= MAX_LOW_STOCK_ALERTS) break;
  }
  return next;
}

function readStoredEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function readStoredStaleDays() {
  if (typeof window === 'undefined') return DEFAULT_STOCK_STALE_DAYS;
  try {
    return clampStaleDays(sessionStorage.getItem(STALE_DAYS_KEY));
  } catch {
    return DEFAULT_STOCK_STALE_DAYS;
  }
}

function readStoredLowStockAlerts() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(LOW_STOCK_KEY);
    return raw ? normalizeLowStockAlerts(JSON.parse(raw)) : [];
  } catch {
    return [];
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

export function getStockUpdateEnabled() {
  if (cachedEnabled != null) return cachedEnabled;
  return readStoredEnabled();
}

export function getStockStaleDays() {
  return cachedEnabled != null ? cachedStaleDays : readStoredStaleDays();
}

export function getLowStockAlerts() {
  return cachedEnabled != null ? cachedLowStockAlerts : readStoredLowStockAlerts();
}

export function setStockUpdateEnabledCache(enabled, staleDays, lowStockAlerts) {
  cachedEnabled = Boolean(enabled);
  if (staleDays != null) cachedStaleDays = clampStaleDays(staleDays);
  if (lowStockAlerts != null) cachedLowStockAlerts = normalizeLowStockAlerts(lowStockAlerts);
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, cachedEnabled ? '1' : '0');
    sessionStorage.setItem(STALE_DAYS_KEY, String(cachedStaleDays));
    sessionStorage.setItem(LOW_STOCK_KEY, JSON.stringify(cachedLowStockAlerts));
  } catch {
    /* ignore */
  }
}

export function notifyStockUpdateSettingsChanged(enabled, staleDays, lowStockAlerts) {
  if (enabled != null || staleDays != null || lowStockAlerts != null) {
    setStockUpdateEnabledCache(
      enabled != null ? enabled : getStockUpdateEnabled(),
      staleDays,
      lowStockAlerts,
    );
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(STOCK_UPDATE_SETTINGS_CHANGED));
  }
}

export function isStockUpdateStale(updatedAt, staleDays = getStockStaleDays()) {
  const days = clampStaleDays(staleDays);
  const iso = String(updatedAt ?? '').trim();
  if (!iso) return true;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t > days * 24 * 60 * 60 * 1000;
}

export function shopLowStockItems(stockRow, alerts = getLowStockAlerts()) {
  const list = normalizeLowStockAlerts(alerts);
  if (!stockRow?.updatedAt || list.length === 0) return [];
  const byKey = {};
  for (const item of Array.isArray(stockRow.items) ? stockRow.items : []) {
    const key = String(item?.key || '').trim();
    if (key) byKey[key] = item;
  }
  const low = [];
  for (const alert of list) {
    const item = byKey[alert.key];
    if (!item) continue;
    const bags = Number(item.bags);
    if (!Number.isFinite(bags) || bags >= alert.minBags) continue;
    low.push({
      key: alert.key,
      minBags: alert.minBags,
      bags,
      label: item.label || alert.key,
    });
  }
  return low;
}

export async function fetchStockUpdateEnabled() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/stock-update-settings`);
      if (res.ok) {
        const data = await res.json();
        setStockUpdateEnabledCache(Boolean(data.enabled), data.staleDays, data.lowStockAlerts);
        return Boolean(data.enabled);
      }
    } catch {
      /* keep cache */
    } finally {
      inflight = null;
    }
    return getStockUpdateEnabled();
  })();
  return inflight;
}

export function useStockUpdateEnabled() {
  const [enabled, setEnabled] = useState(() => getStockUpdateEnabled());
  const [staleDays, setStaleDays] = useState(() => getStockStaleDays());
  const [lowStockAlerts, setLowStockAlerts] = useState(() => getLowStockAlerts());
  const [ready, setReady] = useState(() => cachedEnabled != null || hasStoredEnabled());

  useEffect(() => {
    const sync = () => {
      setEnabled(getStockUpdateEnabled());
      setStaleDays(getStockStaleDays());
      setLowStockAlerts(getLowStockAlerts());
      setReady(true);
    };
    window.addEventListener(STOCK_UPDATE_SETTINGS_CHANGED, sync);
    return () => window.removeEventListener(STOCK_UPDATE_SETTINGS_CHANGED, sync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchStockUpdateEnabled().then((value) => {
      if (cancelled) return;
      setEnabled(value);
      setStaleDays(getStockStaleDays());
      setLowStockAlerts(getLowStockAlerts());
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { enabled, staleDays, lowStockAlerts, ready };
}
