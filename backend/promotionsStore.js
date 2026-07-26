const fs = require('fs').promises;
const path = require('path');
const { toNonNegNumber } = require('./stocksStore');

const PROMOTIONS_FILE = path.join(__dirname, 'data', 'promotions.json');

const BRAND_KEYS = ['tokyo', 'samudra', 'atlas', 'nippon'];
const BAG_FIELDS = {
  tokyo: 'tokyoBags',
  samudra: 'samudraBags',
  atlas: 'atlasBags',
  nippon: 'nipponBags',
};

function emptyBrandMap() {
  return { tokyo: 0, samudra: 0, atlas: 0, nippon: 0 };
}

/** Free bags per promotion issue date (same shape as bill outs for the daily ledger). */
function aggregatePromotionOutsByDate(promotions) {
  const map = {};
  for (const row of promotions) {
    const d = String(row.date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (!map[d]) map[d] = emptyBrandMap();
    for (const k of BRAND_KEYS) {
      map[d][k] += toNonNegNumber(row[BAG_FIELDS[k]]);
    }
  }
  return map;
}

function sumAllPromotionBagsByBrand(promotions) {
  const t = emptyBrandMap();
  for (const row of promotions) {
    for (const k of BRAND_KEYS) {
      t[k] += toNonNegNumber(row[BAG_FIELDS[k]]);
    }
  }
  return t;
}

async function readPromotions() {
  try {
    const raw = await fs.readFile(PROMOTIONS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writePromotions(records) {
  await fs.mkdir(path.dirname(PROMOTIONS_FILE), { recursive: true });
  await fs.writeFile(PROMOTIONS_FILE, JSON.stringify(records, null, 2), 'utf8');
}

module.exports = {
  readPromotions,
  writePromotions,
  aggregatePromotionOutsByDate,
  sumAllPromotionBagsByBrand,
  PROMOTIONS_FILE,
};
