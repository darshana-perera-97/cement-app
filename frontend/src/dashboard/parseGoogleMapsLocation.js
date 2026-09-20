function decodeMaybe(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
}

function asLatLng(lat, lng) {
  const y = Number(lat);
  const x = Number(lng);
  if (!Number.isFinite(y) || !Number.isFinite(x)) return null;
  if (y < -90 || y > 90 || x < -180 || x > 180) return null;
  return { lat: y, lng: x };
}

/** Parse "7.492831,79.916214" or "loc:7.492831,79.916214". */
export function parseLatLngPair(text) {
  const raw = decodeMaybe(text).replace(/^loc:/i, '').trim();
  if (!raw) return null;
  const m = raw.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,|$)/);
  if (!m) return null;
  return asLatLng(m[1], m[2]);
}

function parseUrlLike(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    try {
      return new URL(`https://${raw}`);
    } catch {
      return null;
    }
  }
}

/**
 * Read lat/lng from a Google Maps link, a maps.google.com/?q=lat,lng URL,
 * or a plain "lat,lng" pair.
 */
export function parseGoogleMapsLocation(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  const direct = parseLatLngPair(raw);
  if (direct) return direct;

  const url = parseUrlLike(raw);
  if (!url) return null;

  const fromParams = ['q', 'query', 'll', 'sll', 'center', 'destination', 'origin', 'daddr', 'saddr']
    .map((key) => parseLatLngPair(url.searchParams.get(key)))
    .find(Boolean);
  if (fromParams) return fromParams;

  const placePin = raw.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (placePin) {
    const pin = asLatLng(placePin[1], placePin[2]);
    if (pin) return pin;
  }

  const at = `${url.pathname}${url.hash}`.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) {
    const pin = asLatLng(at[1], at[2]);
    if (pin) return pin;
  }

  return null;
}
