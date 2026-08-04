const fs = require('fs').promises;
const path = require('path');

const SENT_WHATSAPP_FILE = path.join(__dirname, '..', 'data', 'sentWhatsapp.json');
const MAX_SENT_WHATSAPP = 40;

async function readSentWhatsapp() {
  try {
    const raw = await fs.readFile(SENT_WHATSAPP_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function appendSentWhatsapp(entry) {
  const records = await readSentWhatsapp();
  const row = {
    id: `wa-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    sentAt: new Date().toISOString(),
    ...entry,
  };
  records.unshift(row);
  const trimmed = records.slice(0, MAX_SENT_WHATSAPP);
  await fs.mkdir(path.dirname(SENT_WHATSAPP_FILE), { recursive: true });
  await fs.writeFile(SENT_WHATSAPP_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
  return row;
}

module.exports = {
  readSentWhatsapp,
  appendSentWhatsapp,
  MAX_SENT_WHATSAPP,
  SENT_WHATSAPP_FILE,
};
