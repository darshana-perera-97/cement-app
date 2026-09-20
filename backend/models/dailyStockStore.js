const { toNonNegNumber } = require('./stocksStore');
const { aggregateOutsByDateFromBills } = require('./billsStore');
const { aggregatePromotionOutsByDate } = require('./promotionsStore');
const { bagsField, emptyBrandMap } = require('./bagProducts');

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

function aggregateLoadsByDate(loads, keys) {
  const map = {};
  for (const row of loads) {
    const d = String(row.date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (!map[d]) map[d] = emptyBrandMap(keys);
    for (const k of keys) {
      map[d][k] += toNonNegNumber(row[bagsField(k)]);
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

function mergeBrandDateMaps(maps, keys) {
  const dates = new Set();
  for (const map of maps) {
    for (const d of Object.keys(map || {})) dates.add(d);
  }
  const merged = {};
  for (const d of dates) {
    merged[d] = emptyBrandMap(keys);
    for (const k of keys) {
      let sum = 0;
      for (const map of maps) sum += map[d]?.[k] || 0;
      merged[d][k] = sum;
    }
  }
  return merged;
}

function mergeOutByDate(billOut, promoOut, keys) {
  return mergeBrandDateMaps([billOut, promoOut], keys);
}

/**
 * Build daily ledger: start-of-day, bags in (loads + item returns), out (bills + free bags + damage), end-of-day.
 */
function buildDailyStockPayload(loads, bills, promotions = [], keys = [], extras = {}) {
  const brandKeys = Array.isArray(keys) && keys.length > 0 ? keys : [];
  const loadIn = aggregateLoadsByDate(loads, brandKeys);
  const extraIn = extras.inByDate && typeof extras.inByDate === 'object' ? extras.inByDate : {};
  const extraOut = extras.outByDate && typeof extras.outByDate === 'object' ? extras.outByDate : {};
  const inByDate = mergeBrandDateMaps([loadIn, extraIn], brandKeys);
  const billOut = aggregateOutsByDateFromBills(Array.isArray(bills) ? bills : [], brandKeys);
  const promoOut = aggregatePromotionOutsByDate(Array.isArray(promotions) ? promotions : [], brandKeys);
  const outByDate = mergeBrandDateMaps([billOut, promoOut, extraOut], brandKeys);
  const allKeys = new Set([...Object.keys(inByDate), ...Object.keys(outByDate)]);
  if (allKeys.size === 0 || brandKeys.length === 0) {
    return { generatedAt: new Date().toISOString(), days: [] };
  }

  const sortedDates = [...allKeys].sort();
  const minDate = sortedDates[0];
  const maxActivityDate = sortedDates[sortedDates.length - 1];
  const endDate = maxYmd(maxActivityDate, todayYmdLocal());

  const days = [];
  let prevEnd = emptyBrandMap(brandKeys);

  for (const date of eachDateInclusive(minDate, endDate)) {
    const inn = inByDate[date] || emptyBrandMap(brandKeys);
    const outv = outByDate[date] || emptyBrandMap(brandKeys);

    const brands = {};
    for (const k of brandKeys) {
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
