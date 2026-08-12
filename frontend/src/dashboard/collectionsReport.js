import { getCachedBrands } from './brandTheme';
import { buildBillSettledDateLookup, isBillFullySettled } from './pendingBills';
import { inDateRange } from './tableToolbar';

export { buildBillSettledDateLookup };

export const COLLECTION_DAY_BUCKETS = [
  { key: '0-14', label: '0–14 days', min: 0, max: 14 },
  { key: '15-21', label: '15–21 days', min: 15, max: 21 },
  { key: '22-30', label: '22–30 days', min: 22, max: 30 },
  { key: '30-35', label: '30–35 days', min: 30, max: 35 },
  { key: 'more than 35', label: 'More than 35 days', min: 36, max: Infinity },
];

export const DEFAULT_COLLECTOR_COMMISSION_RATES = Object.fromEntries(
  COLLECTION_DAY_BUCKETS.map((b) => [b.key, 0]),
);

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function normalizeCustomerName(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function daysBetweenYmd(fromYmd, toYmd) {
  if (!fromYmd || !toYmd || fromYmd.length < 10 || toYmd.length < 10) return 0;
  const t0 = new Date(
    parseInt(fromYmd.slice(0, 4), 10),
    parseInt(fromYmd.slice(5, 7), 10) - 1,
    parseInt(fromYmd.slice(8, 10), 10),
  ).getTime();
  const t1 = new Date(
    parseInt(toYmd.slice(0, 4), 10),
    parseInt(toYmd.slice(5, 7), 10) - 1,
    parseInt(toYmd.slice(8, 10), 10),
  ).getTime();
  return Math.max(0, Math.round((t1 - t0) / (24 * 60 * 60 * 1000)));
}

function brandLineFromBill(bill, brandKey) {
  if (!brandKey) return round2(bill.totalAmount);
  const line = Number(bill[`${brandKey}Line`]);
  if (line > 0) return round2(line);
  const bags = Number(bill[`${brandKey}Bags`]) || 0;
  const price = Number(bill[`${brandKey}UnitPrice`]) || 0;
  return round2(bags * price);
}

/** Buckets used for summary totals (day 30 appears in both 22–30 and 30–35). */
export function summaryBucketsForDays(days) {
  const d = Number(days);
  if (!Number.isFinite(d) || d < 0) return [];
  const out = [];
  if (d >= 0 && d <= 14) out.push('0-14');
  if (d >= 15 && d <= 21) out.push('15-21');
  if (d >= 22 && d <= 30) out.push('22-30');
  if (d >= 30 && d <= 35) out.push('30-35');
  if (d > 35) out.push('more than 35');
  return out;
}

/** Single bucket for commission calculation (exclusive ranges). */
export function commissionBucketForDays(days) {
  const d = Number(days);
  if (!Number.isFinite(d) || d < 0) return null;
  if (d > 35) return 'more than 35';
  if (d >= 30) return '30-35';
  if (d >= 22) return '22-30';
  if (d >= 15) return '15-21';
  return '0-14';
}

export function normalizeCollectorCommissionRates(raw) {
  const out = { ...DEFAULT_COLLECTOR_COMMISSION_RATES };
  if (!raw || typeof raw !== 'object') return out;
  const src = { ...raw };
  if (src['1-14'] != null && src['0-14'] == null) {
    src['0-14'] = src['1-14'];
  }
  for (const bucket of COLLECTION_DAY_BUCKETS) {
    const v = Number(src[bucket.key]);
    if (Number.isFinite(v) && v >= 0) out[bucket.key] = round2(v);
  }
  return out;
}

/**
 * Settled invoice lines for collections / commission reports.
 * Only fully settled bills (zero outstanding) are included.
 */
export function buildSettledCollectionsRows(
  customers,
  bills,
  settledByBillId,
  payments,
  { from, to, collectorUserId = '' } = {},
) {
  const customerByNk = new Map();
  for (const c of customers || []) {
    const nk = normalizeCustomerName(c.name);
    if (nk) customerByNk.set(nk, c);
  }
  const collectorFilter = String(collectorUserId ?? '').trim();
  const rows = [];
  const brands = getCachedBrands();

  for (const bill of bills || []) {
    const billId = String(bill.id ?? '').trim();
    const settledDate = billId ? settledByBillId.get(billId) || '' : '';
    if (!settledDate || !/^\d{4}-\d{2}-\d{2}$/.test(settledDate)) continue;
    if (!isBillFullySettled(bill, customers, bills, payments)) continue;
    if (from && to && !inDateRange(settledDate, from, to)) continue;

    const shopName = String(bill.customerName ?? '').trim() || '—';
    const nk = normalizeCustomerName(bill.customerName);
    const cust = customerByNk.get(nk);
    if (collectorFilter && String(cust?.collectorUserId ?? '') !== collectorFilter) continue;

    const billDate = String(bill.date ?? '').slice(0, 10);
    const invoiceNumber = String(bill.invoiceNumber ?? '').trim() || '—';
    const billAmount = round2(bill.totalAmount);
    const daysToSettle = daysBetweenYmd(billDate, settledDate);
    const collectorName = String(cust?.collectorName ?? '').trim() || '—';
    const commissionBucket = commissionBucketForDays(daysToSettle);

    let anyBrand = false;
    for (const brand of brands) {
      const bagCount = Number(bill[brand.bagsField]) || 0;
      if (bagCount <= 0) continue;
      anyBrand = true;
      rows.push({
        rowKey: `${billId}-${brand.key}`,
        billId,
        date: settledDate,
        invoiceNumber,
        shopName,
        bagType: brand.label,
        brandKey: brand.key,
        bagCount,
        amount: brandLineFromBill(bill, brand.key),
        billDate,
        settledDate,
        daysToSettle,
        billAmount,
        collectorUserId: String(cust?.collectorUserId ?? ''),
        collectorName,
        commissionBucket,
      });
    }

    if (!anyBrand) {
      rows.push({
        rowKey: `${billId}-total`,
        billId,
        date: settledDate,
        invoiceNumber,
        shopName,
        bagType: '—',
        brandKey: '',
        bagCount: 0,
        amount: billAmount,
        billDate,
        settledDate,
        daysToSettle,
        billAmount,
        collectorUserId: String(cust?.collectorUserId ?? ''),
        collectorName,
        commissionBucket,
      });
    }
  }

  rows.sort((a, b) => {
    const bySettled = a.settledDate.localeCompare(b.settledDate);
    if (bySettled !== 0) return bySettled;
    const byShop = a.shopName.localeCompare(b.shopName);
    if (byShop !== 0) return byShop;
    return a.invoiceNumber.localeCompare(b.invoiceNumber);
  });

  return rows;
}

export function summarizeCollectionsByBucket(rows) {
  const totals = Object.fromEntries(
    COLLECTION_DAY_BUCKETS.map((b) => [b.key, { lineCount: 0, amount: 0 }]),
  );
  for (const row of rows || []) {
    const buckets = summaryBucketsForDays(row.daysToSettle);
    for (const key of buckets) {
      if (!totals[key]) continue;
      totals[key].lineCount += 1;
      totals[key].amount = round2(totals[key].amount + row.amount);
    }
  }
  return totals;
}

export function enrichRowsWithCommission(rows, rates) {
  const normalized = normalizeCollectorCommissionRates(rates);
  return (rows || []).map((row) => {
    const bucket = row.commissionBucket;
    const commissionPercent = bucket ? normalized[bucket] || 0 : 0;
    const commissionAmount = round2((row.amount * commissionPercent) / 100);
    return { ...row, commissionPercent, commissionAmount };
  });
}

export function summarizeCommissionByBucket(rows) {
  const totals = Object.fromEntries(
    COLLECTION_DAY_BUCKETS.map((b) => [
      b.key,
      { lineCount: 0, collectionAmount: 0, commissionAmount: 0, commissionPercent: 0 },
    ]),
  );
  for (const row of rows || []) {
    const key = row.commissionBucket;
    if (!key || !totals[key]) continue;
    totals[key].lineCount += 1;
    totals[key].collectionAmount = round2(totals[key].collectionAmount + row.amount);
    totals[key].commissionAmount = round2(totals[key].commissionAmount + (row.commissionAmount || 0));
    totals[key].commissionPercent = row.commissionPercent || 0;
  }
  return totals;
}
