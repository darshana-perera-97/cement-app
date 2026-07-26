import { useEffect, useState } from 'react';
import { getApiBase } from './apiBase';

/** Fallback when the API is unreachable or SHOP_NAME is unset. */
export const DEFAULT_SHOP_NAME = 'CS Store';

let cachedShopName = null;
let inflight = null;

/**
 * Initials for the logo badge (e.g. "CS Store" → "CS", "Acme" → "AC").
 */
export function shopNameInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'CS';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export async function fetchShopName() {
  if (cachedShopName) return cachedShopName;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/config`);
      if (res.ok) {
        const data = await res.json();
        const name = String(data?.shopName ?? '').trim();
        if (name) {
          cachedShopName = name;
          return cachedShopName;
        }
      }
    } catch {
      /* use default */
    } finally {
      inflight = null;
    }
    cachedShopName = DEFAULT_SHOP_NAME;
    return cachedShopName;
  })();

  return inflight;
}

/** React hook — returns shop name from backend `.env` `SHOP_NAME`. */
export function useShopName() {
  const [shopName, setShopName] = useState(cachedShopName || DEFAULT_SHOP_NAME);

  useEffect(() => {
    let cancelled = false;
    fetchShopName().then((name) => {
      if (!cancelled) setShopName(name);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return shopName;
}
