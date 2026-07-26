const fs = require('fs').promises;
const path = require('path');

const EMAIL_CONFIG_FILE = path.join(__dirname, 'data', 'emailConfigs.json');

const DEFAULT_EMAIL_CONFIG = {
  enabled: false,
  host: '',
  port: 587,
  secure: false,
  user: '',
  pass: '',
  from: '',
  fromName: 'Chaminda Stores',
};

async function readEmailConfig() {
  try {
    const raw = await fs.readFile(EMAIL_CONFIG_FILE, 'utf8');
    const data = JSON.parse(raw);
    return { ...DEFAULT_EMAIL_CONFIG, ...data };
  } catch (e) {
    if (e.code === 'ENOENT') return { ...DEFAULT_EMAIL_CONFIG };
    throw e;
  }
}

async function writeEmailConfig(config) {
  await fs.mkdir(path.dirname(EMAIL_CONFIG_FILE), { recursive: true });
  await fs.writeFile(EMAIL_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

function maskEmailConfig(config) {
  const { pass, ...rest } = config;
  return {
    ...rest,
    pass: '',
    passConfigured: Boolean(String(pass ?? '').trim()),
  };
}

module.exports = {
  readEmailConfig,
  writeEmailConfig,
  maskEmailConfig,
  DEFAULT_EMAIL_CONFIG,
  EMAIL_CONFIG_FILE,
};
