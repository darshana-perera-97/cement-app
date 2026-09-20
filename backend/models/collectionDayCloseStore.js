const fs = require('fs').promises;
const path = require('path');

const COLLECTION_DAY_CLOSES_FILE = path.join(__dirname, '..', 'data', 'collectionDayCloses.json');

function normalizeYmd(raw) {
  const s = String(raw ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function normalizeCloseRow(row) {
  const collectorUserId = String(row?.collectorUserId ?? '').trim();
  const date = normalizeYmd(row?.date);
  if (!collectorUserId || !date) return null;
  return {
    collectorUserId,
    date,
    closedAt: String(row?.closedAt ?? '').trim() || new Date().toISOString(),
    closedBy: String(row?.closedBy ?? '').trim(),
  };
}

function normalizeCloses(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.closes) ? raw.closes : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const row = normalizeCloseRow(item);
    if (!row) continue;
    const key = `${row.collectorUserId}|${row.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

async function readCollectionDayCloses() {
  try {
    const raw = await fs.readFile(COLLECTION_DAY_CLOSES_FILE, 'utf8');
    const data = JSON.parse(raw);
    return normalizeCloses(data);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writeCollectionDayCloses(records) {
  const next = normalizeCloses(records);
  await fs.mkdir(path.dirname(COLLECTION_DAY_CLOSES_FILE), { recursive: true });
  await fs.writeFile(COLLECTION_DAY_CLOSES_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function findCollectionDayClose(closes, collectorUserId, date) {
  const id = String(collectorUserId ?? '').trim();
  const d = normalizeYmd(date);
  if (!id || !d) return null;
  return closes.find((row) => row.collectorUserId === id && row.date === d) || null;
}

async function getCollectionDayClose(collectorUserId, date) {
  const closes = await readCollectionDayCloses();
  return findCollectionDayClose(closes, collectorUserId, date);
}

async function isCollectionClosedForCollector(collectorUserId, date) {
  const row = await getCollectionDayClose(collectorUserId, date);
  return Boolean(row);
}

async function closeCollectionDay({ collectorUserId, date, closedBy }) {
  const id = String(collectorUserId ?? '').trim();
  const d = normalizeYmd(date);
  if (!id) return { error: 'collectorUserId is required' };
  if (!d) return { error: 'date must be YYYY-MM-DD' };
  const closes = await readCollectionDayCloses();
  const existing = findCollectionDayClose(closes, id, d);
  if (existing) return { close: existing, alreadyClosed: true };
  const row = {
    collectorUserId: id,
    date: d,
    closedAt: new Date().toISOString(),
    closedBy: String(closedBy ?? '').trim(),
  };
  closes.push(row);
  await writeCollectionDayCloses(closes);
  return { close: row, alreadyClosed: false };
}

module.exports = {
  COLLECTION_DAY_CLOSES_FILE,
  normalizeYmd,
  readCollectionDayCloses,
  getCollectionDayClose,
  isCollectionClosedForCollector,
  closeCollectionDay,
};
