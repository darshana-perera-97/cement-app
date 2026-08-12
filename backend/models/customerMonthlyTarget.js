const { toNonNegNumber } = require('./stocksStore');

function normalizeCustomerName(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function totalBagsOnBill(bill) {
  let sum = 0;
  for (const [key, val] of Object.entries(bill || {})) {
    if (key.endsWith('Bags') && key !== 'totalBags') {
      sum += toNonNegNumber(val);
    }
  }
  return sum;
}

function currentCalendarMonthRangeLocal() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const from = `${y}-${m}-01`;
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  const to = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
  return { from, to, monthLabel: `${y}-${m}` };
}

function monthlyBagsSoldForCustomerName(bills, customerName) {
  const nk = normalizeCustomerName(customerName);
  const { from, to } = currentCalendarMonthRangeLocal();
  let sum = 0;
  for (const bill of bills) {
    if (normalizeCustomerName(bill.customerName) !== nk) continue;
    const d = String(bill.date ?? '').trim();
    if (!d || d < from || d > to) continue;
    sum += totalBagsOnBill(bill);
  }
  return Math.round(sum);
}

function normalizeMonthlyTargetBags(input) {
  if (input === '' || input == null) return 0;
  const n = Math.floor(Number(input));
  if (!Number.isFinite(n) || n < 0 || n > 999999) return null;
  return n;
}

function monthlyTargetFieldsForCustomer(customer, bills) {
  const target = normalizeMonthlyTargetBags(customer?.monthlyTargetBags) ?? 0;
  const sold = monthlyBagsSoldForCustomerName(bills, customer?.name);
  const { monthLabel } = currentCalendarMonthRangeLocal();
  const progressPct =
    target > 0 ? Math.round((sold / target) * 1000) / 10 : null;
  return {
    monthlyTargetBags: target,
    monthlyBagsSold: sold,
    monthlyTargetMonth: monthLabel,
    monthlyTargetProgressPct: progressPct,
  };
}

module.exports = {
  normalizeMonthlyTargetBags,
  monthlyTargetFieldsForCustomer,
  monthlyBagsSoldForCustomerName,
};
