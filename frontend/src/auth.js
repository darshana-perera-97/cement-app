import { ALL_MANAGER_ACCESS_KEYS, COLLECTOR_ACCESS_KEYS, DASHBOARD_NAV } from './dashboard/navConfig';
import { getStockUpdateEnabled, setStockUpdateEnabledCache } from './stockUpdateSettings';
import {
  getCollectorUnloadPriceEnabled,
  setCollectorUnloadPriceEnabledCache,
} from './collectorUnloadPriceSettings';
import { setStockItemUnloadPriceEnabledCache } from './stockItemUnloadPriceSettings';

const AUTH_KEY = 'cs-store-auth';
const USER_KEY = 'cs-store-username';
const ROLE_KEY = 'cs-store-role';
const TOKEN_KEY = 'cs-store-token';
const STAFF_ROLE_KEY = 'cs-store-staff-role';
const DISPLAY_NAME_KEY = 'cs-store-display-name';
const MANAGER_ACCESS_KEY = 'cs-store-manager-access';

export const AUTH_CHANGED = 'cs-auth-changed';

function notifyAuthChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(AUTH_CHANGED));
}

export function setManagerAccess(keys) {
  if (Array.isArray(keys)) {
    sessionStorage.setItem(MANAGER_ACCESS_KEY, JSON.stringify(keys));
  } else {
    sessionStorage.removeItem(MANAGER_ACCESS_KEY);
  }
}

