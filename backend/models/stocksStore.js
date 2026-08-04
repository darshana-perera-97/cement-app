const fs = require('fs').promises;
const path = require('path');

/** Loads (dispatch records) for the Loads page and stock ledger. */
const LOADS_FILE = path.join(__dirname, '..', 'data', 'loads.json');
/** Earlier filename; still read once to migrate if `loads.json` is absent. */
const LEGACY_STOCKS_FILE = path.join(__dirname, '..', 'data', 'stocks.json');

async function readStocks() {
  try {
    const raw = await fs.readFile(LOADS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  try {
    const raw = await fs.readFile(LEGACY_STOCKS_FILE, 'utf8');
    const data = JSON.parse(raw);
    const arr = Array.isArray(data) ? data : [];
    await fs.mkdir(path.dirname(LOADS_FILE), { recursive: true });
    await fs.writeFile(LOADS_FILE, JSON.stringify(arr, null, 2), 'utf8');
    return arr;
  } catch (e2) {
    if (e2.code === 'ENOENT') return [];
    throw e2;
  }
}

async function writeStocks(records) {
  await fs.mkdir(path.dirname(LOADS_FILE), { recursive: true });
  await fs.writeFile(LOADS_FILE, JSON.stringify(records, null, 2), 'utf8');
}

function toNonNegNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

const BAG_BRANDS = ['tokyo', 'samudra', 'atlas', 'nippon'];

/** Sum arrival quantities on all load rows (original bags; not reduced when bills are saved). */
function sumLoadBagsByBrand(loads) {
  const t = { tokyo: 0, samudra: 0, atlas: 0, nippon: 0 };
  for (const row of loads) {
    for (const k of BAG_BRANDS) {
      t[k] += toNonNegNumber(row[`${k}Bags`]);
    }
  }
  return t;
}

/**
 * Latest non-zero cut-off price per brand from loads (newest date, then createdAt).
 * @returns {{ tokyo?: number, samudra?: number, atlas?: number, nippon?: number }}
 */
function lastCutOffPricesByBrand(loads) {
  const sorted = [...(Array.isArray(loads) ? loads : [])].sort((a, b) => {
    const da = String(a.date || '');
    const db = String(b.date || '');
    if (da !== db) return db.localeCompare(da);
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });
  const out = {};
  for (const key of BAG_BRANDS) {
    for (const row of sorted) {
      const n = Number(row[`${key}CutOffPrice`]);
      if (Number.isFinite(n) && n > 0) {
        out[key] = n;
        break;
      }
    }
  }
  return out;
}

function normalizePurchaseOrderIds(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const id of raw) {
    const sid = String(id ?? '').trim();
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    out.push(sid);
  }
  return out;
}

module.exports = {
  readStocks,
  writeStocks,
  toNonNegNumber,
  sumLoadBagsByBrand,
  lastCutOffPricesByBrand,
  normalizePurchaseOrderIds,
  BAG_BRANDS,
  LOADS_FILE,
};
