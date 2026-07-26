const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const { readStocks, writeStocks, toNonNegNumber, sumLoadBagsByBrand } = require('./stocksStore');
const {
  refreshLiveStockFromSources,
  getLiveStockSummary,
  getLiveDailyLedgerPayload,
} = require('./liveStockStore');
const {
  readCustomers,
  writeCustomers,
  toNonNegMoney,
  defaultDueDateYmd,
} = require('./customersStore');
const {
  normalizeCustomerName,
  computeCustomerBalance,
  computeRemainingAmount,
  paymentCreditToCustomer,
} = require('./customerBalance');
const {
  readOverdueDates,
  setCustomerOverdueDays,
  getOverdueDaysForCustomer,
  normalizeOverdueDays,
  DEFAULT_OVERDUE_DAYS,
} = require('./overdueDatesStore');
const { readEmailConfig, writeEmailConfig, maskEmailConfig } = require('./emailConfigsStore');
const { readWhatsAppConfig, writeWhatsAppConfig } = require('./whatsappConfigsStore');
const { readCompanyData, writeCompanyData } = require('./companyDataStore');
const { readSentEmails } = require('./sentEmailsStore');
const { readSentWhatsapp } = require('./sentWhatsappStore');
const { notifyBillEmail, notifyPaymentEmail, notifyPromotionEmail } = require('./emailService');
const {
  getWhatsAppStatus,
  startWhatsAppClient,
  applyWhatsAppConfigChange,
  notifyBillWhatsApp,
  notifyPaymentWhatsApp,
  notifyPromotionWhatsApp,
} = require('./whatsappService');

function enrichCustomerBalance(customer, bills, payments, overdueDates = {}) {
  const { amountToPay, overpaymentAmount } = computeCustomerBalance(customer, bills, payments);
  return {
    ...customer,
    remainingAmount: amountToPay,
    overpaymentAmount,
    overdueDays: getOverdueDaysForCustomer(overdueDates, customer.id),
  };
}
const { readBills, writeBills, lineTotal, sumAllBillBagsByBrand } = require('./billsStore');
const {
  getPaymentCheques,
  sumChequeAmounts,
  parseChequesFromBody,
  buildChequesForStorage,
  buildChequesForUpdate,
  applyLegacyChequeFields,
  chequeDepositQueueItem,
} = require('./paymentCheques');
const {
  readPayments,
  writePayments,
  todayYmdLocal: paymentDateDefaultYmd,
  normalizePaymentBillNumber,
  isPaymentBillNumberTaken,
} = require('./paymentsStore');
const { signToken, requireAdmin } = require('./authToken');
const {
  readUsers,
  verifyStoredUser,
  findUserByUsername,
  createUser,
  deleteUserById,
  toPublicUser,
} = require('./usersStore');
const { readPromotions, writePromotions, sumAllPromotionBagsByBrand } = require('./promotionsStore');

const app = express();
const PORT = Number(process.env.PORT) || 1249;
const SHOP_NAME = String(process.env.SHOP_NAME || 'CS Store').trim() || 'CS Store';

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'backend' });
});

/** Public app config (shop branding). No auth — used on login and chrome. */
app.get('/api/config', (req, res) => {
  res.json({ shopName: SHOP_NAME });
});

