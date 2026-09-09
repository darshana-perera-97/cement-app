const fs = require('fs').promises;
const path = require('path');

const PRINTER_SETTINGS_FILE = path.join(__dirname, '..', 'data', 'printerSettings.json');

const ROLE_KEYS = ['collector', 'driver', 'manager', 'all'];
const SCENARIO_KEYS = ['unload', 'cashCollection', 'billGenerate'];

const DEFAULT_SCENARIO = { enabled: false, copies: 1 };

const DEFAULT_PRINTER_SETTINGS = {
  enabled: false,
  allowedRoles: ['all'],
  scenarios: {
    unload: { ...DEFAULT_SCENARIO },
    cashCollection: { ...DEFAULT_SCENARIO },
    billGenerate: { ...DEFAULT_SCENARIO },
  },
};

function clampCopies(raw) {
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(9, n);
}

function normalizeAllowedRoles(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const next = [];
  for (const item of list) {
    const key = String(item ?? '')
      .trim()
      .toLowerCase();
    if (!ROLE_KEYS.includes(key) || next.includes(key)) continue;
    next.push(key);
  }
  if (next.includes('all')) return ['all'];
  return next;
}

function normalizeScenario(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: Boolean(src.enabled),
    copies: clampCopies(src.copies),
  };
}

function normalizePrinterSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const scenarios = {};
  for (const key of SCENARIO_KEYS) {
    scenarios[key] = normalizeScenario(src.scenarios?.[key] ?? DEFAULT_PRINTER_SETTINGS.scenarios[key]);
  }
  return {
    enabled: Boolean(src.enabled),
    allowedRoles: normalizeAllowedRoles(
      src.allowedRoles != null ? src.allowedRoles : DEFAULT_PRINTER_SETTINGS.allowedRoles,
    ),
    scenarios,
  };
}

async function readPrinterSettings() {
  try {
    const raw = await fs.readFile(PRINTER_SETTINGS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return normalizePrinterSettings(data);
  } catch (e) {
    if (e.code === 'ENOENT') return { ...normalizePrinterSettings(DEFAULT_PRINTER_SETTINGS) };
    throw e;
  }
}

async function writePrinterSettings(settings) {
  const next = normalizePrinterSettings(settings);
  await fs.mkdir(path.dirname(PRINTER_SETTINGS_FILE), { recursive: true });
  await fs.writeFile(PRINTER_SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = {
  PRINTER_SETTINGS_FILE,
  DEFAULT_PRINTER_SETTINGS,
  ROLE_KEYS,
  SCENARIO_KEYS,
  normalizePrinterSettings,
  readPrinterSettings,
  writePrinterSettings,
};
