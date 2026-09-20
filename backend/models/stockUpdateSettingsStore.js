const fs = require('fs').promises;
const path = require('path');

const STOCK_UPDATE_SETTINGS_FILE = path.join(__dirname, '..', 'data', 'stockUpdateSettings.json');

const DEFAULT_STOCK_UPDATE_SETTINGS = {
  enabled: false,
  staleDays: 7,
  lowStockAlerts: [],
};

const MAX_LOW_STOCK_ALERTS = 5;

function clampStaleDays(raw) {
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_STOCK_UPDATE_SETTINGS.staleDays;
  return Math.min(365, n);
}

function clampMinBags(raw) {
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(99999, n);
}

function normalizeLowStockAlerts(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const next = [];
  const seen = new Set();
  for (const row of list) {
    const key = String(row?.key ?? '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push({
      key,
      minBags: clampMinBags(row.minBags),
    });
    if (next.length >= MAX_LOW_STOCK_ALERTS) break;
  }
  return next;
}

function normalizeStockUpdateSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: Boolean(src.enabled),
    staleDays: clampStaleDays(src.staleDays ?? DEFAULT_STOCK_UPDATE_SETTINGS.staleDays),
    lowStockAlerts: normalizeLowStockAlerts(src.lowStockAlerts),
  };
}

async function readStockUpdateSettings() {
  try {
    const raw = await fs.readFile(STOCK_UPDATE_SETTINGS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return normalizeStockUpdateSettings(data);
  } catch (e) {
    if (e.code === 'ENOENT') return { ...DEFAULT_STOCK_UPDATE_SETTINGS };
    throw e;
  }
}

async function writeStockUpdateSettings(settings) {
  const current = await readStockUpdateSettings();
  const src = settings && typeof settings === 'object' ? settings : {};
  const next = normalizeStockUpdateSettings({
    ...current,
    ...src,
    lowStockAlerts: src.lowStockAlerts !== undefined ? src.lowStockAlerts : current.lowStockAlerts,
  });
  await fs.mkdir(path.dirname(STOCK_UPDATE_SETTINGS_FILE), { recursive: true });
  await fs.writeFile(STOCK_UPDATE_SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

async function isStockUpdateEnabled() {
  const settings = await readStockUpdateSettings();
  return Boolean(settings.enabled);
}

module.exports = {
  STOCK_UPDATE_SETTINGS_FILE,
  DEFAULT_STOCK_UPDATE_SETTINGS,
  normalizeStockUpdateSettings,
  readStockUpdateSettings,
  writeStockUpdateSettings,
  isStockUpdateEnabled,
  clampStaleDays,
  MAX_LOW_STOCK_ALERTS,
};
