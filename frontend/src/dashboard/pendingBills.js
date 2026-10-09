import { getPaymentCheques, cdmPortion, onlineTransferPortion } from './paymentCheques';

function isPaymentCreditActive(p) {
  if (p?.cancelled) return false;
  if (!p?.requiresApproval) return true;
  const s = String(p.approvalStatus ?? 'pending').trim().toLowerCase();
  return s === 'approved';
}

/** Default settlement window when a customer has no overdueDays override. */
export const DEFAULT_OVERDUE_DAYS = 14;

function normalizeCustomerName(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function toNonNegMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round(v * 100) / 100;
}

function sumPromotionAmountForBill(promotions, billId, type) {
  const id = String(billId ?? '').trim();
  if (!id) return 0;
  let sum = 0;
  for (const row of Array.isArray(promotions) ? promotions : []) {
    if (String(row?.type ?? '').trim() !== type) continue;
    if (String(row.billId ?? '').trim() !== id) continue;
    sum += toNonNegMoney(row.discountAmount);
  }
  return Math.round(sum * 100) / 100;
}

/** System rule cashback applied to one invoice (`rule_cashback`). */
function sumRuleCashbackForBill(promotions, billId) {
  return sumPromotionAmountForBill(promotions, billId, 'rule_cashback');
}

/** Invoice discounts applied to one selected invoice (`invoice_discount`). */
export function sumInvoiceDiscountForBill(promotions, billId) {
  return sumPromotionAmountForBill(promotions, billId, 'invoice_discount');
}

/** Invoice total still to be paid after invoice discounts and rule cashback on that invoice. */
function payableBillTotal(bill, promotions = []) {
  const base = toNonNegMoney(bill?.totalAmount);
  const reductions =
    sumRuleCashbackForBill(promotions, bill?.id) + sumInvoiceDiscountForBill(promotions, bill?.id);
  return Math.max(0, Math.round((base - reductions) * 100) / 100);
}

/** Matches backend `paymentCreditToCustomer`. */
export function paymentCreditToCustomer(p) {
  if (!isPaymentCreditActive(p)) return 0;
  const cheques = getPaymentCheques(p);
  const cdm = cdmPortion(p);
  const onlineTransfer = onlineTransferPortion(p);
  if (cheques.length > 0) {
    const cash = toNonNegMoney(p?.cashAmount);
    const activeCheques = cheques
      .filter((c) => !c.chequeReturned)
      .reduce((s, c) => s + toNonNegMoney(c.amount), 0);
    return toNonNegMoney(cash + activeCheques + cdm + onlineTransfer);
  }
  const total = toNonNegMoney(p?.amount);
  if (total > 0) return total;
  return toNonNegMoney(p?.cashAmount) + toNonNegMoney(p?.chequeAmount) + cdm + onlineTransfer;
}

/** Amount collected on the receipt, including cheques that later bounce. */
export function paymentSettlementCredit(p) {
  if (!isPaymentCreditActive(p)) return 0;
  if (p?.cancelled) return 0;
  const total = toNonNegMoney(p?.amount);
  if (total > 0) return total;
  const cheques = getPaymentCheques(p);
  const cdm = cdmPortion(p);
  const onlineTransfer = onlineTransferPortion(p);
  if (cheques.length > 0) {
    const cash = toNonNegMoney(p?.cashAmount);
    const chequeSum = cheques.reduce((s, c) => s + toNonNegMoney(c.amount), 0);
    return toNonNegMoney(cash + chequeSum + cdm + onlineTransfer);
  }
  return toNonNegMoney(p?.cashAmount) + toNonNegMoney(p?.chequeAmount) + cdm + onlineTransfer;
}

const RETURN_CHEQUE_PREFIX = 'return-cheque:';

export function returnChequeBillId(paymentId, chequeId) {
  return `${RETURN_CHEQUE_PREFIX}${String(paymentId ?? '').trim()}:${String(chequeId ?? '').trim()}`;
}

export function isReturnChequeBillId(billId) {
  return String(billId ?? '').startsWith(RETURN_CHEQUE_PREFIX);
}

