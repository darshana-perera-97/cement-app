const fs = require('fs').promises;
const path = require('path');

const WHATSAPP_CONFIG_FILE = path.join(__dirname, 'data', 'whatsappConfigs.json');

const DEFAULT_WHATSAPP_CONFIG = {
  enabled: false,
  lastConnection: null,
};

function normalizeLastConnection(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const phone = String(raw.phone ?? '').trim();
  const pushname = String(raw.pushname ?? '').trim();
  const platform = String(raw.platform ?? '').trim();
  const connectedAt = String(raw.connectedAt ?? '').trim();
  if (!phone && !pushname && !platform && !connectedAt) return null;
  return { phone, pushname, platform, connectedAt };
}

async function readWhatsAppConfig() {
  try {
    const raw = await fs.readFile(WHATSAPP_CONFIG_FILE, 'utf8');
    const data = JSON.parse(raw);
    return {
      ...DEFAULT_WHATSAPP_CONFIG,
      ...data,
      lastConnection: normalizeLastConnection(data.lastConnection),
    };
  } catch (e) {
    if (e.code === 'ENOENT') return { ...DEFAULT_WHATSAPP_CONFIG };
    if (e instanceof SyntaxError) {
      console.error('[whatsapp] config file corrupt — using defaults');
      return { ...DEFAULT_WHATSAPP_CONFIG };
    }
    throw e;
  }
}

async function writeWhatsAppConfig(config) {
  await fs.mkdir(path.dirname(WHATSAPP_CONFIG_FILE), { recursive: true });
  const tmpFile = `${WHATSAPP_CONFIG_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmpFile, JSON.stringify(config, null, 2), 'utf8');
  await fs.rename(tmpFile, WHATSAPP_CONFIG_FILE);
}

module.exports = {
  readWhatsAppConfig,
  writeWhatsAppConfig,
  DEFAULT_WHATSAPP_CONFIG,
  WHATSAPP_CONFIG_FILE,
};
