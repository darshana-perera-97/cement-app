const { toNonNegMoney } = require('./customersStore');
const { getPaymentCheques } = require('./paymentCheques');
const { cdmPortion, onlineTransferPortion, isPaymentCreditActive } = require('./paymentOtherMethods');
const { promotionCreditAmount, promotionType, sumInvoiceDiscountForBill, sumRuleCashbackForBill, PROMOTION_TYPES } = require('./promotionsStore');
const { sumItemReturnForBill, returnLedgerDeltaForCustomer } = require('./returnsStore');

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
  if (!isPaymentCreditActive(p)) return 0;
  const cheques = getPaymentCheques(p);
  const cdm = cdmPortion(p);
  const onlineTransfer = onlineTransferPortion(p);
  if (cheques.length > 0) {
    const cash = toNonNegMoney(p?.cashAmount);
    const activeCheques = cheques
      .filter((c) => !c.chequeReturned)
      .reduce((s, c) => s + toNonNegMoney(c.amount), 0);
    return roundMoney(cash + activeCheques + cdm + onlineTransfer);
  }
  const total = toNonNegMoney(p?.amount);
  if (total > 0) return total;
  return roundMoney(toNonNegMoney(p?.cashAmount) + toNonNegMoney(p?.chequeAmount) + cdm + onlineTransfer);
}

/** Full payment amount recorded (before any returned cheques). */
function paymentGrossCredit(p) {
  if (p?.cancelled) return 0;
  const total = toNonNegMoney(p?.amount);
  if (total > 0) return total;
  const cheques = getPaymentCheques(p);
  const cdm = cdmPortion(p);
  const onlineTransfer = onlineTransferPortion(p);
  if (cheques.length > 0) {
    const cash = toNonNegMoney(p?.cashAmount);
    const chequeSum = cheques.reduce((s, c) => s + toNonNegMoney(c.amount), 0);
    return roundMoney(cash + chequeSum + cdm + onlineTransfer);
  }
  return roundMoney(toNonNegMoney(p?.cashAmount) + toNonNegMoney(p?.chequeAmount) + cdm + onlineTransfer);
}

function roundMoney(n) {
  return Math.round(n * 100) / 100;
}

/** Credit that settled invoices when it was collected, including cheques that later bounced. */
function paymentSettlementCredit(p) {
  if (!isPaymentCreditActive(p)) return 0;
  return paymentGrossCredit(p);
}

const RETURN_CHEQUE_PREFIX = 'return-cheque:';

function returnChequeBillId(paymentId, chequeId) {
  return `${RETURN_CHEQUE_PREFIX}${String(paymentId ?? '').trim()}:${String(chequeId ?? '').trim()}`;
}

function isReturnChequeBillId(billId) {
  return String(billId ?? '').startsWith(RETURN_CHEQUE_PREFIX);
}

function parseReturnChequeBillId(billId) {
  const raw = String(billId ?? '');
  if (!raw.startsWith(RETURN_CHEQUE_PREFIX)) return null;
  const rest = raw.slice(RETURN_CHEQUE_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep <= 0) return null;
  const paymentId = rest.slice(0, sep);
  const chequeId = rest.slice(sep + 1);
  if (!paymentId || !chequeId) return null;
  return { paymentId, chequeId };
}

function paymentEventTime(p) {
  const created = String(p?.createdAt ?? '').trim();
  if (created) return created;
  const date = String(p?.date ?? '').slice(0, 10);
  return date ? `${date}T12:00:00` : '';
}