/** Aggregates for dashboard "Your card": receivables, stock spend, payments in */
app.get('/api/cash-summary', async (req, res) => {
  try {
    const [customers, bills, payments, stocks, overdueDates] = await Promise.all([
      readCustomers(),
      readBills(),
      readPayments(),
      readStocks(),
      readOverdueDates(),
    ]);
    let pendingFromCustomers = 0;
    for (const c of customers) {
      pendingFromCustomers += computeRemainingAmount(c, bills, payments);
    }
    let cashToBuyStock = 0;
    for (const s of stocks) {
      cashToBuyStock += toNonNegMoney(s.totalAmount);
    }
    let cashReceivedFromCustomers = 0;
    for (const p of payments) {
      cashReceivedFromCustomers += paymentCreditToCustomer(p);
    }
    const round2 = (n) => Math.round(Number(n) * 100) / 100;
    const overdueRows = collectOverdueBillRows(customers, bills, payments, overdueDates);
    const maxDaysOverdue = overdueRows.length
      ? Math.max(...overdueRows.map((r) => r.daysOverdue))
      : 0;
    const overdueTotal = round2(
      overdueRows.reduce((s, r) => s + toNonNegMoney(r.outstandingAmount), 0),
    );
    const overduePriority = overduePriorityFromMaxDays(maxDaysOverdue);
    res.json({
      pendingFromCustomers: round2(pendingFromCustomers),
      cashToBuyStock: round2(cashToBuyStock),
      cashReceivedFromCustomers: round2(cashReceivedFromCustomers),
      overdue: {
        totalOutstanding: overdueTotal,
        billCount: overdueRows.length,
        maxDaysOverdue,
        priority: overduePriority,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load cash summary' });
  }
});

/** Last N calendar days (local server time): oldest first. Each key is YYYY-MM-DD. */
function lastNDaysYmdLocal(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

/** Default credit bill settlement window when a customer has no override in overduedates.json. */
const BILL_SETTLEMENT_DAYS = DEFAULT_OVERDUE_DAYS;

/** How a payment settled the account (customer transaction list). */
function paymentSettlementSummary(p) {
  const credit = paymentCreditToCustomer(p);
  if (credit <= 0) return null;
  const cash = toNonNegMoney(p?.cashAmount);
  const chequeLines = getPaymentCheques(p);
  const chq = sumChequeAmounts(chequeLines);
  if (cash <= 0 && chq <= 0) {
    return `Settled LKR ${credit}`;
  }
  const parts = [];
  if (cash > 0) parts.push(`cash LKR ${cash}`);
  for (const line of chequeLines) {
    let s = `cheque LKR ${line.amount}`;
    if (line.chequeNumber) s += ` #${line.chequeNumber}`;
    if (line.chequeDate) s += ` · ${line.chequeDate}`;
    parts.push(s);
  }
  return parts.length ? `Settled: ${parts.join(' · ')}` : `Settled LKR ${credit}`;
}

function ymdTodayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysToYmd(ymd, days) {
  const parts = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return null;
  const d = new Date(parseInt(parts[1], 10), parseInt(parts[2], 10) - 1, parseInt(parts[3], 10));
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + (Number(days) || 0));
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${dd}`;
}

const BILL_BAG_BRANDS = ['tokyo', 'samudra', 'atlas', 'nippon'];

const BILL_BRAND_LABEL = {
  tokyo: 'Tokyo',
  samudra: 'Samudra',
  atlas: 'Atlas',
  nippon: 'Nippon',
};

/**
 * Bill line quantities must not exceed available bags pool-wide:
 * (sum of all load arrivals) − (all credit bills) − (promotional outs).
 * Matches live stock; loads.json rows are not mutated when bills are saved.
 */
function validateBillAgainstPooledStock(loads, existingBills, promotions, billBagFields) {
  const loaded = sumLoadBagsByBrand(loads);
  const soldSoFar = sumAllBillBagsByBrand(existingBills);
  const promoOut = sumAllPromotionBagsByBrand(promotions);
  for (const k of BILL_BAG_BRANDS) {
    const available = Math.max(
      0,
      toNonNegNumber(loaded[k]) - toNonNegNumber(soldSoFar[k]) - toNonNegNumber(promoOut[k]),
    );
    const need = toNonNegNumber(billBagFields[`${k}Bags`]);
    if (need > available) {
      return {
        ok: false,
        error: `Not enough ${BILL_BRAND_LABEL[k]} bags in stock: ${available} available, this bill needs ${need}.`,
      };
    }
  }
  return { ok: true };
}

function parseBillBagFields(body) {
  const tokyoBags = toNonNegNumber(body.tokyoBags);
  const samudraBags = toNonNegNumber(body.samudraBags);
  const atlasBags = toNonNegNumber(body.atlasBags);
  const nipponBags = toNonNegNumber(body.nipponBags);
  const tokyoUnitPrice = toNonNegMoney(body.tokyoUnitPrice);
  const samudraUnitPrice = toNonNegMoney(body.samudraUnitPrice);
  const atlasUnitPrice = toNonNegMoney(body.atlasUnitPrice);
  const nipponUnitPrice = toNonNegMoney(body.nipponUnitPrice);
  const tokyoLine = lineTotal(tokyoBags, tokyoUnitPrice);
  const samudraLine = lineTotal(samudraBags, samudraUnitPrice);
  const atlasLine = lineTotal(atlasBags, atlasUnitPrice);
  const nipponLine = lineTotal(nipponBags, nipponUnitPrice);
  const totalAmount =
    Math.round((tokyoLine + samudraLine + atlasLine + nipponLine) * 100) / 100;
  return {
    tokyoBags,
    samudraBags,
    atlasBags,
    nipponBags,
    tokyoUnitPrice,
    samudraUnitPrice,
    atlasUnitPrice,
    nipponUnitPrice,
    tokyoLine,
    samudraLine,
    atlasLine,
    nipponLine,
    totalAmount,
  };
}

async function refreshCustomerBalancesForBillNames(bills, paymentsList, ...nameKeys) {
  const keys = new Set(nameKeys.map((n) => normalizeCustomerName(n)).filter(Boolean));
  if (keys.size === 0) return;
  const customers = await readCustomers();
  let dirty = false;
  for (const c of customers) {
    if (keys.has(normalizeCustomerName(c.name))) {
      c.remainingAmount = computeRemainingAmount(c, bills, paymentsList);
      dirty = true;
    }
  }
  if (dirty) await writeCustomers(customers);
}

async function refreshCustomerBalancesForCustomerIds(bills, paymentsList, ...customerIds) {
  const ids = new Set(customerIds.map((id) => String(id ?? '').trim()).filter(Boolean));
  if (ids.size === 0) return;
  const customers = await readCustomers();
  let dirty = false;
  for (const c of customers) {
    if (ids.has(c.id)) {
      c.remainingAmount = computeRemainingAmount(c, bills, paymentsList);
      dirty = true;
    }
  }
  if (dirty) await writeCustomers(customers);
}

function daysFromDueToToday(dueYmd, todayYmd) {
  if (!dueYmd || !todayYmd || dueYmd.length < 10 || todayYmd.length < 10) return 0;
  const t0 = new Date(
    parseInt(dueYmd.slice(0, 4), 10),
    parseInt(dueYmd.slice(5, 7), 10) - 1,
    parseInt(dueYmd.slice(8, 10), 10),
  ).getTime();
  const t1 = new Date(
    parseInt(todayYmd.slice(0, 4), 10),
    parseInt(todayYmd.slice(5, 7), 10) - 1,
    parseInt(todayYmd.slice(8, 10), 10),
  ).getTime();
  return Math.max(0, Math.round((t1 - t0) / (24 * 60 * 60 * 1000)));
}

function billDetailsLine(bill) {
  const parts = [];
  const stockId = String(bill.stockId ?? '').trim();
  if (stockId) parts.push(`Stock ${stockId}`);
  const bagParts = [];
  const labels = [
    ['tokyo', 'Tokyo'],
    ['samudra', 'Samudra'],
    ['atlas', 'Atlas'],
    ['nippon', 'Nippon'],
  ];
  for (const [key, label] of labels) {
    const n = toNonNegNumber(bill[`${key}Bags`]);
    if (n > 0) bagParts.push(`${label} ${n} bags`);
  }
  if (bagParts.length) parts.push(bagParts.join(', '));
  const line = parts.join(' · ');
  if (line) return line;
  const amt = toNonNegMoney(bill.totalAmount);
  return amt > 0 ? `Total LKR ${amt}` : 'Credit bill';
}

/**
 * Unpaid credit bills (remaining > 0 after payments). Payments apply to `pastBill` first,
 * then bills in chronological order (same idea as balances).
 * @param {{ overdueOnly?: boolean }} [options]
 */
function collectUnpaidBillRows(customers, bills, payments, overdueDates = {}, options = {}) {
  const { overdueOnly = false } = options;
  const todayYmd = ymdTodayLocal();
  const rows = [];

  const pushIfMatch = (row) => {
    const isOverdue = Boolean(row.dueDate && todayYmd > row.dueDate);
    if (overdueOnly && !isOverdue) return;
    rows.push({
      ...row,
      daysOverdue: isOverdue ? daysFromDueToToday(row.dueDate, todayYmd) : 0,
    });
  };

  for (const cust of customers) {
    const settlementDays = getOverdueDaysForCustomer(overdueDates, cust.id);
    const nk = normalizeCustomerName(cust.name);
    const custBills = bills.filter((b) => normalizeCustomerName(b.customerName) === nk);
    let paySum = 0;
    for (const p of payments) {
      if (p.customerId === cust.id) paySum += paymentCreditToCustomer(p);
    }
    const sortedBills = [...custBills].sort((a, b) => {
      const cmp = String(a.date).localeCompare(String(b.date));
      if (cmp !== 0) return cmp;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
    let remainingCredit = paySum;
    const pastOwed = toNonNegMoney(cust.pastBill);
    const towardPast = Math.min(pastOwed, remainingCredit);
    remainingCredit -= towardPast;

    for (const bill of sortedBills) {
      const total = toNonNegMoney(bill.totalAmount);
      const paidTowardBill = Math.min(total, remainingCredit);
      remainingCredit -= paidTowardBill;
      const remaining = Math.round((total - paidTowardBill) * 100) / 100;
      const due = addDaysToYmd(bill.date, settlementDays);
      if (remaining > 0) {
        pushIfMatch({
          id: bill.id,
          customerName: cust.name,
          billDate: bill.date,
          dueDate: due,
          daysFromBillDate: daysFromDueToToday(bill.date, todayYmd),
          outstandingAmount: remaining,
          billTotal: total,
          details: billDetailsLine(bill),
          settlementDays,
        });
      }
    }
  }

  const registeredNk = new Set(customers.map((c) => normalizeCustomerName(c.name)));
  const orphanBillsByNk = new Map();
  for (const bill of bills) {
    const nk = normalizeCustomerName(bill.customerName);
    if (registeredNk.has(nk)) continue;
    if (!orphanBillsByNk.has(nk)) orphanBillsByNk.set(nk, []);
    orphanBillsByNk.get(nk).push(bill);
  }

  for (const [nk, obills] of orphanBillsByNk) {
    let paySum = 0;
    for (const p of payments) {
      if (normalizeCustomerName(p.customerName) === nk) paySum += paymentCreditToCustomer(p);
    }
    const sortedBills = [...obills].sort((a, b) => {
      const cmp = String(a.date).localeCompare(String(b.date));
      if (cmp !== 0) return cmp;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
    let remainingCredit = paySum;
    for (const bill of sortedBills) {
      const total = toNonNegMoney(bill.totalAmount);
      const paidTowardBill = Math.min(total, remainingCredit);
      remainingCredit -= paidTowardBill;
      const remaining = Math.round((total - paidTowardBill) * 100) / 100;
      const due = addDaysToYmd(bill.date, BILL_SETTLEMENT_DAYS);
      if (remaining > 0) {
        const name = String(bill.customerName ?? '').trim() || 'Unknown';
        pushIfMatch({
          id: bill.id,
          customerName: name,
          billDate: bill.date,
          dueDate: due,
          daysFromBillDate: daysFromDueToToday(bill.date, todayYmd),
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

/** Overdue credit bills (same rules as `/api/overdue-bills`). */
function collectOverdueBillRows(customers, bills, payments, overdueDates = {}) {
  return collectUnpaidBillRows(customers, bills, payments, overdueDates, { overdueOnly: true }).sort(
    (a, b) => {
      if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      return b.outstandingAmount - a.outstandingAmount;
    },
  );
}

/** All unpaid credit bills (pending), including those not yet overdue. */
function collectPendingBillRows(customers, bills, payments, overdueDates = {}) {
  return collectUnpaidBillRows(customers, bills, payments, overdueDates, { overdueOnly: false });
}

/** Longest days past due → UI priority tier (green → red). */
function overduePriorityFromMaxDays(maxDays) {
  if (!maxDays || maxDays <= 0) return 'none';
  if (maxDays <= 7) return 'low';
  if (maxDays <= 14) return 'moderate';
  if (maxDays <= 30) return 'high';
  return 'critical';
}

/** Daily cash in (customer payments) vs cash out (load/stock purchases) */
app.get('/api/cash-flow', async (req, res) => {
  try {
    const n = Math.min(90, Math.max(1, parseInt(String(req.query.days), 10) || 7));
    const dayKeys = lastNDaysYmdLocal(n);
    const daySet = new Set(dayKeys);
    const [payments, stocks] = await Promise.all([readPayments(), readStocks()]);

    const inByDate = Object.fromEntries(dayKeys.map((d) => [d, 0]));
    const outByDate = Object.fromEntries(dayKeys.map((d) => [d, 0]));

    for (const p of payments) {
      const d = String(p.date ?? '').slice(0, 10);
      if (!daySet.has(d)) continue;
      inByDate[d] += paymentCreditToCustomer(p);
    }
    for (const s of stocks) {
      const d = String(s.date ?? '').slice(0, 10);
      if (!daySet.has(d)) continue;
      outByDate[d] += toNonNegMoney(s.totalAmount);
    }

    const round2 = (x) => Math.round(Number(x) * 100) / 100;
    const series = dayKeys.map((date) => ({
      date,
      label: date.slice(5).replace('-', '/'),
      cashIn: round2(inByDate[date]),
      cashOut: round2(outByDate[date]),
    }));
    res.json(series);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load cash flow' });
  }
});

/** Daily bag totals from credit bills (Tokyo / Samudra / Atlas / Nippon) */
app.get('/api/bag-sales-by-day', async (req, res) => {
  try {
    const n = Math.min(90, Math.max(1, parseInt(String(req.query.days), 10) || 7));
    const dayKeys = lastNDaysYmdLocal(n);
    const daySet = new Set(dayKeys);
    const bills = await readBills();
    const byDay = Object.fromEntries(
      dayKeys.map((d) => [d, { tokyo: 0, samudra: 0, atlas: 0, nippon: 0 }]),
    );
    for (const b of bills) {
      const d = String(b.date ?? '').slice(0, 10);
      if (!daySet.has(d)) continue;
      byDay[d].tokyo += toNonNegNumber(b.tokyoBags);
      byDay[d].samudra += toNonNegNumber(b.samudraBags);
      byDay[d].atlas += toNonNegNumber(b.atlasBags);
      byDay[d].nippon += toNonNegNumber(b.nipponBags);
    }
    const series = dayKeys.map((date) => ({
      date,
      label: date.slice(5).replace('-', '/'),
      ...byDay[date],
    }));
    res.json(series);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load bag sales by day' });
  }
});

/** Latest customer payments (cash in) and stock load purchases (cash out), merged by time */
app.get('/api/recent-transfers', async (req, res) => {
  try {
    const limit = Math.min(20, Math.max(1, parseInt(String(req.query.limit), 10) || 5));
    const [payments, stocks] = await Promise.all([readPayments(), readStocks()]);
    const rows = [];

    for (const p of payments) {
      const id = String(p.id ?? '').trim();
      const at = p.createdAt || `${String(p.date ?? '').slice(0, 10)}T12:00:00`;
      const title = String(p.customerName ?? '').trim() || 'Customer payment';
      const billNum = String(p.billNumber ?? '').trim();
      rows.push({
        id: id ? `payment-${id}` : `payment-${at}-${billNum}-${paymentCreditToCustomer(p)}`,
        kind: 'payment_in',
        at,
        title,
        subtitle: billNum ? `Bill #${billNum} · Payment in` : 'Payment in',
        amount: paymentCreditToCustomer(p),
      });
    }

    for (const s of stocks) {
      const id = String(s.id ?? '').trim();
      const at = s.createdAt || `${String(s.date ?? '').slice(0, 10)}T12:00:00`;
      const stockId = String(s.stockId ?? '').trim();
      const veh = String(s.vehicleNumber ?? '').trim();
      rows.push({
        id: id ? `stock-${id}` : `stock-${at}-${stockId}`,
        kind: 'stock_purchase',
        at,
        title: stockId ? `Load ${stockId}` : 'Stock purchase',
        subtitle: veh ? `${veh} · Paid for stock` : 'Paid for stock',
        amount: toNonNegMoney(s.totalAmount),
      });
    }

    rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    res.json(rows.slice(0, limit));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load recent transfers' });
  }
});