export function getManagerAccess() {
  if (isAdmin() || getStaffRole() !== 'Manager') return null;
  try {
    const raw = sessionStorage.getItem(MANAGER_ACCESS_KEY);
    if (!raw) return [...ALL_MANAGER_ACCESS_KEYS];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function isDsr() {
  return getStaffRole() === 'DSR';
}

export function canAccessMap() {
  if (isAdmin()) return true;
  if (!getStockUpdateEnabled()) return false;
  return isCollector() || isDsr();
}

export function canAccessCollectorUnloadPrices() {
  return isCollector() && getCollectorUnloadPriceEnabled();
}

export function hasDashboardAccess(accessKey) {
  if (!accessKey) return false;
  if (accessKey === 'unloads') return canAccessCollectorUnloadPrices();
  if (isAdmin()) return true;
  if (accessKey === 'map') return canAccessMap();
  if (isDsr()) return false;
  if (getStaffRole() === 'Manager') {
    const access = getManagerAccess();
    return Array.isArray(access) && access.includes(accessKey);
  }
  if (getStaffRole() === 'Collector') {
    return COLLECTOR_ACCESS_KEYS.includes(accessKey);
  }
  return true;
}

export function getFirstAllowedDashboardPath() {
  if (isAdmin()) return '/dashboard/analytics';
  if (isDsr()) return canAccessMap() ? '/dashboard/map' : '/dashboard/no-access';
  if (getStaffRole() === 'Manager') {
    const item = DASHBOARD_NAV.find((n) => n.accessKey && hasDashboardAccess(n.accessKey));
    return item?.to || '/dashboard/no-access';
  }
  if (getStaffRole() === 'Collector') {
    const item = DASHBOARD_NAV.find((n) => n.accessKey && COLLECTOR_ACCESS_KEYS.includes(n.accessKey));
    return item?.to || '/dashboard/no-access';
  }
  return '/dashboard/analytics';
}

/** After sign-in (or visiting /), send drivers to the unloads portal. */
export function getPostLoginPath() {
  if (isDriverAuthed()) return '/unloads';
  return getFirstAllowedDashboardPath();
}

export function setAuth(username, role, token, staffRole, managerAccess) {
  sessionStorage.setItem(AUTH_KEY, '1');
  if (username != null && String(username).trim()) {
    sessionStorage.setItem(USER_KEY, String(username).trim());
  }
  sessionStorage.setItem(ROLE_KEY, role === 'admin' ? 'admin' : 'staff');
  if (token != null && String(token).trim()) {
    sessionStorage.setItem(TOKEN_KEY, String(token).trim());
  }
  sessionStorage.removeItem(DISPLAY_NAME_KEY);
  const sr = staffRole != null ? String(staffRole).trim() : '';
  if (sr) sessionStorage.setItem(STAFF_ROLE_KEY, sr);
  else sessionStorage.removeItem(STAFF_ROLE_KEY);
  if (role !== 'admin' && sr === 'Manager') {
    setManagerAccess(Array.isArray(managerAccess) ? managerAccess : [...ALL_MANAGER_ACCESS_KEYS]);
  } else {
    sessionStorage.removeItem(MANAGER_ACCESS_KEY);
  }
  notifyAuthChanged();
}

/** Driver portal session (NIC login on /unloads). */
export function setDriverAuth(username, token, displayName) {
  sessionStorage.setItem(AUTH_KEY, '1');
  if (username != null && String(username).trim()) {
    sessionStorage.setItem(USER_KEY, String(username).trim());
  }
  sessionStorage.setItem(ROLE_KEY, 'staff');
  if (token != null && String(token).trim()) {
    sessionStorage.setItem(TOKEN_KEY, String(token).trim());
  }
  sessionStorage.setItem(STAFF_ROLE_KEY, 'Driver');
  if (displayName != null && String(displayName).trim()) {
    sessionStorage.setItem(DISPLAY_NAME_KEY, String(displayName).trim());
  }
  sessionStorage.removeItem(MANAGER_ACCESS_KEY);
  notifyAuthChanged();
}

export function clearAuth() {
  sessionStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(ROLE_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(STAFF_ROLE_KEY);
  sessionStorage.removeItem(DISPLAY_NAME_KEY);
  sessionStorage.removeItem(MANAGER_ACCESS_KEY);
  notifyAuthChanged();
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

export function getStaffRole() {
  return sessionStorage.getItem(STAFF_ROLE_KEY) || '';
}

export function getDisplayName() {
  return sessionStorage.getItem(DISPLAY_NAME_KEY) || getUsername();
}

export function isDriverAuthed() {
  return isAuthed() && getStaffRole() === 'Driver';
}

/** Driver portal or admin (for testing / oversight). */
export function canAccessUnloadsPortal() {
  return isDriverAuthed() || isAdmin();
}

export function isManagerOrAdmin() {
  return isAdmin() || getStaffRole() === 'Manager';
}

export function isCollector() {
  return getStaffRole() === 'Collector';
}

/** Collectors and drivers may only record today's date on new entries. */
export function mustUseTodayRecordDate() {
  return isCollector() || isDriverAuthed();
}

/** Admin-only: edit existing records in detail popups and edit modals. */
export function canEditDetails() {
  return isAdmin();
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

/** Sync manager permissions from GET /api/me (e.g. after admin changes access). */
export async function refreshSessionFromServer(apiBase) {
  const root = String(apiBase || '').trim();
  if (!root || !isAuthed()) return;
  try {
    const res = await authFetch(`${root}/api/me`);
    if (!res.ok) {
      if (res.status === 403 && isDsr()) {
        clearAuth();
      }
      return;
    }
    const data = await res.json();
    const displayName = String(data.name || data.username || '').trim();
    if (displayName) sessionStorage.setItem(DISPLAY_NAME_KEY, displayName);
    if (data.role === 'admin') {
      sessionStorage.setItem(ROLE_KEY, 'admin');
      sessionStorage.removeItem(STAFF_ROLE_KEY);
      sessionStorage.removeItem(MANAGER_ACCESS_KEY);
      return;
    }
    const staffRole = String(data.staffRole || '').trim();
    if (staffRole) sessionStorage.setItem(STAFF_ROLE_KEY, staffRole);
    if (staffRole === 'Manager' && Array.isArray(data.managerAccess)) {
      setManagerAccess(data.managerAccess);
    }
    if (data.stockUpdateEnabled != null) {
      setStockUpdateEnabledCache(Boolean(data.stockUpdateEnabled));
    }
    if (data.collectorUnloadPriceEnabled != null) {
      setCollectorUnloadPriceEnabledCache(Boolean(data.collectorUnloadPriceEnabled));
    }
    if (data.stockItemUnloadPriceEnabled != null) {
      setStockItemUnloadPriceEnabledCache(Boolean(data.stockItemUnloadPriceEnabled));
    }
    if (staffRole === 'DSR' && !getStockUpdateEnabled()) {
      clearAuth();
    }
  } catch {
    /* ignore */
  }
}
