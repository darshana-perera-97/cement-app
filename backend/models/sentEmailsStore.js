const fs = require('fs').promises;
const path = require('path');

const SENT_EMAILS_FILE = path.join(__dirname, '..', 'data', 'sentEmails.json');
const MAX_SENT_EMAILS = 40;

async function readSentEmails() {
  try {
    const raw = await fs.readFile(SENT_EMAILS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function appendSentEmail(entry) {
  const records = await readSentEmails();
  const row = {
    id: `email-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    sentAt: new Date().toISOString(),
    ...entry,
  };
  records.unshift(row);
  const trimmed = records.slice(0, MAX_SENT_EMAILS);
  await fs.mkdir(path.dirname(SENT_EMAILS_FILE), { recursive: true });
  await fs.writeFile(SENT_EMAILS_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
  return row;
}

module.exports = {
  readSentEmails,
  appendSentEmail,
  MAX_SENT_EMAILS,
  SENT_EMAILS_FILE,
};