/**
 * Bills that are still unpaid past the settlement window (bill date + per-customer overdue days, default 14 local).
 * Payments apply to `pastBill` first, then to bills in chronological order (same idea as balances).
 */
app.get('/api/overdue-bills', async (req, res) => {
  try {
    const [customers, bills, payments, overdueDates] = await Promise.all([
      readCustomers(),
      readBills(),
      readPayments(),
      readOverdueDates(),
    ]);
    res.json(collectOverdueBillRows(customers, bills, payments, overdueDates));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load overdue bills' });
  }
});

/**
 * All unpaid credit bills (pending), including bills not yet past the settlement window.
 * Same payment allocation as `/api/overdue-bills`.
 */
app.get('/api/pending-bills', async (req, res) => {
  try {
    const [customers, bills, payments, overdueDates] = await Promise.all([
      readCustomers(),
      readBills(),
      readPayments(),
      readOverdueDates(),
    ]);
    res.json(collectPendingBillRows(customers, bills, payments, overdueDates));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load pending bills' });
  }
});

app.post('/api/login', async (req, res) => {
  const expectedUser = (process.env.ADMIN_USERNAME || '').trim();
  const expectedPass = (process.env.ADMIN_PASSWORD || '').trim();
  if (!expectedUser || !expectedPass) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }
  const body = req.body || {};
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '').trim();
  try {
    if (username === expectedUser && password === expectedPass) {
      return res.json({
        ok: true,
        role: 'admin',
        token: signToken(expectedUser, 'admin'),
        username: expectedUser,
      });
    }
    if (await verifyStoredUser(username, password)) {
      const u = await findUserByUsername(username);
      if (!u) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }
      return res.json({
        ok: true,
        role: 'staff',
        token: signToken(u.username, 'staff'),
        username: u.username,
      });
    }
    return res.status(401).json({ error: 'Invalid username or password' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/users', async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  try {
    const users = await readUsers();
    res.json(users.map(toPublicUser));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read users' });
  }
});