function paymentEventTime(p) {
  const created = String(p?.createdAt ?? '').trim();
  if (created) return created;
  const date = String(p?.date ?? '').slice(0, 10);
  return date ? `${date}T12:00:00` : '';
}

export function listCustomerReturnedCheques(customer, payments) {
  if (!customer) return [];
  const rows = [];
  for (const p of Array.isArray(payments) ? payments : []) {
    if (p.customerId !== customer.id) continue;
    if (!isPaymentCreditActive(p)) continue;
    for (const c of getPaymentCheques(p)) {
      if (!c.chequeReturned) continue;
      const amount = toNonNegMoney(c.amount);
      if (amount <= 0) continue;
      const returnAt = String(
        c.chequeReturnedAt || p.createdAt || `${String(p.date || '').slice(0, 10)}T12:00:00`,
      );
      rows.push({
        id: returnChequeBillId(p.id, c.id),
        paymentId: String(p.id ?? '').trim(),
        chequeId: String(c.id ?? '').trim(),
        amount,
        returnAt,
        returnDate: returnAt.slice(0, 10),
        chequeNumber: String(c.chequeNumber ?? '').trim(),
        chequeBank: String(c.chequeBank ?? '').trim(),
        chequeDate: String(c.chequeDate ?? '').slice(0, 10),
        receiptNumber: String(p.billNumber ?? '').trim(),
      });
    }
  }
  rows.sort((a, b) => a.returnAt.localeCompare(b.returnAt) || a.id.localeCompare(b.id));
  return rows;
}

function returnChequePayableByPayment(rc, payment) {
  if (!rc || !payment) return false;
  if (rc.paymentId && rc.paymentId === String(payment.id ?? '').trim()) return false;
  const payAt = paymentEventTime(payment);
  if (!rc.returnAt || !payAt) return false;
  return rc.returnAt <= payAt;
}

function getPaymentBillCashAllocations(p) {
  if (!Array.isArray(p?.billCashAllocations)) return [];
  return p.billCashAllocations
    .map((a) => ({
      billId: String(a?.billId ?? '').trim(),
      cashAmount: toNonNegMoney(a?.cashAmount ?? a?.amount ?? 0),
    }))
    .filter((a) => a.billId && a.cashAmount > 0);
}

/** Synthetic invoice id for a customer's opening balance (`pastBill`). */
export function openingBalanceBillId(customerId) {
  return `${String(customerId ?? '').trim()}-opening`;
}

export function isOpeningBalanceBillId(billId, customerId) {
  const id = String(billId ?? '').trim();
  const cid = String(customerId ?? '').trim();
  return Boolean(id && cid && id === `${cid}-opening`);
}

