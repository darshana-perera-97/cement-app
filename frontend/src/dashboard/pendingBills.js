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
  const total = toNonNegMoney(p?.amount);
  if (total > 0) return total;
  return toNonNegMoney(p?.cashAmount) + toNonNegMoney(p?.chequeAmount);
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

function billDetailsLine(bill) {
  const parts = [];
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

/**
 * All unpaid credit bills (pending), including those not yet overdue.
 * Same payment allocation as backend `/api/overdue-bills` / `/api/pending-bills`.
 *
 * @param {Array} customers — from `/api/customers` (uses `overdueDays` when present)
 * @param {Array} bills — from `/api/bills`
 * @param {Array} payments — from `/api/payments`
 */
export function buildPendingBillRows(customers = [], bills = [], payments = []) {
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
    const nk = normalizeCustomerName(cust.name);
    const custBills = safeBills.filter((b) => normalizeCustomerName(b.customerName) === nk);
    let paySum = 0;
    for (const p of safePayments) {
      if (p.customerId === cust.id) paySum += paymentCreditToCustomer(p);
    }
    let remainingCredit = paySum;
    const pastOwed = toNonNegMoney(cust.pastBill);
    const towardPast = Math.min(pastOwed, remainingCredit);
    remainingCredit -= towardPast;

    for (const bill of sortBillsChronological(custBills)) {
      const total = toNonNegMoney(bill.totalAmount);
      const paidTowardBill = Math.min(total, remainingCredit);
      remainingCredit -= paidTowardBill;
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

  rows.sort((a, b) => {
    const shopCmp = String(a.customerName ?? '').localeCompare(String(b.customerName ?? ''));
    if (shopCmp !== 0) return shopCmp;
    const dateCmp = String(a.billDate ?? '').localeCompare(String(b.billDate ?? ''));
    if (dateCmp !== 0) return dateCmp;
    return (Number(b.outstandingAmount) || 0) - (Number(a.outstandingAmount) || 0);
  });
  return rows;
}