app.post('/api/users', async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  try {
    const body = req.body || {};
    const username = String(body.username ?? '').trim();
    const password = String(body.password ?? '').trim();
    const result = await createUser({
      username,
      password,
      createdBy: admin.username,
    });
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    res.status(201).json(result.user);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  try {
    const result = await deleteUserById(req.params.id);
    if (!result.ok) {
      return res.status(result.error === 'User not found' ? 404 : 400).json({ error: result.error });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

app.get('/api/customers', async (req, res) => {
  try {
    const customers = await readCustomers();
    const [bills, payments, overdueDates] = await Promise.all([
      readBills(),
      readPayments(),
      readOverdueDates(),
    ]);
    const enriched = customers.map((c) => enrichCustomerBalance(c, bills, payments, overdueDates));
    const sorted = [...enriched].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), undefined, {
        sensitivity: 'base',
      }),
    );
    res.json(sorted);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read customers' });
  }
});

app.get('/api/customers/:id/transactions', async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    const customers = await readCustomers();
    const cust = customers.find((c) => c.id === id);
    if (!cust) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    const nameKey = normalizeCustomerName(cust.name);

    const [bills, payments, overdueDates] = await Promise.all([
      readBills(),
      readPayments(),
      readOverdueDates(),
    ]);
    const transactions = [];

    const openingDetails = [
      'Past bill owed on account',
      cust.addedBy ? `added by ${cust.addedBy}` : null,
      cust.pastBillUpdatedAt
        ? `balance updated ${String(cust.pastBillUpdatedAt).slice(0, 10)}${
            cust.pastBillUpdatedBy ? ` by ${cust.pastBillUpdatedBy}` : ''
          }`
        : null,
    ]
      .filter(Boolean)
      .join(' · ');
    transactions.push({
      kind: 'opening',
      id: `${cust.id}-opening`,
      date: cust.createdAt ? String(cust.createdAt).slice(0, 10) : cust.dueDate,
      sortAt: cust.createdAt || `${cust.dueDate}T12:00:00`,
      type: 'Credit (opening balance)',
      details: openingDetails,
      amount: Number(cust.pastBill) || 0,
      direction: 'charge',
    });

    for (const b of bills) {
      if (normalizeCustomerName(b.customerName) !== nameKey) continue;
      transactions.push({
        kind: 'bill',
        id: b.id,
        date: b.date,
        sortAt: b.createdAt || `${b.date}T12:00:00`,
        type: 'Credit sale',
        details: [b.stockId, b.enteredBy ? `by ${b.enteredBy}` : ''].filter(Boolean).join(' · '),
        amount: Number(b.totalAmount) || 0,
        direction: 'charge',
      });
    }

    for (const p of payments) {
      if (p.customerId !== cust.id) continue;
      transactions.push({
        kind: 'payment',
        id: p.id,
        date: p.date,
        sortAt: p.createdAt || `${p.date}T12:00:00`,
        type: 'Payment',
        details: [
          paymentSettlementSummary(p),
          p.billNumber ? `Bill #${p.billNumber}` : null,
          p.note,
          p.recordedBy ? `by ${p.recordedBy}` : '',
        ]
          .filter(Boolean)
          .join(' · ') || '—',
        amount: paymentCreditToCustomer(p),
        direction: 'credit',
      });
    }

    transactions.sort((a, b) => {
      const dateCmp = String(b.date || '').localeCompare(String(a.date || ''));
      if (dateCmp !== 0) return dateCmp;
      return new Date(b.sortAt).getTime() - new Date(a.sortAt).getTime();
    });

    res.json({
      customer: enrichCustomerBalance(cust, bills, payments, overdueDates),
      transactions,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load transactions' });
  }
});

app.post('/api/customers', async (req, res) => {
  try {
    const body = req.body || {};
    const addedBy = String(body.addedBy ?? '').trim();
    if (!addedBy) {
      return res.status(400).json({ error: 'addedBy (username) is required' });
    }

    const name = String(body.name ?? '').trim();
    const location = String(body.location ?? '').trim();
    const contactNumber = String(body.contactNumber ?? '').trim();
    const email = String(body.email ?? '').trim();
    if (!name || !location || !contactNumber) {
      return res.status(400).json({ error: 'name, location, and contactNumber are required' });
    }

    const pastBill = toNonNegMoney(body.pastBill);
    let dueDate = String(body.dueDate ?? '').trim();
    if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      dueDate = defaultDueDateYmd();
    }

    const row = {
      id: `cust-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      name,
      location,
      contactNumber,
      ...(email ? { email } : {}),
      pastBill,
      remainingAmount: pastBill,
      dueDate,
      addedBy,
      createdAt: new Date().toISOString(),
    };

    const customers = await readCustomers();
    customers.push(row);
    await writeCustomers(customers);
    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save customer' });
  }
});

app.patch('/api/customers/:id', async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    const body = req.body || {};
    const updatedBy = String(body.updatedBy ?? '').trim();
    if (!updatedBy) {
      return res.status(400).json({ error: 'updatedBy (username) is required' });
    }

    const hasName = body.name !== undefined;
    const hasLocation = body.location !== undefined;
    const hasContact = body.contactNumber !== undefined;
    const hasEmail = body.email !== undefined;
    const hasDueDate = body.dueDate !== undefined;
    const hasPastBill = body.pastBill !== undefined;
    const hasOverdueDays = body.overdueDays !== undefined;
    if (!hasName && !hasLocation && !hasContact && !hasEmail && !hasDueDate && !hasPastBill && !hasOverdueDays) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const customers = await readCustomers();
    const idx = customers.findIndex((c) => c.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const cust = customers[idx];
    const oldNameKey = normalizeCustomerName(cust.name);
    let nameChanged = false;

    if (hasName) {
      const name = String(body.name ?? '').trim();
      if (!name) return res.status(400).json({ error: 'name cannot be empty' });
      if (normalizeCustomerName(name) !== oldNameKey) {
        nameChanged = true;
        cust.name = name;
      }
    }
    if (hasLocation) {
      const location = String(body.location ?? '').trim();
      if (!location) return res.status(400).json({ error: 'location cannot be empty' });
      cust.location = location;
    }
    if (hasContact) {
      const contactNumber = String(body.contactNumber ?? '').trim();
      if (!contactNumber) {
        return res.status(400).json({ error: 'contactNumber cannot be empty' });
      }
      cust.contactNumber = contactNumber;
    }
    if (hasEmail) {
      const email = String(body.email ?? '').trim();
      if (email) {
        cust.email = email;
      } else {
        delete cust.email;
      }
    }
    if (hasDueDate) {
      const dueDate = String(body.dueDate ?? '').trim();
      if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
        return res.status(400).json({ error: 'dueDate must be YYYY-MM-DD' });
      }
      cust.dueDate = dueDate;
    }
    if (hasPastBill) {
      const nextPastBill = toNonNegMoney(body.pastBill);
      if (nextPastBill !== toNonNegMoney(cust.pastBill)) {
        cust.pastBill = nextPastBill;
        cust.pastBillUpdatedAt = new Date().toISOString();
        cust.pastBillUpdatedBy = updatedBy;
      }
    }

    let overdueDates = await readOverdueDates();
    if (hasOverdueDays) {
      const nextOverdueDays = normalizeOverdueDays(body.overdueDays);
      if (nextOverdueDays == null) {
        return res.status(400).json({
          error: `overdueDays must be an integer from 1 to 365 (default ${DEFAULT_OVERDUE_DAYS})`,
        });
      }
      overdueDates = await setCustomerOverdueDays(id, nextOverdueDays);
    }

    cust.updatedAt = new Date().toISOString();
    cust.updatedBy = updatedBy;

    let bills = await readBills();
    let payments = await readPayments();
    let billsDirty = false;
    let paymentsDirty = false;
    let promosDirty = false;

    if (nameChanged) {
      const newName = cust.name;
      for (const b of bills) {
        if (normalizeCustomerName(b.customerName) === oldNameKey) {
          b.customerName = newName;
          billsDirty = true;
        }
      }
      for (const p of payments) {
        if (p.customerId === cust.id) {
          p.customerName = newName;
          paymentsDirty = true;
        }
      }
      const promos = await readPromotions();
      for (const pr of promos) {
        if (pr.customerId === cust.id) {
          pr.customerName = newName;
          promosDirty = true;
        }
      }
      if (promosDirty) await writePromotions(promos);
    }

    if (billsDirty) await writeBills(bills);
    if (paymentsDirty) await writePayments(payments);

    cust.remainingAmount = computeRemainingAmount(cust, bills, payments);
    customers[idx] = cust;
    await writeCustomers(customers);

    res.json(enrichCustomerBalance(cust, bills, payments, overdueDates));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

app.get('/api/payments', async (req, res) => {
  try {
    const payments = await readPayments();
    const sorted = [...payments].sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
    res.json(sorted);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read payments' });
  }
});

app.post('/api/payments', async (req, res) => {
  try {
    const body = req.body || {};
    const recordedBy = String(body.recordedBy ?? '').trim();
    if (!recordedBy) {
      return res.status(400).json({ error: 'recordedBy (username) is required' });
    }
    const customerId = String(body.customerId ?? '').trim();
    if (!customerId) {
      return res.status(400).json({ error: 'customerId is required' });
    }

    let cashAmount = toNonNegMoney(body.cashAmount ?? 0);
    const parsedCheques = parseChequesFromBody(body);
    if (parsedCheques.error) {
      return res.status(400).json({ error: parsedCheques.error });
    }
    let chequeAmount = sumChequeAmounts(
      parsedCheques.cheques.map((c) => ({ amount: c.amount })),
    );
    if (cashAmount === 0 && chequeAmount === 0 && body.amount != null) {
      cashAmount = toNonNegMoney(body.amount);
    }
    const amount = Math.round((cashAmount + chequeAmount) * 100) / 100;
    if (amount <= 0) {
      return res.status(400).json({ error: 'Enter a cash amount and/or cheque amount so the total is greater than 0.' });
    }

    let date = String(body.date ?? '').trim();
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      date = paymentDateDefaultYmd();
    }
    const note = String(body.note ?? '').trim();

    const billNumber = normalizePaymentBillNumber(body.billNumber);
    if (!billNumber) {
      return res.status(400).json({
        error: 'billNumber is required (1–3 digits, stored as 001–999)',
      });
    }

    const customers = await readCustomers();
    const cust = customers.find((c) => c.id === customerId);
    if (!cust) {
      return res.status(400).json({ error: 'Customer not found' });
    }

    const payments = await readPayments();
    if (isPaymentBillNumberTaken(payments, billNumber)) {
      return res.status(400).json({ error: 'This bill number is already used for another payment.' });
    }

    const storedCheques = buildChequesForStorage(parsedCheques.cheques);
    const row = {
      id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      date,
      customerId: cust.id,
      customerName: cust.name,
      billNumber,
      amount,
      cashAmount,
      note,
      recordedBy,
      createdAt: new Date().toISOString(),
    };
    if (storedCheques.length > 0) {
      row.cheques = storedCheques;
    }
    applyLegacyChequeFields(row, storedCheques);

    payments.push(row);
    const billsList = await readBills();
    cust.remainingAmount = computeRemainingAmount(cust, billsList, payments);
    await writeCustomers(customers);
    await writePayments(payments);
    if (cust.email) {
      notifyPaymentEmail(cust, row, cust.remainingAmount).catch((err) =>
        console.error('payment email notification', err),
      );
    }
    if (cust.contactNumber) {
      notifyPaymentWhatsApp(cust, row, cust.remainingAmount).catch((err) =>
        console.error('payment whatsapp notification', err),
      );
    }
    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save payment' });
  }
});

app.patch('/api/payments/:id', async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    if (!id) {
      return res.status(400).json({ error: 'Payment id is required' });
    }
    const body = req.body || {};
    const updatedBy = String(body.updatedBy ?? body.recordedBy ?? '').trim();
    if (!updatedBy) {
      return res.status(400).json({ error: 'updatedBy (username) is required' });
    }
    const customerId = String(body.customerId ?? '').trim();
    if (!customerId) {
      return res.status(400).json({ error: 'customerId is required' });
    }

    let cashAmount = toNonNegMoney(body.cashAmount ?? 0);
    const parsedCheques = parseChequesFromBody(body);
    if (parsedCheques.error) {
      return res.status(400).json({ error: parsedCheques.error });
    }
    let chequeAmount = sumChequeAmounts(
      parsedCheques.cheques.map((c) => ({ amount: c.amount })),
    );
    if (cashAmount === 0 && chequeAmount === 0 && body.amount != null) {
      cashAmount = toNonNegMoney(body.amount);
    }
    const amount = Math.round((cashAmount + chequeAmount) * 100) / 100;
    if (amount <= 0) {
      return res.status(400).json({ error: 'Enter a cash amount and/or cheque amount so the total is greater than 0.' });
    }

    let date = String(body.date ?? '').trim();
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const note = String(body.note ?? '').trim();

    const billNumber = normalizePaymentBillNumber(body.billNumber);
    if (!billNumber) {
      return res.status(400).json({
        error: 'billNumber is required (1–3 digits, stored as 001–999)',
      });
    }

    const customers = await readCustomers();
    const cust = customers.find((c) => c.id === customerId);
    if (!cust) {
      return res.status(400).json({ error: 'Customer not found' });
    }

    const payments = await readPayments();
    const idx = payments.findIndex((p) => p.id === id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    if (isPaymentBillNumberTaken(payments, billNumber, id)) {
      return res.status(400).json({ error: 'This bill number is already used for another payment.' });
    }

    const existing = payments[idx];
    const chequeUpdate = buildChequesForUpdate(parsedCheques.cheques, existing);
    if (chequeUpdate.error) {
      return res.status(400).json({ error: chequeUpdate.error });
    }
    const storedCheques = chequeUpdate.cheques;

    const row = {
      ...existing,
      date,
      customerId: cust.id,
      customerName: cust.name,
      billNumber,
      amount,
      cashAmount,
      note,
      updatedBy,
      updatedAt: new Date().toISOString(),
    };
    if (storedCheques.length > 0) {
      row.cheques = storedCheques;
    } else {
      delete row.cheques;
    }
    applyLegacyChequeFields(row, storedCheques);

    payments[idx] = row;
    await writePayments(payments);

    const billsList = await readBills();
    await refreshCustomerBalancesForCustomerIds(
      billsList,
      payments,
      existing.customerId,
      cust.id,
    );

    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update payment' });
  }
});

/** Cheques (by cheque date) not yet marked as deposited to the bank — default `date` is today (server local). */
app.get('/api/cheque-deposit-queue', async (req, res) => {
  try {
    const fromDate = String(req.query.date ?? '').trim() || paymentDateDefaultYmd();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
      return res.status(400).json({ error: 'Invalid date' });
    }
    const daysRaw = req.query.days != null ? Number(req.query.days) : 1;
    const days = Number.isFinite(daysRaw) && daysRaw >= 1 && daysRaw <= 31 ? Math.floor(daysRaw) : 1;
    const throughDate = addDaysToYmd(fromDate, days - 1);
    if (!throughDate) {
      return res.status(400).json({ error: 'Invalid date range' });
    }
    const payments = await readPayments();
    const items = [];
    for (const p of payments) {
      for (const cheque of getPaymentCheques(p)) {
        if (cheque.chequeDeposited) continue;
        const cd = String(cheque.chequeDate ?? '').slice(0, 10);
        if (!cd || cd < fromDate || cd > throughDate) continue;
        items.push(chequeDepositQueueItem(p, cheque));
      }
    }
    const sorted = [...items].sort((a, b) => {
      const dateCmp = String(a.chequeDate || '').localeCompare(String(b.chequeDate || ''));
      if (dateCmp !== 0) return dateCmp;
      const t = new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      if (t !== 0) return t;
      const idCmp = String(b.id).localeCompare(String(a.id));
      if (idCmp !== 0) return idCmp;
      return String(a.chequeId || '').localeCompare(String(b.chequeId || ''));
    });
    res.json({ asOfDate: fromDate, throughDate, days, items: sorted });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load cheque deposit queue' });
  }
});

app.patch('/api/payments/:id/cheque-deposited', async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    if (!id) {
      return res.status(400).json({ error: 'Payment id is required' });
    }
    const body = req.body || {};
    const recordedBy = String(body.recordedBy ?? '').trim();
    if (!recordedBy) {
      return res.status(400).json({ error: 'recordedBy (username) is required' });
    }
    const payments = await readPayments();
    const idx = payments.findIndex((p) => p.id === id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    const p = { ...payments[idx] };
    const chequeId = String(body.chequeId ?? '').trim();
    const chequeLines = getPaymentCheques(p);
    if (chequeLines.length === 0) {
      return res.status(400).json({ error: 'This payment has no cheque' });
    }

    const now = new Date().toISOString();
    if (Array.isArray(p.cheques) && p.cheques.length > 0) {
      const targetId = chequeId || (p.cheques.length === 1 ? String(p.cheques[0].id || '') : '');
      if (!targetId) {
        return res.status(400).json({ error: 'chequeId is required when a payment has multiple cheques' });
      }
      const chIdx = p.cheques.findIndex((c) => String(c.id) === targetId);
      if (chIdx < 0) {
        return res.status(404).json({ error: 'Cheque not found on this payment' });
      }
      const ch = { ...p.cheques[chIdx] };
      if (ch.chequeDeposited) {
        return res.status(400).json({ error: 'This cheque is already marked as deposited' });
      }
      ch.chequeDeposited = true;
      ch.chequeDepositedAt = now;
      ch.chequeDepositedBy = recordedBy;
      p.cheques = [...p.cheques];
      p.cheques[chIdx] = ch;
      applyLegacyChequeFields(p, getPaymentCheques(p));
    } else {
      if (p.chequeDeposited) {
        return res.status(400).json({ error: 'This cheque is already marked as deposited' });
      }
      p.chequeDeposited = true;
      p.chequeDepositedAt = now;
      p.chequeDepositedBy = recordedBy;
    }
    payments[idx] = p;
    await writePayments(payments);
    res.json(p);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update payment' });
  }
});

/** Free-bag promotions: stored in promotions.json; reduces live stock / daily ledger “out” (no customer balance or cash). */
app.get('/api/promotions', async (req, res) => {
  try {
    const rows = await readPromotions();
    const sorted = [...rows].sort((a, b) => {
      const da = String(a.date || '');
      const db = String(b.date || '');
      if (da !== db) return db.localeCompare(da);
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
    res.json(sorted);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read promotions' });
  }
});

app.post('/api/promotions', async (req, res) => {
  try {
    const body = req.body || {};
    const enteredBy = String(body.enteredBy ?? '').trim();
    if (!enteredBy) {
      return res.status(400).json({ error: 'enteredBy (username) is required' });
    }
    const customerId = String(body.customerId ?? '').trim();
    if (!customerId) {
      return res.status(400).json({ error: 'customerId is required' });
    }

    let date = String(body.date ?? '').trim();
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    const reason = String(body.reason ?? '').trim();
    if (!reason) {
      return res.status(400).json({ error: 'reason is required' });
    }

    let billNumber = '';
    if (body.billNumber != null && String(body.billNumber).trim() !== '') {
      const norm = normalizePaymentBillNumber(body.billNumber);
      if (!norm) {
        return res.status(400).json({ error: 'billNumber must be 1–3 digits when provided' });
      }
      billNumber = norm;
    }

    const tokyoBags = toNonNegNumber(body.tokyoBags);
    const samudraBags = toNonNegNumber(body.samudraBags);
    const atlasBags = toNonNegNumber(body.atlasBags);
    const nipponBags = toNonNegNumber(body.nipponBags);
    const bagSum = tokyoBags + samudraBags + atlasBags + nipponBags;
    if (bagSum <= 0) {
      return res.status(400).json({ error: 'Enter at least one free bag (any brand).' });
    }

    const customers = await readCustomers();
    const cust = customers.find((c) => c.id === customerId);
    if (!cust) {
      return res.status(400).json({ error: 'Customer not found' });
    }

    const row = {
      id: `promo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      date,
      customerId: cust.id,
      customerName: cust.name,
      billNumber,
      reason,
      tokyoBags,
      samudraBags,
      atlasBags,
      nipponBags,
      enteredBy,
      createdAt: new Date().toISOString(),
    };

    const promos = await readPromotions();
    promos.push(row);
    await writePromotions(promos);
    try {
      await refreshLiveStockFromSources();
    } catch (err) {
      console.error('liveStock refresh after promotion', err);
    }
    if (cust.email) {
      notifyPromotionEmail(cust, row).catch((err) =>
        console.error('promotion email notification', err),
      );
    }
    if (cust.contactNumber) {
      notifyPromotionWhatsApp(cust, row).catch((err) =>
        console.error('promotion whatsapp notification', err),
      );
    }
    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save promotion' });
  }
});

