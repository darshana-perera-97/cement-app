const { toNonNegMoney } = require('./customersStore');

function normalizeCustomerName(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Total applied against the customer’s balance for one payment (cash + cheque).
 * Uses stored `amount`; if missing, sums cash and cheque parts.
 */
function paymentCreditToCustomer(p) {
  const total = toNonNegMoney(p?.amount);
  if (total > 0) return total;
  return toNonNegMoney(p?.cashAmount) + toNonNegMoney(p?.chequeAmount);
}

function roundMoney(n) {
  return Math.round(n * 100) / 100;
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
};
