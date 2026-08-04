const fs = require('fs').promises;
const path = require('path');

const LORRIES_FILE = path.join(__dirname, '..', 'data', 'lorries.json');

async function readLorriesRaw() {
  try {
    const raw = await fs.readFile(LORRIES_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writeLorries(records) {
  await fs.mkdir(path.dirname(LORRIES_FILE), { recursive: true });
  await fs.writeFile(LORRIES_FILE, JSON.stringify(records, null, 2), 'utf8');
}

function normalizeNumber(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeLorry(row) {
  const number = normalizeNumber(row.number ?? row.vehicleNumber ?? row.name);
  const note = String(row.note ?? '').trim();
  return {
    ...row,
    number,
    note,
  };
}

async function readLorries() {
  const existing = await readLorriesRaw();
  return existing.map(normalizeLorry).filter((row) => row.number);
}

function findDuplicate(records, number, excludeId = '') {
  const key = normalizeNumber(number).toLowerCase();
  if (!key) return null;
  return (
    records.find(
      (r) =>
        r.id !== excludeId &&
        normalizeNumber(r.number ?? r.vehicleNumber ?? r.name).toLowerCase() === key,
    ) || null
  );
}

module.exports = {
  readLorries,
  writeLorries,
  normalizeNumber,
  normalizeLorry,
  findDuplicate,
  LORRIES_FILE,
};
