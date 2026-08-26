import { getPaymentCheques, cdmPortion, onlineTransferPortion } from './paymentCheques';

function isPaymentCreditActive(p) {
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

/** Matches backend `paymentCreditToCustomer`. */
function paymentCreditToCustomer(p) {
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

function getPaymentBillCashAllocations(p) {
  if (!Array.isArray(p?.billCashAllocations)) return [];
  return p.billCashAllocations
    .map((a) => ({
      billId: String(a?.billId ?? '').trim(),
      cashAmount: toNonNegMoney(a?.cashAmount ?? a?.amount ?? 0),
    }))
    .filter((a) => a.billId && a.cashAmount > 0);
}

function comparePaymentsChronological(a, b) {
  const cmp = String(a.date ?? '').localeCompare(String(b.date ?? ''));
  if (cmp !== 0) return cmp;
  return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
}

/**
 * Per-bill paid amounts after processing payments in order.
 * Payments with billCashAllocations apply only to those bills (skip FIFO).
 * Other payments apply pastBill first, then oldest bills.
 */
function computeBillPaymentAllocation(customer, bills, payments) {
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

  const custPayments = (Array.isArray(payments) ? payments : [])
    .filter((p) => p.customerId === customer.id)
    .sort(comparePaymentsChronological);

  for (const p of custPayments) {
    const credit = paymentCreditToCustomer(p);
    if (credit <= 0) continue;

    const explicit = getPaymentBillCashAllocations(p);
    if (explicit.length > 0) {
      for (const { billId, cashAmount } of explicit) {
        if (!paidByBillId.has(billId)) continue;
        const bill = custBills.find((b) => String(b.id ?? '').trim() === billId);
        const total = toNonNegMoney(bill?.totalAmount);
        const current = paidByBillId.get(billId) || 0;
        const room = Math.max(0, toNonNegMoney(total - current));
        const toward = Math.min(room, cashAmount);
        paidByBillId.set(billId, toNonNegMoney(current + toward));
      }
      continue;
    }

    let remaining = credit;
    const towardPast = Math.min(Math.max(0, pastOwed - pastPaid), remaining);
    pastPaid = toNonNegMoney(pastPaid + towardPast);
    remaining = toNonNegMoney(remaining - towardPast);

    for (const bill of custBills) {
      if (remaining <= 0) break;
      const id = String(bill.id ?? '').trim();
      if (!id) continue;
      const total = toNonNegMoney(bill.totalAmount);
      const current = paidByBillId.get(id) || 0;
      const room = Math.max(0, toNonNegMoney(total - current));
      const toward = Math.min(room, remaining);
      paidByBillId.set(id, toNonNegMoney(current + toward));
      remaining = toNonNegMoney(remaining - toward);
    }
  }

  return { paidByBillId, pastPaid, custBills };
}

/**
 * Each approved payment’s amount applied to a specific invoice (FIFO or explicit allocation).
 * Opening past-bill amounts are not included — those have no invoice date for aging.
 */
export function listCustomerBillPaymentAllocations(customer, bills, payments) {
  if (!customer) return [];
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
  const allocations = [];

  const custPayments = (Array.isArray(payments) ? payments : [])
    .filter((p) => p.customerId === customer.id)
    .sort(comparePaymentsChronological);

  const pushAlloc = (payment, bill, amount) => {
    const toward = toNonNegMoney(amount);
    if (toward <= 0 || !bill) return;
    const paymentDate = String(payment.date ?? '').slice(0, 10);
    allocations.push({
      paymentId: String(payment.id ?? '').trim(),
      paymentDate,
      bill,
      amount: toward,
    });
  };

  for (const p of custPayments) {
    const credit = paymentCreditToCustomer(p);
    if (credit <= 0) continue;

    const explicit = getPaymentBillCashAllocations(p);
    if (explicit.length > 0) {
      for (const { billId, cashAmount } of explicit) {
        if (!paidByBillId.has(billId)) continue;
        const bill = custBills.find((b) => String(b.id ?? '').trim() === billId);
        const total = toNonNegMoney(bill?.totalAmount);
        const current = paidByBillId.get(billId) || 0;
        const room = Math.max(0, toNonNegMoney(total - current));
        const toward = Math.min(room, cashAmount);
        paidByBillId.set(billId, toNonNegMoney(current + toward));
        pushAlloc(p, bill, toward);
      }
      continue;
    }

    let remaining = credit;
    const towardPast = Math.min(Math.max(0, pastOwed - pastPaid), remaining);
    pastPaid = toNonNegMoney(pastPaid + towardPast);
    remaining = toNonNegMoney(remaining - towardPast);

    for (const bill of custBills) {
      if (remaining <= 0) break;
      const id = String(bill.id ?? '').trim();
      if (!id) continue;
      const total = toNonNegMoney(bill.totalAmount);
      const current = paidByBillId.get(id) || 0;
      const room = Math.max(0, toNonNegMoney(total - current));
      const toward = Math.min(room, remaining);
      paidByBillId.set(id, toNonNegMoney(current + toward));
      remaining = toNonNegMoney(remaining - toward);
      pushAlloc(p, bill, toward);
    }
  }

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

export function billDetailsLine(bill) {
  const parts = [];
  const invoiceNumber = String(bill.invoiceNumber ?? '').trim();
  if (invoiceNumber) parts.push(`Inv ${invoiceNumber}`);
  const stockId = String(bill.stockId ?? '').trim();
  if (stockId) parts.push(`Stock ${stockId}`);
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
function buildSettledDateByBillId(custBills, custPayments, pastBillAmount = 0) {
  const settledByBillId = new Map();
  const sortedBills = sortBillsChronological(custBills);
  const runningPaid = new Map();
  for (const b of sortedBills) {
    const id = String(b.id ?? '').trim();
    if (id) runningPaid.set(id, 0);
  }

  const pastOwed = toNonNegMoney(pastBillAmount);
  let pastPaid = 0;

  for (const p of [...custPayments].sort(comparePaymentsChronological)) {
    let credit = paymentCreditToCustomer(p);
    if (credit <= 0) continue;
    const payDate = String(p.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate)) continue;

    const explicit = getPaymentBillCashAllocations(p);
    if (explicit.length > 0) {
      for (const { billId, cashAmount } of explicit) {
        if (!runningPaid.has(billId)) continue;
        const bill = sortedBills.find((b) => String(b.id ?? '').trim() === billId);
        const total = toNonNegMoney(bill?.totalAmount);
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
    }

    for (const bill of sortedBills) {
      if (credit <= 0) break;
      const id = String(bill.id ?? '').trim();
      if (!id) continue;
      const total = toNonNegMoney(bill.totalAmount);
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

function buildSettledDateByBillIdForCustomer(customer, bills, payments) {
  if (!customer) return new Map();

  const nk = normalizeCustomerName(customer.name);
  const custBills = (Array.isArray(bills) ? bills : []).filter(
    (b) => normalizeCustomerName(b.customerName) === nk,
  );
  const custPayments = (Array.isArray(payments) ? payments : []).filter(
    (p) => p.customerId === customer.id,
  );
  return buildSettledDateByBillId(custBills, custPayments, customer.pastBill);
}

/** Map bill id → settled date when fully paid (FIFO or explicit allocations). */
export function buildBillSettledDateLookup(customers, bills, payments) {
  const settledByBillId = new Map();
  const safeCustomers = Array.isArray(customers) ? customers : [];
  const safeBills = Array.isArray(bills) ? bills : [];
  const safePayments = Array.isArray(payments) ? payments : [];
  const registeredNk = new Set();

  for (const cust of safeCustomers) {
    const nk = normalizeCustomerName(cust.name);
    if (!nk) continue;
    registeredNk.add(nk);
    for (const [id, date] of buildSettledDateByBillIdForCustomer(cust, safeBills, safePayments)) {
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
    for (const [id, date] of buildSettledDateByBillId(obills, custPayments, 0)) {
      settledByBillId.set(id, date);
    }
  }

  return settledByBillId;
}

/** True when approved payments have fully cleared the bill (no outstanding balance). */
export function isBillFullySettled(bill, customers, bills, payments) {
  const nk = normalizeCustomerName(bill?.customerName);
  const id = String(bill?.id ?? '').trim();
  const total = toNonNegMoney(bill?.totalAmount);
  if (!id || total <= 0) return false;

  const cust = (Array.isArray(customers) ? customers : []).find(
    (c) => normalizeCustomerName(c.name) === nk,
  );

  if (cust) {
    const { paidByBillId } = computeBillPaymentAllocation(cust, bills, payments);
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
    const bTotal = toNonNegMoney(b.totalAmount);
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
  { includeOrphanBills = true } = {},
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
    const { paidByBillId, custBills } = computeBillPaymentAllocation(cust, safeBills, safePayments);

    for (const bill of custBills) {
      const total = toNonNegMoney(bill.totalAmount);
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
        details: billDetailsLine(bill),
        settlementDays,
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
        const total = toNonNegMoney(bill.totalAmount);
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
          details: billDetailsLine(bill),
        });
      }
    }
  }

  rows.sort((a, b) => {
    const shopCmp = String(a.customerName ?? '').localeCompare(String(b.customerName ?? ''));
    if (shopCmp !== 0) return shopCmp;
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
export function buildCustomerInvoiceRows(customer, bills = [], payments = []) {
  if (!customer) return [];
  const todayYmd = todayYmdLocal();
  const settlementDays = settlementDaysForCustomer(customer);
  const settledByBillId = buildSettledDateByBillIdForCustomer(customer, bills, payments);
  const { paidByBillId, custBills } = computeBillPaymentAllocation(customer, bills, payments);

  const rows = [];
  for (const bill of custBills) {
    const total = toNonNegMoney(bill.totalAmount);
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
      details: billDetailsLine(bill),
      daysLeftUntilDue: dueDate && todayYmd <= dueDate ? daysBetweenYmd(todayYmd, dueDate) : 0,
      daysOverdue: isOverdue ? daysBetweenYmd(dueDate, todayYmd) : 0,
      isOverdue,
    });
  }

  rows.sort((a, b) => String(b.billDate).localeCompare(String(a.billDate)));
  return rows;
}

/** Outstanding credit bills for one customer (optional: exclude a payment when editing). */
export function buildCustomerOutstandingBills(
  customers = [],
  bills = [],
  payments = [],
  customerId,
  { excludePaymentId = null } = {},
) {
  const idKey = String(customerId ?? '').trim();
  const cust = (Array.isArray(customers) ? customers : []).find(
    (c) => String(c.id ?? '').trim() === idKey,
  );
  if (!cust) return [];
  const pay = excludePaymentId
    ? (Array.isArray(payments) ? payments : []).filter((p) => p.id !== excludePaymentId)
    : payments;
  return buildPendingBillRows([cust], bills, pay, { includeOrphanBills: false });
}