app.patch('/api/promotions/:id', async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    if (!id) {
      return res.status(400).json({ error: 'Promotion id is required' });
    }
    const body = req.body || {};
    const updatedBy = String(body.updatedBy ?? body.enteredBy ?? '').trim();
    if (!updatedBy) {
      return res.status(400).json({ error: 'updatedBy (username) is required' });
    }
    const customerId = String(body.customerId ?? '').trim();
    if (!customerId) {
      return res.status(400).json({ error: 'customerId is required' });
    }

    let date = String(body.date ?? '').trim();
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    const reason = String(body.reason ?? '').trim();
    if (!reason) {
      return res.status(400).json({ error: 'reason is required' });
    }

    let billNumber = '';
    if (body.billNumber != null && String(body.billNumber).trim() !== '') {
      const norm = normalizePaymentBillNumber(body.billNumber);
      if (!norm) {
        return res.status(400).json({ error: 'billNumber must be 1–3 digits when provided' });
      }
      billNumber = norm;
    }

    const tokyoBags = toNonNegNumber(body.tokyoBags);
    const samudraBags = toNonNegNumber(body.samudraBags);
    const atlasBags = toNonNegNumber(body.atlasBags);
    const nipponBags = toNonNegNumber(body.nipponBags);
    const bagSum = tokyoBags + samudraBags + atlasBags + nipponBags;
    if (bagSum <= 0) {
      return res.status(400).json({ error: 'Enter at least one free bag (any brand).' });
    }

    const customers = await readCustomers();
    const cust = customers.find((c) => c.id === customerId);
    if (!cust) {
      return res.status(400).json({ error: 'Customer not found' });
    }

    const promos = await readPromotions();
    const idx = promos.findIndex((p) => p.id === id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Promotion not found' });
    }

    const existing = promos[idx];
    const row = {
      ...existing,
      date,
      customerId: cust.id,
      customerName: cust.name,
      billNumber,
      reason,
      tokyoBags,
      samudraBags,
      atlasBags,
      nipponBags,
      updatedBy,
      updatedAt: new Date().toISOString(),
    };

    promos[idx] = row;
    await writePromotions(promos);
    try {
      await refreshLiveStockFromSources();
    } catch (err) {
      console.error('liveStock refresh after promotion update', err);
    }
    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update promotion' });
  }
});

