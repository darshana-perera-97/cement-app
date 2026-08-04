const { toNonNegNumber } = require('./stocksStore');

const BRAND_KEYS = ['tokyo', 'samudra', 'atlas', 'nippon'];

function compareByDateThenCreated(a, b) {
  const da = String(a.date ?? '').trim();
  const db = String(b.date ?? '').trim();
  if (da !== db) return da.localeCompare(db);
  return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
}

function buildFifoPools(loads) {
  const pools = Object.fromEntries(BRAND_KEYS.map((k) => [k, []]));
  for (const load of [...loads].sort(compareByDateThenCreated)) {
    const stockId = String(load.stockId ?? '').trim();
    if (!stockId) continue;
    for (const k of BRAND_KEYS) {
      const bagCount = toNonNegNumber(load[`${k}Bags`]);
      if (bagCount > 0) pools[k].push({ stockId, remaining: bagCount });
    }
  }
  return pools;
}

function takeFromPool(pool, need, stockIdFilter = null) {
  const chunks = [];
  let left = toNonNegNumber(need);
  if (left <= 0) return chunks;

  for (const slot of pool) {
    if (left <= 0) break;
    if (stockIdFilter && slot.stockId !== stockIdFilter) continue;
    if (slot.remaining <= 0) continue;
    const take = Math.min(left, slot.remaining);
    slot.remaining -= take;
    left -= take;
    chunks.push({ stockId: slot.stockId, bags: take });
  }
  return chunks;
}

/** Deplete FIFO pools for bags already on existing credit bills. */
function consumeExistingBillsFromPools(pools, bills) {
  for (const bill of [...bills].sort(compareByDateThenCreated)) {
    const explicitStockId = String(bill.stockId ?? '').trim();
    for (const k of BRAND_KEYS) {
      const need = toNonNegNumber(bill[`${k}Bags`]);
      if (need <= 0) continue;
      const pool = pools[k];
      let chunks = explicitStockId ? takeFromPool(pool, need, explicitStockId) : takeFromPool(pool, need);
      if (explicitStockId) {
        const taken = chunks.reduce((s, c) => s + c.bags, 0);
        if (taken < need) {
          chunks = chunks.concat(takeFromPool(pool, need - taken));
        }
      }
    }
  }
}

/**
 * Infer load Stock ID for a new bill using FIFO (same rules as shop distribution reports).
 * Returns the stock id that supplies the most bags for this sale, or '' if none match.
 */
function inferStockIdForBillBags(loads, existingBills, bagFields) {
  const pools = buildFifoPools(loads);
  consumeExistingBillsFromPools(pools, existingBills);

  const counts = {};
  for (const k of BRAND_KEYS) {
    const need = toNonNegNumber(bagFields[`${k}Bags`]);
    if (need <= 0) continue;
    const chunks = takeFromPool(pools[k], need);
    for (const c of chunks) {
      counts[c.stockId] = (counts[c.stockId] || 0) + c.bags;
    }
  }

  let bestId = '';
  let bestBags = 0;
  for (const [stockId, bags] of Object.entries(counts)) {
    if (bags > bestBags) {
      bestBags = bags;
      bestId = stockId;
    }
  }
  return bestId;
}

module.exports = {
  inferStockIdForBillBags,
};
