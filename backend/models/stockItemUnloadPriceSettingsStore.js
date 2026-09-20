const fs = require('fs').promises;
const path = require('path');

const STOCK_ITEM_UNLOAD_PRICE_SETTINGS_FILE = path.join(
  __dirname,
  '..',
  'data',
  'stockItemUnloadPriceSettings.json',
);

const DEFAULT_STOCK_ITEM_UNLOAD_PRICE_SETTINGS = {
  enabled: false,
};

function normalizeStockItemUnloadPriceSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: Boolean(src.enabled),
  };
}

async function readStockItemUnloadPriceSettings() {
  try {
    const raw = await fs.readFile(STOCK_ITEM_UNLOAD_PRICE_SETTINGS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return normalizeStockItemUnloadPriceSettings(data);
  } catch (e) {
    if (e.code === 'ENOENT') return { ...DEFAULT_STOCK_ITEM_UNLOAD_PRICE_SETTINGS };
    throw e;
  }
}

async function writeStockItemUnloadPriceSettings(settings) {
  const current = await readStockItemUnloadPriceSettings();
  const src = settings && typeof settings === 'object' ? settings : {};
  const next = normalizeStockItemUnloadPriceSettings({
    ...current,
    ...src,
  });
  await fs.mkdir(path.dirname(STOCK_ITEM_UNLOAD_PRICE_SETTINGS_FILE), { recursive: true });
  await fs.writeFile(STOCK_ITEM_UNLOAD_PRICE_SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

async function isStockItemUnloadPriceEnabled() {
  const settings = await readStockItemUnloadPriceSettings();
  return Boolean(settings.enabled);
}

module.exports = {
  STOCK_ITEM_UNLOAD_PRICE_SETTINGS_FILE,
  DEFAULT_STOCK_ITEM_UNLOAD_PRICE_SETTINGS,
  normalizeStockItemUnloadPriceSettings,
  readStockItemUnloadPriceSettings,
  writeStockItemUnloadPriceSettings,
  isStockItemUnloadPriceEnabled,
};
