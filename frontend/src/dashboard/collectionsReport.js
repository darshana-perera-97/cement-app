import { formatBrandLabel, getCachedBrands } from './brandTheme';
import { getPaymentCheques } from './paymentCheques';
import {
  buildBillSettledDateLookup,
  listCustomerBillPaymentAllocations,
  paymentCreditToCustomer,
} from './pendingBills';
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

function isYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').slice(0, 10));
}

/**
 * Date a cheque is realized: later of converting date and deposit date when deposited.
 * Falls back to converting date when not yet deposited.
 */
export function chequeRealizeYmd(cheque) {
  const converting = String(cheque?.chequeDate ?? '').slice(0, 10);
  const deposited = String(cheque?.chequeDepositedAt ?? '').slice(0, 10);
  const convertingOk = isYmd(converting);
  const depositedOk = Boolean(cheque?.chequeDeposited) && isYmd(deposited);
  if (convertingOk && depositedOk) return deposited > converting ? deposited : converting;
  if (convertingOk) return converting;
  if (depositedOk) return deposited;
  return '';
}

/**
 * Split a payment's credited amount into slices with the date used for days-to-settle.
 * Cash / CDM / transfer use the payment date; each cheque uses its realize date.
 */
function paymentSettleSlices(payment, paymentDate) {
  const cheques = getPaymentCheques(payment).filter(
    (c) => !c.chequeReturned && round2(c.amount) > 0,
  );
  const chequeTotal = round2(cheques.reduce((s, c) => s + round2(c.amount), 0));
  const credit = round2(paymentCreditToCustomer(payment));
  const nonCheque = round2(Math.max(0, credit - chequeTotal));
  const byDate = new Map();
  const addSlice = (amount, settleDate) => {
    const amt = round2(amount);
    if (amt <= 0) return;
    const key = isYmd(settleDate) ? settleDate : paymentDate;
    byDate.set(key, round2((byDate.get(key) || 0) + amt));
  };
  if (nonCheque > 0) addSlice(nonCheque, paymentDate);
  for (const c of cheques) {
    addSlice(c.amount, chequeRealizeYmd(c) || paymentDate);
  }
  if (byDate.size === 0) addSlice(credit, paymentDate);
  return [...byDate.entries()].map(([settleDate, amount]) => ({ settleDate, amount }));
}

