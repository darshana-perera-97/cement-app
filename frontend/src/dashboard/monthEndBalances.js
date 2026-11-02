import { buildCustomerInvoiceRows, DEFAULT_OVERDUE_DAYS } from './pendingBills';

function roundMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function daysBetweenYmd(fromYmd, toYmd) {
  const from = String(fromYmd ?? '').slice(0, 10);
  const to = String(toYmd ?? '').slice(0, 10);
  if (from.length < 10 || to.length < 10) return null;
  const t0 = new Date(
    parseInt(from.slice(0, 4), 10),
    parseInt(from.slice(5, 7), 10) - 1,
    parseInt(from.slice(8, 10), 10),
  ).getTime();
  const t1 = new Date(
    parseInt(to.slice(0, 4), 10),
    parseInt(to.slice(5, 7), 10) - 1,
    parseInt(to.slice(8, 10), 10),
  ).getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  return Math.max(0, Math.round((t1 - t0) / (24 * 60 * 60 * 1000)));
}

export function localTodayYmd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function currentMonthValue(d = new Date()) {
  return localTodayYmd(d).slice(0, 7);
}

export function monthDisplayLabel(monthValue) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthValue ?? '').trim());
  if (!match) return String(monthValue || '—');
  return new Date(Number(match[1]), Number(match[2]) - 1, 1).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

function creditDaysFor(customer) {
  const n = Number(customer?.overdueDays);
  if (Number.isFinite(n) && n >= 0) return n;
  return DEFAULT_OVERDUE_DAYS;
}

/**
 * One bill's score against the customer's credit days.
 * On or before the credit window the score is 100.
 * After that it is 100 × credit days ÷ days used (twice the window is 50).
 */
export function billSuccessPercent(daysUsed, creditDays) {
  const days = Math.max(0, Math.round(Number(daysUsed) || 0));
  const limit = Math.max(0, Number(creditDays) || 0);
  if (days <= limit) return 100;
  if (limit <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((100 * limit) / days)));
}

function averagePercent(scores) {
  if (!scores.length) return null;
  const total = scores.reduce((sum, n) => sum + n, 0);
  return Math.round(total / scores.length);
}

function isUnloadBill(row) {
  return !row?.isOpeningBalance && !row?.isReturnCheque && !row?.isAccountAdjustment;
}

/**
 * Month-end view for every customer.
 * Settled bills are unloads dated in `month` that are fully paid, with days to settle.
 * Pending bills are every balance still open, including overdue, with days from the billing date
 * and the amount already settled.
 * Customer success averages those bills. Anything inside the credit-day window scores 100%.
 */
export function buildMonthEndBalances(customers, bills, payments, options = {}) {
  const month = String(options.month ?? '').slice(0, 7);
  const asOf = String(options.asOf ?? localTodayYmd()).slice(0, 10);
  const promotions = options.promotions || [];
  const returnsRows = options.returnsRows || [];
  const shops = [];

  for (const customer of Array.isArray(customers) ? customers : []) {
    const shopName = String(customer?.name ?? '').trim();
    if (!shopName) continue;
    const creditDays = creditDaysFor(customer);
    const invoices = buildCustomerInvoiceRows(
      customer,
      bills,
      payments,
      promotions,
      returnsRows,
    );
    const settled = [];
    const pending = [];
    const scores = [];

    for (const inv of invoices) {
      const billDate = String(inv.billDate ?? '').slice(0, 10);
      const outstanding = roundMoney(Math.max(0, Number(inv.outstandingAmount) || 0));
      const fullySettled = inv.status === 'settled' || outstanding <= 0.009;
      const inMonth = /^\d{4}-\d{2}$/.test(month) && billDate.slice(0, 7) === month;

      if (fullySettled && isUnloadBill(inv) && inMonth) {
        const daysToSettle = inv.daysToSettle == null ? null : Number(inv.daysToSettle);
        if (daysToSettle != null && Number.isFinite(daysToSettle)) {
          scores.push(billSuccessPercent(daysToSettle, creditDays));
        }
        settled.push({
          id: inv.id,
          billDate,
          details: String(inv.details ?? '').trim() || 'Credit bill',
          amount: roundMoney(inv.billTotal),
          settledDate: String(inv.settledDate ?? '').slice(0, 10),
          daysToSettle: daysToSettle != null && Number.isFinite(daysToSettle) ? daysToSettle : null,
        });
        continue;
      }

      if (outstanding <= 0.009) continue;

      const daysFromBillDate = daysBetweenYmd(billDate, asOf);
      const dueDate = String(inv.dueDate ?? '').slice(0, 10);
      const overdue = Boolean(dueDate && asOf > dueDate);
      const daysOverdue = overdue ? daysBetweenYmd(dueDate, asOf) || 0 : 0;
      if (daysFromBillDate != null) scores.push(billSuccessPercent(daysFromBillDate, creditDays));
      pending.push({
        id: inv.id,
        billDate,
        details: String(inv.details ?? '').trim() || 'Credit bill',
        daysFromBillDate,
        settledAmount: roundMoney(inv.paidAmount),
        balance: outstanding,
        overdue,
        daysOverdue,
        isOpeningBalance: Boolean(inv.isOpeningBalance),
        isReturnCheque: Boolean(inv.isReturnCheque),
      });
    }

    if (settled.length === 0 && pending.length === 0) continue;

    settled.sort((a, b) => {
      const byDate = String(a.billDate).localeCompare(String(b.billDate));
      if (byDate !== 0) return byDate;
      return String(a.details).localeCompare(String(b.details));
    });
    pending.sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      const byDate = String(a.billDate).localeCompare(String(b.billDate));
      if (byDate !== 0) return byDate;
      return String(a.details).localeCompare(String(b.details));
    });

    const settledAmount = roundMoney(settled.reduce((sum, row) => sum + row.amount, 0));
    const pendingAmount = roundMoney(pending.reduce((sum, row) => sum + row.balance, 0));
    const overdueAmount = roundMoney(
      pending.filter((row) => row.overdue).reduce((sum, row) => sum + row.balance, 0),
    );

    shops.push({
      customerId: customer.id,
      shopName,
      location: String(customer.location ?? '').trim(),
      creditDays,
      successPercent: averagePercent(scores),
      settled,
      pending,
      settledAmount,
      pendingAmount,
      overdueAmount,
    });
  }

  shops.sort((a, b) => a.shopName.localeCompare(b.shopName, undefined, { sensitivity: 'base' }));

  const scoredShops = shops.filter((shop) => shop.successPercent != null);
  return {
    month,
    monthLabel: monthDisplayLabel(month),
    asOf,
    shops,
    totals: {
      shopCount: shops.length,
      settledCount: shops.reduce((sum, shop) => sum + shop.settled.length, 0),
      settledAmount: roundMoney(shops.reduce((sum, shop) => sum + shop.settledAmount, 0)),
      pendingCount: shops.reduce((sum, shop) => sum + shop.pending.length, 0),
      pendingAmount: roundMoney(shops.reduce((sum, shop) => sum + shop.pendingAmount, 0)),
      overdueCount: shops.reduce(
        (sum, shop) => sum + shop.pending.filter((row) => row.overdue).length,
        0,
      ),
      overdueAmount: roundMoney(shops.reduce((sum, shop) => sum + shop.overdueAmount, 0)),
      successPercent: averagePercent(scoredShops.map((shop) => shop.successPercent)),
    },
  };
}
