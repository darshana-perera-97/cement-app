/**
 * Backend API base URL for this frontend.
 *
 * - Production / custom: set `REACT_APP_API_URL` in `.env` (no trailing slash).
 * - Production, unset: returns '' → calls use relative `/api/...` (same origin when SPA is served by the API).
 * - Local dev: if unset, uses {@link DEFAULT_DEV_API_URL} below — change only here for port/host.
 */
// export const DEFAULT_DEV_API_URL = 'http://93.127.129.102:1240';
// export const DEFAULT_DEV_API_URL = 'http://69.197.187.24:1249';
// export const DEFAULT_DEV_API_URL = 'https://anuradha-distribution.aipulse.lk';
// export const DEFAULT_DEV_API_URL = 'https://shakya.aipulse.lk';
// export const DEFAULT_DEV_API_URL = 'https://chaminda-stores.aipulse.lk';
export const DEFAULT_DEV_API_URL = 'http://localhost:1249';

export function getApiBase() {
  const fromEnv = (process.env.REACT_APP_API_URL || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'development') {
    return DEFAULT_DEV_API_URL;
  }
  return '';
}