app.delete('/api/promotions/:id', async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    if (!id) {
      return res.status(400).json({ error: 'Promotion id is required' });
    }
    const promos = await readPromotions();
    const idx = promos.findIndex((p) => p.id === id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Promotion not found' });
    }
    promos.splice(idx, 1);
    await writePromotions(promos);
    try {
      await refreshLiveStockFromSources();
    } catch (err) {
      console.error('liveStock refresh after promotion delete', err);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete promotion' });
  }
});

app.get('/api/activity', async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit), 10) || 5));
    const [loads, bills, customers, payments] = await Promise.all([
      readStocks(),
      readBills(),
      readCustomers(),
      readPayments(),
    ]);

    const items = [];

    for (const r of loads) {
      items.push({
        kind: 'load',
        id: r.id,
        at: r.createdAt || `${r.date}T12:00:00`,
        title: r.stockId || 'Stock load',
        subtitle: [r.vehicleNumber, r.date, r.addedBy].filter(Boolean).join(' · '),
        amount: Number(r.totalAmount) || 0,
      });
    }
    for (const r of bills) {
      items.push({
        kind: 'bill',
        id: r.id,
        at: r.createdAt || `${r.date}T12:00:00`,
        title: `Bill · ${r.customerName || 'Customer'}`,
        subtitle: [r.stockId, r.date, r.enteredBy].filter(Boolean).join(' · '),
        amount: Number(r.totalAmount) || 0,
      });
    }
    for (const r of customers) {
      items.push({
        kind: 'customer',
        id: r.id,
        at: r.createdAt || `${r.dueDate}T12:00:00`,
        title: `Customer · ${r.name}`,
        subtitle: [r.location, r.addedBy].filter(Boolean).join(' · '),
        amount: Number(r.pastBill) || 0,
      });
    }
    for (const r of payments) {
      items.push({
        kind: 'payment',
        id: r.id,
        at: r.createdAt || `${r.date}T12:00:00`,
        title: `Payment · ${r.customerName}`,
        subtitle: [r.billNumber ? `#${r.billNumber}` : null, r.date, r.recordedBy, r.note]
          .filter(Boolean)
          .join(' · '),
        amount: paymentCreditToCustomer(r),
      });
    }

    items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    res.json(items.slice(0, limit));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load activity' });
  }
});

