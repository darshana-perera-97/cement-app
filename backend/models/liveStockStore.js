const fs = require('fs').promises;
const path = require('path');
const { readStocks, sumLoadBagsByBrand } = require('./stocksStore');
const { readBills, sumAllBillBagsByBrand } = require('./billsStore');
const { readPromotions, sumAllPromotionBagsByBrand } = require('./promotionsStore');
const { buildDailyStockPayload } = require('./dailyStockStore');
const { readDistributors } = require('./distributorsStore');

const LIVE_FILE = path.join(__dirname, '..', 'data', 'liveStock.json');

const BRAND_KEYS = ['tokyo', 'samudra', 'atlas', 'nippon'];
const BRAND_LABELS = { tokyo: 'Tokyo', samudra: 'Samudra', atlas: 'Atlas', nippon: 'Nippon' };

/** Map distributor product name (e.g. "Tokyo 50KG") → brand key. */
function productToBrandKey(product) {
  const p = String(product || '').toLowerCase();
  if (!p) return null;
  for (const key of BRAND_KEYS) {
    if (p.includes(key) || p.includes(BRAND_LABELS[key].toLowerCase())) return key;
  }
  return null;
}

/** Brand keys referenced in at least one distributor's products list. */
async function getBrandKeysFromDistributorProducts() {
  const distributors = await readDistributors();
  const keys = new Set();
  for (const d of distributors) {
    const products = Array.isArray(d.products) ? d.products : [];
    for (const product of products) {
      const key = productToBrandKey(product);
      if (key) keys.add(key);
    }
  }
  return BRAND_KEYS.filter((k) => keys.has(k));
}

async function readLiveStock() {
  try {
    const raw = await fs.readFile(LIVE_FILE, 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function writeLiveStock(data) {
  await fs.mkdir(path.dirname(LIVE_FILE), { recursive: true });
  await fs.writeFile(LIVE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Rebuild bags + daily ledger from loads, bills, and promotions, then persist to liveStock.json.
 * Call after any change to loads, credit bills, or promotional free bags.
 */
async function refreshLiveStockFromSources() {
  const loads = await readStocks();
  const bills = await readBills();
  const promotions = await readPromotions();
  const loaded = sumLoadBagsByBrand(loads);
  const sold = sumAllBillBagsByBrand(bills);
  const promoOut = sumAllPromotionBagsByBrand(promotions);
  const bags = {};
  for (const k of BRAND_KEYS) {
    bags[k] = Math.max(0, loaded[k] - sold[k] - promoOut[k]);
  }
  const ledgerPayload = buildDailyStockPayload(loads, bills, promotions);
  const doc = {
    updatedAt: new Date().toISOString(),
    bags,
    dailyLedger: {
      generatedAt: ledgerPayload.generatedAt,
      days: ledgerPayload.days,
    },
  };
  await writeLiveStock(doc);
  return doc;
}

/** Dashboard / Stock page cards — served from file (refreshed on load & bill saves). */
async function getLiveStockSummary(options = {}) {
  let live = await readLiveStock();
  if (!live?.bags) {
    await refreshLiveStockFromSources();
    live = await readLiveStock();
  }
  const brandKeys =
    options.distributorProductsOnly === true
      ? await getBrandKeysFromDistributorProducts()
      : BRAND_KEYS;
  const brands = brandKeys.map((key) => ({
    key,
    label: BRAND_LABELS[key],
    bags: Math.max(0, Math.floor(Number(live.bags[key]) || 0)),
  }));
  return { liveAt: live.updatedAt || new Date().toISOString(), brands };
}

/** Daily bag ledger table — same numbers as in file (refreshed with live stock). */
async function getLiveDailyLedgerPayload() {
  let live = await readLiveStock();
  if (!live?.dailyLedger?.days) {
    await refreshLiveStockFromSources();
    live = await readLiveStock();
  }
  return {
    generatedAt: live.dailyLedger.generatedAt || live.updatedAt,
    days: Array.isArray(live.dailyLedger.days) ? live.dailyLedger.days : [],
  };
}

module.exports = {
  readLiveStock,
  writeLiveStock,
  refreshLiveStockFromSources,
  getLiveStockSummary,
  getLiveDailyLedgerPayload,
  productToBrandKey,
  getBrandKeysFromDistributorProducts,
  LIVE_FILE,
};