function splitAmountAcrossSlices(amount, slices) {
  const collected = round2(amount);
  if (collected <= 0 || !Array.isArray(slices) || slices.length === 0) return [];
  const total = round2(slices.reduce((s, sl) => s + sl.amount, 0));
  if (total <= 0) return [{ amount: collected, settleDate: slices[0].settleDate }];
  let remaining = collected;
  return slices
    .map((slice, i) => {
      const isLast = i === slices.length - 1;
      const raw = isLast ? remaining : round2((collected * slice.amount) / total);
      const share = round2(Math.max(0, Math.min(remaining, raw)));
      remaining = round2(remaining - share);
      return { amount: share, settleDate: slice.settleDate };
    })
    .filter((s) => s.amount > 0);
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

function normalizeRecorderKey(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase();
}

function paymentMatchesRecordedByKeys(payment, recordedByKeys) {
  if (!Array.isArray(recordedByKeys) || recordedByKeys.length === 0) return false;
  const by = normalizeRecorderKey(payment?.recordedBy);
  if (!by) return false;
  return recordedByKeys.includes(by);
}

function recorderDisplayName(recordedBy, staff = []) {
  const raw = String(recordedBy ?? '').trim();
  if (!raw) return '—';
  const key = normalizeRecorderKey(raw);
  const user = (staff || []).find((u) => {
    const keys = [u.username, u.nic].map(normalizeRecorderKey).filter(Boolean);
    return keys.includes(key);
  });
  return String(user?.name ?? '').trim() || raw;
}

/**
 * Collection lines recorded by a collector, manager, or admin.
 * Includes every approved payment allocated to an invoice (full or partial).
 * Amount is the collected portion; days are from bill date to payment or cheque realize date.
 */
export function buildSettledCollectionsRows(
  customers,
  bills,
  settledByBillId,
  payments,
  { from, to, recordedByKeys = null, staff = [] } = {},
) {
  const keys = Array.isArray(recordedByKeys)
    ? recordedByKeys.map(normalizeRecorderKey).filter(Boolean)
    : null;
  const settledLookup = settledByBillId instanceof Map ? settledByBillId : new Map();
  const allocsByPaymentId = new Map();

  for (const cust of customers || []) {
    const allocations = listCustomerBillPaymentAllocations(cust, bills, payments);
    for (const alloc of allocations) {
      const pid = String(alloc.paymentId ?? '').trim();
      if (!pid) continue;
      if (!allocsByPaymentId.has(pid)) allocsByPaymentId.set(pid, []);
      allocsByPaymentId.get(pid).push({ ...alloc, customer: cust });
    }
  }

  const rows = [];
  let rowSeq = 0;

  const pushShareRows = ({ payment, alloc, shopName, collectorName }) => {
    const paymentDate = String(alloc.paymentDate || payment?.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) return;
    if (from && to && !inDateRange(paymentDate, from, to)) return;

    const bill = alloc.bill;
    const billId = String(bill?.id ?? '').trim();
    const billDate = String(bill?.date ?? '').slice(0, 10);
    const invoiceNumber = String(bill?.invoiceNumber ?? '').trim() || '—';
    const billAmount = round2(bill?.totalAmount);
    const settledDate = billId ? settledLookup.get(billId) || '' : '';
    const paymentSlices = paymentSettleSlices(payment, paymentDate);
    let amountSlices = splitAmountAcrossSlices(alloc.amount, paymentSlices);
    if (amountSlices.length === 0) {
      amountSlices = [{ amount: round2(alloc.amount), settleDate: paymentDate }];
    }

    for (const amountSlice of amountSlices) {
      const settleDateForDays = amountSlice.settleDate || paymentDate;
      const daysToSettle = billDate ? daysBetweenYmd(billDate, settleDateForDays) : 0;
      const commissionBucket = commissionBucketForDays(daysToSettle);
      const brandShares = prorateCollectionAcrossBrands(bill, amountSlice.amount);

      for (const share of brandShares) {
        if (share.amount <= 0) continue;
        rowSeq += 1;
        rows.push({
          rowKey: `${alloc.paymentId || paymentDate}-${billId}-${share.brandKey || 'total'}-${settleDateForDays}-${rowSeq}`,
          paymentId: alloc.paymentId,
          billId,
          date: paymentDate,
          invoiceNumber,
          shopName,
          bagType: share.bagType,
          brandKey: share.brandKey,
          bagCount: share.bagCount,
          amount: share.amount,
          billDate,
          settledDate,
          daysToSettle,
          billAmount,
          collectorUserId: String(alloc.customer?.collectorUserId ?? ''),
          collectorName,
          recordedBy: String(payment?.recordedBy ?? '').trim(),
          commissionBucket,
          isPartial: !settledDate,
        });
      }
    }
  };

  for (const p of payments || []) {
    if (keys && !paymentMatchesRecordedByKeys(p, keys)) continue;
    const credit = paymentCreditToCustomer(p);
    if (credit <= 0) continue;
    const paymentDate = String(p.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) continue;
    if (from && to && !inDateRange(paymentDate, from, to)) continue;

    const pid = String(p.id ?? '').trim();
    const allocs = (pid && allocsByPaymentId.get(pid)) || [];
    const shopNameFallback = String(p.customerName ?? '').trim() || '—';
    const collectorName = recorderDisplayName(p.recordedBy, staff);

    let allocated = 0;
    for (const alloc of allocs) {
      allocated = round2(allocated + alloc.amount);
      const cust = alloc.customer;
      pushShareRows({
        payment: p,
        alloc: { ...alloc, paymentDate },
        shopName: String(cust?.name ?? p.customerName ?? '').trim() || '—',
        collectorName,
      });
    }

    const leftover = round2(credit - allocated);
    if (leftover > 0) {
      rowSeq += 1;
      rows.push({
        rowKey: `${pid || paymentDate}-unallocated-${rowSeq}`,
        paymentId: pid,
        billId: '',
        date: paymentDate,
        invoiceNumber: '—',
        shopName: shopNameFallback,
        bagType: '—',
        brandKey: '',
        bagCount: 0,
        amount: leftover,
        billDate: '',
        settledDate: '',
        daysToSettle: null,
        billAmount: leftover,
        collectorUserId: '',
        collectorName,
        recordedBy: String(p.recordedBy ?? '').trim(),
        commissionBucket: null,
        isPartial: true,
      });
    }
  }

  rows.sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    const byShop = a.shopName.localeCompare(b.shopName);
    if (byShop !== 0) return byShop;
    const byInvoice = a.invoiceNumber.localeCompare(b.invoiceNumber);
    if (byInvoice !== 0) return byInvoice;
    return (a.brandKey || '').localeCompare(b.brandKey || '');
  });

  return rows;
}

