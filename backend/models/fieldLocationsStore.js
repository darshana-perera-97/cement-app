const fs = require('fs').promises;
const path = require('path');

const FIELD_LOCATIONS_FILE = path.join(__dirname, '..', 'data', 'fieldLocations.json');

const SRI_LANKA = {
  west: 79.42,
  south: 5.72,
  east: 81.95,
  north: 9.98,
};

/** Drop pins that have not checked in recently. */
const MAX_AGE_MS = 45 * 60 * 1000;

function isInSriLanka(lat, lng) {
  const y = Number(lat);
  const x = Number(lng);
  if (!Number.isFinite(y) || !Number.isFinite(x)) return false;
  return y >= SRI_LANKA.south && y <= SRI_LANKA.north && x >= SRI_LANKA.west && x <= SRI_LANKA.east;
}

function roundCoord(n) {
  return Math.round(Number(n) * 1e6) / 1e6;
}

async function readFieldLocations() {
  try {
    const raw = await fs.readFile(FIELD_LOCATIONS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writeFieldLocations(records) {
  await fs.mkdir(path.dirname(FIELD_LOCATIONS_FILE), { recursive: true });
  await fs.writeFile(FIELD_LOCATIONS_FILE, JSON.stringify(records, null, 2), 'utf8');
}

function toPublicLocation(row) {
  return {
    id: String(row.userId || ''),
    name: String(row.name || '').trim(),
    role: row.role === 'Driver' ? 'Driver' : 'Collector',
    lat: roundCoord(row.lat),
    lng: roundCoord(row.lng),
    accuracy: Number.isFinite(Number(row.accuracy)) ? Math.max(0, Math.round(Number(row.accuracy))) : 0,
    lorryNumber: String(row.lorryNumber || '').trim(),
    updatedAt: String(row.updatedAt || ''),
  };
}

function isFresh(row, now = Date.now()) {
  const t = new Date(row?.updatedAt || '').getTime();
  if (!Number.isFinite(t)) return false;
  return now - t <= MAX_AGE_MS;
}

async function upsertFieldLocation(entry) {
  const userId = String(entry.userId || '').trim();
  if (!userId) throw new Error('userId is required');
  const rows = await readFieldLocations();
  const next = {
    userId,
    name: String(entry.name || '').trim(),
    role: entry.role === 'Driver' ? 'Driver' : 'Collector',
    lat: roundCoord(entry.lat),
    lng: roundCoord(entry.lng),
    accuracy: Number.isFinite(Number(entry.accuracy)) ? Math.max(0, Math.round(Number(entry.accuracy))) : 0,
    lorryNumber: String(entry.lorryNumber || '').trim(),
    updatedAt: String(entry.updatedAt || new Date().toISOString()),
  };
  const idx = rows.findIndex((row) => String(row.userId) === userId);
  if (idx >= 0) rows[idx] = next;
  else rows.push(next);
  await writeFieldLocations(rows);
  return next;
}

async function listFreshFieldLocations() {
  const now = Date.now();
  const rows = await readFieldLocations();
  return rows
    .filter((row) => isFresh(row, now) && isInSriLanka(row.lat, row.lng))
    .map(toPublicLocation)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
}

module.exports = {
  isInSriLanka,
  upsertFieldLocation,
  listFreshFieldLocations,
};
