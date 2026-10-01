const fs = require('fs').promises;
const path = require('path');

const PRINTER_SETTINGS_FILE = path.join(__dirname, '..', 'data', 'printerSettings.json');

const ROLE_KEYS = ['collector', 'driver', 'manager', 'all'];
const SCENARIO_KEYS = ['unload', 'cashCollection', 'billGenerate'];

const DEFAULT_SCENARIO = { enabled: false, copies: 1 };
const SHOP_NAME_MAX = 80;
const LOCATION_MAX = 160;
const BANK_DETAILS_MAX = 1200;
const FONT_PT_MIN = 1;
const FONT_PT_MAX = 200;
const FONT_PT_DEFAULT = 12;
const LINE_SPACE_MIN = 0;
const LINE_SPACE_MAX = 48;

const DEFAULT_TEST_PRINT = {
  shopName: '',
  location: '',
  bankDetails: '',
  shopNameFontSize: 12,
  locationFontSize: 12,
  bankDetailsFontSize: 12,
  shopNameLineSpacing: 0,
  locationLineSpacing: 0,
  bankDetailsLineSpacing: 0,
};

const DEFAULT_PRINTER_SETTINGS = {
  enabled: false,
  allowedRoles: ['all'],
  scenarios: {
    unload: { ...DEFAULT_SCENARIO },
    cashCollection: { ...DEFAULT_SCENARIO },
    billGenerate: { ...DEFAULT_SCENARIO },
  },
  testPrint: { ...DEFAULT_TEST_PRINT },
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

function normalizeMultiline(raw, max) {
  return String(raw ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim()
    .slice(0, max);
}

function normalizeSingleLine(raw, max) {
  return String(raw ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeFontPoints(raw, fallback, legacyMagnification) {
  const toPoints = (value) => {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < FONT_PT_MIN) return null;
    if (legacyMagnification && n <= 8) return n * 12;
    return Math.min(FONT_PT_MAX, n);
  };
  return toPoints(raw) ?? toPoints(fallback) ?? FONT_PT_DEFAULT;
}

function normalizeLineSpacing(raw) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 0;
  return Math.min(LINE_SPACE_MAX, Math.max(LINE_SPACE_MIN, n));
}

function normalizeTestPrint(src) {
  const block = src?.testPrint && typeof src.testPrint === 'object' ? src.testPrint : {};
  const legacyBank = normalizeMultiline(src?.printMessage, BANK_DETAILS_MAX);
  const bankDetails = normalizeMultiline(block.bankDetails, BANK_DETAILS_MAX);
  const sharedSize = block.fontSize;
  const legacyMagnification = block.shopNameLineSpacing == null
    && block.locationLineSpacing == null
    && block.bankDetailsLineSpacing == null;
  return {
    shopName: normalizeSingleLine(block.shopName, SHOP_NAME_MAX),
    location: normalizeSingleLine(block.location, LOCATION_MAX),
    bankDetails: bankDetails || legacyBank,
    shopNameFontSize: normalizeFontPoints(block.shopNameFontSize, sharedSize, legacyMagnification),
    locationFontSize: normalizeFontPoints(block.locationFontSize, sharedSize, legacyMagnification),
    bankDetailsFontSize: normalizeFontPoints(block.bankDetailsFontSize, sharedSize, legacyMagnification),
    shopNameLineSpacing: normalizeLineSpacing(block.shopNameLineSpacing),
    locationLineSpacing: normalizeLineSpacing(block.locationLineSpacing),
    bankDetailsLineSpacing: normalizeLineSpacing(block.bankDetailsLineSpacing),
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
    testPrint: normalizeTestPrint(src),
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