app.get('/api/bills', async (req, res) => {
  try {
    const bills = await readBills();
    const sorted = [...bills].sort((a, b) => {
      const da = String(a.date || '');
      const db = String(b.date || '');
      if (da !== db) return db.localeCompare(da);
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
    res.json(sorted);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read bills' });
  }
});

app.post('/api/bills', async (req, res) => {
  try {
    const body = req.body || {};
    const enteredBy = String(body.enteredBy ?? body.addedBy ?? '').trim();
    if (!enteredBy) {
      return res.status(400).json({ error: 'enteredBy (username) is required' });
    }

    const date = String(body.date ?? '').trim();
    const customerName = String(body.customerName ?? '').trim();
    if (!date || !customerName) {
      return res.status(400).json({ error: 'date and customerName are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    const fields = parseBillBagFields(body);
    const stockId = '';

    const row = {
      id: `bill-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      date,
      customerName,
      stockId,
      ...fields,
      enteredBy,
      createdAt: new Date().toISOString(),
    };

    const stocks = await readStocks();
    const bills = await readBills();
    const promotions = await readPromotions();
    const check = validateBillAgainstPooledStock(stocks, bills, promotions, {
      tokyoBags: fields.tokyoBags,
      samudraBags: fields.samudraBags,
      atlasBags: fields.atlasBags,
      nipponBags: fields.nipponBags,
    });
    if (!check.ok) {
      return res.status(400).json({ error: check.error });
    }

    bills.push(row);
    await writeBills(bills);

    const paymentsList = await readPayments();
    await refreshCustomerBalancesForBillNames(bills, paymentsList, customerName);

    try {
      await refreshLiveStockFromSources();
    } catch (err) {
      console.error('liveStock refresh after bill', err);
    }

    const customersForEmail = await readCustomers();
    const custForEmail = customersForEmail.find(
      (c) => normalizeCustomerName(c.name) === normalizeCustomerName(customerName),
    );
    if (custForEmail?.email) {
      notifyBillEmail(custForEmail, row, custForEmail.remainingAmount).catch((err) =>
        console.error('bill email notification', err),
      );
    }
    if (custForEmail?.contactNumber) {
      notifyBillWhatsApp(custForEmail, row, custForEmail.remainingAmount).catch((err) =>
        console.error('bill whatsapp notification', err),
      );
    }

    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save bill' });
  }
});

app.patch('/api/bills/:id', async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    if (!id) {
      return res.status(400).json({ error: 'Bill id is required' });
    }
    const body = req.body || {};
    const updatedBy = String(body.updatedBy ?? body.enteredBy ?? '').trim();
    if (!updatedBy) {
      return res.status(400).json({ error: 'updatedBy (username) is required' });
    }

    const date = String(body.date ?? '').trim();
    const customerName = String(body.customerName ?? '').trim();
    if (!date || !customerName) {
      return res.status(400).json({ error: 'date and customerName are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    const bills = await readBills();
    const idx = bills.findIndex((b) => b.id === id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    const existing = bills[idx];
    const fields = parseBillBagFields(body);
    const stocks = await readStocks();
    const promotions = await readPromotions();
    const otherBills = bills.filter((b) => b.id !== id);
    const check = validateBillAgainstPooledStock(stocks, otherBills, promotions, {
      tokyoBags: fields.tokyoBags,
      samudraBags: fields.samudraBags,
      atlasBags: fields.atlasBags,
      nipponBags: fields.nipponBags,
    });
    if (!check.ok) {
      return res.status(400).json({ error: check.error });
    }

    const row = {
      ...existing,
      date,
      customerName,
      ...fields,
      updatedBy,
      updatedAt: new Date().toISOString(),
    };
    bills[idx] = row;
    await writeBills(bills);

    const paymentsList = await readPayments();
    await refreshCustomerBalancesForBillNames(
      bills,
      paymentsList,
      existing.customerName,
      customerName,
    );

    try {
      await refreshLiveStockFromSources();
    } catch (err) {
      console.error('liveStock refresh after bill update', err);
    }

    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update bill' });
  }
});

app.get('/api/stocks', async (req, res) => {
  try {
    const stocks = await readStocks();
    res.json(stocks);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read stocks' });
  }
});

app.get('/api/daily-stock', async (req, res) => {
  try {
    const payload = await getLiveDailyLedgerPayload();
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load daily stock' });
  }
});

app.get('/api/stocks/summary', async (req, res) => {
  try {
    const payload = await getLiveStockSummary();
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to summarize stock' });
  }
});

app.post('/api/stocks', async (req, res) => {
  try {
    const body = req.body || {};
    const addedBy = String(body.addedBy ?? '').trim();
    if (!addedBy) {
      return res.status(400).json({ error: 'addedBy (username) is required' });
    }

    const date = String(body.date ?? '').trim();
    const stockId = String(body.stockId ?? '').trim();
    const vehicleNumber = String(body.vehicleNumber ?? '').trim();
    if (!date || !stockId || !vehicleNumber) {
      return res.status(400).json({ error: 'date, stockId, and vehicleNumber are required' });
    }

    const trimStr = (v) => String(v ?? '').trim();
    const cutOffNumberOrUndef = (v) => {
      const s = String(v ?? '').trim();
      if (!s) return undefined;
      const n = Number(s);
      if (!Number.isFinite(n) || n < 0) return undefined;
      return toNonNegNumber(n);
    };
    const row = {
      id: `load-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      date,
      stockId,
      vehicleNumber,
      tokyoBags: toNonNegNumber(body.tokyoBags),
      tokyoCost: toNonNegNumber(body.tokyoCost),
      tokyoCutOffPrice: cutOffNumberOrUndef(body.tokyoCutOffPrice),
      tokyoInvoice: trimStr(body.tokyoInvoice),
      tokyoCheque: trimStr(body.tokyoCheque),
      tokyoConvertingDate: trimStr(body.tokyoConvertingDate).slice(0, 10),
      samudraBags: toNonNegNumber(body.samudraBags),
      samudraCost: toNonNegNumber(body.samudraCost),
      samudraCutOffPrice: cutOffNumberOrUndef(body.samudraCutOffPrice),
      samudraInvoice: trimStr(body.samudraInvoice),
      samudraCheque: trimStr(body.samudraCheque),
      samudraConvertingDate: trimStr(body.samudraConvertingDate).slice(0, 10),
      atlasBags: toNonNegNumber(body.atlasBags),
      atlasCost: toNonNegNumber(body.atlasCost),
      atlasCutOffPrice: cutOffNumberOrUndef(body.atlasCutOffPrice),
      atlasInvoice: trimStr(body.atlasInvoice),
      atlasCheque: trimStr(body.atlasCheque),
      atlasConvertingDate: trimStr(body.atlasConvertingDate).slice(0, 10),
      nipponBags: toNonNegNumber(body.nipponBags),
      nipponCost: toNonNegNumber(body.nipponCost),
      nipponCutOffPrice: cutOffNumberOrUndef(body.nipponCutOffPrice),
      nipponInvoice: trimStr(body.nipponInvoice),
      nipponCheque: trimStr(body.nipponCheque),
      nipponConvertingDate: trimStr(body.nipponConvertingDate).slice(0, 10),
      transportCostPerBag: toNonNegNumber(body.transportCostPerBag),
      marginPerBag:
        body.marginPerBag === '' || body.marginPerBag == null
          ? 70
          : toNonNegNumber(body.marginPerBag),
      addedBy,
      createdAt: new Date().toISOString(),
    };

    row.totalAmount =
      row.tokyoCost + row.samudraCost + row.atlasCost + row.nipponCost;

    const stockBrandsRequireRefs = [
      ['tokyo', 'Tokyo'],
      ['samudra', 'Samudra'],
      ['atlas', 'Atlas'],
      ['nippon', 'Nippon'],
    ];
    const missingRefs = [];
    const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
    for (const [key, label] of stockBrandsRequireRefs) {
      if (toNonNegNumber(row[`${key}Bags`]) >= 1) {
        if (!row[`${key}Invoice`]) missingRefs.push(`${label} invoice number`);
        if (!row[`${key}Cheque`]) missingRefs.push(`${label} cheque number`);
        const convertingDate = row[`${key}ConvertingDate`];
        if (!convertingDate || !YMD_RE.test(convertingDate)) {
          row[`${key}ConvertingDate`] = date;
        }
      }
    }
    if (missingRefs.length > 0) {
      return res.status(400).json({
        error: `When bags are 1 or more for a brand, invoice and cheque are required. Missing: ${missingRefs.join(', ')}.`,
      });
    }

    const stocks = await readStocks();
    stocks.push(row);
    await writeStocks(stocks);
    try {
      await refreshLiveStockFromSources();
    } catch (err) {
      console.error('liveStock refresh after load', err);
    }
    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save stock record' });
  }
});

app.patch('/api/stocks/:id', async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    if (!id) {
      return res.status(400).json({ error: 'Stock id is required' });
    }
    const body = req.body || {};
    const updatedBy = String(body.updatedBy ?? body.addedBy ?? '').trim();
    if (!updatedBy) {
      return res.status(400).json({ error: 'updatedBy (username) is required' });
    }

    const date = String(body.date ?? '').trim();
    const stockId = String(body.stockId ?? '').trim();
    const vehicleNumber = String(body.vehicleNumber ?? '').trim();
    if (!date || !stockId || !vehicleNumber) {
      return res.status(400).json({ error: 'date, stockId, and vehicleNumber are required' });
    }

    const stocks = await readStocks();
    const idx = stocks.findIndex((s) => s.id === id);
    if (idx < 0) {
      return res.status(404).json({ error: 'Stock record not found' });
    }
    const existing = stocks[idx];

    const trimStr = (v) => String(v ?? '').trim();
    const cutOffNumberOrUndef = (v) => {
      const s = String(v ?? '').trim();
      if (!s) return undefined;
      const n = Number(s);
      if (!Number.isFinite(n) || n < 0) return undefined;
      return toNonNegNumber(n);
    };
    const row = {
      ...existing,
      date,
      stockId,
      vehicleNumber,
      tokyoBags: toNonNegNumber(body.tokyoBags),
      tokyoCost: toNonNegNumber(body.tokyoCost),
      tokyoCutOffPrice: cutOffNumberOrUndef(body.tokyoCutOffPrice),
      tokyoInvoice: trimStr(body.tokyoInvoice),
      tokyoCheque: trimStr(body.tokyoCheque),
      tokyoConvertingDate: trimStr(body.tokyoConvertingDate).slice(0, 10),
      samudraBags: toNonNegNumber(body.samudraBags),
      samudraCost: toNonNegNumber(body.samudraCost),
      samudraCutOffPrice: cutOffNumberOrUndef(body.samudraCutOffPrice),
      samudraInvoice: trimStr(body.samudraInvoice),
      samudraCheque: trimStr(body.samudraCheque),
      samudraConvertingDate: trimStr(body.samudraConvertingDate).slice(0, 10),
      atlasBags: toNonNegNumber(body.atlasBags),
      atlasCost: toNonNegNumber(body.atlasCost),
      atlasCutOffPrice: cutOffNumberOrUndef(body.atlasCutOffPrice),
      atlasInvoice: trimStr(body.atlasInvoice),
      atlasCheque: trimStr(body.atlasCheque),
      atlasConvertingDate: trimStr(body.atlasConvertingDate).slice(0, 10),
      nipponBags: toNonNegNumber(body.nipponBags),
      nipponCost: toNonNegNumber(body.nipponCost),
      nipponCutOffPrice: cutOffNumberOrUndef(body.nipponCutOffPrice),
      nipponInvoice: trimStr(body.nipponInvoice),
      nipponCheque: trimStr(body.nipponCheque),
      nipponConvertingDate: trimStr(body.nipponConvertingDate).slice(0, 10),
      transportCostPerBag: toNonNegNumber(body.transportCostPerBag),
      marginPerBag:
        body.marginPerBag === '' || body.marginPerBag == null
          ? 70
          : toNonNegNumber(body.marginPerBag),
      updatedBy,
      updatedAt: new Date().toISOString(),
    };

    row.totalAmount =
      row.tokyoCost + row.samudraCost + row.atlasCost + row.nipponCost;

    const stockBrandsRequireRefs = [
      ['tokyo', 'Tokyo'],
      ['samudra', 'Samudra'],
      ['atlas', 'Atlas'],
      ['nippon', 'Nippon'],
    ];
    const missingRefs = [];
    const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
    for (const [key, label] of stockBrandsRequireRefs) {
      if (toNonNegNumber(row[`${key}Bags`]) >= 1) {
        if (!row[`${key}Invoice`]) missingRefs.push(`${label} invoice number`);
        if (!row[`${key}Cheque`]) missingRefs.push(`${label} cheque number`);
        const convertingDate = row[`${key}ConvertingDate`];
        if (!convertingDate || !YMD_RE.test(convertingDate)) {
          row[`${key}ConvertingDate`] = date;
        }
      }
    }
    if (missingRefs.length > 0) {
      return res.status(400).json({
        error: `When bags are 1 or more for a brand, invoice and cheque are required. Missing: ${missingRefs.join(', ')}.`,
      });
    }

    stocks[idx] = row;
    await writeStocks(stocks);
    try {
      await refreshLiveStockFromSources();
    } catch (err) {
      console.error('liveStock refresh after load update', err);
    }
    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update stock record' });
  }
});

app.get('/api/messages/settings', async (req, res) => {
  try {
    const [emailConfig, whatsappConfig, companyData] = await Promise.all([
      readEmailConfig(),
      readWhatsAppConfig(),
      readCompanyData(),
    ]);
    res.json({
      emailConfig: maskEmailConfig(emailConfig),
      whatsappConfig,
      whatsappStatus: getWhatsAppStatus(),
      companyData,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load message settings' });
  }
});

app.put('/api/messages/email-config', async (req, res) => {
  try {
    const body = req.body || {};
    const current = await readEmailConfig();
    const host = body.host !== undefined ? String(body.host ?? '').trim() : current.host;
    const user = body.user !== undefined ? String(body.user ?? '').trim() : current.user;
    const from = body.from !== undefined ? String(body.from ?? '').trim() : current.from;
    const fromName = body.fromName !== undefined ? String(body.fromName ?? '').trim() : current.fromName;
    const port = body.port !== undefined ? parseInt(String(body.port), 10) : current.port;
    const secure = body.secure !== undefined ? Boolean(body.secure) : current.secure;
    const enabled = body.enabled !== undefined ? Boolean(body.enabled) : current.enabled;

    let pass = current.pass;
    if (body.pass !== undefined && String(body.pass).trim() !== '') {
      pass = String(body.pass).trim();
    }

    if (enabled && (!host || !user || !pass)) {
      return res.status(400).json({ error: 'host, user, and password are required when email is enabled' });
    }

    const next = {
      enabled,
      host,
      port: Number.isFinite(port) && port > 0 ? port : 587,
      secure,
      user,
      pass,
      from: from || user,
      fromName: fromName || SHOP_NAME,
    };
    await writeEmailConfig(next);
    res.json({ emailConfig: maskEmailConfig(next) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save email config' });
  }
});

app.put('/api/messages/company-data', async (req, res) => {
  try {
    const body = req.body || {};
    const distributor = String(body.distributor ?? '').trim();
    const company = String(body.company ?? '').trim();
    if (!distributor || !company) {
      return res.status(400).json({ error: 'distributor and company are required' });
    }
    const next = { distributor, company };
    await writeCompanyData(next);
    res.json(next);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save company data' });
  }
});

app.get('/api/messages/sent-emails', async (req, res) => {
  try {
    const emails = await readSentEmails();
    res.json(emails);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load sent emails' });
  }
});

app.get('/api/messages/whatsapp-status', async (req, res) => {
  try {
    const whatsappConfig = await readWhatsAppConfig();
    res.json({
      enabled: Boolean(whatsappConfig.enabled),
      ...getWhatsAppStatus(),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load WhatsApp status' });
  }
});

app.put('/api/messages/whatsapp-config', async (req, res) => {
  try {
    const body = req.body || {};
    const current = await readWhatsAppConfig();
    const enabled = body.enabled !== undefined ? Boolean(body.enabled) : current.enabled;
    const next = { enabled };
    await writeWhatsAppConfig(next);
    const whatsappStatus = await applyWhatsAppConfigChange(enabled);
    res.json({
      whatsappConfig: next,
      whatsappStatus,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save WhatsApp config' });
  }
});

app.get('/api/messages/sent-whatsapp', async (req, res) => {
  try {
    const messages = await readSentWhatsapp();
    res.json(messages);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load sent WhatsApp history' });
  }
});

/** CRA production build: same process serves API + static assets + client routes (see SPA fallback below). */
const FRONTEND_BUILD = path.resolve(
  process.env.FRONTEND_BUILD_DIR || path.join(__dirname, '..', 'frontend', 'build')
);
const FRONTEND_INDEX = path.join(FRONTEND_BUILD, 'index.html');

if (fs.existsSync(FRONTEND_INDEX)) {
  app.use(express.static(FRONTEND_BUILD, { index: 'index.html' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api')) return next();
    res.sendFile(FRONTEND_INDEX, (err) => {
      if (err) next(err);
    });
  });
} else {
  console.warn(
    `[server] No frontend build at ${FRONTEND_INDEX} — only API. Run: cd frontend && npm run build (or set FRONTEND_BUILD_DIR).`
  );
}

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  if (fs.existsSync(FRONTEND_INDEX)) {
    console.log(`Serving SPA from ${FRONTEND_BUILD}`);
  }
  readWhatsAppConfig()
    .then((config) => {
      if (config.enabled) {
        startWhatsAppClient().catch((err) => console.error('whatsapp startup', err));
      }
    })
    .catch((err) => console.error('whatsapp config read', err));
});
