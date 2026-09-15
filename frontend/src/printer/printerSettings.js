import { getStaffRole, isAdmin, isAuthed } from '../auth';

export const PRINTER_SETTINGS_CHANGED = 'printer-settings-changed';

export const PRINTER_ROLE_OPTIONS = [
  { key: 'collector', label: 'Collectors' },
  { key: 'driver', label: 'Drivers' },
  { key: 'manager', label: 'Managers' },
  { key: 'all', label: 'All users' },
];

export const PRINTER_SCENARIOS = [
  {
    key: 'unload',
    label: 'Unloading',
    printTitle: 'Unloading invoice',
    description: 'Print an unloading invoice when a shop unload is recorded.',
  },
  {
    key: 'cashCollection',
    label: 'Cash collection',
    description: 'Print a receipt when a customer payment is recorded.',
  },
  {
    key: 'billGenerate',
    label: 'Bill generate',
    description: 'Print an invoice when a bill is created or an unload is approved.',
  },
];

export const EMPTY_PRINTER_SETTINGS = {
  enabled: false,
  allowedRoles: ['all'],
  scenarios: {
    unload: { enabled: false, copies: 1 },
    cashCollection: { enabled: false, copies: 1 },
    billGenerate: { enabled: false, copies: 1 },
  },
};

export function notifyPrinterSettingsChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PRINTER_SETTINGS_CHANGED));
  }
}

export function currentPrinterRoleKey() {
  if (isAdmin()) return 'admin';
  const staff = String(getStaffRole() || '').trim();
  if (staff === 'Collector') return 'collector';
  if (staff === 'Driver') return 'driver';
  if (staff === 'Manager') return 'manager';
  return '';
}

export function isPrinterRoleAllowed(settings, roleKey = currentPrinterRoleKey()) {
  if (!settings?.enabled) return false;
  if (!isAuthed()) return false;
  const roles = Array.isArray(settings.allowedRoles) ? settings.allowedRoles : [];
  if (roles.includes('all')) return true;
  if (roleKey === 'admin') return true;
  return Boolean(roleKey) && roles.includes(roleKey);
}

export function isPrinterScenarioEnabled(settings, scenarioKey) {
  return Boolean(settings?.enabled && settings?.scenarios?.[scenarioKey]?.enabled);
}

export function printerCopiesForScenario(settings, scenarioKey) {
  const n = Number(settings?.scenarios?.[scenarioKey]?.copies);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(9, Math.floor(n));
}

export function shouldAutoPrintScenario(settings, scenarioKey, connected) {
  if (!connected) return false;
  if (!isPrinterRoleAllowed(settings)) return false;
  if (!isPrinterScenarioEnabled(settings, scenarioKey)) return false;
  return printerCopiesForScenario(settings, scenarioKey) > 0;
}

export function shouldShowPrinterIndicator(settings) {
  return isPrinterRoleAllowed(settings);
}
