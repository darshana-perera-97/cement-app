const fs = require('fs').promises;
const path = require('path');

const COLLECTOR_UNLOAD_PRICE_SETTINGS_FILE = path.join(
  __dirname,
  '..',
  'data',
  'collectorUnloadPriceSettings.json',
);

const DEFAULT_COLLECTOR_UNLOAD_PRICE_SETTINGS = {
  enabled: false,
};

function normalizeCollectorUnloadPriceSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: Boolean(src.enabled),
  };
}

async function readCollectorUnloadPriceSettings() {
  try {
    const raw = await fs.readFile(COLLECTOR_UNLOAD_PRICE_SETTINGS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return normalizeCollectorUnloadPriceSettings(data);
  } catch (e) {
    if (e.code === 'ENOENT') return { ...DEFAULT_COLLECTOR_UNLOAD_PRICE_SETTINGS };
    throw e;
  }
}

async function writeCollectorUnloadPriceSettings(settings) {
  const current = await readCollectorUnloadPriceSettings();
  const src = settings && typeof settings === 'object' ? settings : {};
  const next = normalizeCollectorUnloadPriceSettings({
    ...current,
    ...src,
  });
  await fs.mkdir(path.dirname(COLLECTOR_UNLOAD_PRICE_SETTINGS_FILE), { recursive: true });
  await fs.writeFile(COLLECTOR_UNLOAD_PRICE_SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

async function isCollectorUnloadPriceEnabled() {
  const settings = await readCollectorUnloadPriceSettings();
  return Boolean(settings.enabled);
}

module.exports = {
  COLLECTOR_UNLOAD_PRICE_SETTINGS_FILE,
  DEFAULT_COLLECTOR_UNLOAD_PRICE_SETTINGS,
  normalizeCollectorUnloadPriceSettings,
  readCollectorUnloadPriceSettings,
  writeCollectorUnloadPriceSettings,
  isCollectorUnloadPriceEnabled,
};
