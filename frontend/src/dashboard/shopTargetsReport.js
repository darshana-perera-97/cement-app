import { getCachedBrands } from './brandTheme';
import { inDateRange } from './tableToolbar';

function normalizeCustomerName(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function monthRangeFromValue(monthValue) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthValue ?? '').trim());
  if (!match) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    return {
      from: `${y}-${m}-01`,
      to: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
    };
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const mm = match[2];
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  return {
    from: `${match[1]}-${mm}-01`,
    to: `${match[1]}-${mm}-${String(daysInMonth).padStart(2, '0')}`,
  };
}

function emptyBrandBagMap() {
  return Object.fromEntries(getCachedBrands().map((b) => [b.key, 0]));
}

/**
 * One row per shop: brand bag totals for the month, monthly target, and completion %.
 */
export function buildShopTargetsRows(bills, customers, monthValue) {
  const brands = getCachedBrands();
  const { from, to } = monthRangeFromValue(monthValue);
  const map = new Map();

  for (const c of Array.isArray(customers) ? customers : []) {
    const shop = String(c.name ?? '').trim();
    if (!shop) continue;
    const nk = normalizeCustomerName(shop);
    map.set(nk, {
      rowKey: c.id || nk,
      shop,
      byBrand: emptyBrandBagMap(),
      total: 0,
      monthlyTargetBags: Math.max(0, Math.floor(Number(c.monthlyTargetBags) || 0)),
      progressPct: null,
    });
  }

  for (const bill of Array.isArray(bills) ? bills : []) {
    if (!inDateRange(bill.date, from, to)) continue;
    const shop = String(bill.customerName ?? '').trim() || '—';
    const nk = normalizeCustomerName(shop);
    if (!map.has(nk)) {
      map.set(nk, {
        rowKey: nk,
        shop,
        byBrand: emptyBrandBagMap(),
        total: 0,
        monthlyTargetBags: 0,
        progressPct: null,
      });
    }
    const row = map.get(nk);
    for (const brand of brands) {
      const bags = Number(bill[brand.bagsField]) || 0;
      if (bags <= 0) continue;
      row.byBrand[brand.key] += bags;
      row.total += bags;
    }
  }

  for (const row of map.values()) {
    row.total = Math.round(row.total);
    for (const b of brands) row.byBrand[b.key] = Math.round(row.byBrand[b.key]);
    if (row.monthlyTargetBags > 0) {
      row.progressPct = Math.round((row.total / row.monthlyTargetBags) * 1000) / 10;
    }
  }

  const rows = [...map.values()]
    .filter((r) => r.monthlyTargetBags > 0 || r.total > 0)
    .sort((a, b) => a.shop.localeCompare(b.shop, undefined, { sensitivity: 'base' }));

  const totals = {
    byBrand: emptyBrandBagMap(),
    total: 0,
    monthlyTargetBags: 0,
  };
  for (const r of rows) {
    for (const b of brands) totals.byBrand[b.key] += r.byBrand[b.key];
    totals.total += r.total;
    totals.monthlyTargetBags += r.monthlyTargetBags;
  }

  const overallProgressPct =
    totals.monthlyTargetBags > 0
      ? Math.round((totals.total / totals.monthlyTargetBags) * 1000) / 10
      : null;

  return { rows, totals, overallProgressPct, from, to };
}
