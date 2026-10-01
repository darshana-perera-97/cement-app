import { useEffect, useRef } from 'react';
import { getApiBase } from '../apiBase';
import { authFetch } from '../auth';

const MIN_MOVE_M = 30;
const MIN_INTERVAL_MS = 20000;

function distanceMeters(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Collectors and drivers report GPS while the app is open. Admin reads it on the map. */
export function useFieldLocationReporter(enabled) {
  const lastRef = useRef({ at: 0, lat: null, lng: null });

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.geolocation) return undefined;
    let cancelled = false;
    const apiBase = getApiBase();

    const send = (pos) => {
      if (cancelled) return;
      const lat = Number(pos?.coords?.latitude);
      const lng = Number(pos?.coords?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const now = Date.now();
      const prev = lastRef.current;
      const moved =
        prev.lat == null || distanceMeters(prev.lat, prev.lng, lat, lng) >= MIN_MOVE_M;
      if (!moved && now - prev.at < MIN_INTERVAL_MS) return;
      prev.at = now;
      prev.lat = lat;
      prev.lng = lng;
      const accuracy = Number(pos.coords.accuracy);
      authFetch(`${apiBase}/api/field-locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat,
          lng,
          ...(Number.isFinite(accuracy) ? { accuracy } : {}),
        }),
      }).catch(() => {});
    };

    const watchId = navigator.geolocation.watchPosition(send, () => {}, {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 20000,
    });
    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [enabled]);
}
