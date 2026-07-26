const fs = require('fs').promises;
const path = require('path');

const WHATSAPP_CONFIG_FILE = path.join(__dirname, 'data', 'whatsappConfigs.json');

const DEFAULT_WHATSAPP_CONFIG = {
  enabled: false,
};

async function readWhatsAppConfig() {
  try {
    const raw = await fs.readFile(WHATSAPP_CONFIG_FILE, 'utf8');
    const data = JSON.parse(raw);
    return { ...DEFAULT_WHATSAPP_CONFIG, ...data };
  } catch (e) {
    if (e.code === 'ENOENT') return { ...DEFAULT_WHATSAPP_CONFIG };
    throw e;
  }
}

async function writeWhatsAppConfig(config) {
  await fs.mkdir(path.dirname(WHATSAPP_CONFIG_FILE), { recursive: true });
  await fs.writeFile(WHATSAPP_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

module.exports = {
  readWhatsAppConfig,
  writeWhatsAppConfig,
  DEFAULT_WHATSAPP_CONFIG,
  WHATSAPP_CONFIG_FILE,
};
