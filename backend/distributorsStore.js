const fs = require('fs').promises;
const path = require('path');

const DISTRIBUTORS_FILE = path.join(__dirname, 'data', 'distributors.json');

async function readDistributors() {
  try {
    const raw = await fs.readFile(DISTRIBUTORS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writeDistributors(records) {
  await fs.mkdir(path.dirname(DISTRIBUTORS_FILE), { recursive: true });
  await fs.writeFile(DISTRIBUTORS_FILE, JSON.stringify(records, null, 2), 'utf8');
}

/** Trim, drop empties, de-dupe case-insensitively; preserve first-seen casing. */
function normalizeStringList(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const name = String(item ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

const normalizeProducts = normalizeStringList;

/** Prefer `locations` array; fall back to legacy single `location` string. */
function normalizeLocations(rowOrList, legacyLocation) {
  if (rowOrList && typeof rowOrList === 'object' && !Array.isArray(rowOrList)) {
    const fromArray = normalizeStringList(rowOrList.locations);
    if (fromArray.length > 0) return fromArray;
    const single = String(rowOrList.location ?? '').trim();
    return single ? [single] : [];
  }
  const fromArray = normalizeStringList(rowOrList);
  if (fromArray.length > 0) return fromArray;
  const single = String(legacyLocation ?? '').trim();
  return single ? [single] : [];
}

function withNormalizedLists(row) {
  const locations = normalizeLocations(row);
  const products = normalizeProducts(row.products);
  return {
    ...row,
    locations,
    location: locations[0] || '',
    products,
  };
}

module.exports = {
  readDistributors,
  writeDistributors,
  normalizeStringList,
  normalizeProducts,
  normalizeLocations,
  withNormalizedLists,
  DISTRIBUTORS_FILE,
};
