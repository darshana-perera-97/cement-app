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

function emptyShopRow(rowKey, shop, monthlyTargetBags = 0) {
  return {
    rowKey,
    shop,
    byBrand: emptyBrandBagMap(),
    total: 0,
    freeBags: 0,
    monthlyTargetBags,
    progressPct: null,
  };
}

function isFreeBagPromotion(row) {
  const type = String(row?.type ?? '').trim();
  return type !== 'invoice_discount' && type !== 'target_promotion' && type !== 'rule_cashback';
}

function freeBagsOnPromotion(row, brands) {
  if (!isFreeBagPromotion(row)) return 0;
  return brands.reduce((sum, brand) => {
    const field = brand.bagsField || `${brand.key}Bags`;
    return sum + (Number(row?.[field]) || 0);
  }, 0);
}

/**
 * One row per shop: brand bag totals for the month, free bags issued that month,
 * monthly target, and completion %.
 */
export function buildShopTargetsRows(bills, customers, monthValue, promotions = []) {
  const brands = getCachedBrands();
  const { from, to } = monthRangeFromValue(monthValue);
  const map = new Map();
  const byCustomerId = new Map();

  for (const c of Array.isArray(customers) ? customers : []) {
    const shop = String(c.name ?? '').trim();
    if (!shop) continue;
    const nk = normalizeCustomerName(shop);
    const row = emptyShopRow(
      c.id || nk,
      shop,
      Math.max(0, Math.floor(Number(c.monthlyTargetBags) || 0)),
    );
    map.set(nk, row);
    const id = String(c.id ?? '').trim();
    if (id) byCustomerId.set(id, row);
  }

  for (const bill of Array.isArray(bills) ? bills : []) {
    if (!inDateRange(bill.date, from, to)) continue;
    const shop = String(bill.customerName ?? '').trim() || '—';
    const nk = normalizeCustomerName(shop);
    if (!map.has(nk)) {
      map.set(nk, emptyShopRow(nk, shop));
    }
    const row = map.get(nk);
    for (const brand of brands) {
      const bags = Number(bill[brand.bagsField]) || 0;
      if (bags <= 0) continue;
      row.byBrand[brand.key] += bags;
      row.total += bags;
    }
  }

  for (const promo of Array.isArray(promotions) ? promotions : []) {
    if (!inDateRange(promo.date, from, to)) continue;
    const bags = freeBagsOnPromotion(promo, brands);
    if (bags <= 0) continue;
    const id = String(promo.customerId ?? '').trim();
    let row = id ? byCustomerId.get(id) : null;
    if (!row) {
      const shop = String(promo.customerName ?? '').trim() || '—';
      row = map.get(normalizeCustomerName(shop));
    }
    if (!row) continue;
    row.freeBags += bags;
  }

  for (const row of map.values()) {
    row.total = Math.round(row.total);
    row.freeBags = Math.round(row.freeBags);
    for (const b of brands) row.byBrand[b.key] = Math.round(row.byBrand[b.key]);
    if (row.monthlyTargetBags > 0) {
      row.progressPct = Math.round((row.total / row.monthlyTargetBags) * 1000) / 10;
    }
  }

  const rows = [...map.values()]
    .filter((r) => r.monthlyTargetBags > 0 || r.total > 0 || r.freeBags > 0)
    .sort((a, b) => a.shop.localeCompare(b.shop, undefined, { sensitivity: 'base' }));

  const totals = {
    byBrand: emptyBrandBagMap(),
    total: 0,
    freeBags: 0,
    monthlyTargetBags: 0,
  };
  for (const r of rows) {
    for (const b of brands) totals.byBrand[b.key] += r.byBrand[b.key];
    totals.total += r.total;
    totals.freeBags += r.freeBags;
    totals.monthlyTargetBags += r.monthlyTargetBags;
  }

  const overallProgressPct =
    totals.monthlyTargetBags > 0
      ? Math.round((totals.total / totals.monthlyTargetBags) * 1000) / 10
      : null;

  return { rows, totals, overallProgressPct, from, to };
}
