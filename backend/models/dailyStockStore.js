const { toNonNegNumber } = require('./stocksStore');
const { aggregateOutsByDateFromBills } = require('./billsStore');
const { aggregatePromotionOutsByDate } = require('./promotionsStore');

const BRAND_KEYS = ['tokyo', 'samudra', 'atlas', 'nippon'];
const BAG_FIELDS = {
  tokyo: 'tokyoBags',
  samudra: 'samudraBags',
  atlas: 'atlasBags',
  nippon: 'nipponBags',
};

function addDaysYmd(ymd, deltaDays) {
  const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(y, m - 1, d + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function todayYmdLocal() {
  const dt = new Date();
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function maxYmd(a, b) {
  return a >= b ? a : b;
}

function emptyBrandMap() {
  return { tokyo: 0, samudra: 0, atlas: 0, nippon: 0 };
}

function aggregateLoadsByDate(loads) {
  const map = {};
  for (const row of loads) {
    const d = String(row.date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (!map[d]) map[d] = emptyBrandMap();
    for (const k of BRAND_KEYS) {
      map[d][k] += toNonNegNumber(row[BAG_FIELDS[k]]);
    }
  }
  return map;
}

function eachDateInclusive(fromYmd, toYmd) {
  const out = [];
  let cur = fromYmd;
  for (;;) {
    if (cur > toYmd) break;
    out.push(cur);
    cur = addDaysYmd(cur, 1);
  }
  return out;
}

function mergeOutByDate(billOut, promoOut) {
  const dates = new Set([...Object.keys(billOut), ...Object.keys(promoOut)]);
  const merged = {};
  for (const d of dates) {
    merged[d] = emptyBrandMap();
    for (const k of BRAND_KEYS) {
      merged[d][k] = (billOut[d]?.[k] || 0) + (promoOut[d]?.[k] || 0);
    }
  }
  return merged;
}

/**
 * Build daily ledger: start-of-day, bags in (loads), out (credit bills + promotional free bags that day), end-of-day.
 */
function buildDailyStockPayload(loads, bills, promotions = []) {
  const inByDate = aggregateLoadsByDate(loads);
  const billOut = aggregateOutsByDateFromBills(Array.isArray(bills) ? bills : []);
  const promoOut = aggregatePromotionOutsByDate(Array.isArray(promotions) ? promotions : []);
  const outByDate = mergeOutByDate(billOut, promoOut);
  const allKeys = new Set([...Object.keys(inByDate), ...Object.keys(outByDate)]);
  if (allKeys.size === 0) {
    return { generatedAt: new Date().toISOString(), days: [] };
  }

  const sortedDates = [...allKeys].sort();
  const minDate = sortedDates[0];
  const maxActivityDate = sortedDates[sortedDates.length - 1];
  const endDate = maxYmd(maxActivityDate, todayYmdLocal());

  const days = [];
  let prevEnd = emptyBrandMap();

  for (const date of eachDateInclusive(minDate, endDate)) {
    const inn = inByDate[date] || emptyBrandMap();
    const outv = outByDate[date] || emptyBrandMap();

    const brands = {};
    for (const k of BRAND_KEYS) {
      const start = prevEnd[k];
      const inBags = inn[k];
      const outBags = outv[k];
      const end = start + inBags - outBags;
      brands[k] = { start: start, in: inBags, out: outBags, end: end };
      prevEnd[k] = end;
    }
    days.push({ date, brands });
  }

  return { generatedAt: new Date().toISOString(), days };
}

module.exports = {
  buildDailyStockPayload,
};
