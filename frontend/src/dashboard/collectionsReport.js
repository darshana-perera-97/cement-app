import { formatReportItemLabel, getCachedBrands } from './brandTheme';
import {
  cashPortion,
  cdmPortion,
  chequePortion,
  getPaymentCheques,
  onlineTransferPortion,
} from './paymentCheques';
import { paymentInvoiceLines, returnChequeSettleLabel } from './paymentReceipt';
import {
  buildBillSettledDateLookup,
  chequeRealizeYmd,
  listCustomerBillPaymentAllocations,
  paymentCreditToCustomer,
  paymentSettlementCredit,
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

/** Nearest rupee. Collection lines are shown in whole rupees. */
function roundRupee(n) {
  return Math.round(Number(n) || 0);
}

/**
 * Split an amount into whole rupees that add up to the nearest rupee.
 * Shares follow the weights; any leftover rupee goes to the largest fractional part.
 */
function splitWholeRupees(amount, weights) {
  const target = roundRupee(amount);
  const ws = (Array.isArray(weights) ? weights : []).map((w) => Math.max(0, Number(w) || 0));
  if (ws.length === 0) return [];
  if (target === 0) return ws.map(() => 0);
  const sumW = ws.reduce((s, w) => s + w, 0);
  if (!(sumW > 0)) {
    const out = ws.map(() => 0);
    out[out.length - 1] = target;
    return out;
  }
  const base = ws.map((w) => Math.floor((target * w) / sumW + 1e-9));
  let left = target - base.reduce((s, n) => s + n, 0);
  if (left > 0) {
    const order = ws
      .map((w, i) => ({ i, frac: (target * w) / sumW - base[i] }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let k = 0; k < left && k < order.length; k += 1) {
      base[order[k].i] += 1;
    }
  }
  return base;
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

export { chequeRealizeYmd };

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
  const collected = roundRupee(amount);
  if (collected <= 0 || !Array.isArray(slices) || slices.length === 0) return [];
  const total = slices.reduce((s, sl) => s + (Number(sl.amount) || 0), 0);
  if (total <= 0) return [{ amount: collected, settleDate: slices[0].settleDate }];
  const shares = splitWholeRupees(
    collected,
    slices.map((sl) => sl.amount),
  );
  return slices
    .map((slice, i) => ({ amount: shares[i], settleDate: slice.settleDate }))
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

function returnOnlyPaymentIds(allocs) {
  const byPayment = new Map();
  for (const alloc of allocs || []) {
    const pid = String(alloc?.paymentId ?? '').trim();
    if (!pid) continue;
    if (!byPayment.has(pid)) byPayment.set(pid, []);
    byPayment.get(pid).push(alloc);
  }
  const ids = new Set();
  for (const [pid, list] of byPayment) {
    if (list.length > 0 && list.every((alloc) => alloc.bill?.isReturnCheque || alloc.isReturnCheque)) {
      ids.add(pid);
    }
  }
  return ids;
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
  const commissionBase = [];
  let rowSeq = 0;
  const returnChequeOnlyPayments = returnOnlyPaymentIds(
    [...allocsByPaymentId.values()].flat(),
  );

  const pushShareRows = ({ payment, alloc, shopName, collectorName }) => {
    const paymentDate = String(alloc.paymentDate || payment?.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) return;
    const inRange = !from || !to || inDateRange(paymentDate, from, to);

    const bill = alloc.bill;
    const billId = String(bill?.id ?? '').trim();
    const billDate = String(bill?.date ?? '').slice(0, 10);
    const rawInvoiceNumber = String(bill?.invoiceNumber ?? '').trim() || '—';
    const mentionReturnCheque =
      Boolean(bill?.isReturnCheque) &&
      returnChequeOnlyPayments.has(String(alloc.paymentId ?? '').trim());
    const invoiceNumber = mentionReturnCheque ? returnChequeSettleLabel(rawInvoiceNumber) : rawInvoiceNumber;
    const billAmount = round2(bill?.totalAmount);
    const settledDate = billId ? settledLookup.get(billId) || '' : '';
    const paymentSlices = paymentSettleSlices(payment, paymentDate);
    let amountSlices = splitAmountAcrossSlices(alloc.amount, paymentSlices);
    if (amountSlices.length === 0) {
      amountSlices = [{ amount: roundRupee(alloc.amount), settleDate: paymentDate }];
    }

    for (const amountSlice of amountSlices) {
      const settleDateForDays = amountSlice.settleDate || paymentDate;
      const daysToSettle = billDate ? daysBetweenYmd(billDate, settleDateForDays) : 0;
      const commissionBucket = commissionBucketForDays(daysToSettle);
      const brandShares = prorateCollectionAcrossBrands(bill, amountSlice.amount);

      for (const share of brandShares) {
        if (share.amount <= 0) continue;
        rowSeq += 1;
        const row = {
          rowKey: `${alloc.paymentId || paymentDate}-${billId}-${share.brandKey || 'total'}-${settleDateForDays}-${rowSeq}`,
          paymentId: alloc.paymentId,
          billId,
          date: paymentDate,
          invoiceNumber,
          shopName,
          bagType: mentionReturnCheque ? 'Return cheque' : share.bagType,
          brandKey: mentionReturnCheque ? '' : share.brandKey,
          bagCount: mentionReturnCheque ? 0 : share.bagCount,
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
          isReturnCheque: !!bill?.isReturnCheque,
        };
        commissionBase.push(row);
        if (inRange) rows.push(row);
      }
    }
  };

  for (const p of payments || []) {
    if (keys && !paymentMatchesRecordedByKeys(p, keys)) continue;
    const credit = paymentSettlementCredit(p);
    if (credit <= 0) continue;
    const paymentDate = String(p.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) continue;
    const inRange = !from || !to || inDateRange(paymentDate, from, to);

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

    const leftover = roundRupee(credit - allocated);
    if (leftover > 0) {
      rowSeq += 1;
      const row = {
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
      };
      commissionBase.push(row);
      if (inRange) rows.push(row);
    }
  }

  appendReturnedChequeCommissionReversals(rows, commissionBase, payments, { from, to });

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
  const collected = roundRupee(collectedAmount);
  if (collected <= 0) return [];
  const brands = getCachedBrands();
  const brandLines = [];
  for (const brand of brands) {
    const bagCount = Number(bill[brand.bagsField]) || 0;
    if (bagCount <= 0) continue;
    brandLines.push({
      brandKey: brand.key,
      bagType: formatReportItemLabel(brand) || brand.label,
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
  const shares =
    billAmount <= 0
      ? brandLines.map((_, i) => (i === 0 ? collected : 0))
      : splitWholeRupees(
          collected,
          brandLines.map((line) => line.lineAmount),
        );
  return brandLines.map((line, i) => ({
    brandKey: line.brandKey,
    bagType: line.bagType,
    bagCount: line.bagCount,
    amount: shares[i] || 0,
  }));
}

/**
 * Reverse commission earned on a cheque once that cheque is returned.
 * The clawback is dated on the return, and uses the same day-bucket as the original collection.
 */
function appendReturnedChequeCommissionReversals(rows, baseRows, payments, { from, to } = {}) {
  const byPayment = new Map();
  for (const row of baseRows || []) {
    const pid = String(row.paymentId ?? '').trim();
    if (!pid || row.isReturnDeduction) continue;
    if (!byPayment.has(pid)) byPayment.set(pid, []);
    byPayment.get(pid).push(row);
  }
  let seq = 0;
  for (const p of payments || []) {
    const pid = String(p.id ?? '').trim();
    const slices = byPayment.get(pid);
    if (!slices || slices.length === 0) continue;
    const baseTotal = round2(slices.reduce((sum, row) => sum + (Number(row.amount) || 0), 0));
    if (baseTotal <= 0) continue;
    let reversible = baseTotal;
    for (const c of getPaymentCheques(p)) {
      if (!c.chequeReturned) continue;
      const chequeAmount = round2(c.amount);
      if (chequeAmount <= 0 || reversible <= 0) continue;
      const returnDate = String(c.chequeReturnedAt || p.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) continue;
      const deduct = roundRupee(Math.min(chequeAmount, reversible));
      reversible = round2(reversible - deduct);
      if (from && to && !inDateRange(returnDate, from, to)) continue;
      const shares = splitWholeRupees(
        deduct,
        slices.map((row) => row.amount),
      );
      for (let index = 0; index < slices.length; index += 1) {
        const row = slices[index];
        const amt = shares[index] || 0;
        if (amt <= 0) continue;
        seq += 1;
        rows.push({
          ...row,
          rowKey: `${row.rowKey}-returned-${c.id || seq}-${seq}`,
          date: returnDate,
          invoiceNumber: c.chequeNumber ? `Return #${c.chequeNumber}` : 'Return cheque',
          bagType: 'Return cheque',
          brandKey: '',
          bagCount: 0,
          amount: -amt,
          settledDate: returnDate,
          isPartial: false,
          isReturnDeduction: true,
        });
      }
    }
  }
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
  const commissionBase = [];
  let rowSeq = 0;

  for (const cust of customers || []) {
    if (collectorFilter && String(cust?.collectorUserId ?? '') !== collectorFilter) continue;
    const allocations = listCustomerBillPaymentAllocations(cust, bills, payments);
    const collectorName = String(cust?.collectorName ?? '').trim() || '—';
    const shopName = String(cust?.name ?? '').trim() || '—';

    const returnChequeOnlyPayments = returnOnlyPaymentIds(allocations);

    for (const alloc of allocations) {
      const paymentDate = String(alloc.paymentDate ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) continue;

      const bill = alloc.bill;
      const billId = String(bill?.id ?? '').trim();
      const billDate = String(bill?.date ?? '').slice(0, 10);
      const rawInvoiceNumber = String(bill?.invoiceNumber ?? '').trim() || '—';
      const mentionReturnCheque =
        Boolean(bill?.isReturnCheque) &&
        returnChequeOnlyPayments.has(String(alloc.paymentId ?? '').trim());
      const invoiceNumber = mentionReturnCheque
        ? returnChequeSettleLabel(rawInvoiceNumber)
        : rawInvoiceNumber;
      const billAmount = round2(bill?.totalAmount);
      const settledDate = billId ? settledLookup.get(billId) || '' : '';
      const payment = paymentById.get(String(alloc.paymentId ?? '').trim());
      const paymentSlices = paymentSettleSlices(payment || {}, paymentDate);
      let amountSlices = splitAmountAcrossSlices(alloc.amount, paymentSlices);
      if (amountSlices.length === 0) {
        amountSlices = [{ amount: roundRupee(alloc.amount), settleDate: paymentDate }];
      }

      for (const amountSlice of amountSlices) {
        const settleDateForDays = amountSlice.settleDate || paymentDate;
        const daysToSettle = daysBetweenYmd(billDate, settleDateForDays);
        const commissionBucket = commissionBucketForDays(daysToSettle);
        const brandShares = prorateCollectionAcrossBrands(bill, amountSlice.amount);

        for (const share of brandShares) {
          if (share.amount <= 0) continue;
          rowSeq += 1;
          const row = {
            rowKey: `${alloc.paymentId || paymentDate}-${billId}-${share.brandKey || 'total'}-${settleDateForDays}-${rowSeq}`,
            paymentId: alloc.paymentId,
            billId,
            date: paymentDate,
            invoiceNumber,
            shopName,
            bagType: mentionReturnCheque ? 'Return cheque' : share.bagType,
            brandKey: mentionReturnCheque ? '' : share.brandKey,
            bagCount: mentionReturnCheque ? 0 : share.bagCount,
            amount: share.amount,
            billDate,
            settledDate,
            daysToSettle,
            billAmount,
            collectorUserId: String(cust?.collectorUserId ?? ''),
            collectorName,
            commissionBucket,
            isPartial: !settledDate,
            isReturnCheque: !!bill?.isReturnCheque,
          };
          commissionBase.push(row);
          if (!from || !to || inDateRange(paymentDate, from, to)) rows.push(row);
        }
      }
    }
  }

  appendReturnedChequeCommissionReversals(rows, commissionBase, payments, { from, to });

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

/** Local date and time used to order All collections, earliest first. */
function collectionRecordedAt(value, fallbackYmd) {
  const raw = String(value ?? '').trim();
  const parsed = raw ? Date.parse(raw) : NaN;
  if (Number.isFinite(parsed) && raw.length > 10) {
    const d = new Date(parsed);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return { sortAt: parsed, when: `${y}-${m}-${day} ${hh}:${mm}` };
  }
  const ymd = isYmd(raw) ? raw.slice(0, 10) : String(fallbackYmd ?? '').slice(0, 10);
  const sortAt = Date.parse(`${ymd}T00:00:00`);
  return { sortAt: Number.isFinite(sortAt) ? sortAt : 0, when: ymd };
}

/** Split an amount across weights so the shares add back up to the amount. */
function splitRound2(total, weights) {
  const target = round2(total);
  const ws = (Array.isArray(weights) ? weights : []).map((w) => Math.max(0, round2(w)));
  if (ws.length === 0) return [];
  if (target === 0) return ws.map(() => 0);
  const sumW = round2(ws.reduce((s, w) => s + w, 0));
  if (!(sumW > 0)) {
    const out = ws.map(() => 0);
    out[out.length - 1] = target;
    return out;
  }
  const shares = ws.map((w) => round2((target * w) / sumW));
  const drift = round2(target - shares.reduce((s, n) => s + n, 0));
  if (drift !== 0) {
    const idx = ws.reduce((best, w, i) => (w > ws[best] ? i : best), 0);
    shares[idx] = round2(shares[idx] + drift);
  }
  return shares;
}

/**
 * Lines for one receipt. A payment applied to more than one invoice becomes one line per invoice.
 * Amounts add up to the full receipt.
 */
function collectionLine(invoice, amount) {
  const billAmount = round2(invoice?.billAmount);
  const billId = String(invoice?.billId ?? '').trim();
  return {
    invoiceNumber: invoice?.invoiceNumber || '—',
    amount: round2(amount),
    billId,
    billDate: /^\d{4}-\d{2}-\d{2}$/.test(String(invoice?.billDate ?? '').slice(0, 10))
      ? String(invoice.billDate).slice(0, 10)
      : '',
    billAmount: billAmount > 0 ? billAmount : null,
  };
}

function collectionLinesForPayment(payment, credit) {
  const invoices = paymentInvoiceLines(payment);
  if (invoices.length <= 1) {
    return [collectionLine(invoices[0], credit)];
  }
  const applied = invoices.map((line) => round2(line.appliedAmount));
  const appliedSum = round2(applied.reduce((s, n) => s + n, 0));
  if (appliedSum > 0 && Math.abs(appliedSum - credit) < 0.01) {
    return invoices.map((line, i) => collectionLine(line, applied[i]));
  }
  if (appliedSum > credit && appliedSum > 0) {
    const shares = splitRound2(credit, applied);
    return invoices.map((line, i) => collectionLine(line, shares[i]));
  }
  if (appliedSum <= 0) {
    const shares = splitRound2(
      credit,
      invoices.map(() => 1),
    );
    return invoices.map((line, i) => collectionLine(line, shares[i]));
  }
  const lines = invoices.map((line, i) => collectionLine(line, applied[i]));
  const gap = round2(credit - appliedSum);
  if (gap > 0) lines.push(collectionLine(null, gap));
  return lines;
}

/**
 * Every receipt recorded in the period. A payment that affects more than one invoice is one line per invoice.
 * Amounts add up to the full receipt. Cheques returned in the period are separate deductions.
 * Rows are ordered by recorded time, earliest first.
 */
export function buildAllCollectionsRows(
  payments,
  { from, to, recordedByKeys = null, staff = [], settledByBillId = null } = {},
) {
  const keys = Array.isArray(recordedByKeys)
    ? recordedByKeys.map(normalizeRecorderKey).filter(Boolean)
    : null;
  const settledLookup = settledByBillId instanceof Map ? settledByBillId : null;
  const rows = [];

  for (const p of payments || []) {
    if (keys && !paymentMatchesRecordedByKeys(p, keys)) continue;
    const credit = paymentSettlementCredit(p);
    if (credit <= 0) continue;
    const date = String(p.date ?? '').slice(0, 10);
    if (!isYmd(date)) continue;
    if (from && to && !inDateRange(date, from, to)) continue;
    const pid = String(p.id ?? '').trim();
    const recorded = collectionRecordedAt(p.createdAt, date);
    const shopName = String(p.customerName ?? '').trim() || '—';
    const collectorName = recorderDisplayName(p.recordedBy, staff);
    const lines = collectionLinesForPayment(p, credit);
    lines.forEach((line, index) => {
      rows.push({
        rowKey: `${pid || date}-${line.invoiceNumber}-${index}`,
        date,
        when: recorded.when,
        sortAt: recorded.sortAt,
        shopName,
        invoiceNumber: line.invoiceNumber,
        billDate: line.billDate || '',
        daysFromBill: line.billDate ? daysBetweenYmd(line.billDate, date) : null,
        billAmount: line.billAmount,
        billSettled: line.billId ? Boolean(settledLookup?.has(line.billId)) : null,
        amount: line.amount,
        cash: index === 0 ? round2(cashPortion(p)) : 0,
        cheque: index === 0 ? round2(chequePortion(p)) : 0,
        cdm: index === 0 ? round2(cdmPortion(p)) : 0,
        bankTransfer: index === 0 ? round2(onlineTransferPortion(p)) : 0,
        collectorName,
        isReturnDeduction: false,
      });
    });
  }

  for (const p of payments || []) {
    if (p?.cancelled) continue;
    if (keys && !paymentMatchesRecordedByKeys(p, keys)) continue;
    const pid = String(p.id ?? '').trim();
    for (const c of getPaymentCheques(p)) {
      if (!c.chequeReturned) continue;
      const returnDate = String(c.chequeReturnedAt || '').slice(0, 10);
      if (!isYmd(returnDate)) continue;
      if (from && to && !inDateRange(returnDate, from, to)) continue;
      const amount = round2(c.amount);
      if (amount <= 0) continue;
      const recorded = collectionRecordedAt(c.chequeReturnedAt, returnDate);
      rows.push({
        rowKey: `return-${pid || returnDate}-${c.id || rows.length}`,
        date: recorded.when.slice(0, 10) || returnDate,
        when: recorded.when,
        sortAt: recorded.sortAt,
        shopName: String(p.customerName ?? '').trim() || '—',
        invoiceNumber: c.chequeNumber ? `Return #${c.chequeNumber}` : 'Return cheque',
        billDate: '',
        daysFromBill: null,
        billAmount: null,
        billSettled: null,
        amount: -amount,
        cash: 0,
        cheque: -amount,
        cdm: 0,
        bankTransfer: 0,
        collectorName: recorderDisplayName(p.recordedBy, staff),
        isReturnDeduction: true,
      });
    }
  }

  rows.sort((a, b) => {
    const byTime = (Number(a.sortAt) || 0) - (Number(b.sortAt) || 0);
    if (byTime !== 0) return byTime;
    const byShop = a.shopName.localeCompare(b.shopName);
    if (byShop !== 0) return byShop;
    return String(a.invoiceNumber).localeCompare(String(b.invoiceNumber));
  });

  return rows;
}

/** All collections summary. Ranges do not overlap: day 30 is only in 22–30, and 31–35 starts at day 31. */
export const ALL_COLLECTION_DAY_BUCKETS = [
  { key: '0-14', label: '0–14 days', min: 0, max: 14 },
  { key: '15-21', label: '15–21 days', min: 15, max: 21 },
  { key: '22-30', label: '22–30 days', min: 22, max: 30 },
  { key: '31-35', label: '31–35 days', min: 31, max: 35 },
  { key: 'more than 35', label: 'More than 35 days', min: 36, max: Infinity },
];

export function allCollectionBucketForDays(days) {
  const d = Number(days);
  if (!Number.isFinite(d) || d < 0) return null;
  const bucket = ALL_COLLECTION_DAY_BUCKETS.find((b) => d >= b.min && d <= b.max);
  return bucket ? bucket.key : null;
}

/** One band per line, using days from the billed date. Lines without a billed date are left out. */
export function summarizeAllCollectionsByDays(rows) {
  const totals = Object.fromEntries(
    ALL_COLLECTION_DAY_BUCKETS.map((b) => [b.key, { lineCount: 0, amount: 0 }]),
  );
  for (const row of rows || []) {
    if (row?.daysFromBill == null || row.daysFromBill === '') continue;
    const key = allCollectionBucketForDays(row.daysFromBill);
    if (!key || !totals[key]) continue;
    totals[key].lineCount += 1;
    totals[key].amount = round2(totals[key].amount + (Number(row.amount) || 0));
  }
  return totals;
}

/** Summary bands from each line's Days, adding that line's Amount. Day 30 is in both 22–30 and 30–35. */
export function summarizeCollectionsByBucket(rows) {
  const totals = Object.fromEntries(
    COLLECTION_DAY_BUCKETS.map((b) => [b.key, { lineCount: 0, amount: 0 }]),
  );
  for (const row of rows || []) {
    if (row?.daysToSettle == null || row.daysToSettle === '') continue;
    const amount = Number(row.amount) || 0;
    for (const key of summaryBucketsForDays(row.daysToSettle)) {
      if (!totals[key]) continue;
      totals[key].lineCount += 1;
      totals[key].amount = round2(totals[key].amount + amount);
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
