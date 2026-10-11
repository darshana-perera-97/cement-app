import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import {
  LoadingSpinner,
  TableFiltersBar,
  filterControl,
  filterLabelNarrow,
  inDateRange,
} from './tableToolbar';

const apiBase = getApiBase();

const periodBtn =
  'rounded-lg px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40';
const periodActive = 'bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200/80';
const periodIdle = 'text-slate-600 hover:bg-white/60';

const INCOME_LINES = [
  { key: 'sales', label: 'Customer sales', singular: 'invoice', plural: 'invoices' },
  { key: 'priceUp', label: 'Price increases', singular: 'change', plural: 'changes' },
  { key: 'bankIncome', label: 'Bank income', singular: 'entry', plural: 'entries' },
  { key: 'companyCheques', label: 'Company cheques', singular: 'cheque', plural: 'cheques' },
];

const EXPENSE_LINES = [
  { key: 'purchases', label: 'Cement purchases', singular: 'load', plural: 'loads' },
  { key: 'salary', label: 'Salary', singular: 'payment', plural: 'payments' },
  { key: 'fuel', label: 'Fuel', singular: 'entry', plural: 'entries' },
  { key: 'maintenance', label: 'Maintenance', singular: 'entry', plural: 'entries' },
  { key: 'other', label: 'Other expenses', singular: 'entry', plural: 'entries' },
  { key: 'bank_charge', label: 'Bank charges', singular: 'charge', plural: 'charges' },
  { key: 'promotions', label: 'Promotions and cashback', singular: 'entry', plural: 'entries' },
  { key: 'returns', label: 'Customer returns', singular: 'return', plural: 'returns' },
  { key: 'priceDown', label: 'Price reductions', singular: 'change', plural: 'changes' },
];

const CASH_EXPENSE_CATEGORIES = new Set(['salary', 'fuel', 'maintenance', 'other', 'bank_charge']);
const PROMOTION_TYPES = new Set(['invoice_discount', 'target_promotion', 'rule_cashback']);

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

function currentYearValue(d = new Date()) {
  return String(d.getFullYear());
}

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

function monthlyRangeFromMonthValue(monthValue) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthValue ?? '').trim());
  if (!match) return monthlyRangeFromMonthValue(currentMonthValue());
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const from = new Date(year, month, 1);
  const to = new Date(year, month + 1, 0);
  return { from: localYmd(from), to: localYmd(to) };
}

function yearlyRangeFromYearValue(yearValue) {
  const year = Number(String(yearValue ?? '').trim());
  if (!Number.isInteger(year) || year < 1990 || year > 2100) {
    return yearlyRangeFromYearValue(currentYearValue());
  }
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function formatLongDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd ?? ''))) return '—';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function periodRangeLabel(from, to) {
  if (from && to && from === to) return formatLongDate(from);
  return `${formatLongDate(from)} – ${formatLongDate(to)}`;
}

function emptyBuckets(defs) {
  return Object.fromEntries(defs.map((line) => [line.key, { total: 0, count: 0 }]));
}

function addAmount(bucket, amount) {
  const n = Number(amount) || 0;
  if (n === 0) return;
  bucket.total = round2(bucket.total + n);
  bucket.count += 1;
}

function ymd(value) {
  return String(value ?? '').slice(0, 10);
}

export function buildCompanyProfit({ bills, stocks, cashBook, returns, promotions, from, to }) {
  const income = emptyBuckets(INCOME_LINES);
  const expenses = emptyBuckets(EXPENSE_LINES);

  for (const bill of Array.isArray(bills) ? bills : []) {
    if (bill?.cancelled) continue;
    if (!inDateRange(ymd(bill?.date), from, to)) continue;
    addAmount(income.sales, bill?.totalAmount);
  }

  for (const stock of Array.isArray(stocks) ? stocks : []) {
    if (!inDateRange(ymd(stock?.date), from, to)) continue;
    addAmount(expenses.purchases, stock?.totalAmount);
  }

  for (const entry of Array.isArray(cashBook) ? cashBook : []) {
    if (entry?.cancelled) continue;
    if (!inDateRange(ymd(entry?.date), from, to)) continue;
    const amount = Math.max(0, Number(entry?.amount) || 0);
    if (amount <= 0) continue;
    const category = String(entry?.category ?? '').trim();
    if (category === 'bank_income') addAmount(income.bankIncome, amount);
    else if (category === 'company_cheque') addAmount(income.companyCheques, amount);
    else if (CASH_EXPENSE_CATEGORIES.has(category)) addAmount(expenses[category], amount);
  }

  for (const promo of Array.isArray(promotions) ? promotions : []) {
    const type = String(promo?.type ?? '').trim();
    if (!PROMOTION_TYPES.has(type)) continue;
    if (!inDateRange(ymd(promo?.date), from, to)) continue;
    addAmount(expenses.promotions, promo?.discountAmount);
  }

  for (const row of Array.isArray(returns) ? returns : []) {
    if (!inDateRange(ymd(row?.date), from, to)) continue;
    const kind = String(row?.kind ?? '').trim() || 'item_return';
    const amount = Math.max(0, Number(row?.amount) || 0);
    if (amount <= 0) continue;
    if (kind === 'item_return') addAmount(expenses.returns, amount);
    else if (kind === 'price_change') {
      if (String(row?.direction ?? '').trim() === 'up') addAmount(income.priceUp, amount);
      else addAmount(expenses.priceDown, amount);
    }
  }

  const incomeTotal = round2(INCOME_LINES.reduce((sum, line) => sum + income[line.key].total, 0));
  const expenseTotal = round2(EXPENSE_LINES.reduce((sum, line) => sum + expenses[line.key].total, 0));
  return {
    income,
    expenses,
    incomeTotal,
    expenseTotal,
    profit: round2(incomeTotal - expenseTotal),
  };
}

