const AUTH_KEY = 'cs-store-auth';
const USER_KEY = 'cs-store-username';
const ROLE_KEY = 'cs-store-role';
const TOKEN_KEY = 'cs-store-token';

export function setAuth(username, role, token) {
  sessionStorage.setItem(AUTH_KEY, '1');
  if (username != null && String(username).trim()) {
    sessionStorage.setItem(USER_KEY, String(username).trim());
  }
  sessionStorage.setItem(ROLE_KEY, role === 'admin' ? 'admin' : 'staff');
  if (token != null && String(token).trim()) {
    sessionStorage.setItem(TOKEN_KEY, String(token).trim());
  }
}

export function clearAuth() {
  sessionStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(ROLE_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

export function isAuthed() {
  return sessionStorage.getItem(AUTH_KEY) === '1';
}

export function getUsername() {
  return sessionStorage.getItem(USER_KEY) || '';
}

export function getRole() {
  return sessionStorage.getItem(ROLE_KEY) || '';
}

export function isAdmin() {
  return getRole() === 'admin';
}

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

/** Headers for authenticated API calls (Bearer from login). */
export function getAuthHeaders() {
  const t = getToken();
  if (!t) return {};
  return { Authorization: `Bearer ${t}` };
}

export function authFetch(url, options = {}) {
  const headers = {
    ...(options.headers || {}),
    ...getAuthHeaders(),
  };
  return fetch(url, { ...options, headers });
}