function prorateCollectionAcrossBrands(bill, collectedAmount) {
  const collected = round2(collectedAmount);
  if (collected <= 0) return [];
  const brands = getCachedBrands();
  const brandLines = [];
  for (const brand of brands) {
    const bagCount = Number(bill[brand.bagsField]) || 0;
    if (bagCount <= 0) continue;
    brandLines.push({
      brandKey: brand.key,
      bagType: formatBrandLabel(brand) || brand.label,
      bagCount,
      lineAmount: brandLineFromBill(bill, brand.key),
    });
  }
  const billAmount = round2(bill.totalAmount);
  if (brandLines.length === 0) {
    return [
      {
        brandKey: '',
        bagType: '—',
        bagCount: 0,
        amount: collected,
      },
    ];
  }
  let remaining = collected;
  return brandLines.map((line, i) => {
    const isLast = i === brandLines.length - 1;
    const rawShare =
      isLast || billAmount <= 0
        ? remaining
        : round2((collected * line.lineAmount) / billAmount);
    const share = round2(Math.max(0, Math.min(remaining, rawShare)));
    remaining = round2(remaining - share);
    return {
      brandKey: line.brandKey,
      bagType: line.bagType,
      bagCount: line.bagCount,
      amount: share,
    };
  });
}

/**
 * Collection lines for collector commission.
 * Includes every approved payment allocated to an invoice (full or partial).
 * Amount is the collected portion; days are from bill date to payment or cheque realize date.
 */
export function buildCollectorCollectionRows(
  customers,
  bills,
  payments,
  settledByBillId,
  { from, to, collectorUserId = '' } = {},
) {
  const collectorFilter = String(collectorUserId ?? '').trim();
  const settledLookup = settledByBillId instanceof Map ? settledByBillId : new Map();
  const paymentById = new Map();
  for (const p of payments || []) {
    const id = String(p.id ?? '').trim();
    if (id) paymentById.set(id, p);
  }
  const rows = [];
  let rowSeq = 0;

  for (const cust of customers || []) {
    if (collectorFilter && String(cust?.collectorUserId ?? '') !== collectorFilter) continue;
    const allocations = listCustomerBillPaymentAllocations(cust, bills, payments);
    const collectorName = String(cust?.collectorName ?? '').trim() || '—';
    const shopName = String(cust?.name ?? '').trim() || '—';

    for (const alloc of allocations) {
      const paymentDate = String(alloc.paymentDate ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) continue;
      if (from && to && !inDateRange(paymentDate, from, to)) continue;

      const bill = alloc.bill;
      const billId = String(bill?.id ?? '').trim();
      const billDate = String(bill?.date ?? '').slice(0, 10);
      const invoiceNumber = String(bill?.invoiceNumber ?? '').trim() || '—';
      const billAmount = round2(bill?.totalAmount);
      const settledDate = billId ? settledLookup.get(billId) || '' : '';
      const payment = paymentById.get(String(alloc.paymentId ?? '').trim());
      const paymentSlices = paymentSettleSlices(payment || {}, paymentDate);
      let amountSlices = splitAmountAcrossSlices(alloc.amount, paymentSlices);
      if (amountSlices.length === 0) {
        amountSlices = [{ amount: round2(alloc.amount), settleDate: paymentDate }];
      }

      for (const amountSlice of amountSlices) {
        const settleDateForDays = amountSlice.settleDate || paymentDate;
        const daysToSettle = daysBetweenYmd(billDate, settleDateForDays);
        const commissionBucket = commissionBucketForDays(daysToSettle);
        const brandShares = prorateCollectionAcrossBrands(bill, amountSlice.amount);

        for (const share of brandShares) {
          if (share.amount <= 0) continue;
          rowSeq += 1;
          rows.push({
            rowKey: `${alloc.paymentId || paymentDate}-${billId}-${share.brandKey || 'total'}-${settleDateForDays}-${rowSeq}`,
            paymentId: alloc.paymentId,
            billId,
            date: paymentDate,
            invoiceNumber,
            shopName,
            bagType: share.bagType,
            brandKey: share.brandKey,
            bagCount: share.bagCount,
            amount: share.amount,
            billDate,
            settledDate,
            daysToSettle,
            billAmount,
            collectorUserId: String(cust?.collectorUserId ?? ''),
            collectorName,
            commissionBucket,
            isPartial: !settledDate,
          });
        }
      }
    }
  }

  rows.sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    const byShop = a.shopName.localeCompare(b.shopName);
    if (byShop !== 0) return byShop;
    const byInvoice = a.invoiceNumber.localeCompare(b.invoiceNumber);
    if (byInvoice !== 0) return byInvoice;
    return (a.brandKey || '').localeCompare(b.brandKey || '');
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
