const fs = require('fs').promises;
const path = require('path');
const { toNonNegNumber } = require('./stocksStore');

const UNLOADS_FILE = path.join(__dirname, '..', 'data', 'unloads.json');

const BRAND_KEYS = ['tokyo', 'samudra', 'atlas', 'nippon'];
const BAG_FIELDS = {
  tokyo: 'tokyoBags',
  samudra: 'samudraBags',
  atlas: 'atlasBags',
  nippon: 'nipponBags',
};

function normalizeStatus(status) {
  const s = String(status ?? 'pending').trim().toLowerCase();
  if (s === 'approved' || s === 'rejected') return s;
  return 'pending';
}

function emptyBrandMap() {
  return { tokyo: 0, samudra: 0, atlas: 0, nippon: 0 };
}

/** Pending driver requests reserve stock until approved or rejected. */
function sumPendingUnloadBagsByBrand(unloads) {
  const t = emptyBrandMap();
  for (const row of unloads) {
    if (normalizeStatus(row.status) !== 'pending') continue;
    for (const k of BRAND_KEYS) {
      t[k] += toNonNegNumber(row[BAG_FIELDS[k]]);
    }
  }
  return t;
}

async function readUnloads() {
  try {
    const raw = await fs.readFile(UNLOADS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writeUnloads(records) {
  await fs.mkdir(path.dirname(UNLOADS_FILE), { recursive: true });
  await fs.writeFile(UNLOADS_FILE, JSON.stringify(records, null, 2), 'utf8');
}

module.exports = {
  readUnloads,
  writeUnloads,
  sumPendingUnloadBagsByBrand,
  normalizeStatus,
  UNLOADS_FILE,
};