/** Returned cheques still owed as their own balances until a later payment settles them. */
function listCustomerReturnedCheques(customer, payments) {
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

/**
 * Apply each payment in order.
 * Settlement credit includes cheques that later bounce, so those invoices stay paid.
 * The bounce is a separate return-cheque balance. With no per-bill split, that balance
 * is paid before the opening balance and before invoices.
 */
function forEachCustomerSettlementApplication(
  customer,
  bills,
  payments,
  promotions = [],
  returnsRows = [],
  onApply,
) {
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
  const openingId = openingBalanceBillId(customer.id);
  const openingCredit = openingId ? sumItemReturnForBill(returnsRows, openingId) : 0;
  const pastRoom = Math.max(0, roundMoney(pastOwed - openingCredit));
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

  const billTotalOf = (bill) => effectiveBillTotal(bill, promotions, returnsRows);
  const note = (info) => {
    if (typeof onApply === 'function') onApply(info);
  };

  const applyReturn = (payment, rc, want) => {
    const current = paidByReturnChequeId.get(rc.id) || 0;
    const room = Math.max(0, roundMoney(rc.amount - current));
    const toward = Math.min(room, toNonNegMoney(want));
    if (toward <= 0) return 0;
    const next = roundMoney(current + toward);
    paidByReturnChequeId.set(rc.id, next);
    note({
      payment,
      kind: 'return',
      billId: rc.id,
      toward,
      remainingAfter: roundMoney(Math.max(0, rc.amount - next)),
      settled: rc.amount - next <= 0.009,
      returnCheque: rc,
    });
    return toward;
  };

  const applyOpening = (payment, want) => {
    if (!openingId || pastRoom <= 0) return 0;
    const room = Math.max(0, roundMoney(pastRoom - pastPaid));
    const toward = Math.min(room, toNonNegMoney(want));
    if (toward <= 0) return 0;
    pastPaid = roundMoney(pastPaid + toward);
    paidByBillId.set(openingId, pastPaid);
    const remaining = roundMoney(Math.max(0, pastRoom - pastPaid));
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
    const total = billTotalOf(bill);
    const current = paidByBillId.get(billId) || 0;
    const room = Math.max(0, roundMoney(total - current));
    const toward = Math.min(room, toNonNegMoney(want));
    if (toward <= 0) return 0;
    const next = roundMoney(current + toward);
    paidByBillId.set(billId, next);
    const remaining = roundMoney(Math.max(0, total - next));
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
      remaining = roundMoney(remaining - applyReturn(p, rc, remaining));
    }
    remaining = roundMoney(remaining - applyOpening(p, remaining));
    for (const bill of custBills) {
      if (remaining <= 0.009) break;
      const id = String(bill.id ?? '').trim();
      if (!id) continue;
      remaining = roundMoney(remaining - applyBill(p, id, remaining));
    }
  }

  return { paidByBillId, pastPaid, paidByReturnChequeId, custBills, returnCheques };
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

/** Synthetic invoice id for a customer's opening balance (`pastBill`). */
function openingBalanceBillId(customerId) {
  return `${String(customerId ?? '').trim()}-opening`;
}

function isOpeningBalanceBillId(billId, customerId) {
  const id = String(billId ?? '').trim();
  const cid = String(customerId ?? '').trim();
  return Boolean(id && cid && id === `${cid}-opening`);
}

function openingBalanceBillDate(customer) {
  const created = String(customer?.createdAt ?? '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(created)) return created;
  const due = String(customer?.dueDate ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : '';
}

function effectiveBillTotal(bill, promotions = [], returnsRows = []) {
  const base = toNonNegMoney(bill?.totalAmount);
  const discount = roundMoney(
    sumInvoiceDiscountForBill(promotions, bill?.id) +
      sumRuleCashbackForBill(promotions, bill?.id) +
      sumItemReturnForBill(returnsRows, bill?.id),
  );
  return Math.max(0, roundMoney(base - discount));
}

/**
 * Per-bill paid amounts after processing payments in order.
 * Explicit bill splits apply only to those invoices and return cheques.
 * Other payments pay outstanding return cheques first, then pastBill, then oldest bills.
 * A cheque that later bounces still counts as having paid the invoices; the bounce is a
 * separate return-cheque balance.
 */
function computeBillPaymentAllocation(customer, bills, payments, promotions = [], returnsRows = []) {
  return forEachCustomerSettlementApplication(customer, bills, payments, promotions, returnsRows);
}

/** Bill id → payment date when each bill was fully cleared. */
function buildSettledDateByBillIdForCustomer(customer, bills, payments, promotions = []) {
  const settledByBillId = new Map();
  if (!customer) return settledByBillId;
  forEachCustomerSettlementApplication(customer, bills, payments, promotions, [], (info) => {
    if (!info.settled || !info.billId) return;
    const payDate = String(info.payment?.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate)) return;
    if (!settledByBillId.has(info.billId)) settledByBillId.set(info.billId, payDate);
  });
  return settledByBillId;
}

/**
 * Payment id → invoices this payment applied to (opening balance included), with remaining after it posted.
 */
function mapPaymentAffectedInvoices(customer, bills, payments, promotions = []) {
  const byPaymentId = new Map();
  if (!customer) return byPaymentId;

  forEachCustomerSettlementApplication(customer, bills, payments, promotions, [], (info) => {
    if (!info.toward || info.toward <= 0) return;
    const pid = String(info.payment?.id ?? '').trim();
    if (!pid) return;
    let hit;
    if (info.kind === 'return') {
      const rc = info.returnCheque;
      const label = rc?.chequeNumber ? `#${rc.chequeNumber}` : 'Return cheque';
      hit = {
        billId: info.billId,
        invoiceNumber: label,
        date: rc?.returnDate || '',
        details: 'Return cheque',
        isReturnCheque: true,
        billTotal: rc?.amount,
        appliedAmount: roundMoney(info.toward),
        remainingAfter: info.remainingAfter,
        settled: info.settled,
      };
    } else if (info.kind === 'opening') {
      hit = {
        billId: info.billId,
        invoiceNumber: 'Opening',
        date: openingBalanceBillDate(customer),
        details: 'Opening balance',
        billTotal: toNonNegMoney(customer.pastBill),
        appliedAmount: roundMoney(info.toward),
        remainingAfter: info.remainingAfter,
        settled: info.settled,
      };
    } else {
      const bill = info.bill;
      hit = {
        billId: info.billId,
        invoiceNumber: String(bill?.invoiceNumber ?? '').trim(),
        date: String(bill?.date ?? '').trim(),
        billTotal: info.billTotal,
        appliedAmount: roundMoney(info.toward),
        remainingAfter: info.remainingAfter,
        settled: info.settled,
      };
    }
    if (!byPaymentId.has(pid)) byPaymentId.set(pid, []);
    byPaymentId.get(pid).push(hit);
  });

  return byPaymentId;
}

function listPaymentAffectedInvoices(customer, bills, payments, paymentId, promotions = []) {
  const targetId = String(paymentId ?? '').trim();
  if (!targetId) return [];
  const map = mapPaymentAffectedInvoices(customer, bills, payments, promotions);
  return map.get(targetId) || [];
}

/** Signed balance: opening past bill + credit bills − payments − promotion credits − returns (negative = overpaid). */
function computeRawBalance(customer, bills, payments, promotions = [], returnsRows = []) {
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
  for (const promo of Array.isArray(promotions) ? promotions : []) {
    if (promo.customerId !== customer.id) continue;
    owed -= promotionCreditAmount(promo);
  }
  for (const row of Array.isArray(returnsRows) ? returnsRows : []) {
    owed += returnLedgerDeltaForCustomer(row, customer);
  }
  return roundMoney(owed);
}

/** Amount still owed and any credit from paying more than owed. */
function computeCustomerBalance(customer, bills, payments, promotions = [], returnsRows = []) {
  const raw = computeRawBalance(customer, bills, payments, promotions, returnsRows);
  return {
    amountToPay: Math.max(0, raw),
    overpaymentAmount: Math.max(0, -raw),
  };
}

/** Amount still owed (0 when the customer has overpaid). */
function computeRemainingAmount(customer, bills, payments, promotions = [], returnsRows = []) {
  return computeCustomerBalance(customer, bills, payments, promotions, returnsRows).amountToPay;
}

module.exports = {
  normalizeCustomerName,
  computeRawBalance,
  computeCustomerBalance,
  computeRemainingAmount,
  paymentCreditToCustomer,
  paymentGrossCredit,
  paymentSettlementCredit,
  returnChequeBillId,
  isReturnChequeBillId,
  parseReturnChequeBillId,
  listCustomerReturnedCheques,
  comparePaymentsChronological,
  sortBillsChronological,
  getPaymentBillCashAllocations,
  computeBillPaymentAllocation,
  buildSettledDateByBillIdForCustomer,
  listPaymentAffectedInvoices,
  mapPaymentAffectedInvoices,
  effectiveBillTotal,
  openingBalanceBillId,
  isOpeningBalanceBillId,
  openingBalanceBillDate,
};
