const { toNonNegMoney } = require('./customersStore');
const { getPaymentCheques } = require('./paymentCheques');

function normalizeCustomerName(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Total applied against the customer’s balance for one payment (cash + non-returned cheques).
 */
function paymentCreditToCustomer(p) {
  const cheques = getPaymentCheques(p);
  if (cheques.length > 0) {
    const cash = toNonNegMoney(p?.cashAmount);
    const activeCheques = cheques
      .filter((c) => !c.chequeReturned)
      .reduce((s, c) => s + toNonNegMoney(c.amount), 0);
    return roundMoney(cash + activeCheques);
  }
  const total = toNonNegMoney(p?.amount);
  if (total > 0) return total;
  return roundMoney(toNonNegMoney(p?.cashAmount) + toNonNegMoney(p?.chequeAmount));
}

/** Full payment amount recorded (before any returned cheques). */
function paymentGrossCredit(p) {
  const total = toNonNegMoney(p?.amount);
  if (total > 0) return total;
  const cheques = getPaymentCheques(p);
  if (cheques.length > 0) {
    const cash = toNonNegMoney(p?.cashAmount);
    const chequeSum = cheques.reduce((s, c) => s + toNonNegMoney(c.amount), 0);
    return roundMoney(cash + chequeSum);
  }
  return roundMoney(toNonNegMoney(p?.cashAmount) + toNonNegMoney(p?.chequeAmount));
}

function roundMoney(n) {
  return Math.round(n * 100) / 100;
}

function comparePaymentsChronological(a, b) {
  const cmp = String(a.date ?? '').localeCompare(String(b.date ?? ''));
  if (cmp !== 0) return cmp;
  return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
}

function sortBillsChronological(bills) {
  return [...bills].sort((a, b) => {
    const cmp = String(a.date ?? '').localeCompare(String(b.date ?? ''));
    if (cmp !== 0) return cmp;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
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

/**
 * Per-bill paid amounts after processing payments in order.
 * Payments with billCashAllocations apply only to those bills (skip FIFO).
 * Other payments apply pastBill first, then oldest bills.
 */
function computeBillPaymentAllocation(customer, bills, payments) {
  const nameKey = normalizeCustomerName(customer.name);
  const custBills = sortBillsChronological(
    (Array.isArray(bills) ? bills : []).filter(
      (b) => normalizeCustomerName(b.customerName) === nameKey,
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
        const room = Math.max(0, roundMoney(total - current));
        const toward = Math.min(room, cashAmount);
        paidByBillId.set(billId, roundMoney(current + toward));
      }
      continue;
    }

    let remaining = credit;
    const towardPast = Math.min(Math.max(0, pastOwed - pastPaid), remaining);
    pastPaid = roundMoney(pastPaid + towardPast);
    remaining = roundMoney(remaining - towardPast);

    for (const bill of custBills) {
      if (remaining <= 0) break;
      const id = String(bill.id ?? '').trim();
      if (!id) continue;
      const total = toNonNegMoney(bill.totalAmount);
      const current = paidByBillId.get(id) || 0;
      const room = Math.max(0, roundMoney(total - current));
      const toward = Math.min(room, remaining);
      paidByBillId.set(id, roundMoney(current + toward));
      remaining = roundMoney(remaining - toward);
    }
  }

  return { paidByBillId, pastPaid, custBills };
}

/** Bill id → payment date when each bill was fully cleared. */
function buildSettledDateByBillIdForCustomer(customer, bills, payments) {
  const settledByBillId = new Map();
  if (!customer) return settledByBillId;

  const { paidByBillId, custBills } = computeBillPaymentAllocation(customer, bills, payments);
  const custPayments = (Array.isArray(payments) ? payments : [])
    .filter((p) => p.customerId === customer.id)
    .sort(comparePaymentsChronological);

  const runningPaid = new Map();
  for (const b of custBills) {
    const id = String(b.id ?? '').trim();
    if (id) runningPaid.set(id, 0);
  }

  const pastOwed = toNonNegMoney(customer.pastBill);
  let pastPaid = 0;

  for (const p of custPayments) {
    const credit = paymentCreditToCustomer(p);
    if (credit <= 0) continue;
    const payDate = String(p.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate)) continue;

    const explicit = getPaymentBillCashAllocations(p);
    if (explicit.length > 0) {
      for (const { billId, cashAmount } of explicit) {
        if (!runningPaid.has(billId)) continue;
        const bill = custBills.find((b) => String(b.id ?? '').trim() === billId);
        const total = toNonNegMoney(bill?.totalAmount);
        const current = runningPaid.get(billId) || 0;
        const room = Math.max(0, roundMoney(total - current));
        const toward = Math.min(room, cashAmount);
        const next = roundMoney(current + toward);
        runningPaid.set(billId, next);
        if (next >= total - 0.009 && billId) settledByBillId.set(billId, payDate);
      }
      continue;
    }

    let remaining = credit;
    const towardPast = Math.min(Math.max(0, pastOwed - pastPaid), remaining);
    pastPaid = roundMoney(pastPaid + towardPast);
    remaining = roundMoney(remaining - towardPast);

    for (const bill of custBills) {
      if (remaining <= 0) break;
      const id = String(bill.id ?? '').trim();
      if (!id) continue;
      const total = toNonNegMoney(bill.totalAmount);
      const current = runningPaid.get(id) || 0;
      const room = Math.max(0, roundMoney(total - current));
      const toward = Math.min(room, remaining);
      const next = roundMoney(current + toward);
      runningPaid.set(id, next);
      remaining = roundMoney(remaining - toward);
      if (next >= total - 0.009) settledByBillId.set(id, payDate);
    }
  }

  return settledByBillId;
}

/** Signed balance: opening past bill + credit bills − payments (negative = overpaid). */
function computeRawBalance(customer, bills, payments) {
  const nameKey = normalizeCustomerName(customer.name);
  let owed = toNonNegMoney(customer.pastBill);
  for (const b of bills) {
    if (normalizeCustomerName(b.customerName) !== nameKey) continue;
    owed += toNonNegMoney(b.totalAmount);
  }
  for (const p of payments) {
    if (p.customerId !== customer.id) continue;
    owed -= paymentCreditToCustomer(p);
  }
  return roundMoney(owed);
}

/** Amount still owed and any credit from paying more than owed. */
function computeCustomerBalance(customer, bills, payments) {
  const raw = computeRawBalance(customer, bills, payments);
  return {
    amountToPay: Math.max(0, raw),
    overpaymentAmount: Math.max(0, -raw),
  };
}

/** Amount still owed (0 when the customer has overpaid). */
function computeRemainingAmount(customer, bills, payments) {
  return computeCustomerBalance(customer, bills, payments).amountToPay;
}

module.exports = {
  normalizeCustomerName,
  computeRawBalance,
  computeCustomerBalance,
  computeRemainingAmount,
  paymentCreditToCustomer,
  paymentGrossCredit,
  comparePaymentsChronological,
  sortBillsChronological,
  getPaymentBillCashAllocations,
  computeBillPaymentAllocation,
  buildSettledDateByBillIdForCustomer,
};
