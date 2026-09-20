import { useCallback, useEffect, useState } from 'react';
import { getApiBase } from '../apiBase';
import { AUTH_CHANGED, authFetch, isCollector } from '../auth';

const apiBase = getApiBase();

export const COLLECTION_DAY_CLOSED_EVENT = 'cs-collection-day-closed';

export function todayYmdLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function notifyCollectionDayClosed(date) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(COLLECTION_DAY_CLOSED_EVENT, { detail: { date } }));
}

export async function fetchCollectionDayClose(date) {
  const q = date ? `?date=${encodeURIComponent(date)}` : '';
  const res = await authFetch(`${apiBase}/api/collection-day-close${q}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load collection status');
  return data;
}

export async function closeCollectionDay(date) {
  const res = await authFetch(`${apiBase}/api/collection-day-close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to close collection');
  notifyCollectionDayClosed(data.date || date);
  return data;
}

export function useCollectorCollectionClosed(date) {
  const [closed, setClosed] = useState(false);
  const [loading, setLoading] = useState(() => isCollector());
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!isCollector()) {
      setClosed(false);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCollectionDayClose(date);
      setClosed(Boolean(data.closed));
    } catch (e) {
      setError(e.message || 'Could not load collection status');
      setClosed(false);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onAuth = () => {
      load();
    };
    const onClosed = (e) => {
      const closedDate = e?.detail?.date;
      if (!date || !closedDate || closedDate === date) load();
    };
    window.addEventListener(AUTH_CHANGED, onAuth);
    window.addEventListener(COLLECTION_DAY_CLOSED_EVENT, onClosed);
    return () => {
      window.removeEventListener(AUTH_CHANGED, onAuth);
      window.removeEventListener(COLLECTION_DAY_CLOSED_EVENT, onClosed);
    };
  }, [load, date]);

  return { closed, loading, error, refresh: load };
}
