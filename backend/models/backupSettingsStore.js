const fs = require('fs').promises;
const path = require('path');
const { normalizeTimeHHMM } = require('./notificationSettingsStore');

const BACKUP_SETTINGS_FILE = path.join(__dirname, '..', 'data', 'backupSettings.json');

const EMAIL_SPLIT = /[,;\s]+/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DEFAULT_BACKUP_SETTINGS = {
  emails: [],
  scheduleEnabled: false,
  scheduleTime: '22:00',
  lastRunYmd: '',
};

function isValidEmail(email) {
  return EMAIL_RE.test(String(email || '').trim());
}

function parseEmailList(raw) {
  const chunks = Array.isArray(raw) ? raw : [raw];
  const seen = new Set();
  const emails = [];
  const invalid = [];
  for (const chunk of chunks) {
    for (const part of String(chunk ?? '').split(EMAIL_SPLIT)) {
      const email = part.trim();
      if (!email) continue;
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (isValidEmail(email)) emails.push(email);
      else invalid.push(email);
    }
  }
  return { emails, invalid };
}

function normalizeBackupSettings(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const { emails } = parseEmailList(src.emails);
  return {
    emails,
    scheduleEnabled: Boolean(src.scheduleEnabled),
    scheduleTime: normalizeTimeHHMM(src.scheduleTime) || DEFAULT_BACKUP_SETTINGS.scheduleTime,
    lastRunYmd: String(src.lastRunYmd ?? '').trim(),
  };
}

function publicBackupSettings(settings) {
  const src = normalizeBackupSettings(settings);
  return {
    emails: src.emails,
    scheduleEnabled: src.scheduleEnabled,
    scheduleTime: src.scheduleTime,
  };
}

async function readBackupSettings() {
  try {
    const raw = await fs.readFile(BACKUP_SETTINGS_FILE, 'utf8');
    return normalizeBackupSettings(JSON.parse(raw));
  } catch (e) {
    if (e.code === 'ENOENT') return { ...DEFAULT_BACKUP_SETTINGS };
    throw e;
  }
}

async function writeBackupSettings(patch = {}) {
  const current = await readBackupSettings();
  const next = normalizeBackupSettings({
    ...current,
    ...patch,
    lastRunYmd: patch.lastRunYmd !== undefined ? patch.lastRunYmd : current.lastRunYmd,
  });
  await fs.mkdir(path.dirname(BACKUP_SETTINGS_FILE), { recursive: true });
  await fs.writeFile(BACKUP_SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = {
  BACKUP_SETTINGS_FILE,
  DEFAULT_BACKUP_SETTINGS,
  isValidEmail,
  parseEmailList,
  normalizeBackupSettings,
  publicBackupSettings,
  readBackupSettings,
  writeBackupSettings,
};
