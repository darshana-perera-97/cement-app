const fs = require('fs').promises;
const path = require('path');
const { readStocks, sumLoadBagsByBrand } = require('./stocksStore');
const { readBills, sumAllBillBagsByBrand } = require('./billsStore');
const { readPromotions, sumAllPromotionBagsByBrand } = require('./promotionsStore');
const { buildDailyStockPayload } = require('./dailyStockStore');
const { getBagProducts, getBagProductKeys } = require('./bagProducts');

const LIVE_FILE = path.join(__dirname, '..', 'data', 'liveStock.json');

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
  const keys = await getBagProductKeys();
  const loads = await readStocks();
  const bills = await readBills();
  const promotions = await readPromotions();
  const loaded = sumLoadBagsByBrand(loads, keys);
  const sold = sumAllBillBagsByBrand(bills, keys);
  const promoOut = sumAllPromotionBagsByBrand(promotions, keys);
  const bags = {};
  for (const k of keys) {
    bags[k] = Math.max(0, loaded[k] - sold[k] - promoOut[k]);
  }
  const ledgerPayload = buildDailyStockPayload(loads, bills, promotions, keys);
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
  const products = await getBagProducts();
  const brands = products.map((p) => ({
    key: p.key,
    label: p.label,
    bags: Math.max(0, Math.floor(Number(live.bags[p.key]) || 0)),
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
  LIVE_FILE,
};
