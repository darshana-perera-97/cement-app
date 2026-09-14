const fs = require('fs').promises;
const path = require('path');

const BACKUP_HISTORY_FILE = path.join(__dirname, '..', 'data', 'backupHistory.json');
const MAX_BACKUP_HISTORY = 40;
const HISTORY_PAGE_SIZE = 10;

async function readBackupHistory() {
  try {
    const raw = await fs.readFile(BACKUP_HISTORY_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function appendBackupHistory(entry) {
  const records = await readBackupHistory();
  const row = {
    id: `backup-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    sentAt: new Date().toISOString(),
    trigger: entry.trigger === 'scheduled' ? 'scheduled' : 'manual',
    emails: Array.isArray(entry.emails) ? entry.emails : [],
    status: entry.status === 'failed' ? 'failed' : 'sent',
    filename: entry.filename || '',
    fileCount: Number.isFinite(Number(entry.fileCount)) ? Number(entry.fileCount) : 0,
    error: entry.error || null,
  };
  records.unshift(row);
  const trimmed = records.slice(0, MAX_BACKUP_HISTORY);
  await fs.mkdir(path.dirname(BACKUP_HISTORY_FILE), { recursive: true });
  await fs.writeFile(BACKUP_HISTORY_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
  return row;
}

function latestBackupHistory(records, limit = HISTORY_PAGE_SIZE) {
  const list = Array.isArray(records) ? records : [];
  return list.slice(0, Math.max(1, limit));
}

module.exports = {
  BACKUP_HISTORY_FILE,
  MAX_BACKUP_HISTORY,
  HISTORY_PAGE_SIZE,
  readBackupHistory,
  appendBackupHistory,
  latestBackupHistory,
};
