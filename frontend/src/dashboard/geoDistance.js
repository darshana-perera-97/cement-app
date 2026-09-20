export const MAX_SHOP_UPDATE_DISTANCE_M = 250;

export function distanceMeters(lat1, lng1, lat2, lng2) {
  const y1 = Number(lat1);
  const x1 = Number(lng1);
  const y2 = Number(lat2);
  const x2 = Number(lng2);
  if (![y1, x1, y2, x2].every(Number.isFinite)) return Infinity;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(y2 - y1);
  const dLng = toRad(x2 - x1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(y1)) * Math.cos(toRad(y2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function formatDistance(meters) {
  const n = Number(meters);
  if (!Number.isFinite(n)) return '—';
  if (n < 1000) return `${Math.round(n)} m`;
  return `${(n / 1000).toFixed(1)} km`;
}