export function openingBalanceBillDate(customer) {
  const created = String(customer?.createdAt ?? '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(created)) return created;
  const due = String(customer?.dueDate ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : '';
}

function openingBalanceDueDate(customer, billDate, settlementDays) {
  const due = String(customer?.dueDate ?? '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) return due;
  return addDaysToYmd(billDate, settlementDays);
}

function comparePaymentsChronological(a, b) {
  const cmp = String(a.date ?? '').localeCompare(String(b.date ?? ''));
  if (cmp !== 0) return cmp;
  return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
}

/**
 * Apply each payment in order.
 * Settlement credit includes cheques that later bounce, so those invoices stay paid.
 * The bounce is a separate return-cheque balance, paid before opening balance and invoices
 * when the collector is not splitting the receipt by hand.
 */
function forEachCustomerSettlementApplication(customer, bills, payments, promotions = [], onApply) {
  const nk = normalizeCustomerName(customer.name);
  const custBills = sortBillsChronological(
    (Array.isArray(bills) ? bills : []).filter(
      (b) => normalizeCustomerName(b.customerName) === nk,
    ),
  );
  const paidByBillId = new Map();
  for (const b of custBills) {
    const id = String(b.id ?? '').trim();
    if (id) paidByBillId.set(id, 0);
  }

  const pastOwed = toNonNegMoney(customer.pastBill);
  let pastPaid = 0;
  const openingId = openingBalanceBillId(customer.id);
  if (pastOwed > 0 && openingId) paidByBillId.set(openingId, 0);

  const returnCheques = listCustomerReturnedCheques(customer, payments);
  const paidByReturnChequeId = new Map();
  const returnById = new Map();
  for (const rc of returnCheques) {
    paidByReturnChequeId.set(rc.id, 0);
    returnById.set(rc.id, rc);
  }
  const billById = new Map(custBills.map((b) => [String(b.id ?? '').trim(), b]));
  const custPayments = (Array.isArray(payments) ? payments : [])
    .filter((p) => p.customerId === customer.id)
    .sort(comparePaymentsChronological);
  const note = (info) => {
    if (typeof onApply === 'function') onApply(info);
  };

  const applyReturn = (payment, rc, want) => {
    const current = paidByReturnChequeId.get(rc.id) || 0;
    const room = Math.max(0, toNonNegMoney(rc.amount - current));
    const toward = Math.min(room, toNonNegMoney(want));
    if (toward <= 0) return 0;
    const next = toNonNegMoney(current + toward);
    paidByReturnChequeId.set(rc.id, next);
    note({
      payment,
      kind: 'return',
      billId: rc.id,
      toward,
      remainingAfter: toNonNegMoney(Math.max(0, rc.amount - next)),
      settled: rc.amount - next <= 0.009,
      returnCheque: rc,
    });
    return toward;
  };

  const applyOpening = (payment, want) => {
    if (!openingId || pastOwed <= 0) return 0;
    const room = Math.max(0, toNonNegMoney(pastOwed - pastPaid));
    const toward = Math.min(room, toNonNegMoney(want));
    if (toward <= 0) return 0;
    pastPaid = toNonNegMoney(pastPaid + toward);
    paidByBillId.set(openingId, pastPaid);
    const remaining = toNonNegMoney(Math.max(0, pastOwed - pastPaid));
    note({
      payment,
      kind: 'opening',
      billId: openingId,
      toward,
      remainingAfter: remaining,
      settled: remaining <= 0.009,
    });
    return toward;
  };

  const applyBill = (payment, billId, want) => {
    if (!paidByBillId.has(billId)) return 0;
    const bill = billById.get(billId);
    const total = payableBillTotal(bill, promotions);
    const current = paidByBillId.get(billId) || 0;
    const room = Math.max(0, toNonNegMoney(total - current));
    const toward = Math.min(room, toNonNegMoney(want));
    if (toward <= 0) return 0;
    const next = toNonNegMoney(current + toward);
    paidByBillId.set(billId, next);
    const remaining = toNonNegMoney(Math.max(0, total - next));
    note({
      payment,
      kind: 'bill',
      billId,
      bill,
      toward,
      remainingAfter: remaining,
      settled: remaining <= 0.009,
      billTotal: total,
    });
    return toward;
  };

  for (const p of custPayments) {
    const credit = paymentSettlementCredit(p);
    if (credit <= 0) continue;
    const explicit = getPaymentBillCashAllocations(p);
    if (explicit.length > 0) {
      for (const { billId, cashAmount } of explicit) {
        if (isReturnChequeBillId(billId)) {
          const rc = returnById.get(billId);
          if (!rc || !returnChequePayableByPayment(rc, p)) continue;
          applyReturn(p, rc, cashAmount);
          continue;
        }
        if (openingId && billId === openingId) {
          applyOpening(p, cashAmount);
          continue;
        }
        applyBill(p, billId, cashAmount);
      }
      continue;
    }

    let remaining = credit;
    for (const rc of returnCheques) {
      if (remaining <= 0.009) break;
      if (!returnChequePayableByPayment(rc, p)) continue;
      remaining = toNonNegMoney(remaining - applyReturn(p, rc, remaining));
    }
    remaining = toNonNegMoney(remaining - applyOpening(p, remaining));
    for (const bill of custBills) {
      if (remaining <= 0.009) break;
      const id = String(bill.id ?? '').trim();
      if (!id) continue;
      remaining = toNonNegMoney(remaining - applyBill(p, id, remaining));
    }
  }

  return { paidByBillId, pastPaid, paidByReturnChequeId, custBills, returnCheques };
}

/**
 * Per-bill paid amounts after processing payments in order.
 * Explicit splits apply only to the chosen invoices and return cheques.
 * Other payments pay return cheques first, then pastBill, then oldest bills.
 */
function computeBillPaymentAllocation(customer, bills, payments, promotions = []) {
  return forEachCustomerSettlementApplication(customer, bills, payments, promotions);
}

/**
 * Each approved payment’s amount applied to a specific invoice (FIFO or explicit allocation).
 * Opening past-bill amounts are not included — those have no invoice date for aging.
 */
export function listCustomerBillPaymentAllocations(customer, bills, payments, promotions = []) {
  if (!customer) return [];
  const allocations = [];
  forEachCustomerSettlementApplication(customer, bills, payments, promotions, (info) => {
    if (!info.toward || info.toward <= 0) return;
    const payment = info.payment;
    const paymentDate = String(payment?.date ?? '').slice(0, 10);
    if (info.kind === 'return') {
      const rc = info.returnCheque;
      allocations.push({
        paymentId: String(payment?.id ?? '').trim(),
        paymentDate,
        recordedBy: String(payment?.recordedBy ?? '').trim(),
        bill: {
          id: rc.id,
          date: rc.returnDate,
          invoiceNumber: rc.chequeNumber ? `RC ${rc.chequeNumber}` : 'Return cheque',
          totalAmount: rc.amount,
          isReturnCheque: true,
        },
        amount: toNonNegMoney(info.toward),
        isReturnCheque: true,
      });
      return;
    }
    if (info.kind !== 'bill' || !info.bill) return;
    allocations.push({
      paymentId: String(payment?.id ?? '').trim(),
      paymentDate,
      recordedBy: String(payment?.recordedBy ?? '').trim(),
      bill: info.bill,
      amount: toNonNegMoney(info.toward),
    });
  });
  return allocations;
}

function todayYmdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysToYmd(ymd, days) {
  if (!ymd || String(ymd).length < 10) return '';
  const d = new Date(
    parseInt(ymd.slice(0, 4), 10),
    parseInt(ymd.slice(5, 7), 10) - 1,
    parseInt(ymd.slice(8, 10), 10),
  );
  d.setDate(d.getDate() + (Number(days) || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

export function billDetailsLine(bill, { includeStockId = true } = {}) {
  const parts = [];
  const invoiceNumber = String(bill.invoiceNumber ?? '').trim();
  if (invoiceNumber) parts.push(includeStockId ? `Inv ${invoiceNumber}` : `Invoice ${invoiceNumber}`);
  if (includeStockId) {
    const stockId = String(bill.stockId ?? '').trim();
    if (stockId) parts.push(`Stock ${stockId}`);
  }
  const bagParts = [];
  for (const [key, label] of [
    ['tokyo', 'Tokyo'],
    ['samudra', 'Samudra'],
    ['atlas', 'Atlas'],
    ['nippon', 'Nippon'],
  ]) {
    const n = Number(bill[`${key}Bags`]) || 0;
    if (n > 0) bagParts.push(`${label} ${n} bags`);
  }
  if (bagParts.length) parts.push(bagParts.join(', '));
  const line = parts.join(' · ');
  if (line) return line;
  const amt = toNonNegMoney(bill.totalAmount);
  return amt > 0 ? `Total LKR ${amt}` : 'Credit bill';
}

function settlementDaysForCustomer(cust) {
  const n = Number(cust?.overdueDays);
  if (Number.isFinite(n) && n >= 0) return n;
  return DEFAULT_OVERDUE_DAYS;
}

function sortBillsChronological(bills) {
  return [...bills].sort((a, b) => {
    const cmp = String(a.date).localeCompare(String(b.date));
    if (cmp !== 0) return cmp;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
}

/** Payment date (YYYY-MM-DD) when each bill was fully cleared. */
function buildSettledDateByBillId(custBills, custPayments, pastBillAmount = 0, customerId = '', promotions = []) {
  const settledByBillId = new Map();
  const sortedBills = sortBillsChronological(custBills);
  const runningPaid = new Map();
  for (const b of sortedBills) {
    const id = String(b.id ?? '').trim();
    if (id) runningPaid.set(id, 0);
  }

  const pastOwed = toNonNegMoney(pastBillAmount);
  let pastPaid = 0;
  const openingId = customerId ? openingBalanceBillId(customerId) : '';
  if (pastOwed > 0 && openingId) runningPaid.set(openingId, 0);

  for (const p of [...custPayments].sort(comparePaymentsChronological)) {
    let credit = paymentCreditToCustomer(p);
    if (credit <= 0) continue;
    const payDate = String(p.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate)) continue;

    const explicit = getPaymentBillCashAllocations(p);
    if (explicit.length > 0) {
      for (const { billId, cashAmount } of explicit) {
        if (openingId && billId === openingId) {
          const room = Math.max(0, toNonNegMoney(pastOwed - pastPaid));
          const toward = Math.min(room, cashAmount);
          pastPaid = toNonNegMoney(pastPaid + toward);
          runningPaid.set(openingId, pastPaid);
          if (pastOwed > 0 && pastPaid >= pastOwed - 0.009) settledByBillId.set(openingId, payDate);
          continue;
        }
        if (!runningPaid.has(billId)) continue;
        const bill = sortedBills.find((b) => String(b.id ?? '').trim() === billId);
        const total = payableBillTotal(bill, promotions);
        const current = runningPaid.get(billId) || 0;
        const room = Math.max(0, toNonNegMoney(total - current));
        const toward = Math.min(room, cashAmount);
        const next = toNonNegMoney(current + toward);
        runningPaid.set(billId, next);
        if (next >= total - 0.009 && billId) settledByBillId.set(billId, payDate);
      }
      continue;
    }

    if (pastOwed > pastPaid) {
      const toward = Math.min(pastOwed - pastPaid, credit);
      pastPaid = toNonNegMoney(pastPaid + toward);
      credit = toNonNegMoney(credit - toward);
      if (openingId && pastPaid >= pastOwed - 0.009) settledByBillId.set(openingId, payDate);
    }

    for (const bill of sortedBills) {
      if (credit <= 0) break;
      const id = String(bill.id ?? '').trim();
      if (!id) continue;
      const total = payableBillTotal(bill, promotions);
      const current = runningPaid.get(id) || 0;
      const room = Math.max(0, toNonNegMoney(total - current));
      const toward = Math.min(room, credit);
      const next = toNonNegMoney(current + toward);
      runningPaid.set(id, next);
      credit = toNonNegMoney(credit - toward);
      if (next >= total - 0.009) settledByBillId.set(id, payDate);
    }
  }

  return settledByBillId;
}

function buildSettledDateByBillIdForCustomer(customer, bills, payments, promotions = []) {
  const settledByBillId = new Map();
  if (!customer) return settledByBillId;
  forEachCustomerSettlementApplication(customer, bills, payments, promotions, (info) => {
    if (!info.settled || !info.billId) return;
    const payDate = String(info.payment?.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate)) return;
    if (!settledByBillId.has(info.billId)) settledByBillId.set(info.billId, payDate);
  });
  return settledByBillId;
}

/** Map bill id → settled date when fully paid (FIFO or explicit allocations). */
export function buildBillSettledDateLookup(customers, bills, payments, promotions = []) {
  const settledByBillId = new Map();
  const safeCustomers = Array.isArray(customers) ? customers : [];
  const safeBills = Array.isArray(bills) ? bills : [];
  const safePayments = Array.isArray(payments) ? payments : [];
  const registeredNk = new Set();

  for (const cust of safeCustomers) {
    const nk = normalizeCustomerName(cust.name);
    if (!nk) continue;
    registeredNk.add(nk);
    for (const [id, date] of buildSettledDateByBillIdForCustomer(cust, safeBills, safePayments, promotions)) {
      settledByBillId.set(id, date);
    }
  }

  const orphanBillsByNk = new Map();
  for (const bill of safeBills) {
    const nk = normalizeCustomerName(bill.customerName);
    if (!nk || registeredNk.has(nk)) continue;
    if (!orphanBillsByNk.has(nk)) orphanBillsByNk.set(nk, []);
    orphanBillsByNk.get(nk).push(bill);
  }

  for (const [nk, obills] of orphanBillsByNk) {
    const custPayments = safePayments.filter((p) => normalizeCustomerName(p.customerName) === nk);
    for (const [id, date] of buildSettledDateByBillId(obills, custPayments, 0, '', promotions)) {
      settledByBillId.set(id, date);
    }
  }

  return settledByBillId;
}

/** True when approved payments have fully cleared the bill (no outstanding balance). */
export function isBillFullySettled(bill, customers, bills, payments, promotions = []) {
  const nk = normalizeCustomerName(bill?.customerName);
  const id = String(bill?.id ?? '').trim();
  const total = payableBillTotal(bill, promotions);
  if (!id || total <= 0) return false;

  const cust = (Array.isArray(customers) ? customers : []).find(
    (c) => normalizeCustomerName(c.name) === nk,
  );

  if (cust) {
    const { paidByBillId } = computeBillPaymentAllocation(cust, bills, payments, promotions);
    const paid = paidByBillId.get(id) || 0;
    return Math.round((total - paid) * 100) / 100 <= 0;
  }

  const obills = sortBillsChronological(
    (Array.isArray(bills) ? bills : []).filter((b) => normalizeCustomerName(b.customerName) === nk),
  );
  let paySum = 0;
  for (const p of Array.isArray(payments) ? payments : []) {
    if (normalizeCustomerName(p.customerName) === nk) paySum += paymentCreditToCustomer(p);
  }
  let remainingCredit = paySum;
  for (const b of obills) {
    const bTotal = payableBillTotal(b, promotions);
    const paidToward = Math.min(bTotal, remainingCredit);
    remainingCredit -= paidToward;
    const bId = String(b.id ?? '').trim();
    if (bId === id) return Math.round((bTotal - paidToward) * 100) / 100 <= 0;
  }
  return false;
}

/**
 * All unpaid credit bills (pending), including those not yet overdue.
 * Same payment allocation as backend `/api/overdue-bills` / `/api/pending-bills`.
 *
 * @param {Array} customers — from `/api/customers` (uses `overdueDays` when present)
 * @param {Array} bills — from `/api/bills`
 * @param {Array} payments — from `/api/payments`
 */
export function buildPendingBillRows(
  customers = [],
  bills = [],
  payments = [],
  { includeOrphanBills = true, promotions = [] } = {},
) {
  const todayYmd = todayYmdLocal();
  const rows = [];
  const safeCustomers = Array.isArray(customers) ? customers : [];
  const safeBills = Array.isArray(bills) ? bills : [];
  const safePayments = Array.isArray(payments) ? payments : [];

  const pushRow = (row) => {
    const isOverdue = Boolean(row.dueDate && todayYmd > row.dueDate);
    rows.push({
      ...row,
      daysOverdue: isOverdue ? daysBetweenYmd(row.dueDate, todayYmd) : 0,
    });
  };

  for (const cust of safeCustomers) {
    const settlementDays = settlementDaysForCustomer(cust);
    const { paidByBillId, pastPaid, custBills, paidByReturnChequeId, returnCheques } =
      computeBillPaymentAllocation(cust, safeBills, safePayments, promotions);

    const pastOwed = toNonNegMoney(cust.pastBill);
    const openingRemaining = Math.round((pastOwed - pastPaid) * 100) / 100;
    if (openingRemaining > 0) {
      const billDate = openingBalanceBillDate(cust);
      const due = openingBalanceDueDate(cust, billDate, settlementDays);
      pushRow({
        id: openingBalanceBillId(cust.id),
        customerName: cust.name,
        billDate,
        dueDate: due,
        daysFromBillDate: daysBetweenYmd(billDate, todayYmd),
        outstandingAmount: openingRemaining,
        billTotal: pastOwed,
        invoiceNumber: 'Opening',
        details: 'Opening balance',
        settlementDays,
        isOpeningBalance: true,
      });
    }

    for (const bill of custBills) {
      const total = payableBillTotal(bill, promotions);
      const id = String(bill.id ?? '').trim();
      const paidTowardBill = id ? paidByBillId.get(id) || 0 : 0;
      const remaining = Math.round((total - paidTowardBill) * 100) / 100;
      if (remaining <= 0) continue;
      const due = addDaysToYmd(bill.date, settlementDays);
      pushRow({
        id: bill.id,
        customerName: cust.name,
        billDate: bill.date,
        dueDate: due,
        daysFromBillDate: daysBetweenYmd(bill.date, todayYmd),
        outstandingAmount: remaining,
        billTotal: total,
        invoiceNumber: String(bill.invoiceNumber ?? '').trim(),
        details: billDetailsLine(bill),
        settlementDays,
      });
    }

    for (const rc of returnCheques || []) {
      const paid = paidByReturnChequeId?.get(rc.id) || 0;
      const remaining = Math.round((rc.amount - paid) * 100) / 100;
      if (remaining <= 0) continue;
      const label = rc.chequeNumber ? `#${rc.chequeNumber}` : 'Return cheque';
      pushRow({
        id: rc.id,
        customerName: cust.name,
        billDate: rc.returnDate,
        dueDate: rc.returnDate,
        daysFromBillDate: daysBetweenYmd(rc.returnDate, todayYmd),
        outstandingAmount: remaining,
        billTotal: rc.amount,
        invoiceNumber: label,
        details: ['Return cheque', rc.chequeBank || null, rc.receiptNumber ? `receipt ${rc.receiptNumber}` : null]
          .filter(Boolean)
          .join(' · '),
        settlementDays,
        isReturnCheque: true,
      });
    }
  }

  if (includeOrphanBills) {
    const registeredNk = new Set(safeCustomers.map((c) => normalizeCustomerName(c.name)));
    const orphanBillsByNk = new Map();
    for (const bill of safeBills) {
      const nk = normalizeCustomerName(bill.customerName);
      if (registeredNk.has(nk)) continue;
      if (!orphanBillsByNk.has(nk)) orphanBillsByNk.set(nk, []);
      orphanBillsByNk.get(nk).push(bill);
    }

    for (const [nk, obills] of orphanBillsByNk) {
      let paySum = 0;
      for (const p of safePayments) {
        if (normalizeCustomerName(p.customerName) === nk) paySum += paymentCreditToCustomer(p);
      }
      let remainingCredit = paySum;
      for (const bill of sortBillsChronological(obills)) {
        const total = payableBillTotal(bill, promotions);
        const paidTowardBill = Math.min(total, remainingCredit);
        remainingCredit -= paidTowardBill;
        const remaining = Math.round((total - paidTowardBill) * 100) / 100;
        if (remaining <= 0) continue;
        const due = addDaysToYmd(bill.date, DEFAULT_OVERDUE_DAYS);
        const name = String(bill.customerName ?? '').trim() || 'Unknown';
        pushRow({
          id: bill.id,
          customerName: name,
          billDate: bill.date,
          dueDate: due,
          daysFromBillDate: daysBetweenYmd(bill.date, todayYmd),
          outstandingAmount: remaining,
          billTotal: total,
          invoiceNumber: String(bill.invoiceNumber ?? '').trim(),
          details: billDetailsLine(bill),
        });
      }
    }
  }

  rows.sort((a, b) => {
    const shopCmp = String(a.customerName ?? '').localeCompare(String(b.customerName ?? ''));
    if (shopCmp !== 0) return shopCmp;
    if (Boolean(a.isReturnCheque) !== Boolean(b.isReturnCheque)) {
      return a.isReturnCheque ? -1 : 1;
    }
    if (Boolean(a.isOpeningBalance) !== Boolean(b.isOpeningBalance)) {
      return a.isOpeningBalance ? -1 : 1;
    }
    const dateCmp = String(a.billDate ?? '').localeCompare(String(b.billDate ?? ''));
    if (dateCmp !== 0) return dateCmp;
    return (Number(b.outstandingAmount) || 0) - (Number(a.outstandingAmount) || 0);
  });
  return rows;
}

/**
 * All credit bills for one customer with settlement status (paid / partial / open).
 * Explicit per-bill allocations are honored; other payments use FIFO.
 * Newest bill date first.
 */
export function buildCustomerInvoiceRows(customer, bills = [], payments = [], promotions = []) {
  if (!customer) return [];
  const todayYmd = todayYmdLocal();
  const settlementDays = settlementDaysForCustomer(customer);
  const settledByBillId = buildSettledDateByBillIdForCustomer(customer, bills, payments, promotions);
  const { paidByBillId, pastPaid, custBills } = computeBillPaymentAllocation(
    customer,
    bills,
    payments,
    promotions,
  );

  const rows = [];
  const pastOwed = toNonNegMoney(customer.pastBill);
  if (pastOwed > 0) {
    const openingId = openingBalanceBillId(customer.id);
    const paidTowardOpening = toNonNegMoney(pastPaid);
    const outstanding = Math.round((pastOwed - paidTowardOpening) * 100) / 100;
    const billDate = openingBalanceBillDate(customer);
    const dueDate = openingBalanceDueDate(customer, billDate, settlementDays);
    const isOverdue = Boolean(dueDate && todayYmd > dueDate && outstanding > 0);
    let status = 'open';
    if (outstanding <= 0) status = 'settled';
    else if (paidTowardOpening > 0) status = 'partial';
    const settledDate = openingId ? settledByBillId.get(openingId) || '' : '';
    const billDateYmd = String(billDate ?? '').slice(0, 10);
    const daysToSettle =
      settledDate && /^\d{4}-\d{2}-\d{2}$/.test(billDateYmd)
        ? daysBetweenYmd(billDateYmd, settledDate)
        : null;
    rows.push({
      id: openingId,
      isOpeningBalance: true,
      billDate,
      dueDate,
      settlementDays,
      settledDate,
      daysToSettle,
      billTotal: pastOwed,
      paidAmount: paidTowardOpening,
      outstandingAmount: outstanding,
      status,
      details: 'Opening balance',
      daysLeftUntilDue: dueDate && todayYmd <= dueDate ? daysBetweenYmd(todayYmd, dueDate) : 0,
      daysOverdue: isOverdue ? daysBetweenYmd(dueDate, todayYmd) : 0,
      isOverdue,
    });
  }

  for (const bill of custBills) {
    const total = payableBillTotal(bill, promotions);
    const id = String(bill.id ?? '').trim();
    const paidTowardBill = id ? paidByBillId.get(id) || 0 : 0;
    const outstanding = Math.round((total - paidTowardBill) * 100) / 100;
    const dueDate = addDaysToYmd(bill.date, settlementDays);
    const isOverdue = Boolean(dueDate && todayYmd > dueDate && outstanding > 0);
    let status = 'open';
    if (outstanding <= 0) status = 'settled';
    else if (paidTowardBill > 0) status = 'partial';

    const settledDate = bill.id ? settledByBillId.get(bill.id) || '' : '';
    const billDateYmd = String(bill.date ?? '').slice(0, 10);
    const daysToSettle =
      settledDate && /^\d{4}-\d{2}-\d{2}$/.test(billDateYmd)
        ? daysBetweenYmd(billDateYmd, settledDate)
        : null;

    rows.push({
      id: bill.id,
      billDate: bill.date,
      dueDate,
      settlementDays,
      settledDate,
      daysToSettle,
      billTotal: total,
      paidAmount: paidTowardBill,
      outstandingAmount: outstanding,
      status,
      details: billDetailsLine(bill, { includeStockId: false }),
      daysLeftUntilDue: dueDate && todayYmd <= dueDate ? daysBetweenYmd(todayYmd, dueDate) : 0,
      daysOverdue: isOverdue ? daysBetweenYmd(dueDate, todayYmd) : 0,
      isOverdue,
    });
  }

  rows.sort((a, b) => {
    if (Boolean(a.isOpeningBalance) !== Boolean(b.isOpeningBalance)) {
      return a.isOpeningBalance ? -1 : 1;
    }
    return String(b.billDate).localeCompare(String(a.billDate));
  });
  return rows;
}

/** Outstanding credit bills for one customer (optional: exclude a payment when editing). */
export function buildCustomerOutstandingBills(
  customers = [],
  bills = [],
  payments = [],
  customerId,
  { excludePaymentId = null, promotions = [] } = {},
) {
  const idKey = String(customerId ?? '').trim();
  const cust = (Array.isArray(customers) ? customers : []).find(
    (c) => String(c.id ?? '').trim() === idKey,
  );
  if (!cust) return [];
  const pay = excludePaymentId
    ? (Array.isArray(payments) ? payments : []).filter((p) => p.id !== excludePaymentId)
    : payments;
  return buildPendingBillRows([cust], bills, pay, { includeOrphanBills: false, promotions });
}