function countHint(count, singular, plural) {
  if (!count) return null;
  return `${count} ${count === 1 ? singular : plural}`;
}

function StatementLines({ lines, buckets, totalLabel, total }) {
  return (
    <div className="divide-y divide-slate-100">
      {lines.map((line) => {
        const bucket = buckets[line.key];
        return (
          <div key={line.key} className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm text-slate-700">{line.label}</p>
              {bucket.count > 0 ? (
                <p className="text-xs text-slate-400">{countHint(bucket.count, line.singular, line.plural)}</p>
              ) : null}
            </div>
            <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">{money(bucket.total)}</p>
          </div>
        );
      })}
      <div className="flex items-start justify-between gap-3 border-t border-slate-200 py-3">
        <p className="text-sm font-semibold text-slate-900">{totalLabel}</p>
        <p className="shrink-0 text-sm font-bold tabular-nums text-slate-900">{money(total)}</p>
      </div>
    </div>
  );
}

export default function CompanyProfitSection() {
  const initialMonth = currentMonthValue();
  const initialRange = monthlyRangeFromMonthValue(initialMonth);
  const [periodMode, setPeriodMode] = useState('monthly');
  const [selectedWeek, setSelectedWeek] = useState(() => currentIsoWeekValue());
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);
  const [selectedYear, setSelectedYear] = useState(() => currentYearValue());
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [appliedFrom, setAppliedFrom] = useState(initialRange.from);
  const [appliedTo, setAppliedTo] = useState(initialRange.to);

  const [bills, setBills] = useState([]);
  const [stocks, setStocks] = useState([]);
  const [cashBook, setCashBook] = useState([]);
  const [returns, setReturns] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [billsRes, stocksRes, cashRes, returnsRes, promosRes] = await Promise.all([
        fetch(`${apiBase}/api/bills`),
        fetch(`${apiBase}/api/stocks`),
        fetch(`${apiBase}/api/cash-book-entries`),
        fetch(`${apiBase}/api/returns`),
        fetch(`${apiBase}/api/promotions`),
      ]);
      if (!billsRes.ok) throw new Error('Failed to load bills');
      if (!stocksRes.ok) throw new Error('Failed to load purchases');
      if (!cashRes.ok) throw new Error('Failed to load cash book');
      if (!returnsRes.ok) throw new Error('Failed to load returns');
      if (!promosRes.ok) throw new Error('Failed to load promotions');
      const [billsData, stocksData, cashData, returnsData, promosData] = await Promise.all([
        billsRes.json(),
        stocksRes.json(),
        cashRes.json(),
        returnsRes.json(),
        promosRes.json(),
      ]);
      setBills(Array.isArray(billsData) ? billsData : []);
      setStocks(Array.isArray(stocksData) ? stocksData : []);
      setCashBook(Array.isArray(cashData) ? cashData : []);
      setReturns(Array.isArray(returnsData) ? returnsData : []);
      setPromotions(Array.isArray(promosData) ? promosData : []);
    } catch (e) {
      setError(e.message || 'Could not load company profit');
      setBills([]);
      setStocks([]);
      setCashBook([]);
      setReturns([]);
      setPromotions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

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

  const applyYear = (yearValue) => {
    const year = yearValue || currentYearValue();
    const { from, to } = yearlyRangeFromYearValue(year);
    setSelectedYear(String(from).slice(0, 4));
    setDateFrom(from);
    setDateTo(to);
    setAppliedFrom(from);
    setAppliedTo(to);
  };

  const handlePeriodChange = (mode) => {
    setPeriodMode(mode);
    if (mode === 'weekly') applyWeek(selectedWeek || currentIsoWeekValue());
    else if (mode === 'monthly') applyMonth(selectedMonth || currentMonthValue());
    else if (mode === 'yearly') applyYear(selectedYear || currentYearValue());
  };

  const summary = useMemo(
    () =>
      buildCompanyProfit({
        bills,
        stocks,
        cashBook,
        returns,
        promotions,
        from: appliedFrom,
        to: appliedTo,
      }),
    [bills, stocks, cashBook, returns, promotions, appliedFrom, appliedTo],
  );

  const profitPositive = summary.profit > 0;
  const profitNegative = summary.profit < 0;
  const rangeLabel = periodRangeLabel(appliedFrom, appliedTo);

  return (
    <section className="rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-6">
      <div>
        <h2 className="text-sm font-bold text-slate-900">Company profit</h2>
        <p className="mt-1 text-sm text-slate-500">
          Income and expenses for the whole company. Profit is income minus expenses for {rangeLabel}.
        </p>
      </div>

      <TableFiltersBar className="mt-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-slate-600">Period</span>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100/90 p-1 ring-1 ring-slate-200/60 sm:grid-cols-4">
            {[
              ['weekly', 'Weekly'],
              ['monthly', 'Monthly'],
              ['yearly', 'Yearly'],
              ['custom', 'Custom'],
            ].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={`${periodBtn} ${periodMode === mode ? periodActive : periodIdle}`}
                onClick={() => handlePeriodChange(mode)}
              >
                {label}
              </button>
            ))}
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

        {periodMode === 'yearly' ? (
          <label className={filterLabelNarrow}>
            Year
            <input
              type="number"
              min={1990}
              max={2100}
              step={1}
              value={selectedYear}
              onChange={(e) => {
                const next = e.target.value;
                setSelectedYear(next);
                if (/^\d{4}$/.test(next)) applyYear(next);
              }}
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
                onClick={() => {
                  let from = dateFrom;
                  let to = dateTo;
                  if (from && to && from > to) {
                    const swap = from;
                    from = to;
                    to = swap;
                    setDateFrom(from);
                    setDateTo(to);
                  }
                  setAppliedFrom(from);
                  setAppliedTo(to);
                }}
                className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
              >
                Apply period
              </button>
            </div>
          </>
        ) : null}
      </TableFiltersBar>

      {error ? (
        <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-10">
          <LoadingSpinner />
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-100">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Income</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-emerald-900">{money(summary.incomeTotal)}</p>
            </div>
            <div className="rounded-xl bg-rose-50 p-4 ring-1 ring-rose-100">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Expenses</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-rose-900">{money(summary.expenseTotal)}</p>
            </div>
            <div
              className={`rounded-xl p-4 ring-1 ${
                profitNegative ? 'bg-rose-50 ring-rose-100' : 'bg-indigo-50 ring-indigo-100'
              }`}
            >
              <p
                className={`text-xs font-semibold uppercase tracking-wide ${
                  profitNegative ? 'text-rose-700' : 'text-indigo-700'
                }`}
              >
                {profitNegative ? 'Loss' : 'Profit'}
              </p>
              <p
                className={`mt-1 text-xl font-bold tabular-nums ${
                  profitNegative ? 'text-rose-900' : profitPositive ? 'text-indigo-900' : 'text-slate-900'
                }`}
              >
                {money(summary.profit)}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl bg-slate-50/80 p-4 ring-1 ring-slate-100">
              <h3 className="text-xs font-bold uppercase tracking-wide text-emerald-700">Income</h3>
              <StatementLines
                lines={INCOME_LINES}
                buckets={summary.income}
                totalLabel="Total income"
                total={summary.incomeTotal}
              />
            </div>
            <div className="rounded-2xl bg-slate-50/80 p-4 ring-1 ring-slate-100">
              <h3 className="text-xs font-bold uppercase tracking-wide text-rose-700">Expenses</h3>
              <StatementLines
                lines={EXPENSE_LINES}
                buckets={summary.expenses}
                totalLabel="Total expenses"
                total={summary.expenseTotal}
              />
            </div>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            Customer sales are invoices dated in this period. Cement purchases are loads received in this period.
            Bank deposits, bank withdrawals, and owner share are left out. Collector commission is shown in the
            section above and is not part of this total.
          </p>
        </>
      )}
    </section>
  );
}
