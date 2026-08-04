const fs = require('fs').promises;
const path = require('path');

const OVERDUE_DATES_FILE = path.join(__dirname, '..', 'data', 'overduedates.json');
const DEFAULT_OVERDUE_DAYS = 14;
const MIN_OVERDUE_DAYS = 1;
const MAX_OVERDUE_DAYS = 365;

async function readOverdueDates() {
  try {
    const raw = await fs.readFile(OVERDUE_DATES_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return data;
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

async function writeOverdueDates(map) {
  await fs.mkdir(path.dirname(OVERDUE_DATES_FILE), { recursive: true });
  await fs.writeFile(OVERDUE_DATES_FILE, JSON.stringify(map, null, 2), 'utf8');
}

function normalizeOverdueDays(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < MIN_OVERDUE_DAYS || n > MAX_OVERDUE_DAYS) return null;
  return n;
}

function getOverdueDaysForCustomer(overdueDates, customerId) {
  const id = String(customerId ?? '').trim();
  if (!id) return DEFAULT_OVERDUE_DAYS;
  const stored = overdueDates[id];
  const normalized = normalizeOverdueDays(stored);
  return normalized == null ? DEFAULT_OVERDUE_DAYS : normalized;
}

/** Persist only when the value differs from default or an existing override. */
async function setCustomerOverdueDays(customerId, days) {
  const id = String(customerId ?? '').trim();
  if (!id) throw new Error('customerId is required');

  const normalized = normalizeOverdueDays(days);
  if (normalized == null) {
    throw new Error(`overdueDays must be an integer from ${MIN_OVERDUE_DAYS} to ${MAX_OVERDUE_DAYS}`);
  }

  const map = await readOverdueDates();
  if (normalized === DEFAULT_OVERDUE_DAYS) {
    if (!(id in map)) return map;
    delete map[id];
    await writeOverdueDates(map);
    return map;
  }

  if (map[id] === normalized) return map;
  map[id] = normalized;
  await writeOverdueDates(map);
  return map;
}

module.exports = {
  readOverdueDates,
  writeOverdueDates,
  setCustomerOverdueDays,
  getOverdueDaysForCustomer,
  normalizeOverdueDays,
  DEFAULT_OVERDUE_DAYS,
  OVERDUE_DATES_FILE,
};
