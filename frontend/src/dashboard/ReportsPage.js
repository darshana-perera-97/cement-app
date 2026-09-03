import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import { authFetch, getDisplayName, isCollector, isManagerOrAdmin } from '../auth';
import { formatBrandLabel, getCachedBrands } from './brandTheme';
import { useBagProducts } from './BagProductsContext';
import {
  LoadingSpinner,
  MobileRowCard,
  TableFiltersBar,
  filterControl,
  filterLabel,
  filterLabelNarrow,
  inDateRange,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
} from './tableToolbar';
import { buildChequeTableRows, chequePortion } from './paymentCheques';
import { downloadDailyCollectionsReportPdf } from './dailyCollectionsReportPdf';
import { downloadCustomerOutstandingReport } from './customerOutstandingExport';
import {
  buildDailyBagsByShopBrandRows,
  downloadDailyBagsByShopReport,
} from './dailyBagsByShopExport';
import { buildShopTargetsRows } from './shopTargetsReport';
import { downloadShopTargetsPdf } from './shopTargetsPdf';
import MonthlyTargetProgressBar from './MonthlyTargetProgressBar';
import {
  buildFinancialCashInRows,
  buildFinancialConvertingChequeRows,
  buildFinancialLoadPurchaseRows,
} from './financialSummary';
import { downloadFinancialSummaryPdf } from './financialSummaryPdf';
import { downloadLoadsSummaryPdf } from './loadsSummaryPdf';
import { downloadMonthlyBillsPdf } from './monthlyBillsPdf';
import { downloadReportsPdf } from './reportsPdf';
import { downloadRefReport } from './reportsRefExport';
import { downloadStockDistributionPdf } from './stockDistributionPdf';
import {
  buildBillSettledDateLookup,
  buildSettledCollectionsRows,
  summarizeCollectionsByBucket,
  COLLECTION_DAY_BUCKETS,
} from './collectionsReport';
import { downloadCollectionsReportPdf } from './collectorCommissionPdf';

const apiBase = getApiBase();

function localYmd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function currentIsoWeekValue(d = new Date()) {
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const year = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function currentMonthValue(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthDisplayLabel(monthValue) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthValue ?? '').trim());
  if (!match) return monthValue || '—';
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  return new Date(year, month, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

function daysFromYmdToToday(fromYmd, toYmd = localYmd()) {
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

/** One row per brand line on bills in the month, with settled date from payment FIFO. */
function buildMonthlyBillRows(bills, settledByBillId, from, to) {
  const rows = [];
  for (const bill of bills) {
    if (!inDateRange(bill.date, from, to)) continue;
    const date = String(bill.date ?? '').slice(0, 10);
    const shop = String(bill.customerName ?? '').trim() || '—';
    const settledDate = bill.id ? settledByBillId.get(bill.id) || '' : '';
    const daysToSettle = settledDate ? daysFromYmdToToday(date, settledDate) : null;

    let anyBrand = false;
    for (const brand of getCachedBrands()) {
      const bagCount = Number(bill[brand.bagsField]) || 0;
      if (bagCount <= 0) continue;
      anyBrand = true;
      rows.push({
        rowKey: `${bill.id || date}-${brand.key}`,
        date,
        shop,
        bagType: formatBrandLabel(brand) || brand.label,
        brandKey: brand.key,
        bagCount,
        amount: brandLineFromBill(bill, brand.key),
        settledDate,
        daysToSettle,
      });
    }

    if (!anyBrand) {
      rows.push({
        rowKey: `${bill.id || date}-total`,
        date,
        shop,
        bagType: '—',
        brandKey: '',
        bagCount: 0,
        amount: Number(bill.totalAmount) || 0,
        settledDate,
        daysToSettle,
      });
    }
  }

  rows.sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    const byShop = a.shop.localeCompare(b.shop);
    if (byShop !== 0) return byShop;
    return a.bagType.localeCompare(b.bagType);
  });
  return rows;
}

function buildShopRowsForRange(bills, payments, customerLocationMap, from, to, brandKey = '') {
  const map = new Map();

  const ensure = (name) => {
    const key = String(name ?? '').trim() || '—';
    if (!map.has(key)) {
      const location = customerLocationMap.get(key.toLowerCase()) || '';
      const bagFields = Object.fromEntries(getCachedBrands().map((b) => [b.bagsField, 0]));
      map.set(key, {
        shop: key,
        location,
        ...bagFields,
        totalBags: 0,
        creditSales: 0,
        billCount: 0,
        cashIn: 0,
        paymentCount: 0,
      });
    }
    return map.get(key);
  };

  for (const b of bills) {
    if (!inDateRange(b.date, from, to)) continue;
    if (!recordHasBrandBags(b, brandKey)) continue;
    const row = ensure(b.customerName);
    const { byBrand, total } = bagsFromRecord(b, brandKey);
    for (const brand of getCachedBrands()) {
      row[brand.bagsField] += byBrand[brand.key] || 0;
    }
    row.totalBags += total;
    row.creditSales += brandLineFromBill(b, brandKey);
    row.billCount += 1;
  }

  for (const p of payments) {
    if (!inDateRange(p.date, from, to)) continue;
    const row = ensure(p.customerName);
    row.cashIn += paymentTotal(p);
    row.paymentCount += 1;
  }

  return [...map.values()].sort((a, b) => a.shop.localeCompare(b.shop));
}

/** ISO calendar week (Mon–Sun) from `<input type="week">` value e.g. `2026-W22`. */
function weeklyRangeFromWeekValue(weekValue) {
  const match = /^(\d{4})-W(\d{2})$/i.exec(String(weekValue ?? '').trim());
  if (!match) return weeklyRangeFromWeekValue(currentIsoWeekValue());
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(year, 0, 4);
  const jan4Day = jan4.getDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4Day + 1);
  const from = new Date(week1Monday);
  from.setDate(week1Monday.getDate() + (week - 1) * 7);
  const to = new Date(from);
  to.setDate(from.getDate() + 6);
  return { from: localYmd(from), to: localYmd(to) };
}

/** Calendar month from `<input type="month">` value e.g. `2026-06`. */
function monthlyRangeFromMonthValue(monthValue) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthValue ?? '').trim());
  if (!match) return monthlyRangeFromMonthValue(currentMonthValue());
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const from = new Date(year, month, 1);
  const to = new Date(year, month + 1, 0);
  return { from: localYmd(from), to: localYmd(to) };
}

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function formatAmountFixed2(n) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function SummaryLkrAmount({ value, valueClassName = 'text-slate-900' }) {
  return (
    <p className={`mt-1 flex items-baseline gap-1.5 font-bold tabular-nums leading-none ${valueClassName}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-75">LKR</span>
      <span className="text-xl">{formatAmountFixed2(value)}</span>
    </p>
  );
}

function bagsFromRecord(record, brandKey = '') {
  const byBrand = {};
  let total = 0;
  const brands = brandKey ? getCachedBrands().filter((b) => b.key === brandKey) : getCachedBrands();
  for (const b of brands) {
    const n = Number(record[b.bagsField]) || 0;
    byBrand[b.key] = n;
    total += n;
  }
  return { byBrand, total };
}

function brandLineFromBill(bill, brandKey) {
  if (!brandKey) return Number(bill.totalAmount) || 0;
  const line = Number(bill[`${brandKey}Line`]);
  if (line > 0) return line;
  const bags = Number(bill[`${brandKey}Bags`]) || 0;
  const price = Number(bill[`${brandKey}UnitPrice`]) || 0;
  return Math.round(bags * price * 100) / 100;
}

function recordHasBrandBags(record, brandKey) {
  if (!brandKey) return true;
  const brand = getCachedBrands().find((b) => b.key === brandKey);
  return brand ? (Number(record[brand.bagsField]) || 0) > 0 : false;
}

function brandCostFromLoad(load, brandKey) {
  if (!brandKey) return Number(load.totalAmount) || 0;
  return Number(load[`${brandKey}Cost`]) || 0;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function compareByDateThenCreated(a, b) {
  const byDate = String(a.date ?? '').localeCompare(String(b.date ?? ''));
  if (byDate !== 0) return byDate;
  return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
}

function emptyBrandBagMap() {
  return Object.fromEntries(getCachedBrands().map((b) => [b.key, 0]));
}

/** Per-brand bag counts from a daily-ledger day entry for one field (start/end/in/out). */
function ledgerBagsByBrand(dayBrands, brandKey, field) {
  const byBrand = emptyBrandBagMap();
  const keys = brandKey ? [brandKey] : getCachedBrands().map((b) => b.key);
  for (const k of keys) {
    byBrand[k] = Number(dayBrands?.[k]?.[field]) || 0;
  }
  return byBrand;
}

/**
 * Remaining bags at month start (carry from previous month) and at month end.
 * Uses daily ledger: start-of-day on `from`, end-of-day on latest day ≤ `to`.
 */
function remainingBagsForMonth(dailyDays, from, to, brandKey = '') {
  const empty = {
    remainingStart: 0,
    remainingEnd: 0,
    byBrandStart: emptyBrandBagMap(),
    byBrandEnd: emptyBrandBagMap(),
  };
  const days = Array.isArray(dailyDays) ? dailyDays : [];
  if (days.length === 0) return empty;

  const exactFrom = days.find((day) => String(day.date ?? '').slice(0, 10) === from);
  let dayBefore = null;
  let endDay = null;
  for (const day of days) {
    const d = String(day.date ?? '').slice(0, 10);
    if (d < from) dayBefore = day;
    if (d <= to) endDay = day;
  }

  let byBrandStart = emptyBrandBagMap();
  if (exactFrom) {
    byBrandStart = ledgerBagsByBrand(exactFrom.brands, brandKey, 'start');
  } else if (dayBefore) {
    byBrandStart = ledgerBagsByBrand(dayBefore.brands, brandKey, 'end');
  }

  const byBrandEnd = endDay
    ? ledgerBagsByBrand(endDay.brands, brandKey, 'end')
    : emptyBrandBagMap();

  const remainingStart = Object.values(byBrandStart).reduce((s, n) => s + (Number(n) || 0), 0);
  const remainingEnd = Object.values(byBrandEnd).reduce((s, n) => s + (Number(n) || 0), 0);

  return {
    remainingStart,
    remainingEnd,
    byBrandStart,
    byBrandEnd,
  };
}

/**
 * Shop distributions matched to stock loads via FIFO (same approach as Incentive).
 * Returns one row per bill × brand × stock chunk.
 */
function buildStockDistributionRows(loads, bills, brandKey = '') {
  const brands = brandKey ? getCachedBrands().filter((b) => b.key === brandKey) : getCachedBrands();
  const pools = Object.fromEntries(getCachedBrands().map((b) => [b.key, []]));

  for (const load of [...loads].sort(compareByDateThenCreated)) {
    const stockId = String(load.stockId ?? '').trim();
    if (!stockId) continue;
    for (const b of getCachedBrands()) {
      const bagCount = Number(load[`${b.key}Bags`]) || 0;
      if (bagCount > 0) pools[b.key].push({ stockId, remaining: bagCount });
    }
  }

  const takeFromPool = (pool, need, stockIdFilter = null) => {
    const chunks = [];
    let left = need;
    for (const slot of pool) {
      if (left <= 0) break;
      if (stockIdFilter && slot.stockId !== stockIdFilter) continue;
      if (slot.remaining <= 0) continue;
      const take = Math.min(left, slot.remaining);
      slot.remaining -= take;
      left -= take;
      chunks.push({ stockId: slot.stockId, bags: take });
    }
    return chunks;
  };

  const rows = [];
  for (const bill of [...bills].sort(compareByDateThenCreated)) {
    const date = String(bill.date ?? '').slice(0, 10);
    const shop = String(bill.customerName ?? '').trim() || '—';
    const explicitStockId = String(bill.stockId ?? '').trim();

    for (const b of brands) {
      const need = Number(bill[`${b.key}Bags`]) || 0;
      if (need <= 0) continue;

      const pool = pools[b.key];
      let chunks = explicitStockId
        ? takeFromPool(pool, need, explicitStockId)
        : takeFromPool(pool, need);

      if (explicitStockId) {
        const taken = chunks.reduce((sum, c) => sum + c.bags, 0);
        if (taken < need) {
          chunks = chunks.concat(takeFromPool(pool, need - taken));
        }
      }

      // Unmatched bags (over-sold vs loads) still shown without a stock id
      const matched = chunks.reduce((sum, c) => sum + c.bags, 0);
      if (matched < need) {
        chunks = chunks.concat([{ stockId: '—', bags: need - matched }]);
      }

      const unitRaw = bill[`${b.key}UnitPrice`];
      const perBagPrice =
        unitRaw == null || unitRaw === '' ? null : round2(Number(unitRaw));
      const billLineTotal = brandLineFromBill(bill, b.key);

      for (const chunk of chunks) {
        const totalAmount =
          perBagPrice != null
            ? round2(perBagPrice * chunk.bags)
            : need > 0
              ? round2((billLineTotal / need) * chunk.bags)
              : 0;
        rows.push({
          rowKey: `${bill.id || date}-${b.key}-${chunk.stockId}-${rows.length}`,
          stockId: chunk.stockId,
          date,
          shop,
          brandKey: b.key,
          bagType: formatBrandLabel(b) || b.label,
          bags: chunk.bags,
          perBagPrice,
          totalAmount,
        });
      }
    }
  }

  return rows;
}

/** Map stockId → earliest load purchase date (YYYY-MM-DD). */
function buildStockPurchaseDateLookup(loads) {
  const map = new Map();
  for (const load of loads) {
    const stockId = String(load.stockId ?? '').trim();
    if (!stockId) continue;
    const date = String(load.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const prev = map.get(stockId);
    if (!prev || date < prev) map.set(stockId, date);
  }
  return map;
}

/** Group distribution rows by stock ID with per-stock subtotals. */
function groupDistributionByStock(rows, purchaseDateByStock = null) {
  const groups = new Map();
  for (const row of rows) {
    const sid = String(row.stockId ?? '').trim() || '—';
    if (!groups.has(sid)) {
      const purchaseDate =
        purchaseDateByStock instanceof Map
          ? purchaseDateByStock.get(sid) || ''
          : purchaseDateByStock?.[sid] || '';
      groups.set(sid, { stockId: sid, purchaseDate, rows: [], bags: 0, totalAmount: 0 });
    }
    const g = groups.get(sid);
    g.rows.push(row);
    g.bags += row.bags;
    g.totalAmount += row.totalAmount;
  }

  for (const g of groups.values()) {
    g.rows.sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate !== 0) return byDate;
      const byShop = a.shop.localeCompare(b.shop);
      if (byShop !== 0) return byShop;
      return a.bagType.localeCompare(b.bagType);
    });
  }

  return [...groups.values()].sort((a, b) => {
    if (a.stockId === '—') return 1;
    if (b.stockId === '—') return -1;
    return a.stockId.localeCompare(b.stockId, undefined, { numeric: true, sensitivity: 'base' });
  });
}

/** Matches backend `paymentCreditToCustomer`: cash + cheque credited to the customer. */
function paymentTotal(p) {
  const total = Number(p.amount) || 0;
  if (total > 0) return total;
  return (Number(p.cashAmount) || 0) + (Number(p.chequeAmount) || 0);
}

/** Physical cash in — treated as bank deposit on the payment date (same as Bank page). */
function cashPortion(p) {
  if (p.cashAmount !== undefined || p.chequeAmount !== undefined) {
    return Math.max(0, Number(p.cashAmount) || 0);
  }
  return paymentTotal(p);
}

function buildDailyBankRows(payments) {
  const map = new Map();
  for (const p of payments) {
    const d = String(p.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const cash = cashPortion(p);
    const chq = chequePortion(p);
    const cur = map.get(d) || { date: d, cashIn: 0, bankDeposit: 0, totalIncome: 0 };
    cur.cashIn += cash;
    cur.bankDeposit += cash;
    cur.totalIncome += cash + chq;
    map.set(d, cur);
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function buildPendingChequeRows(payments, from, to) {
  const rows = buildChequeTableRows(payments, (p, _c, flat) => {
    if (flat.chequeDeposited) return null;
    if (!inDateRange(flat.chequeDate, from, to)) return null;
    return {
      id: flat.rowKey,
      chequeDate: flat.chequeDate,
      amount: flat.amount,
      chequeNumber: flat.chequeNumber,
      customerName: String(p.customerName ?? '').trim() || '—',
      billNumber: p.billNumber != null ? String(p.billNumber) : '—',
      paymentDate: String(p.date ?? '').slice(0, 10) || '—',
      sortAt: p.createdAt || `${p.date}T12:00:00`,
    };
  });
  rows.sort((a, b) => {
    const cmp = a.chequeDate.localeCompare(b.chequeDate);
    if (cmp !== 0) return cmp;
    return String(a.sortAt).localeCompare(String(b.sortAt));
  });
  return rows;
}

/** Cheques on payments recorded on a single calendar day (collections day). */
function buildDailyCollectionChequeRows(payments, ymd) {
  const rows = buildChequeTableRows(payments, (p, _c, flat) => {
    const payDate = String(p.date ?? '').slice(0, 10);
    if (payDate !== ymd) return null;
    return {
      id: flat.rowKey,
      customerName: String(p.customerName ?? '').trim() || '—',
      chequeDate: flat.chequeDate || '—',
      chequeNumber: flat.chequeNumber,
      amount: flat.amount,
      chequeDeposited: flat.chequeDeposited,
      billNumber: p.billNumber != null ? String(p.billNumber) : '—',
    };
  });
  rows.sort((a, b) => {
    const byShop = a.customerName.localeCompare(b.customerName);
    if (byShop !== 0) return byShop;
    return a.chequeDate.localeCompare(b.chequeDate);
  });
  return rows;
}

function enrichDailyShopRows(baseRows, payments, ymd) {
  const cashByShop = new Map();
  const chequeByShop = new Map();
  for (const p of payments) {
    const d = String(p.date ?? '').slice(0, 10);
    if (d !== ymd) continue;
    const shop = String(p.customerName ?? '').trim() || '—';
    cashByShop.set(shop, round2((cashByShop.get(shop) || 0) + cashPortion(p)));
    chequeByShop.set(shop, round2((chequeByShop.get(shop) || 0) + chequePortion(p)));
  }
  return baseRows.map((r) => ({
    ...r,
    cashCollected: cashByShop.get(r.shop) || 0,
    chequeCollected: chequeByShop.get(r.shop) || 0,
  }));
}

const periodBtn =
  'rounded-lg px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40';
const periodActive = 'bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200/80';
const periodIdle = 'text-slate-600 hover:bg-white/60';

function Card({ title, subtitle, children }) {
  return (
    <div className="rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-6">
      <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function BrandBagSummary({ byBrand, total, loadCount, brandKey = '' }) {
  const visibleBrands = brandKey ? getCachedBrands().filter((b) => b.key === brandKey) : getCachedBrands();
  return (
    <div
      className={`grid gap-3 sm:grid-cols-2 ${visibleBrands.length > 1 ? 'lg:grid-cols-5' : 'lg:grid-cols-2'}`}
    >
      {visibleBrands.map((b) => (
        <div
          key={b.key}
          className={`rounded-xl bg-gradient-to-br ${b.accent} p-4 text-white shadow-md ring-1 ${b.ring}`}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-white/85">{formatBrandLabel(b) || b.label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{(byBrand[b.key] || 0).toLocaleString()}</p>
          <p className="mt-0.5 text-xs text-white/75">bags</p>
        </div>
      ))}
      <div className="rounded-xl bg-slate-800 p-4 text-white shadow-md ring-1 ring-slate-700">
        <p className="text-xs font-semibold uppercase tracking-wide text-white/85">Total</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{total.toLocaleString()}</p>
        <p className="mt-0.5 text-xs text-white/75">
          from {loadCount} load{loadCount === 1 ? '' : 's'}
        </p>
      </div>
    </div>
  );
}

/** Compact per-brand remaining bag list for stock distribution summary cards. */
function BrandRemainingBreakdown({ byBrand, brandKey = '' }) {
  const visibleBrands = brandKey ? getCachedBrands().filter((b) => b.key === brandKey) : getCachedBrands();
  return (
    <ul className="mt-2 space-y-1">
      {visibleBrands.map((b) => (
        <li key={b.key} className="flex items-center justify-between gap-2 text-xs">
          <span
            className={`inline-flex rounded-md px-1.5 py-0.5 font-semibold ${b.iconBg || 'bg-slate-100 text-slate-700'}`}
          >
            {formatBrandLabel(b) || b.label}
          </span>
          <span className="font-semibold tabular-nums text-slate-800">
            {(byBrand?.[b.key] || 0).toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function ReportsPage() {
  const { brands } = useBagProducts();
  const [loads, setLoads] = useState([]);
  const [bills, setBills] = useState([]);
  const [payments, setPayments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [dailyStockDays, setDailyStockDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [periodMode, setPeriodMode] = useState('weekly');
  const [selectedWeek, setSelectedWeek] = useState(() => currentIsoWeekValue());
  const [selectedMonth, setSelectedMonth] = useState(() => currentMonthValue());
  const [dateFrom, setDateFrom] = useState(() => weeklyRangeFromWeekValue(currentIsoWeekValue()).from);
  const [dateTo, setDateTo] = useState(() => weeklyRangeFromWeekValue(currentIsoWeekValue()).to);
  const [appliedFrom, setAppliedFrom] = useState(() => weeklyRangeFromWeekValue(currentIsoWeekValue()).from);
  const [appliedTo, setAppliedTo] = useState(() => weeklyRangeFromWeekValue(currentIsoWeekValue()).to);
  const [brandFilter, setBrandFilter] = useState('');
  const [loadsSummaryMonth, setLoadsSummaryMonth] = useState(() => currentMonthValue());
  const [stockDistMonth, setStockDistMonth] = useState(() => currentMonthValue());
  const [stockDistBrand, setStockDistBrand] = useState('');
  const [stockDistMonthPurchasesOnly, setStockDistMonthPurchasesOnly] = useState(false);
  const [billsMonth, setBillsMonth] = useState(() => currentMonthValue());
  const [dailyBagsMonth, setDailyBagsMonth] = useState(() => currentMonthValue());
  const [dailyBagsBrand, setDailyBagsBrand] = useState('');
  const [shopTargetsMonth, setShopTargetsMonth] = useState(() => currentMonthValue());
  const [dailyReportDate, setDailyReportDate] = useState(() => localYmd());
  const [collectionsMonth, setCollectionsMonth] = useState(() => currentMonthValue());
  const [collectionsCollectorId, setCollectionsCollectorId] = useState('');
  const [collectors, setCollectors] = useState([]);
  const [collectorStaffUserId, setCollectorStaffUserId] = useState('');
  const [collectorDisplayName, setCollectorDisplayName] = useState('');

  const collectorReportsView = isCollector();
  const showDailyCollectionsReport = isManagerOrAdmin() || collectorReportsView;

  const [fsPeriodMode, setFsPeriodMode] = useState('monthly');
  const [fsSelectedWeek, setFsSelectedWeek] = useState(() => currentIsoWeekValue());
  const [fsSelectedMonth, setFsSelectedMonth] = useState(() => currentMonthValue());
  const [fsDateFrom, setFsDateFrom] = useState(() => monthlyRangeFromMonthValue(currentMonthValue()).from);
  const [fsDateTo, setFsDateTo] = useState(() => monthlyRangeFromMonthValue(currentMonthValue()).to);
  const [fsAppliedFrom, setFsAppliedFrom] = useState(() => monthlyRangeFromMonthValue(currentMonthValue()).from);
  const [fsAppliedTo, setFsAppliedTo] = useState(() => monthlyRangeFromMonthValue(currentMonthValue()).to);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (collectorReportsView) {
        const [billsRes, paymentsRes, customersRes] = await Promise.all([
          authFetch(`${apiBase}/api/bills`),
          authFetch(`${apiBase}/api/payments`),
          fetch(`${apiBase}/api/customers`),
        ]);
        if (!billsRes.ok) throw new Error('Failed to load bills');
        if (!paymentsRes.ok) throw new Error('Failed to load payments');
        if (!customersRes.ok) throw new Error('Failed to load customers');

        const [billsData, paymentsData, customersData] = await Promise.all([
          billsRes.json(),
          paymentsRes.json(),
          customersRes.json(),
        ]);

        setBills(Array.isArray(billsData) ? billsData : []);
        setPayments(Array.isArray(paymentsData) ? paymentsData : []);
        setCustomers(Array.isArray(customersData) ? customersData : []);
        setLoads([]);
        setDailyStockDays([]);
        setCollectors([]);
        return;
      }

      const [loadsRes, billsRes, paymentsRes, customersRes, dailyRes, collectorsRes] = await Promise.all([
        fetch(`${apiBase}/api/stocks`),
        fetch(`${apiBase}/api/bills`),
        fetch(`${apiBase}/api/payments`),
        fetch(`${apiBase}/api/customers`),
        fetch(`${apiBase}/api/daily-stock`),
        authFetch(`${apiBase}/api/collectors`),
      ]);
      if (!loadsRes.ok) throw new Error('Failed to load loads');
      if (!billsRes.ok) throw new Error('Failed to load bills');
      if (!paymentsRes.ok) throw new Error('Failed to load payments');
      if (!customersRes.ok) throw new Error('Failed to load customers');
      if (!dailyRes.ok) throw new Error('Failed to load daily stock');
      if (!collectorsRes.ok) throw new Error('Failed to load collectors');

      const [loadsData, billsData, paymentsData, customersData, dailyData, collectorsData] = await Promise.all([
        loadsRes.json(),
        billsRes.json(),
        paymentsRes.json(),
        customersRes.json(),
        dailyRes.json(),
        collectorsRes.json(),
      ]);

      setLoads(Array.isArray(loadsData) ? loadsData : []);
      setBills(Array.isArray(billsData) ? billsData : []);
      setPayments(Array.isArray(paymentsData) ? paymentsData : []);
      setCustomers(Array.isArray(customersData) ? customersData : []);
      setDailyStockDays(Array.isArray(dailyData?.days) ? dailyData.days : []);
      setCollectors(Array.isArray(collectorsData) ? collectorsData : []);
    } catch (e) {
      setError(e.message || 'Could not load report data');
      setLoads([]);
      setBills([]);
      setPayments([]);
      setCustomers([]);
      setDailyStockDays([]);
      setCollectors([]);
    } finally {
      setLoading(false);
    }
  }, [collectorReportsView]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!collectorReportsView) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`${apiBase}/api/me`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        const id = String(data.staffUserId ?? '').trim();
        if (id) setCollectorStaffUserId(id);
        const name = String(data.name ?? '').trim();
        setCollectorDisplayName(name || getDisplayName());
      } catch {
        if (!cancelled) setCollectorDisplayName(getDisplayName());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [collectorReportsView]);

  const effectiveCollectionsCollectorId = collectorReportsView
    ? collectorStaffUserId
    : collectionsCollectorId;

  const customerLocationMap = useMemo(() => {
    const map = new Map();
    for (const c of customers) {
      const name = String(c.name ?? '').trim();
      if (name) map.set(name.toLowerCase(), String(c.location ?? '').trim());
    }
    return map;
  }, [customers]);

  const applyWeek = (weekValue) => {
    const week = weekValue || currentIsoWeekValue();
    const { from, to } = weeklyRangeFromWeekValue(week);
    setSelectedWeek(week);
    setDateFrom(from);
    setDateTo(to);
    setAppliedFrom(from);
    setAppliedTo(to);
  };

  const applyMonth = (monthValue) => {
    const month = monthValue || currentMonthValue();
    const { from, to } = monthlyRangeFromMonthValue(month);
    setSelectedMonth(month);
    setDateFrom(from);
    setDateTo(to);
    setAppliedFrom(from);
    setAppliedTo(to);
  };

  const handlePeriodChange = (mode) => {
    setPeriodMode(mode);
    if (mode === 'weekly') {
      applyWeek(selectedWeek || currentIsoWeekValue());
    } else if (mode === 'monthly') {
      applyMonth(selectedMonth || currentMonthValue());
    }
  };

  const handleGenerate = () => {
    setAppliedFrom(dateFrom);
    setAppliedTo(dateTo);
  };

  const applyFsWeek = (weekValue) => {
    const week = weekValue || currentIsoWeekValue();
    const { from, to } = weeklyRangeFromWeekValue(week);
    setFsSelectedWeek(week);
    setFsDateFrom(from);
    setFsDateTo(to);
    setFsAppliedFrom(from);
    setFsAppliedTo(to);
  };

  const applyFsMonth = (monthValue) => {
    const month = monthValue || currentMonthValue();
    const { from, to } = monthlyRangeFromMonthValue(month);
    setFsSelectedMonth(month);
    setFsDateFrom(from);
    setFsDateTo(to);
    setFsAppliedFrom(from);
    setFsAppliedTo(to);
  };

  const handleFsPeriodChange = (mode) => {
    setFsPeriodMode(mode);
    if (mode === 'weekly') {
      applyFsWeek(fsSelectedWeek || currentIsoWeekValue());
    } else if (mode === 'monthly') {
      applyFsMonth(fsSelectedMonth || currentMonthValue());
    }
  };

  const handleFsGenerate = () => {
    setFsAppliedFrom(fsDateFrom);
    setFsAppliedTo(fsDateTo);
  };

  const activeBrand = useMemo(() => brands.find((b) => b.key === brandFilter) ?? null, [brandFilter, brands]);

  const loadsReport = useMemo(() => {
    const filtered = loads.filter(
      (r) => inDateRange(r.date, appliedFrom, appliedTo) && recordHasBrandBags(r, brandFilter),
    );
    const byBrand = Object.fromEntries(brands.map((b) => [b.key, 0]));
    let total = 0;
    for (const r of filtered) {
      const { byBrand: row, total: rowTotal } = bagsFromRecord(r, brandFilter);
      for (const b of brands) byBrand[b.key] += row[b.key] || 0;
      total += rowTotal;
    }
    return { byBrand, total, loadCount: filtered.length };
  }, [loads, appliedFrom, appliedTo, brandFilter]);

  const shopRows = useMemo(
    () =>
      buildShopRowsForRange(
        bills,
        payments,
        customerLocationMap,
        appliedFrom,
        appliedTo,
        brandFilter,
      ),
    [bills, payments, appliedFrom, appliedTo, customerLocationMap, brandFilter],
  );

  const loadsSummaryRange = useMemo(
    () => monthlyRangeFromMonthValue(loadsSummaryMonth),
    [loadsSummaryMonth],
  );

  const loadsSummaryMonthLabel = useMemo(
    () => monthDisplayLabel(loadsSummaryMonth),
    [loadsSummaryMonth],
  );

  const stockDistRange = useMemo(() => monthlyRangeFromMonthValue(stockDistMonth), [stockDistMonth]);

  const stockDistMonthLabel = useMemo(() => monthDisplayLabel(stockDistMonth), [stockDistMonth]);

  const billsMonthRange = useMemo(() => monthlyRangeFromMonthValue(billsMonth), [billsMonth]);

  const billsMonthLabel = useMemo(() => monthDisplayLabel(billsMonth), [billsMonth]);

  const dailyBagsMonthLabel = useMemo(() => monthDisplayLabel(dailyBagsMonth), [dailyBagsMonth]);

  const dailyBagsActiveBrand = useMemo(
    () => brands.find((b) => b.key === dailyBagsBrand) ?? null,
    [dailyBagsBrand],
  );

  const dailyBagsReport = useMemo(
    () => buildDailyBagsByShopBrandRows(bills, dailyBagsMonth, dailyBagsBrand),
    [bills, dailyBagsMonth, dailyBagsBrand],
  );

  const shopTargetsMonthLabel = useMemo(() => monthDisplayLabel(shopTargetsMonth), [shopTargetsMonth]);

  const shopTargetsReport = useMemo(
    () => buildShopTargetsRows(bills, customers, shopTargetsMonth),
    [bills, customers, shopTargetsMonth],
  );

  const billSettledDateLookup = useMemo(
    () => buildBillSettledDateLookup(customers, bills, payments),
    [customers, bills, payments],
  );

  const monthlyBillRows = useMemo(
    () => buildMonthlyBillRows(bills, billSettledDateLookup, billsMonthRange.from, billsMonthRange.to),
    [bills, billSettledDateLookup, billsMonthRange],
  );

  const monthlyBillTotals = useMemo(
    () =>
      monthlyBillRows.reduce(
        (acc, r) => ({
          bagCount: acc.bagCount + r.bagCount,
          amount: acc.amount + r.amount,
        }),
        { bagCount: 0, amount: 0 },
      ),
    [monthlyBillRows],
  );

  const collectionsMonthRange = useMemo(
    () => monthlyRangeFromMonthValue(collectionsMonth),
    [collectionsMonth],
  );

  const collectionsMonthLabel = useMemo(
    () => monthDisplayLabel(collectionsMonth),
    [collectionsMonth],
  );

  const settledCollectionsRows = useMemo(() => {
    if (collectorReportsView && !collectorStaffUserId) return [];
    return buildSettledCollectionsRows(customers, bills, billSettledDateLookup, payments, {
      from: collectionsMonthRange.from,
      to: collectionsMonthRange.to,
      collectorUserId: effectiveCollectionsCollectorId,
    });
  }, [
    collectorReportsView,
    collectorStaffUserId,
    customers,
    bills,
    payments,
    billSettledDateLookup,
    collectionsMonthRange,
    effectiveCollectionsCollectorId,
  ]);

  const settledCollectionsBucketSummary = useMemo(
    () => summarizeCollectionsByBucket(settledCollectionsRows),
    [settledCollectionsRows],
  );

  const settledCollectionsTotal = useMemo(
    () => settledCollectionsRows.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [settledCollectionsRows],
  );

  const collectionsCollectorLabel = useMemo(() => {
    if (collectorReportsView) return collectorDisplayName || getDisplayName() || 'Your collections';
    if (!collectionsCollectorId) return 'All collectors';
    return collectors.find((c) => c.id === collectionsCollectorId)?.name || '—';
  }, [collectorReportsView, collectorDisplayName, collectionsCollectorId, collectors]);

  const handleDownloadSettledCollectionsPdf = () => {
    downloadCollectionsReportPdf({
      periodLabel: collectionsMonthLabel,
      collectorName: collectionsCollectorLabel,
      rows: settledCollectionsRows,
      bucketSummary: settledCollectionsBucketSummary,
      totals: { amount: settledCollectionsTotal },
      generatedAt: new Date(),
    });
  };

  const stockDistActiveBrand = useMemo(
    () => brands.find((b) => b.key === stockDistBrand) ?? null,
    [stockDistBrand],
  );

  const stockDistPurchaseDates = useMemo(() => buildStockPurchaseDateLookup(loads), [loads]);

  const stockDistMonthStockIds = useMemo(() => {
    const { from, to } = stockDistRange;
    const ids = new Set();
    for (const [stockId, purchaseDate] of stockDistPurchaseDates) {
      if (inDateRange(purchaseDate, from, to)) ids.add(stockId);
    }
    return ids;
  }, [stockDistPurchaseDates, stockDistRange]);

  const stockDistRemainingAll = useMemo(
    () =>
      remainingBagsForMonth(
        dailyStockDays,
        stockDistRange.from,
        stockDistRange.to,
        stockDistBrand,
      ),
    [dailyStockDays, stockDistRange, stockDistBrand],
  );

  const stockDistInOutAll = useMemo(() => {
    const { from, to } = stockDistRange;
    let bagsIn = 0;
    let bagsInAmount = 0;
    let bagsOut = 0;
    let bagsOutAmount = 0;
    const bagsInByBrand = emptyBrandBagMap();

    for (const r of loads) {
      if (!inDateRange(r.date, from, to)) continue;
      if (!recordHasBrandBags(r, stockDistBrand)) continue;
      const { byBrand, total } = bagsFromRecord(r, stockDistBrand);
      bagsIn += total;
      bagsInAmount += brandCostFromLoad(r, stockDistBrand);
      for (const b of brands) bagsInByBrand[b.key] += byBrand[b.key] || 0;
    }

    for (const b of bills) {
      if (!inDateRange(b.date, from, to)) continue;
      if (!recordHasBrandBags(b, stockDistBrand)) continue;
      bagsOut += bagsFromRecord(b, stockDistBrand).total;
      bagsOutAmount += brandLineFromBill(b, stockDistBrand);
    }

    return {
      bagsIn,
      bagsInAmount: round2(bagsInAmount),
      bagsOut,
      bagsOutAmount: round2(bagsOutAmount),
      bagsInByBrand,
    };
  }, [loads, bills, stockDistRange, stockDistBrand]);

  const stockDistRows = useMemo(() => {
    const { from, to } = stockDistRange;
    return buildStockDistributionRows(loads, bills, stockDistBrand).filter((r) => {
      if (!inDateRange(r.date, from, to)) return false;
      if (!stockDistMonthPurchasesOnly) return true;
      const sid = String(r.stockId ?? '').trim();
      return sid && stockDistMonthStockIds.has(sid);
    });
  }, [loads, bills, stockDistRange, stockDistBrand, stockDistMonthPurchasesOnly, stockDistMonthStockIds]);

  const stockDistRemaining = useMemo(() => {
    if (!stockDistMonthPurchasesOnly) return stockDistRemainingAll;

    const byBrandStart = emptyBrandBagMap();
    const byBrandEnd = emptyBrandBagMap();
    const outByBrand = emptyBrandBagMap();
    for (const r of stockDistRows) {
      outByBrand[r.brandKey] = (outByBrand[r.brandKey] || 0) + (Number(r.bags) || 0);
    }

    const visible = stockDistBrand ? [stockDistBrand] : brands.map((b) => b.key);
    for (const key of visible) {
      const inn = stockDistInOutAll.bagsInByBrand?.[key] || 0;
      const out = outByBrand[key] || 0;
      byBrandEnd[key] = Math.max(0, inn - out);
    }

    return {
      remainingStart: 0,
      remainingEnd: Object.values(byBrandEnd).reduce((s, n) => s + (Number(n) || 0), 0),
      byBrandStart,
      byBrandEnd,
    };
  }, [
    stockDistMonthPurchasesOnly,
    stockDistRemainingAll,
    stockDistRows,
    stockDistInOutAll,
    stockDistBrand,
  ]);

  const stockDistInOut = useMemo(() => {
    if (!stockDistMonthPurchasesOnly) {
      return {
        bagsIn: stockDistInOutAll.bagsIn,
        bagsInAmount: stockDistInOutAll.bagsInAmount,
        bagsOut: stockDistInOutAll.bagsOut,
        bagsOutAmount: stockDistInOutAll.bagsOutAmount,
      };
    }

    let bagsOut = 0;
    let bagsOutAmount = 0;
    for (const r of stockDistRows) {
      bagsOut += Number(r.bags) || 0;
      bagsOutAmount += Number(r.totalAmount) || 0;
    }

    return {
      bagsIn: stockDistInOutAll.bagsIn,
      bagsInAmount: stockDistInOutAll.bagsInAmount,
      bagsOut,
      bagsOutAmount: round2(bagsOutAmount),
    };
  }, [stockDistMonthPurchasesOnly, stockDistInOutAll, stockDistRows]);

  const stockDistGroups = useMemo(
    () => groupDistributionByStock(stockDistRows, stockDistPurchaseDates),
    [stockDistRows, stockDistPurchaseDates],
  );

  const stockDistTableTotals = useMemo(
    () =>
      stockDistGroups.reduce(
        (acc, g) => ({
          bags: acc.bags + g.bags,
          totalAmount: acc.totalAmount + g.totalAmount,
        }),
        { bags: 0, totalAmount: 0 },
      ),
    [stockDistGroups],
  );

  const monthLoadsReport = useMemo(() => {
    const { from, to } = loadsSummaryRange;
    const filtered = loads.filter((r) => inDateRange(r.date, from, to));
    const byBrand = Object.fromEntries(brands.map((b) => [b.key, 0]));
    let total = 0;
    let totalAmount = 0;
    for (const r of filtered) {
      const { byBrand: row, total: rowTotal } = bagsFromRecord(r, '');
      for (const b of brands) byBrand[b.key] += row[b.key] || 0;
      total += rowTotal;
      totalAmount += Number(r.totalAmount) || 0;
    }
    return { byBrand, total, loadCount: filtered.length, totalAmount };
  }, [loads, loadsSummaryRange]);

  const monthLoadRows = useMemo(() => {
    const { from, to } = loadsSummaryRange;
    return loads
      .filter((r) => inDateRange(r.date, from, to))
      .map((r) => {
        const bagCols = Object.fromEntries(
          brands.map((b) => [b.bagsField, Number(r[b.bagsField]) || 0]),
        );
        return {
          date: String(r.date ?? '').slice(0, 10),
          stockId: String(r.stockId ?? '').trim(),
          vehicleNumber: String(r.vehicleNumber ?? '').trim(),
          ...bagCols,
          totalAmount: Number(r.totalAmount) || 0,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.stockId.localeCompare(b.stockId));
  }, [loads, loadsSummaryRange, brands]);

  const monthShopRows = useMemo(
    () =>
      buildShopRowsForRange(
        bills,
        payments,
        customerLocationMap,
        loadsSummaryRange.from,
        loadsSummaryRange.to,
        '',
      ),
    [bills, payments, customerLocationMap, loadsSummaryRange],
  );

  const monthShopTotals = useMemo(
    () =>
      monthShopRows.reduce(
        (acc, r) => ({
          totalBags: acc.totalBags + r.totalBags,
          creditSales: acc.creditSales + r.creditSales,
          cashIn: acc.cashIn + r.cashIn,
        }),
        { totalBags: 0, creditSales: 0, cashIn: 0 },
      ),
    [monthShopRows],
  );

  const shopOutstandingByName = useMemo(() => {
    const map = new Map();
    for (const c of customers) {
      const name = String(c.name ?? '').trim();
      if (!name) continue;
      map.set(name.toLowerCase(), Math.max(0, Number(c.remainingAmount) || 0));
      map.set(name, Math.max(0, Number(c.remainingAmount) || 0));
    }
    return map;
  }, [customers]);

  const outstandingForShop = useCallback(
    (shop) => {
      const key = String(shop ?? '').trim();
      if (!key) return 0;
      if (shopOutstandingByName.has(key)) return shopOutstandingByName.get(key);
      return shopOutstandingByName.get(key.toLowerCase()) ?? 0;
    },
    [shopOutstandingByName],
  );

  const monthInvoiceRows = useMemo(() => {
    const { from, to } = loadsSummaryRange;
    const asOf = localYmd();
    const rows = [];
    for (const b of bills) {
      if (!inDateRange(b.date, from, to)) continue;
      const shop = String(b.customerName ?? '').trim() || '—';
      const invoiceDate = String(b.date ?? '').slice(0, 10);
      rows.push({
        shop,
        invoiceDate,
        daysFromBillDate: daysFromYmdToToday(invoiceDate, asOf),
        amount: Number(b.totalAmount) || 0,
      });
    }
    rows.sort((a, b) => {
      const shopCmp = a.shop.localeCompare(b.shop);
      if (shopCmp !== 0) return shopCmp;
      return a.invoiceDate.localeCompare(b.invoiceDate);
    });
    return rows;
  }, [bills, loadsSummaryRange]);

  const monthInvoiceGroups = useMemo(() => {
    const groups = new Map();
    for (const row of monthInvoiceRows) {
      if (!groups.has(row.shop)) {
        groups.set(row.shop, {
          shop: row.shop,
          invoices: [],
          totalAmount: 0,
          outstanding: outstandingForShop(row.shop),
        });
      }
      const g = groups.get(row.shop);
      g.invoices.push(row);
      g.totalAmount += row.amount;
    }
    return [...groups.values()].sort((a, b) => a.shop.localeCompare(b.shop));
  }, [monthInvoiceRows, outstandingForShop]);

  const monthInvoiceGrandTotals = useMemo(
    () =>
      monthInvoiceGroups.reduce(
        (acc, g) => ({
          totalAmount: acc.totalAmount + g.totalAmount,
          outstanding: acc.outstanding + g.outstanding,
        }),
        { totalAmount: 0, outstanding: 0 },
      ),
    [monthInvoiceGroups],
  );

  const visibleBrands = useMemo(
    () => (activeBrand ? [activeBrand] : brands),
    [activeBrand],
  );

  const refDetailRows = useMemo(() => {
    const filteredBrands = brandFilter ? brands.filter((b) => b.key === brandFilter) : brands;
    const rows = [];
    for (const b of bills) {
      if (!inDateRange(b.date, appliedFrom, appliedTo)) continue;
      if (!recordHasBrandBags(b, brandFilter)) continue;
      const shop = String(b.customerName ?? '').trim() || '—';
      const location = customerLocationMap.get(shop.toLowerCase()) || '';
      const date = String(b.date ?? '').slice(0, 10);
      for (const brand of filteredBrands) {
        const bagCount = Number(b[brand.bagsField]) || 0;
        if (bagCount <= 0) continue;
        rows.push({
          date,
          shop,
          location,
          bagType: formatBrandLabel(brand) || brand.label,
          bagCount,
        });
      }
    }
    rows.sort((a, b) => {
      const shopCmp = a.shop.localeCompare(b.shop);
      if (shopCmp !== 0) return shopCmp;
      const dateCmp = a.date.localeCompare(b.date);
      if (dateCmp !== 0) return dateCmp;
      return a.bagType.localeCompare(b.bagType);
    });
    return rows;
  }, [bills, appliedFrom, appliedTo, brandFilter, customerLocationMap]);

  const shopTotals = useMemo(
    () =>
      shopRows.reduce(
        (acc, r) => ({
          totalBags: acc.totalBags + r.totalBags,
          creditSales: acc.creditSales + r.creditSales,
          cashIn: acc.cashIn + r.cashIn,
        }),
        { totalBags: 0, creditSales: 0, cashIn: 0 },
      ),
    [shopRows],
  );

  const dailyReportShopRows = useMemo(() => {
    if (!showDailyCollectionsReport) return [];
    const base = buildShopRowsForRange(
      bills,
      payments,
      customerLocationMap,
      dailyReportDate,
      dailyReportDate,
      '',
    );
    return enrichDailyShopRows(base, payments, dailyReportDate).filter((r) => r.cashIn > 0);
  }, [showDailyCollectionsReport, bills, payments, customerLocationMap, dailyReportDate]);

  const dailyReportTotals = useMemo(
    () =>
      dailyReportShopRows.reduce(
        (acc, r) => ({
          collections: round2(acc.collections + r.cashIn),
          cash: round2(acc.cash + r.cashCollected),
          cheque: round2(acc.cheque + r.chequeCollected),
          paymentCount: acc.paymentCount + r.paymentCount,
        }),
        { collections: 0, cash: 0, cheque: 0, paymentCount: 0 },
      ),
    [dailyReportShopRows],
  );

  const dailyReportChequeRows = useMemo(() => {
    if (!showDailyCollectionsReport) return [];
    return buildDailyCollectionChequeRows(payments, dailyReportDate);
  }, [showDailyCollectionsReport, payments, dailyReportDate]);

  const dailyReportChequeTotal = useMemo(
    () => round2(dailyReportChequeRows.reduce((s, r) => s + r.amount, 0)),
    [dailyReportChequeRows],
  );

  const bankDailyRows = useMemo(() => {
    const all = buildDailyBankRows(payments);
    return all.filter((r) => inDateRange(r.date, appliedFrom, appliedTo));
  }, [payments, appliedFrom, appliedTo]);

  const bankDailyTotals = useMemo(
    () =>
      bankDailyRows.reduce(
        (acc, r) => ({
          cashIn: acc.cashIn + r.cashIn,
          bankDeposit: acc.bankDeposit + r.bankDeposit,
          totalIncome: acc.totalIncome + r.totalIncome,
        }),
        { cashIn: 0, bankDeposit: 0, totalIncome: 0 },
      ),
    [bankDailyRows],
  );

  const pendingChequeRows = useMemo(
    () => buildPendingChequeRows(payments, appliedFrom, appliedTo),
    [payments, appliedFrom, appliedTo],
  );

  const pendingChequeTotal = useMemo(
    () => pendingChequeRows.reduce((s, r) => s + r.amount, 0),
    [pendingChequeRows],
  );

  const periodLabel =
    appliedFrom && appliedTo
      ? `${appliedFrom} → ${appliedTo}`
      : appliedFrom
        ? `From ${appliedFrom}`
        : appliedTo
          ? `Until ${appliedTo}`
          : 'All dates';

  const filterHint = [
    `Report period: ${periodLabel}`,
    activeBrand ? `Brand: ${activeBrand.label}` : 'Brand: All brands',
  ].join(' · ');

  const handleDownloadPdf = useCallback(() => {
    downloadReportsPdf(
      {
        periodLabel,
        brandLabel: activeBrand ? activeBrand.label : 'All brands',
        loadsReport,
        visibleBrands,
        shopRows,
        shopTotals,
        bankDailyRows,
        bankDailyTotals,
        pendingChequeRows,
        pendingChequeTotal,
      },
      { dateFrom: appliedFrom, dateTo: appliedTo },
    );
  }, [
    appliedFrom,
    appliedTo,
    periodLabel,
    activeBrand,
    loadsReport,
    visibleBrands,
    shopRows,
    shopTotals,
    bankDailyRows,
    bankDailyTotals,
    pendingChequeRows,
    pendingChequeTotal,
  ]);

  const handleDownloadRef = useCallback(() => {
    downloadRefReport(
      refDetailRows,
      {
        periodLabel,
        brandLabel: activeBrand ? activeBrand.label : 'All brands',
      },
      { dateFrom: appliedFrom, dateTo: appliedTo, brandLabel: activeBrand ? activeBrand.label : 'All brands' },
    );
  }, [refDetailRows, periodLabel, activeBrand, appliedFrom, appliedTo]);

  const downloadBtnClass =
    'rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-100 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

  const todayYmd = useMemo(() => localYmd(), []);

  const outstandingSummary = useMemo(() => {
    let totalOutstanding = 0;
    let totalCredit = 0;
    let withBalance = 0;
    for (const c of customers) {
      const outstanding = Math.max(0, Number(c.remainingAmount) || 0);
      const credit = Math.max(0, Number(c.overpaymentAmount) || 0);
      totalOutstanding += outstanding;
      totalCredit += credit;
      if (outstanding > 0) withBalance += 1;
    }
    return { totalOutstanding, totalCredit, withBalance, customerCount: customers.length };
  }, [customers]);

  const outstandingRows = useMemo(() => {
    return [...customers]
      .map((c) => ({
        id: c.id,
        name: String(c.name ?? '').trim() || '—',
        location: String(c.location ?? '').trim(),
        dueDate: String(c.dueDate ?? '').slice(0, 10) || '—',
        outstanding: Math.max(0, Number(c.remainingAmount) || 0),
        credit: Math.max(0, Number(c.overpaymentAmount) || 0),
      }))
      .filter((r) => r.outstanding > 0 || r.credit > 0)
      .sort((a, b) => {
        const balCmp = b.outstanding - a.outstanding;
        if (balCmp !== 0) return balCmp;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
  }, [customers]);

  const handleDownloadOutstanding = useCallback(() => {
    downloadCustomerOutstandingReport(customers, { asOfDate: todayYmd });
  }, [customers, todayYmd]);

  const handleDownloadLoadsSummary = useCallback(() => {
    downloadLoadsSummaryPdf(
      {
        monthLabel: loadsSummaryMonthLabel,
        loadsReport: monthLoadsReport,
        loadRows: monthLoadRows,
        invoiceRows: monthInvoiceRows,
        shopOutstandingByName,
      },
      { monthSlug: loadsSummaryMonth },
    );
  }, [
    loadsSummaryMonth,
    loadsSummaryMonthLabel,
    monthLoadsReport,
    monthLoadRows,
    monthInvoiceRows,
    shopOutstandingByName,
  ]);

  const handleDownloadMonthlyBills = useCallback(() => {
    downloadMonthlyBillsPdf(
      {
        monthLabel: billsMonthLabel,
        rows: monthlyBillRows,
        totals: monthlyBillTotals,
      },
      { monthSlug: billsMonth },
    );
  }, [billsMonth, billsMonthLabel, monthlyBillRows, monthlyBillTotals]);

  const handleDownloadDailyBagsByShop = useCallback(() => {
    downloadDailyBagsByShopReport(
      {
        monthLabel: dailyBagsMonthLabel,
        brandLabel: dailyBagsActiveBrand ? dailyBagsActiveBrand.label : 'All brands',
        daysInMonth: dailyBagsReport.daysInMonth,
        rows: dailyBagsReport.rows,
        dayTotals: dailyBagsReport.dayTotals,
        grandTotal: dailyBagsReport.grandTotal,
      },
      { monthSlug: dailyBagsMonth },
    );
  }, [dailyBagsMonth, dailyBagsMonthLabel, dailyBagsActiveBrand, dailyBagsReport]);

  const handleDownloadShopTargets = useCallback(() => {
    downloadShopTargetsPdf(
      {
        monthLabel: shopTargetsMonthLabel,
        rows: shopTargetsReport.rows,
        totals: shopTargetsReport.totals,
        overallProgressPct: shopTargetsReport.overallProgressPct,
      },
      { monthSlug: shopTargetsMonth },
    );
  }, [shopTargetsMonth, shopTargetsMonthLabel, shopTargetsReport]);

  const handleDownloadStockDistribution = useCallback(() => {
    downloadStockDistributionPdf(
      {
        monthLabel: stockDistMonthLabel,
        brandLabel: stockDistActiveBrand ? stockDistActiveBrand.label : 'All brands',
        brandKey: stockDistBrand,
        monthPurchasesOnly: stockDistMonthPurchasesOnly,
        remaining: stockDistRemaining,
        inOut: stockDistInOut,
        groups: stockDistGroups,
        tableTotals: stockDistTableTotals,
      },
      {
        monthSlug: stockDistMonth,
        brandSlug: stockDistBrand || 'all',
      },
    );
  }, [
    stockDistMonth,
    stockDistMonthLabel,
    stockDistBrand,
    stockDistActiveBrand,
    stockDistMonthPurchasesOnly,
    stockDistRemaining,
    stockDistInOut,
    stockDistGroups,
    stockDistTableTotals,
  ]);

  const fsPeriodLabel =
    fsAppliedFrom && fsAppliedTo
      ? `${fsAppliedFrom} → ${fsAppliedTo}`
      : fsAppliedFrom
        ? `From ${fsAppliedFrom}`
        : fsAppliedTo
          ? `Until ${fsAppliedTo}`
          : 'All dates';

  const financialLoadRows = useMemo(
    () => buildFinancialLoadPurchaseRows(loads, fsAppliedFrom, fsAppliedTo),
    [loads, fsAppliedFrom, fsAppliedTo],
  );

  const financialLoadGrandTotal = useMemo(
    () => financialLoadRows.reduce((s, r) => s + (Number(r.totalCost) || 0), 0),
    [financialLoadRows],
  );

  const financialCashInRows = useMemo(
    () => buildFinancialCashInRows(payments, fsAppliedFrom, fsAppliedTo),
    [payments, fsAppliedFrom, fsAppliedTo],
  );

  const financialCashInTotals = useMemo(
    () =>
      financialCashInRows.reduce(
        (acc, r) => ({
          cash: acc.cash + (Number(r.cashAmount) || 0),
          cheque: acc.cheque + (Number(r.chequeAmount) || 0),
          total: acc.total + (Number(r.total) || 0),
        }),
        { cash: 0, cheque: 0, total: 0 },
      ),
    [financialCashInRows],
  );

  const financialConvertingRows = useMemo(
    () => buildFinancialConvertingChequeRows(payments, fsAppliedFrom, fsAppliedTo),
    [payments, fsAppliedFrom, fsAppliedTo],
  );

  const financialConvertingTotal = useMemo(
    () => financialConvertingRows.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [financialConvertingRows],
  );

  const handleDownloadFinancialSummary = useCallback(() => {
    const fileSlug =
      fsPeriodMode === 'monthly' && fsSelectedMonth
        ? fsSelectedMonth
        : fsPeriodMode === 'weekly' && fsSelectedWeek
          ? fsSelectedWeek.replace(/W/, 'w')
          : `${fsAppliedFrom || 'from'}_${fsAppliedTo || 'to'}`;
    downloadFinancialSummaryPdf(
      {
        periodLabel: fsPeriodLabel,
        loadRows: financialLoadRows,
        cashInRows: financialCashInRows,
        convertingRows: financialConvertingRows,
      },
      { fileSlug },
    );
  }, [
    fsPeriodMode,
    fsSelectedMonth,
    fsSelectedWeek,
    fsAppliedFrom,
    fsAppliedTo,
    fsPeriodLabel,
    financialLoadRows,
    financialCashInRows,
    financialConvertingRows,
  ]);

  const handleDownloadDailyCollectionsPdf = useCallback(() => {
    downloadDailyCollectionsReportPdf(
      {
        reportDate: dailyReportDate,
        totals: dailyReportTotals,
        shopRows: dailyReportShopRows,
        chequeRows: dailyReportChequeRows,
        chequeTotal: dailyReportChequeTotal,
      },
      { dateSlug: dailyReportDate },
    );
  }, [
    dailyReportDate,
    dailyReportTotals,
    dailyReportShopRows,
    dailyReportChequeRows,
    dailyReportChequeTotal,
  ]);

  return (
    <div className="space-y-5">
      <div className="rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-6">
        <h1 className="text-lg font-bold text-slate-900">Reports</h1>
        <p className="mt-1 text-sm text-slate-500">
          {collectorReportsView
            ? 'Daily collections, monthly bills, and settled collections for your assigned shops.'
            : showDailyCollectionsReport
              ? 'Daily collections for managers, plus monthly summaries and downloadable reports.'
              : 'Monthly summaries, balances, and downloadable reports.'}
        </p>
      </div>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      {showDailyCollectionsReport ? (
        <Card
          title="Daily collections report"
          subtitle={
            collectorReportsView
              ? 'Collections and cheques received from your assigned shops on the selected day'
              : 'Collections and cheques received for the selected day (manager / admin)'
          }
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className={filterLabelNarrow}>
              Report date
              <input
                type="date"
                value={dailyReportDate}
                max={localYmd()}
                onChange={(e) => setDailyReportDate(e.target.value || localYmd())}
                className={filterControl}
              />
            </label>
            <button
              type="button"
              onClick={handleDownloadDailyCollectionsPdf}
              disabled={loading || !!error}
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Download report (PDF)
            </button>
          </div>

          {loading ? (
            <p className="mt-5 rounded-[20px] bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              <LoadingSpinner label="Loading daily report…" />
            </p>
          ) : (
            <>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-100">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Collections</p>
                  <SummaryLkrAmount value={dailyReportTotals.collections} valueClassName="text-emerald-900" />
                  <p className="mt-0.5 text-xs text-emerald-600">
                    {dailyReportTotals.paymentCount} payment
                    {dailyReportTotals.paymentCount === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="rounded-xl bg-sky-50 p-4 ring-1 ring-sky-100">
                  <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Cash</p>
                  <SummaryLkrAmount value={dailyReportTotals.cash} valueClassName="text-sky-900" />
                </div>
                <div className="rounded-xl bg-violet-50 p-4 ring-1 ring-violet-100">
                  <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Cheque</p>
                  <SummaryLkrAmount value={dailyReportTotals.cheque} valueClassName="text-violet-900" />
                  <p className="mt-0.5 text-xs text-violet-600">
                    {dailyReportChequeRows.length} cheque{dailyReportChequeRows.length === 1 ? '' : 's'}
                  </p>
                </div>
              </div>

              <h3 className="mt-6 text-xs font-bold uppercase tracking-wide text-slate-500">By shop</h3>
              <div className="mt-3 space-y-3 sm:hidden">
                {dailyReportShopRows.length === 0 ? (
                  <p className="rounded-[20px] bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-100">
                    No collections on {dailyReportDate}.
                  </p>
                ) : (
                  dailyReportShopRows.map((r) => (
                    <MobileRowCard
                      key={r.shop}
                      title={r.shop}
                      subtitle={r.location || '—'}
                      fields={[
                        { label: 'Cash', value: money(r.cashCollected) },
                        { label: 'Cheque', value: money(r.chequeCollected) },
                        { label: 'Collections', value: money(r.cashIn) },
                      ]}
                    />
                  ))
                )}
              </div>
              <div className={`mt-3 hidden sm:block ${scrollTableWrap}`}>
                <table className="w-full min-w-[600px] border-separate border-spacing-0 text-left text-sm">
                  <thead className={stickyThead}>
                    <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Shop</th>
                      <th className="whitespace-nowrap px-4 py-3">Location</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right">Cash</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right">Cheque</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right">Collections</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyReportShopRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                          No collections on {dailyReportDate}.
                        </td>
                      </tr>
                    ) : (
                      dailyReportShopRows.map((r) => (
                        <tr key={r.shop} className="border-t border-slate-100 hover:bg-slate-50/80">
                          <td className={`whitespace-nowrap px-4 py-3 font-medium text-slate-900 ${stickyFirstTd}`}>
                            {r.shop}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.location || '—'}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-sky-800">
                            {r.cashCollected > 0 ? money(r.cashCollected) : '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-violet-800">
                            {r.chequeCollected > 0 ? money(r.chequeCollected) : '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-emerald-700">
                            {r.cashIn > 0 ? money(r.cashIn) : '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {dailyReportShopRows.length > 0 ? (
                    <tfoot>
                      <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold text-slate-900">
                        <td className="px-4 py-3" colSpan={2}>
                          Total ({dailyReportShopRows.length} shop
                          {dailyReportShopRows.length === 1 ? '' : 's'})
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-sky-800">
                          {money(dailyReportTotals.cash)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-violet-800">
                          {money(dailyReportTotals.cheque)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-emerald-700">
                          {money(dailyReportTotals.collections)}
                        </td>
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>

              <h3 className="mt-8 text-xs font-bold uppercase tracking-wide text-slate-500">Cheque list</h3>
              <p className="mt-1 text-xs text-slate-500">
                Cheques recorded on payments dated {dailyReportDate}.
              </p>
              <div className="mt-3 space-y-3 sm:hidden">
                {dailyReportChequeRows.length === 0 ? (
                  <p className="rounded-[20px] bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-100">
                    No cheques on this day.
                  </p>
                ) : (
                  dailyReportChequeRows.map((r) => (
                    <MobileRowCard
                      key={r.id}
                      title={r.customerName}
                      subtitle={r.chequeDate}
                      fields={[
                        { label: 'Amount', value: money(r.amount) },
                        { label: 'Cheque #', value: r.chequeNumber },
                        { label: 'Bill #', value: r.billNumber },
                        {
                          label: 'Deposited',
                          value: r.chequeDeposited ? 'Yes' : 'Pending',
                        },
                      ]}
                    />
                  ))
                )}
              </div>
              <div className={`mt-3 hidden sm:block ${scrollTableWrap}`}>
                <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
                  <thead className={stickyThead}>
                    <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Shop</th>
                      <th className="whitespace-nowrap px-4 py-3">Cheque date</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
                      <th className="whitespace-nowrap px-4 py-3 font-mono">Cheque #</th>
                      <th className="whitespace-nowrap px-4 py-3 font-mono">Bill #</th>
                      <th className="whitespace-nowrap px-4 py-3">Deposited</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyReportChequeRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                          No cheques on this day.
                        </td>
                      </tr>
                    ) : (
                      dailyReportChequeRows.map((r) => (
                        <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                          <td className={`px-4 py-3 font-medium text-slate-900 ${stickyFirstTd}`}>{r.customerName}</td>
                          <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{r.chequeDate}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-violet-800">
                            {money(r.amount)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 font-mono text-sm">{r.chequeNumber}</td>
                          <td className="whitespace-nowrap px-4 py-3 font-mono text-sm tabular-nums">{r.billNumber}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm">
                            {r.chequeDeposited ? (
                              <span className="font-semibold text-emerald-700">Deposited</span>
                            ) : (
                              <span className="font-semibold text-amber-700">Pending</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {dailyReportChequeRows.length > 0 ? (
                    <tfoot>
                      <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold text-slate-900">
                        <td className={`px-4 py-3 ${stickyFirstTd}`} colSpan={2}>
                          Total ({dailyReportChequeRows.length} cheque
                          {dailyReportChequeRows.length === 1 ? '' : 's'})
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-violet-800">
                          {money(dailyReportChequeTotal)}
                        </td>
                        <td className="px-4 py-3" colSpan={3} />
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>
            </>
          )}
        </Card>
      ) : null}

      <Card
        title="Settled collections"
        subtitle={
          collectorReportsView
            ? `Your fully settled invoices by settled date in ${collectionsMonthLabel}`
            : `Fully settled invoices by settled date in ${collectionsMonthLabel} — filter by collector`
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className={filterLabelNarrow}>
            Settled in month
            <input
              type="month"
              value={collectionsMonth}
              onChange={(e) => setCollectionsMonth(e.target.value || currentMonthValue())}
              className={filterControl}
            />
          </label>
          {!collectorReportsView ? (
            <label className={filterLabel}>
              Collector
              <select
                value={collectionsCollectorId}
                onChange={(e) => setCollectionsCollectorId(e.target.value)}
                className={filterControl}
              >
                <option value="">All collectors</option>
                {collectors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            onClick={handleDownloadSettledCollectionsPdf}
            disabled={
              loading ||
              !!error ||
              settledCollectionsRows.length === 0 ||
              (collectorReportsView && !collectorStaffUserId)
            }
            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download PDF
          </button>
        </div>

        <div className={`mt-5 ${scrollTableWrap}`}>
          <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Days to settle</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Lines</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Collection amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {COLLECTION_DAY_BUCKETS.map((bucket) => {
                const s = settledCollectionsBucketSummary[bucket.key] || {};
                return (
                  <tr key={bucket.key} className="bg-white">
                    <td className={`whitespace-nowrap px-4 py-3 font-medium ${stickyFirstTd}`}>{bucket.label}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{s.lineCount || 0}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-semibold">
                      {money(s.amount || 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-indigo-50/60 font-semibold text-indigo-950">
                <td className="px-4 py-3">Total</td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                  {settledCollectionsRows.length}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(settledCollectionsTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className={`mt-6 ${scrollTableWrap}`}>
          <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
                <th className="whitespace-nowrap px-4 py-3">Invoice #</th>
                <th className="whitespace-nowrap px-4 py-3">Shop name</th>
                <th className="whitespace-nowrap px-4 py-3">Bag type</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
                <th className="whitespace-nowrap px-4 py-3">Bill date</th>
                <th className="whitespace-nowrap px-4 py-3">Settled date</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Days</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Bill amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading || (collectorReportsView && !collectorStaffUserId) ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : settledCollectionsRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    No settled collections for {collectionsCollectorLabel} in {collectionsMonthLabel}.
                  </td>
                </tr>
              ) : (
                settledCollectionsRows.map((r) => {
                  const brand = brands.find((b) => b.key === r.brandKey);
                  return (
                    <tr key={r.rowKey} className="border-t border-slate-100 hover:bg-slate-50/80">
                      <td className={`whitespace-nowrap px-4 py-3 tabular-nums text-slate-600 ${stickyFirstTd}`}>
                        {r.date}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{r.invoiceNumber}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">{r.shopName}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {r.bagType !== '—' ? (
                          <span
                            className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${
                              brand?.iconBg || 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {r.bagType}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(r.amount)}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{r.billDate}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{r.settledDate}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{r.daysToSettle}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(r.billAmount)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Bills by month"
        subtitle={
          collectorReportsView
            ? `Credit bills for your assigned shops in ${billsMonthLabel} — settled date from payments (oldest bills first)`
            : `All credit bills in ${billsMonthLabel} — settled date from payments (oldest bills first)`
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className={filterLabelNarrow}>
            Month
            <input
              type="month"
              value={billsMonth}
              onChange={(e) => setBillsMonth(e.target.value || currentMonthValue())}
              className={filterControl}
            />
          </label>
          <button
            type="button"
            onClick={handleDownloadMonthlyBills}
            disabled={loading || !!error}
            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download bills (PDF)
          </button>
        </div>

        <div className="mt-5 hidden">
          {loading ? (
            <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
              <LoadingSpinner />
            </p>
          ) : monthlyBillRows.length === 0 ? (
            <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
              No credit bills in {billsMonthLabel}.
            </p>
          ) : (
            monthlyBillRows.map((r) => (
              <MobileRowCard
                key={r.rowKey}
                title={r.shop}
                subtitle={r.date}
                badge={r.bagType !== '—' ? r.bagType : null}
                fields={[
                  { label: 'Bags', value: r.bagCount.toLocaleString() },
                  { label: 'Amount', value: money(r.amount) },
                  { label: 'Settled', value: r.settledDate || '—' },
                  { label: 'Days', value: r.daysToSettle != null ? r.daysToSettle : '—' },
                ]}
              />
            ))
          )}
        </div>

        <div className={`mt-5 hidden sm:block ${scrollTableWrap}`}>
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
                <th className="whitespace-nowrap px-4 py-3">Shop name</th>
                <th className="whitespace-nowrap px-4 py-3">Bag type</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Bag count</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
                <th className="whitespace-nowrap px-4 py-3">Bill settled date</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Days to settle</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : monthlyBillRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No credit bills in {billsMonthLabel}.
                  </td>
                </tr>
              ) : (
                monthlyBillRows.map((r) => {
                  const brand = brands.find((b) => b.key === r.brandKey);
                  return (
                    <tr key={r.rowKey} className="border-t border-slate-100 hover:bg-slate-50/80">
                      <td className={`whitespace-nowrap px-4 py-3 tabular-nums text-slate-600 ${stickyFirstTd}`}>{r.date}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">{r.shop}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {r.bagType !== '—' ? (
                          <span
                            className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${
                              brand?.iconBg || 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {r.bagType}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-800">
                        {r.bagCount.toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                        {money(r.amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">
                        {r.settledDate || '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">
                        {r.daysToSettle != null ? r.daysToSettle : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {!loading && monthlyBillRows.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-indigo-50/60 font-semibold text-slate-900">
                  <td className="px-4 py-3" colSpan={3}>
                    Total ({monthlyBillRows.length} line{monthlyBillRows.length === 1 ? '' : 's'})
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {monthlyBillTotals.bagCount.toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-indigo-900">
                    {money(monthlyBillTotals.amount)}
                  </td>
                  <td className="px-4 py-3" colSpan={2} />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </Card>

      {!collectorReportsView ? (
      <>
      <Card
        title="Daily bags sold by shop"
        subtitle={`Bags sold per shop and brand for each day of ${dailyBagsMonthLabel}${
          dailyBagsActiveBrand ? ` · ${dailyBagsActiveBrand.label}` : ' · all brands'
        }`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className={filterLabelNarrow}>
            Month
            <input
              type="month"
              value={dailyBagsMonth}
              onChange={(e) => setDailyBagsMonth(e.target.value || currentMonthValue())}
              className={filterControl}
            />
          </label>
          <label className={filterLabelNarrow}>
            Brand
            <select
              value={dailyBagsBrand}
              onChange={(e) => setDailyBagsBrand(e.target.value)}
              className={filterControl}
            >
              <option value="">All brands</option>
              {brands.map((b) => (
                <option key={b.key} value={b.key}>
                  {formatBrandLabel(b) || b.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleDownloadDailyBagsByShop}
            disabled={loading || !!error}
            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download report (PDF + Excel)
          </button>
        </div>

        <div className="mt-5 space-y-3 sm:hidden">
          {loading ? (
            <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
              <LoadingSpinner />
            </p>
          ) : dailyBagsReport.rows.length === 0 ? (
            <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
              No bags sold in {dailyBagsMonthLabel}.
            </p>
          ) : (
            dailyBagsReport.rows.map((r) => {
              const brand = brands.find((b) => b.key === r.brandKey);
              const soldDays = r.dayBags
                .map((n, i) => (n > 0 ? { day: i + 1, bags: n } : null))
                .filter(Boolean);
              return (
                <MobileRowCard
                  key={r.rowKey}
                  title={r.shop}
                  subtitle={`${soldDays.length} day${soldDays.length === 1 ? '' : 's'} with sales`}
                  badge={
                    <span
                      className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${
                        brand?.iconBg || 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {r.brand}
                    </span>
                  }
                  fields={[
                    { label: 'Month total', value: r.total.toLocaleString() },
                    {
                      label: 'By day',
                      value:
                        soldDays.length === 0
                          ? '—'
                          : soldDays.map((d) => `${d.day}: ${d.bags}`).join(' · '),
                    },
                  ]}
                />
              );
            })
          )}
        </div>

        <div className={`mt-5 hidden sm:block ${scrollTableWrap}`}>
          <table
            className="w-full border-separate border-spacing-0 text-left text-sm"
            style={{ minWidth: `${220 + dailyBagsReport.daysInMonth * 36 + 64}px` }}
          >
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className={`whitespace-nowrap px-3 py-3 ${stickyFirstTh}`}>Shop name</th>
                <th className="whitespace-nowrap px-3 py-3">Brand</th>
                {Array.from({ length: dailyBagsReport.daysInMonth }, (_, i) => (
                  <th key={i + 1} className="whitespace-nowrap px-2 py-3 text-center tabular-nums">
                    {i + 1}
                  </th>
                ))}
                <th className="whitespace-nowrap px-3 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={dailyBagsReport.daysInMonth + 3}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : dailyBagsReport.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={dailyBagsReport.daysInMonth + 3}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No bags sold in {dailyBagsMonthLabel}.
                  </td>
                </tr>
              ) : (
                dailyBagsReport.rows.map((r) => {
                  const brand = brands.find((b) => b.key === r.brandKey);
                  return (
                    <tr key={r.rowKey} className="border-t border-slate-100 hover:bg-slate-50/80">
                      {r.shopRowSpan > 0 ? (
                        <td
                          rowSpan={r.shopRowSpan}
                          className={`whitespace-nowrap px-3 py-2.5 align-middle font-medium text-slate-900 ${stickyFirstTd}`}
                        >
                          {r.shop}
                        </td>
                      ) : null}
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span
                          className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${
                            brand?.iconBg || 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {r.brand}
                        </span>
                      </td>
                      {r.dayBags.map((n, i) => (
                        <td
                          key={i}
                          className={`whitespace-nowrap px-2 py-2.5 text-center tabular-nums ${
                            n > 0 ? 'font-medium text-slate-800' : 'text-slate-300'
                          }`}
                        >
                          {n > 0 ? n.toLocaleString() : '—'}
                        </td>
                      ))}
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                        {r.total.toLocaleString()}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {!loading && dailyBagsReport.rows.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-indigo-50/60 font-semibold text-slate-900">
                  <td className="sticky left-0 z-[11] bg-indigo-50 px-3 py-3 shadow-[2px_0_4px_-2px_rgba(15,23,42,0.06)]" colSpan={2}>
                    Total ({dailyBagsReport.shopCount || dailyBagsReport.rows.length} shop
                    {(dailyBagsReport.shopCount || dailyBagsReport.rows.length) === 1 ? '' : 's'} ·{' '}
                    {dailyBagsReport.rows.length} brand row
                    {dailyBagsReport.rows.length === 1 ? '' : 's'})
                  </td>
                  {dailyBagsReport.dayTotals.map((n, i) => (
                    <td key={i} className="whitespace-nowrap px-2 py-3 text-center tabular-nums">
                      {n > 0 ? n.toLocaleString() : '—'}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-indigo-900">
                    {dailyBagsReport.grandTotal.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </Card>

      <Card
        title="Shop targets"
        subtitle={`Monthly bag sales vs target for ${shopTargetsMonthLabel} — from credit bills and customer targets`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className={filterLabelNarrow}>
            Month
            <input
              type="month"
              value={shopTargetsMonth}
              onChange={(e) => setShopTargetsMonth(e.target.value || currentMonthValue())}
              className={filterControl}
            />
          </label>
          <button
            type="button"
            onClick={handleDownloadShopTargets}
            disabled={loading || !!error}
            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download report (PDF)
          </button>
        </div>

        <div className="mt-5 space-y-3 sm:hidden">
          {loading ? (
            <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
              <LoadingSpinner />
            </p>
          ) : shopTargetsReport.rows.length === 0 ? (
            <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
              No shop sales or targets in {shopTargetsMonthLabel}.
            </p>
          ) : (
            shopTargetsReport.rows.map((r) => (
              <MobileRowCard
                key={r.rowKey}
                title={r.shop}
                fields={[
                  ...brands.map((b) => ({
                    label: formatBrandLabel(b) || b.label,
                    value: (r.byBrand[b.key] || 0).toLocaleString(),
                  })),
                  { label: 'Total bags', value: r.total.toLocaleString() },
                  {
                    label: 'Monthly target',
                    value: r.monthlyTargetBags > 0 ? r.monthlyTargetBags.toLocaleString() : '—',
                  },
                  {
                    label: 'Completed',
                    value:
                      r.progressPct != null ? (
                        <MonthlyTargetProgressBar
                          sold={r.total}
                          target={r.monthlyTargetBags}
                          progressPct={r.progressPct}
                          compact
                        />
                      ) : (
                        '—'
                      ),
                  },
                ]}
              />
            ))
          )}
        </div>

        <div className={`mt-5 hidden sm:block ${scrollTableWrap}`}>
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Shop name</th>
                {brands.map((b) => (
                  <th key={b.key} className="whitespace-nowrap px-4 py-3 text-right">
                    {formatBrandLabel(b) || b.label} bags
                  </th>
                ))}
                <th className="whitespace-nowrap px-4 py-3 text-right">Total bags</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Monthly target</th>
                <th className="min-w-[10rem] whitespace-nowrap px-4 py-3">Completed</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={brands.length + 4} className="px-4 py-8 text-center text-slate-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : shopTargetsReport.rows.length === 0 ? (
                <tr>
                  <td colSpan={brands.length + 4} className="px-4 py-8 text-center text-slate-500">
                    No shop sales or targets in {shopTargetsMonthLabel}.
                  </td>
                </tr>
              ) : (
                shopTargetsReport.rows.map((r) => (
                  <tr key={r.rowKey} className="border-t border-slate-100 hover:bg-slate-50/80">
                    <td className={`whitespace-nowrap px-4 py-3 font-medium text-slate-900 ${stickyFirstTd}`}>
                      {r.shop}
                    </td>
                    {brands.map((b) => (
                      <td
                        key={b.key}
                        className={`whitespace-nowrap px-4 py-3 text-right tabular-nums ${
                          r.byBrand[b.key] > 0 ? 'text-slate-800' : 'text-slate-300'
                        }`}
                      >
                        {r.byBrand[b.key] > 0 ? r.byBrand[b.key].toLocaleString() : '—'}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                      {r.total.toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">
                      {r.monthlyTargetBags > 0 ? r.monthlyTargetBags.toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {r.monthlyTargetBags > 0 ? (
                        <MonthlyTargetProgressBar
                          sold={r.total}
                          target={r.monthlyTargetBags}
                          progressPct={r.progressPct}
                          compact
                        />
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {!loading && shopTargetsReport.rows.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-indigo-50/60 font-semibold text-slate-900">
                  <td className={`px-4 py-3 ${stickyFirstTd}`}>
                    Total ({shopTargetsReport.rows.length} shop
                    {shopTargetsReport.rows.length === 1 ? '' : 's'})
                  </td>
                  {brands.map((b) => (
                    <td key={b.key} className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {(shopTargetsReport.totals.byBrand[b.key] || 0).toLocaleString()}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {shopTargetsReport.totals.total.toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {shopTargetsReport.totals.monthlyTargetBags > 0
                      ? shopTargetsReport.totals.monthlyTargetBags.toLocaleString()
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {shopTargetsReport.overallProgressPct != null ? (
                      <span className="text-xs font-semibold tabular-nums text-indigo-800">
                        {shopTargetsReport.overallProgressPct}%
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </Card>

      <Card
        title="Stock Distribution per month"
        subtitle={`Carry-over, bags in/out, and shop distributions for ${stockDistMonthLabel}${
          stockDistActiveBrand ? ` · ${stockDistActiveBrand.label}` : ' · all brands'
        }${stockDistMonthPurchasesOnly ? ' · stocks purchased this month only' : ''} — rows grouped by stock`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className={filterLabelNarrow}>
            Month
            <input
              type="month"
              value={stockDistMonth}
              onChange={(e) => setStockDistMonth(e.target.value || currentMonthValue())}
              className={filterControl}
            />
          </label>
          <label className={filterLabelNarrow}>
            Brand
            <select
              value={stockDistBrand}
              onChange={(e) => setStockDistBrand(e.target.value)}
              className={filterControl}
            >
              <option value="">All brands</option>
              {brands.map((b) => (
                <option key={b.key} value={b.key}>
                  {formatBrandLabel(b) || b.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex cursor-pointer items-center gap-2 pb-2.5 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={stockDistMonthPurchasesOnly}
              onChange={(e) => setStockDistMonthPurchasesOnly(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/40"
            />
            Stocks purchased this month only
          </label>
          <button
            type="button"
            onClick={handleDownloadStockDistribution}
            disabled={loading || !!error}
            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download stock distribution (PDF)
          </button>
        </div>

        <div className="mt-4 hidden gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Remaining from last month
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">
              {stockDistRemaining.remainingStart.toLocaleString()}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">bags at month start</p>
            <BrandRemainingBreakdown
              byBrand={stockDistRemaining.byBrandStart}
              brandKey={stockDistBrand}
            />
          </div>
          <div className="rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Remaining at month end
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums text-emerald-900">
              {stockDistRemaining.remainingEnd.toLocaleString()}
            </p>
            <p className="mt-0.5 text-xs text-emerald-600">bags left after month</p>
            <BrandRemainingBreakdown
              byBrand={stockDistRemaining.byBrandEnd}
              brandKey={stockDistBrand}
            />
          </div>
          <div className="rounded-xl bg-sky-50 p-4 ring-1 ring-sky-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">All bags in</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-sky-900">
              {stockDistInOut.bagsIn.toLocaleString()}
            </p>
            <p className="mt-0.5 text-xs text-sky-600">{money(stockDistInOut.bagsInAmount)}</p>
          </div>
          <div className="rounded-xl bg-violet-50 p-4 ring-1 ring-violet-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
              All bags distributed
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums text-violet-900">
              {stockDistInOut.bagsOut.toLocaleString()}
            </p>
            <p className="mt-0.5 text-xs text-violet-600">{money(stockDistInOut.bagsOutAmount)}</p>
          </div>
        </div>

        <div className="mt-5 hidden">
          {loading ? (
            <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
              <LoadingSpinner />
            </p>
          ) : stockDistGroups.length === 0 ? (
            <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
              No shop distributions in {stockDistMonthLabel}
              {stockDistActiveBrand ? ` for ${stockDistActiveBrand.label}` : ''}
              {stockDistMonthPurchasesOnly ? ' from stocks purchased this month' : ''}.
            </p>
          ) : (
            stockDistGroups.flatMap((g) => [
              ...g.rows.map((r) => (
                <MobileRowCard
                  key={r.rowKey}
                  title={r.stockId}
                  subtitle={`${r.date} · ${r.shop}`}
                  badge={r.bagType}
                  fields={[
                    { label: 'Bags', value: r.bags.toLocaleString() },
                    { label: 'Per bag', value: r.perBagPrice != null ? money(r.perBagPrice) : '—' },
                    { label: 'Total', value: money(r.totalAmount) },
                  ]}
                />
              )),
              <MobileRowCard
                key={`${g.stockId}-subtotal`}
                title={`Stock ${g.stockId} total`}
                subtitle={g.purchaseDate ? `Purchased ${g.purchaseDate}` : undefined}
                fields={[
                  { label: 'Bags', value: g.bags.toLocaleString() },
                  { label: 'Total', value: money(g.totalAmount) },
                ]}
              />,
            ])
          )}
        </div>

        <div className={`mt-5 hidden sm:block ${scrollTableWrap}`}>
          <table className="w-full min-w-[780px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>StockID</th>
                <th className="whitespace-nowrap px-4 py-3">Date</th>
                <th className="whitespace-nowrap px-4 py-3">Shop name</th>
                <th className="whitespace-nowrap px-4 py-3">Bag type</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Per bag price</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Total amount</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : stockDistGroups.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No shop distributions in {stockDistMonthLabel}
                    {stockDistActiveBrand ? ` for ${stockDistActiveBrand.label}` : ''}
                    {stockDistMonthPurchasesOnly ? ' from stocks purchased this month' : ''}.
                  </td>
                </tr>
              ) : (
                stockDistGroups.flatMap((g) => [
                  ...g.rows.map((r) => {
                    const brand = brands.find((b) => b.key === r.brandKey);
                    return (
                      <tr
                        key={r.rowKey}
                        className="border-t border-slate-100 hover:bg-slate-50/80"
                      >
                        <td className={`whitespace-nowrap px-4 py-3 font-medium text-slate-900 ${stickyFirstTd}`}>
                          {r.stockId}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">
                          {r.date}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-800">{r.shop}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${
                              brand?.iconBg || 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {r.bagType}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-800">
                          {r.bags.toLocaleString()}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">
                          {r.perBagPrice != null ? money(r.perBagPrice) : '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                          {money(r.totalAmount)}
                        </td>
                      </tr>
                    );
                  }),
                  <tr
                    key={`${g.stockId}-subtotal`}
                    className="border-t border-slate-200 bg-slate-50/90 font-semibold text-slate-900"
                  >
                    <td className="px-4 py-3" colSpan={4}>
                      Stock {g.stockId} total
                      {g.purchaseDate ? (
                        <span className="ml-2 font-normal text-slate-500">
                          · purchased {g.purchaseDate}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {g.bags.toLocaleString()}
                    </td>
                    <td className="px-4 py-3" />
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-indigo-800">
                      {money(g.totalAmount)}
                    </td>
                  </tr>,
                ])
              )}
            </tbody>
            {!loading && stockDistGroups.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-indigo-50/60 font-semibold text-slate-900">
                  <td className="px-4 py-3" colSpan={4}>
                    Grand total
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {stockDistTableTotals.bags.toLocaleString()}
                  </td>
                  <td className="px-4 py-3" />
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-indigo-900">
                    {money(stockDistTableTotals.totalAmount)}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </Card>

      <Card
        title="Total loads summary"
        subtitle={`Bags brought in during ${loadsSummaryMonthLabel} — credit invoices that month with days from bill date, outstanding | total per shop`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className={filterLabelNarrow}>
            Month
            <input
              type="month"
              value={loadsSummaryMonth}
              onChange={(e) => setLoadsSummaryMonth(e.target.value || currentMonthValue())}
              className={filterControl}
            />
          </label>
          <button
            type="button"
            onClick={handleDownloadLoadsSummary}
            disabled={loading || !!error}
            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download loads summary (PDF)
          </button>
        </div>

        <div className="mt-4 hidden gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl bg-slate-800 p-4 text-white shadow-md ring-1 ring-slate-700">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/85">Bags from loads</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{monthLoadsReport.total.toLocaleString()}</p>
            <p className="mt-0.5 text-xs text-white/75">
              {monthLoadsReport.loadCount} load{monthLoadsReport.loadCount === 1 ? '' : 's'}
            </p>
          </div>
          <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Load purchase total</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-amber-900">{money(monthLoadsReport.totalAmount)}</p>
          </div>
          <div className="rounded-xl bg-sky-50 p-4 ring-1 ring-sky-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Bags sold</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-sky-900">
              {monthShopTotals.totalBags.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl bg-violet-50 p-4 ring-1 ring-violet-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Invoice total</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-violet-900">
              {money(monthInvoiceGrandTotals.totalAmount)}
            </p>
          </div>
          <div className="rounded-xl bg-rose-50 p-4 ring-1 ring-rose-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Outstanding (shops)</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-rose-900">
              {money(monthInvoiceGrandTotals.outstanding)}
            </p>
          </div>
        </div>

        <div className="mt-5 hidden">
          {loading ? (
            <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
              <LoadingSpinner />
            </p>
          ) : monthInvoiceGroups.length === 0 ? (
            <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
              No credit invoices in {loadsSummaryMonthLabel}.
            </p>
          ) : (
            monthInvoiceGroups.flatMap((g) => [
              ...g.invoices.map((inv, idx) => (
                <MobileRowCard
                  key={`${g.shop}-${inv.invoiceDate}-${idx}`}
                  title={inv.shop}
                  subtitle={inv.invoiceDate}
                  fields={[
                    { label: 'Days', value: inv.daysFromBillDate },
                    { label: 'Amount', value: money(inv.amount) },
                  ]}
                />
              )),
              <MobileRowCard
                key={`${g.shop}-subtotal`}
                title={g.shop}
                subtitle="Outstanding | Total"
                fields={[
                  { label: 'Outstanding', value: money(g.outstanding) },
                  { label: 'Total', value: money(g.totalAmount) },
                ]}
              />,
            ])
          )}
        </div>

        <div className={`mt-5 hidden sm:block ${scrollTableWrap}`}>
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Shop name</th>
                <th className="whitespace-nowrap px-4 py-3">Invoice date</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Days from bill date</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : monthInvoiceGroups.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    No credit invoices in {loadsSummaryMonthLabel}.
                  </td>
                </tr>
              ) : (
                monthInvoiceGroups.flatMap((g) => [
                  ...g.invoices.map((inv, idx) => (
                    <tr
                      key={`${g.shop}-${inv.invoiceDate}-${idx}`}
                      className="border-t border-slate-100 hover:bg-slate-50/80"
                    >
                      <td className={`whitespace-nowrap px-4 py-3 font-medium text-slate-900 ${stickyFirstTd}`}>{inv.shop}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">
                        {inv.invoiceDate}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">
                        {inv.daysFromBillDate}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                        {money(inv.amount)}
                      </td>
                    </tr>
                  )),
                  <tr
                    key={`${g.shop}-subtotal`}
                    className="border-t border-slate-200 bg-slate-50/90 font-semibold text-slate-900"
                  >
                    <td className={`px-4 py-3 ${stickyFirstTd}`}>{g.shop}</td>
                    <td className="px-4 py-3 text-slate-600" colSpan={2}>
                      Outstanding | Total
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-indigo-800">
                      {money(g.outstanding)} | {money(g.totalAmount)}
                    </td>
                  </tr>,
                ])
              )}
            </tbody>
            {!loading && monthInvoiceGroups.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-indigo-50/60 font-semibold text-slate-900">
                  <td className={`px-4 py-3 ${stickyFirstTd}`}>Grand total</td>
                  <td className="px-4 py-3 text-slate-600" colSpan={2}>
                    Outstanding | Total
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-indigo-900">
                    {money(monthInvoiceGrandTotals.outstanding)} |{' '}
                    {money(monthInvoiceGrandTotals.totalAmount)}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </Card>

      <Card
        title="Financial summary"
        subtitle={`Loads purchased, cash in from shops, and cheques to convert — ${fsPeriodLabel}`}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-slate-600">Period</span>
              <div className="inline-flex rounded-xl bg-slate-100/90 p-1 ring-1 ring-slate-200/60">
                <button
                  type="button"
                  className={`${periodBtn} ${fsPeriodMode === 'weekly' ? periodActive : periodIdle}`}
                  onClick={() => handleFsPeriodChange('weekly')}
                >
                  Weekly
                </button>
                <button
                  type="button"
                  className={`${periodBtn} ${fsPeriodMode === 'monthly' ? periodActive : periodIdle}`}
                  onClick={() => handleFsPeriodChange('monthly')}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  className={`${periodBtn} ${fsPeriodMode === 'custom' ? periodActive : periodIdle}`}
                  onClick={() => setFsPeriodMode('custom')}
                >
                  Custom
                </button>
              </div>
            </div>

            {fsPeriodMode === 'weekly' ? (
              <label className={filterLabelNarrow}>
                Week
                <input
                  type="week"
                  value={fsSelectedWeek}
                  onChange={(e) => applyFsWeek(e.target.value)}
                  className={filterControl}
                />
              </label>
            ) : null}

            {fsPeriodMode === 'monthly' ? (
              <label className={filterLabelNarrow}>
                Month
                <input
                  type="month"
                  value={fsSelectedMonth}
                  onChange={(e) => applyFsMonth(e.target.value)}
                  className={filterControl}
                />
              </label>
            ) : null}

            {fsPeriodMode === 'custom' ? (
              <>
                <label className={filterLabelNarrow}>
                  From date
                  <input
                    type="date"
                    value={fsDateFrom}
                    onChange={(e) => setFsDateFrom(e.target.value)}
                    className={filterControl}
                  />
                </label>
                <label className={filterLabelNarrow}>
                  To date
                  <input
                    type="date"
                    value={fsDateTo}
                    onChange={(e) => setFsDateTo(e.target.value)}
                    className={filterControl}
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={handleFsGenerate}
                    className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
                  >
                    Apply period
                  </button>
                </div>
              </>
            ) : null}

            <button
              type="button"
              onClick={handleDownloadFinancialSummary}
              disabled={loading || !!error}
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Download financial summary (PDF)
            </button>
          </div>

          <div className="hidden gap-3 sm:grid sm:grid-cols-3">
            <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-100">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Loads purchased</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-amber-900">
                {money(financialLoadGrandTotal)}
              </p>
              <p className="mt-0.5 text-xs text-amber-600">
                {financialLoadRows.length} line{financialLoadRows.length === 1 ? '' : 's'}
              </p>
            </div>
            <div className="rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-100">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Cash in total</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-emerald-900">
                {money(financialCashInTotals.total)}
              </p>
              <p className="mt-0.5 text-xs text-emerald-600">
                Cash {money(financialCashInTotals.cash)} · Cheques {money(financialCashInTotals.cheque)}
              </p>
            </div>
            <div className="rounded-xl bg-rose-50 p-4 ring-1 ring-rose-100">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Cheques converting</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-rose-900">
                {money(financialConvertingTotal)}
              </p>
              <p className="mt-0.5 text-xs text-rose-600">
                {financialConvertingRows.length} cheque{financialConvertingRows.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 hidden space-y-6 sm:block">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">1. All loads purchased</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Stock loads in the period — date, vehicle, cheque, invoice, bag type, bags, and cost
            </p>
            <div className="mt-3 hidden">
              {loading ? (
                <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
                  <LoadingSpinner />
                </p>
              ) : financialLoadRows.length === 0 ? (
                <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
                  No loads purchased in {fsPeriodLabel}.
                </p>
              ) : (
                financialLoadRows.map((r) => (
                  <MobileRowCard
                    key={r.rowKey}
                    title={r.vehicle}
                    subtitle={r.date}
                    badge={r.bagType}
                    fields={[
                      { label: 'Invoice', value: r.invoiceNumber },
                      { label: 'Cheque', value: r.chequeNumber },
                      { label: 'Bags', value: r.bags.toLocaleString() },
                      { label: 'Cost', value: money(r.totalCost) },
                    ]}
                  />
                ))
              )}
            </div>
            <div className={`mt-3 hidden sm:block ${scrollTableWrap}`}>
              <table className="w-full min-w-[880px] border-separate border-spacing-0 text-left text-sm">
                <thead className={stickyThead}>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
                    <th className="whitespace-nowrap px-4 py-3">Vehicle</th>
                    <th className="whitespace-nowrap px-4 py-3">Cheque number</th>
                    <th className="whitespace-nowrap px-4 py-3">Invoice number</th>
                    <th className="whitespace-nowrap px-4 py-3">Bag type</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">No of bags</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Total cost</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                        <LoadingSpinner />
                      </td>
                    </tr>
                  ) : financialLoadRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                        No loads purchased in {fsPeriodLabel}.
                      </td>
                    </tr>
                  ) : (
                    financialLoadRows.map((r) => (
                      <tr key={r.rowKey} className="border-t border-slate-100 hover:bg-slate-50/80">
                        <td className={`whitespace-nowrap px-4 py-3 tabular-nums text-slate-600 ${stickyFirstTd}`}>{r.date}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">{r.vehicle}</td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">
                          {r.chequeNumber}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">
                          {r.invoiceNumber}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">{r.bagType}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700">
                          {r.bags.toLocaleString()}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                          {money(r.totalCost)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {!loading && financialLoadRows.length > 0 ? (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-indigo-50/60 font-semibold text-slate-900">
                      <td className="px-4 py-3" colSpan={6}>
                        Grand total
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-indigo-900">
                        {money(financialLoadGrandTotal)}
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-800">2. Total cash in</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Cash and cheques from shops — cheque number, date, and amount shown under each row when present
            </p>
            <div className="mt-3 hidden">
              {loading ? (
                <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
                  <LoadingSpinner />
                </p>
              ) : financialCashInRows.length === 0 ? (
                <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
                  No cash in recorded for {fsPeriodLabel}.
                </p>
              ) : (
                financialCashInRows.map((r) => (
                  <MobileRowCard
                    key={r.rowKey}
                    title={r.shop}
                    subtitle={r.date}
                    fields={[
                      { label: 'Bill #', value: r.billNumber },
                      { label: 'Cash', value: r.cashAmount > 0 ? money(r.cashAmount) : '—' },
                      { label: 'Cheque', value: r.chequeAmount > 0 ? money(r.chequeAmount) : '—' },
                      { label: 'Total', value: money(r.total) },
                      ...(r.chequeDetails
                        ? [{ label: 'Cheques', value: r.chequeDetails }]
                        : []),
                    ]}
                  />
                ))
              )}
            </div>
            <div className={`mt-3 hidden sm:block ${scrollTableWrap}`}>
              <table className="w-full min-w-[800px] border-separate border-spacing-0 text-left text-sm">
                <thead className={stickyThead}>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
                    <th className="whitespace-nowrap px-4 py-3">Shop</th>
                    <th className="whitespace-nowrap px-4 py-3">Bill number</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Cash amount</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Cheque amount</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        <LoadingSpinner />
                      </td>
                    </tr>
                  ) : financialCashInRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        No cash in recorded for {fsPeriodLabel}.
                      </td>
                    </tr>
                  ) : (
                    financialCashInRows.flatMap((r) => {
                      const main = (
                        <tr key={r.rowKey} className="border-t border-slate-100 hover:bg-slate-50/80">
                          <td className={`whitespace-nowrap px-4 py-3 tabular-nums text-slate-600 ${stickyFirstTd}`}>{r.date}</td>
                          <td className="px-4 py-3 font-medium text-slate-900">{r.shop}</td>
                          <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">
                            {r.billNumber}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700">
                            {r.cashAmount > 0 ? money(r.cashAmount) : '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700">
                            {r.chequeAmount > 0 ? money(r.chequeAmount) : '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                            {money(r.total)}
                          </td>
                        </tr>
                      );
                      if (!r.chequeDetails) return [main];
                      return [
                        main,
                        <tr key={`${r.rowKey}-cheques`} className="bg-slate-50/50">
                          <td colSpan={6} className="px-4 pb-2.5 pt-0 text-[11px] leading-snug text-slate-500">
                            {r.chequeDetails}
                          </td>
                        </tr>,
                      ];
                    })
                  )}
                </tbody>
                {!loading && financialCashInRows.length > 0 ? (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-indigo-50/60 font-semibold text-slate-900">
                      <td className="px-4 py-3" colSpan={3}>
                        Grand total
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-indigo-900">
                        {money(financialCashInTotals.cash)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-indigo-900">
                        {money(financialCashInTotals.cheque)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-indigo-900">
                        {money(financialCashInTotals.total)}
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-800">3. Cheques to be converted</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Shop cheques with issue date in the selected period
            </p>
            <div className="mt-3 hidden">
              {loading ? (
                <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
                  <LoadingSpinner />
                </p>
              ) : financialConvertingRows.length === 0 ? (
                <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
                  No cheques with an issue date in {fsPeriodLabel}.
                </p>
              ) : (
                financialConvertingRows.map((r) => (
                  <MobileRowCard
                    key={r.rowKey}
                    title={r.chequeNumber}
                    subtitle={r.date}
                    fields={[
                      { label: 'Issue date', value: r.issueDate },
                      { label: 'Bill #', value: r.billNumber },
                      { label: 'Customer', value: r.customer },
                      { label: 'Amount', value: money(r.amount) },
                    ]}
                  />
                ))
              )}
            </div>
            <div className={`mt-3 hidden sm:block ${scrollTableWrap}`}>
              <table className="w-full min-w-[800px] border-separate border-spacing-0 text-left text-sm">
                <thead className={stickyThead}>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
                    <th className="whitespace-nowrap px-4 py-3">Cheque number</th>
                    <th className="whitespace-nowrap px-4 py-3">Issue date</th>
                    <th className="whitespace-nowrap px-4 py-3">Bill number</th>
                    <th className="whitespace-nowrap px-4 py-3">Customer</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        <LoadingSpinner />
                      </td>
                    </tr>
                  ) : financialConvertingRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        No cheques with an issue date in {fsPeriodLabel}.
                      </td>
                    </tr>
                  ) : (
                    financialConvertingRows.map((r) => (
                      <tr key={r.rowKey} className="border-t border-slate-100 hover:bg-slate-50/80">
                        <td className={`whitespace-nowrap px-4 py-3 tabular-nums text-slate-600 ${stickyFirstTd}`}>{r.date}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums text-slate-900">
                          {r.chequeNumber}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">
                          {r.issueDate}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">
                          {r.billNumber}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">{r.customer}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                          {money(r.amount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {!loading && financialConvertingRows.length > 0 ? (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-indigo-50/60 font-semibold text-slate-900">
                      <td className="px-4 py-3" colSpan={5}>
                        Grand total
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-indigo-900">
                        {money(financialConvertingTotal)}
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </div>
        </div>
      </Card>

      <Card
        title="Customer outstanding (today)"
        subtitle={`Snapshot as of ${todayYmd} — all customers with current balance owed or credit on account`}
      >
        <div className="hidden gap-3 sm:grid sm:grid-cols-3">
          <div className="rounded-xl bg-indigo-50 p-4 ring-1 ring-indigo-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Total outstanding</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-indigo-900">
              {money(outstandingSummary.totalOutstanding)}
            </p>
            <p className="mt-0.5 text-xs text-indigo-600">
              {outstandingSummary.withBalance} customer{outstandingSummary.withBalance === 1 ? '' : 's'} with balance due
            </p>
          </div>
          <div className="rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Total credit</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-emerald-900">
              {money(outstandingSummary.totalCredit)}
            </p>
            <p className="mt-0.5 text-xs text-emerald-600">Overpayment on account</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Customers</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">
              {outstandingSummary.customerCount}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">Included in download</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDownloadOutstanding}
          disabled={loading || !!error || customers.length === 0}
          className="mt-4 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Download outstanding (PDF + Excel)
        </button>

        <div className="mt-5 hidden">
          {loading ? (
            <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
              <LoadingSpinner label="Loading customer balances…" />
            </p>
          ) : outstandingRows.length === 0 ? (
            <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
              No customers with an outstanding balance or credit on account.
            </p>
          ) : (
            outstandingRows.map((r) => (
              <MobileRowCard
                key={r.id}
                title={r.name}
                subtitle={r.location || '—'}
                fields={[
                  { label: 'Due date', value: r.dueDate },
                  { label: 'Outstanding', value: r.outstanding > 0 ? money(r.outstanding) : '—' },
                  { label: 'Credit', value: r.credit > 0 ? money(r.credit) : '—' },
                ]}
              />
            ))
          )}
        </div>

        <div className={`mt-5 hidden sm:block ${scrollTableWrap}`}>
          <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className={`px-4 py-3 ${stickyFirstTh}`}>Shop</th>
                <th className="px-4 py-3">Location</th>
                <th className="whitespace-nowrap px-4 py-3">Due date</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Outstanding</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    <LoadingSpinner label="Loading customer balances…" />
                  </td>
                </tr>
              ) : outstandingRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    No customers with an outstanding balance or credit on account.
                  </td>
                </tr>
              ) : (
                outstandingRows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                    <td className={`px-4 py-3 font-medium text-slate-900 ${stickyFirstTd}`}>{r.name}</td>
                    <td className="px-4 py-3 text-slate-600">{r.location || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{r.dueDate}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-indigo-800">
                      {r.outstanding > 0 ? money(r.outstanding) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-emerald-700">
                      {r.credit > 0 ? money(r.credit) : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {!loading && outstandingRows.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold text-slate-900">
                  <td className="px-4 py-3" colSpan={3}>
                    Total ({outstandingSummary.customerCount} customers in download)
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-indigo-800">
                    {money(outstandingSummary.totalOutstanding)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-emerald-700">
                    {outstandingSummary.totalCredit > 0 ? money(outstandingSummary.totalCredit) : '—'}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </Card>

      <TableFiltersBar hint={!loading ? filterHint : null}>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-slate-600">Period</span>
          <div className="inline-flex rounded-xl bg-slate-100/90 p-1 ring-1 ring-slate-200/60">
            <button
              type="button"
              className={`${periodBtn} ${periodMode === 'weekly' ? periodActive : periodIdle}`}
              onClick={() => handlePeriodChange('weekly')}
            >
              Weekly
            </button>
            <button
              type="button"
              className={`${periodBtn} ${periodMode === 'monthly' ? periodActive : periodIdle}`}
              onClick={() => handlePeriodChange('monthly')}
            >
              Monthly
            </button>
            <button
              type="button"
              className={`${periodBtn} ${periodMode === 'custom' ? periodActive : periodIdle}`}
              onClick={() => setPeriodMode('custom')}
            >
              Custom
            </button>
          </div>
        </div>

        {periodMode === 'weekly' ? (
          <label className={filterLabelNarrow}>
            Week
            <input
              type="week"
              value={selectedWeek}
              onChange={(e) => applyWeek(e.target.value)}
              className={filterControl}
            />
          </label>
        ) : null}

        {periodMode === 'monthly' ? (
          <label className={filterLabelNarrow}>
            Month
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => applyMonth(e.target.value)}
              className={filterControl}
            />
          </label>
        ) : null}

        {periodMode === 'custom' ? (
          <>
            <label className={filterLabelNarrow}>
              From date
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className={filterControl}
              />
            </label>
            <label className={filterLabelNarrow}>
              To date
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className={filterControl}
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={handleGenerate}
                className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
              >
                Generate report
              </button>
            </div>
          </>
        ) : null}

        <label className={filterLabelNarrow}>
          Brand
          <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} className={filterControl}>
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.key} value={b.key}>
                {formatBrandLabel(b) || b.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-end gap-2">
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={loading || !!error}
            className={downloadBtnClass}
          >
            Download PDF for CS
          </button>
          <button
            type="button"
            onClick={handleDownloadRef}
            disabled={loading || !!error || refDetailRows.length === 0}
            className={downloadBtnClass}
          >
            Download for Ref
          </button>
        </div>
      </TableFiltersBar>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      <div className="hidden space-y-5 sm:block">
      {loading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner size="lg" label="Loading report data…" />
        </div>
      ) : (
        <>
          <Card
            title="Cement bags from loads"
            subtitle={`Total bags received from stock loads in the selected period${activeBrand ? ` (${activeBrand.label} only)` : ''} (${loadsReport.loadCount} load${loadsReport.loadCount === 1 ? '' : 's'})`}
          >
            <BrandBagSummary
              byBrand={loadsReport.byBrand}
              total={loadsReport.total}
              loadCount={loadsReport.loadCount}
              brandKey={brandFilter}
            />
          </Card>

          <Card
            title="Cement bags per shop"
            subtitle={`Credit bill bags sold to each customer in the selected period${activeBrand ? ` (${activeBrand.label} only)` : ''}`}
          >
            <div className="hidden">
              {shopRows.filter((r) => r.totalBags > 0).length === 0 ? (
                <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
                  No bag sales in this period{activeBrand ? ` for ${activeBrand.label}` : ''}.
                </p>
              ) : (
                shopRows
                  .filter((r) => r.totalBags > 0)
                  .map((r) => (
                    <MobileRowCard
                      key={r.shop}
                      title={r.shop}
                      subtitle={r.location || '—'}
                      fields={[
                        ...visibleBrands.slice(0, 4).map((b) => ({
                          label: formatBrandLabel(b) || b.label,
                          value: r[`${b.key}Bags`].toLocaleString(),
                        })),
                        { label: 'Total bags', value: r.totalBags.toLocaleString() },
                        { label: 'Bills', value: r.billCount },
                      ]}
                    />
                  ))
              )}
            </div>
            <div className={`hidden sm:block ${scrollTableWrap}`}>
              <table className="w-full min-w-[800px] border-separate border-spacing-0 text-left text-sm">
                <thead className={stickyThead}>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Shop</th>
                    <th className="whitespace-nowrap px-4 py-3">Location</th>
                    {visibleBrands.map((b) => (
                      <th key={b.key} className="whitespace-nowrap px-4 py-3 text-right">
                        {formatBrandLabel(b) || b.label}
                      </th>
                    ))}
                    <th className="whitespace-nowrap px-4 py-3 text-right">Total bags</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Bills</th>
                  </tr>
                </thead>
                <tbody>
                  {shopRows.filter((r) => r.totalBags > 0).length === 0 ? (
                    <tr>
                      <td colSpan={visibleBrands.length + 4} className="px-4 py-8 text-center text-slate-500">
                        No bag sales in this period{activeBrand ? ` for ${activeBrand.label}` : ''}.
                      </td>
                    </tr>
                  ) : (
                    shopRows
                      .filter((r) => r.totalBags > 0)
                      .map((r) => (
                      <tr key={r.shop} className="border-t border-slate-100 hover:bg-slate-50/80">
                        <td className={`whitespace-nowrap px-4 py-3 font-medium text-slate-900 ${stickyFirstTd}`}>{r.shop}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.location || '—'}</td>
                        {visibleBrands.map((b) => (
                          <td key={b.key} className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                            {r[`${b.key}Bags`].toLocaleString()}
                          </td>
                        ))}
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                          {r.totalBags.toLocaleString()}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">
                          {r.billCount}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {shopRows.filter((r) => r.totalBags > 0).length > 0 ? (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold text-slate-900">
                      <td className="px-4 py-3" colSpan={2}>
                        Total
                      </td>
                      {visibleBrands.map((b) => {
                        const sum = shopRows
                          .filter((r) => r.totalBags > 0)
                          .reduce((s, r) => s + (r[`${b.key}Bags`] || 0), 0);
                        return (
                          <td key={b.key} className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                            {sum.toLocaleString()}
                          </td>
                        );
                      })}
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {shopTotals.totalBags.toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {shopRows.filter((r) => r.totalBags > 0).reduce((s, r) => s + r.billCount, 0)}
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </Card>

          <Card
            title="Credit sales per shop"
            subtitle={`Total credit bill amounts per customer in the selected period${activeBrand ? ` (${activeBrand.label} line totals only)` : ''}`}
          >
            <div className="hidden">
              {shopRows.filter((r) => r.creditSales > 0).length === 0 ? (
                <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
                  No credit sales in this period.
                </p>
              ) : (
                shopRows
                  .filter((r) => r.creditSales > 0)
                  .sort((a, b) => b.creditSales - a.creditSales)
                  .map((r) => (
                    <MobileRowCard
                      key={r.shop}
                      title={r.shop}
                      subtitle={r.location || '—'}
                      fields={[
                        { label: 'Bills', value: r.billCount },
                        { label: 'Credit sales', value: money(r.creditSales) },
                      ]}
                    />
                  ))
              )}
            </div>
            <div className={`hidden sm:block ${scrollTableWrap}`}>
              <table className="w-full min-w-[480px] border-separate border-spacing-0 text-left text-sm">
                <thead className={stickyThead}>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Shop</th>
                    <th className="whitespace-nowrap px-4 py-3">Location</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Bills</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Credit sales</th>
                  </tr>
                </thead>
                <tbody>
                  {shopRows.filter((r) => r.creditSales > 0).length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                        No credit sales in this period.
                      </td>
                    </tr>
                  ) : (
                    shopRows
                      .filter((r) => r.creditSales > 0)
                      .sort((a, b) => b.creditSales - a.creditSales)
                      .map((r) => (
                        <tr key={r.shop} className="border-t border-slate-100 hover:bg-slate-50/80">
                          <td className={`whitespace-nowrap px-4 py-3 font-medium text-slate-900 ${stickyFirstTd}`}>{r.shop}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.location || '—'}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">
                            {r.billCount}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                            {money(r.creditSales)}
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
                {shopTotals.creditSales > 0 ? (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold text-slate-900">
                      <td className="px-4 py-3" colSpan={2}>
                        Total
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {shopRows.reduce((s, r) => s + r.billCount, 0)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {money(shopTotals.creditSales)}
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </Card>

          <Card
            title="Cash in per shop"
            subtitle="Payments received (cash + cheque) per customer in the selected period"
          >
            <div className="hidden">
              {shopRows.filter((r) => r.cashIn > 0).length === 0 ? (
                <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
                  No payments in this period.
                </p>
              ) : (
                shopRows
                  .filter((r) => r.cashIn > 0)
                  .sort((a, b) => b.cashIn - a.cashIn)
                  .map((r) => (
                    <MobileRowCard
                      key={r.shop}
                      title={r.shop}
                      subtitle={r.location || '—'}
                      fields={[
                        { label: 'Payments', value: r.paymentCount },
                        { label: 'Cash in', value: money(r.cashIn) },
                      ]}
                    />
                  ))
              )}
            </div>
            <div className={`hidden sm:block ${scrollTableWrap}`}>
              <table className="w-full min-w-[480px] border-separate border-spacing-0 text-left text-sm">
                <thead className={stickyThead}>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Shop</th>
                    <th className="whitespace-nowrap px-4 py-3">Location</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Payments</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Cash in</th>
                  </tr>
                </thead>
                <tbody>
                  {shopRows.filter((r) => r.cashIn > 0).length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                        No payments in this period.
                      </td>
                    </tr>
                  ) : (
                    shopRows
                      .filter((r) => r.cashIn > 0)
                      .sort((a, b) => b.cashIn - a.cashIn)
                      .map((r) => (
                        <tr key={r.shop} className="border-t border-slate-100 hover:bg-slate-50/80">
                          <td className={`whitespace-nowrap px-4 py-3 font-medium text-slate-900 ${stickyFirstTd}`}>{r.shop}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.location || '—'}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">
                            {r.paymentCount}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-emerald-700">
                            {money(r.cashIn)}
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
                {shopTotals.cashIn > 0 ? (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold text-slate-900">
                      <td className="px-4 py-3" colSpan={2}>
                        Total
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {shopRows.reduce((s, r) => s + r.paymentCount, 0)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-emerald-700">
                        {money(shopTotals.cashIn)}
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </Card>

          <Card
            title="Bank cash deposits"
            subtitle="Daily cash taken in (by payment date) — each amount is treated as deposited to the bank on that day"
          >
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-sky-50 p-4 ring-1 ring-sky-100">
                <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Bank deposit total</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-sky-900">{money(bankDailyTotals.bankDeposit)}</p>
                <p className="mt-0.5 text-xs text-sky-600">{bankDailyRows.length} day{bankDailyRows.length === 1 ? '' : 's'}</p>
              </div>
              <div className="rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-100">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Cash in</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-emerald-900">{money(bankDailyTotals.cashIn)}</p>
              </div>
              <div className="rounded-xl bg-slate-100 p-4 ring-1 ring-slate-200">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Total income (cash + cheque)</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{money(bankDailyTotals.totalIncome)}</p>
              </div>
            </div>
            <div className="hidden">
              {bankDailyRows.length === 0 ? (
                <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
                  No cash deposits in this period.
                </p>
              ) : (
                bankDailyRows.map((r) => (
                  <MobileRowCard
                    key={r.date}
                    title={r.date}
                    fields={[
                      { label: 'Cash in', value: money(r.cashIn) },
                      { label: 'Bank deposit', value: money(r.bankDeposit) },
                      { label: 'Total income', value: money(r.totalIncome) },
                    ]}
                  />
                ))
              )}
            </div>
            <div className={`hidden sm:block ${scrollTableWrap}`}>
              <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm">
                <thead className={stickyThead}>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Payment date</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Cash in</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Bank deposit</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Total income (cash + cheque)</th>
                  </tr>
                </thead>
                <tbody>
                  {bankDailyRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                        No cash deposits in this period.
                      </td>
                    </tr>
                  ) : (
                    bankDailyRows.map((r) => (
                      <tr key={r.date} className="border-t border-slate-100 hover:bg-slate-50/80">
                        <td className={`whitespace-nowrap px-4 py-3 font-medium tabular-nums text-slate-900 ${stickyFirstTd}`}>{r.date}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-emerald-800">
                          {money(r.cashIn)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-sky-800">
                          {money(r.bankDeposit)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                          {money(r.totalIncome)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {bankDailyRows.length > 0 ? (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold text-slate-900">
                      <td className={`px-4 py-3 ${stickyFirstTd}`}>Total</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(bankDailyTotals.cashIn)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(bankDailyTotals.bankDeposit)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(bankDailyTotals.totalIncome)}</td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </Card>

          <Card
            title="Cheques to be deposited"
            subtitle="Cheques dated in the selected period that are not yet marked as deposited at the bank"
          >
            <div className="mb-4 rounded-xl bg-violet-50 p-4 ring-1 ring-violet-100">
              <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Pending deposit total</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-violet-900">{money(pendingChequeTotal)}</p>
              <p className="mt-0.5 text-xs text-violet-600">
                {pendingChequeRows.length} cheque{pendingChequeRows.length === 1 ? '' : 's'} awaiting bank deposit
              </p>
            </div>
            <div className="hidden">
              {pendingChequeRows.length === 0 ? (
                <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
                  No cheques pending deposit in this period.
                </p>
              ) : (
                pendingChequeRows.map((r) => (
                  <MobileRowCard
                    key={r.id}
                    title={r.customerName}
                    subtitle={r.chequeDate}
                    fields={[
                      { label: 'Amount', value: money(r.amount) },
                      { label: 'Cheque #', value: r.chequeNumber },
                      { label: 'Bill #', value: r.billNumber },
                      { label: 'Payment date', value: r.paymentDate },
                    ]}
                  />
                ))
              )}
            </div>
            <div className={`hidden sm:block ${scrollTableWrap}`}>
              <table className="w-full min-w-[880px] border-separate border-spacing-0 text-left text-sm">
                <thead className={stickyThead}>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Cheque date</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
                    <th className="whitespace-nowrap px-4 py-3 font-mono">Cheque #</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="whitespace-nowrap px-4 py-3 font-mono">Bill #</th>
                    <th className="whitespace-nowrap px-4 py-3">Payment date</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingChequeRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        No cheques pending deposit in this period.
                      </td>
                    </tr>
                  ) : (
                    pendingChequeRows.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                        <td className={`whitespace-nowrap px-4 py-3 tabular-nums font-medium text-slate-900 ${stickyFirstTd}`}>{r.chequeDate}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-violet-800">
                          {money(r.amount)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-sm">{r.chequeNumber}</td>
                        <td className="px-4 py-3 font-medium text-slate-900">{r.customerName}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-sm tabular-nums">{r.billNumber}</td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{r.paymentDate}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {pendingChequeRows.length > 0 ? (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold text-slate-900">
                      <td className={`px-4 py-3 ${stickyFirstTd}`}>Total</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-violet-800">
                        {money(pendingChequeTotal)}
                      </td>
                      <td className="px-4 py-3" colSpan={4} />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </Card>
        </>
      )}
      </div>
      </>
      ) : null}
    </div>
  );
}
