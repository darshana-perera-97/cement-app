import { useEffect, useMemo, useState } from 'react';
import { authFetch } from '../auth';
import { getApiBase } from '../apiBase';
import { formatMoney } from './detailModalShared';
import { downloadMonthEndBalancesPdf } from './monthEndBalancesPdf';
import {
  buildMonthEndBalances,
  currentMonthValue,
  monthDisplayLabel,
} from './monthEndBalances';
import { LoadingSpinner, modalPanelClass4xl, scrollTableWrap, stickyThead } from './tableToolbar';

const apiBase = getApiBase();

function percentLabel(value) {
  return value == null ? '—' : `${value}%`;
}

function successClass(value) {
  if (value == null) return 'bg-slate-100 text-slate-600';
  if (value >= 80) return 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100';
  if (value >= 50) return 'bg-amber-50 text-amber-900 ring-1 ring-amber-100';
  return 'bg-rose-50 text-rose-800 ring-1 ring-rose-100';
}

function overdueLabel(row) {
  if (!row.overdue) return 'No';
  const days = Number(row.daysOverdue) || 0;
  return days > 0 ? `Yes · ${days}d` : 'Yes';
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export default function MonthEndBalancesSection({ shopName = '' }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => currentMonthValue());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [source, setSource] = useState({
    customers: [],
    bills: [],
    payments: [],
    promotions: [],
    returnsRows: [],
  });

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [billsRes, paymentsRes, customersRes, promotionsRes, returnsRes] = await Promise.all([
          authFetch(`${apiBase}/api/bills`),
          authFetch(`${apiBase}/api/payments`),
          authFetch(`${apiBase}/api/customers`),
          authFetch(`${apiBase}/api/promotions`),
          authFetch(`${apiBase}/api/returns`),
        ]);
        if (!billsRes.ok || !paymentsRes.ok || !customersRes.ok) {
          throw new Error('Could not load bills, payments, or customers');
        }
        const [bills, payments, customers, promotions, returnsRows] = await Promise.all([
          billsRes.json(),
          paymentsRes.json(),
          customersRes.json(),
          promotionsRes.ok ? promotionsRes.json() : [],
          returnsRes.ok ? returnsRes.json() : [],
        ]);
        if (cancelled) return;
        setSource({
          customers: Array.isArray(customers) ? customers : [],
          bills: Array.isArray(bills) ? bills : [],
          payments: Array.isArray(payments) ? payments : [],
          promotions: Array.isArray(promotions) ? promotions : [],
          returnsRows: Array.isArray(returnsRows) ? returnsRows : [],
        });
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Could not load month end balances');
          setSource({ customers: [], bills: [], payments: [], promotions: [], returnsRows: [] });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const report = useMemo(
    () =>
      buildMonthEndBalances(source.customers, source.bills, source.payments, {
        month,
        promotions: source.promotions,
        returnsRows: source.returnsRows,
      }),
    [source, month],
  );

  const needle = query.trim().toLowerCase();
  const visibleShops = needle
    ? report.shops.filter((shop) => shop.shopName.toLowerCase().includes(needle))
    : report.shops;

  const handleDownload = () => {
    downloadMonthEndBalancesPdf(report, { shopName, generatedAt: new Date() });
  };

  return (
    <section className="rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Month end balances</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
            Open a report of every customer&apos;s pending and overdue balances, the unloads settled in
            the selected month, and a success rating from how those bills were settled.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setError(null);
            setOpen(true);
          }}
          className="inline-flex w-full shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03] sm:w-auto"
        >
          View balances
        </button>
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="month-end-balances-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            aria-label="Close"
            onClick={() => setOpen(false)}
          />
          <div
            className={`${modalPanelClass4xl} flex max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-bottom,0px)))] w-full max-w-none flex-col overflow-hidden !p-0 sm:max-w-6xl`}
          >
            <div className="shrink-0 border-b border-slate-100 px-4 pb-4 pt-3 sm:px-6 sm:pt-6">
              <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-slate-300/90 sm:hidden" aria-hidden />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 id="month-end-balances-title" className="text-lg font-bold text-slate-900">
                    {shopName || 'Shop'}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Month end balances · {monthDisplayLabel(month)}. Bills settled inside the credit days
                    score 100%. Later bills score 100 × credit days ÷ days used.
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={handleDownload}
                    disabled={loading || Boolean(error)}
                    className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-indigo-700 disabled:opacity-60"
                  >
                    Download PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="block text-sm font-medium text-slate-600">
                  Month
                  <input
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value || currentMonthValue())}
                    className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 sm:w-44"
                  />
                </label>
                <label className="block min-w-0 flex-1 text-sm font-medium text-slate-600">
                  Shop
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter by shop name"
                    className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  />
                </label>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
              {loading ? (
                <div className="flex justify-center py-16">
                  <LoadingSpinner size="lg" />
                </div>
              ) : error ? (
                <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
                  {error}
                </p>
              ) : (
                <div className="space-y-5">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Stat
                      label="Settled unloads"
                      value={formatMoney(report.totals.settledAmount)}
                      hint={`${report.totals.settledCount} bill${report.totals.settledCount === 1 ? '' : 's'} in ${monthDisplayLabel(month)}`}
                    />
                    <Stat
                      label="Pending balance"
                      value={formatMoney(report.totals.pendingAmount)}
                      hint={`${report.totals.pendingCount} open bill${report.totals.pendingCount === 1 ? '' : 's'}`}
                    />
                    <Stat
                      label="Overdue balance"
                      value={formatMoney(report.totals.overdueAmount)}
                      hint={`${report.totals.overdueCount} overdue bill${report.totals.overdueCount === 1 ? '' : 's'}`}
                    />
                    <Stat
                      label="Customer success"
                      value={percentLabel(report.totals.successPercent)}
                      hint="Average of shops in this month"
                    />
                  </div>

                  {visibleShops.length === 0 ? (
                    <p className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
                      No settled unloads or pending balances for this month.
                    </p>
                  ) : (
                    visibleShops.map((shop) => (
                      <article key={shop.customerId || shop.shopName} className="space-y-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <h3 className="text-base font-bold text-slate-900">{shop.shopName}</h3>
                            <p className="text-xs text-slate-500">
                              {shop.location ? `${shop.location} · ` : ''}
                              Credit days {shop.creditDays}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                              Customer success
                            </span>
                            <span className={`rounded-full px-3 py-1 text-sm font-bold ${successClass(shop.successPercent)}`}>
                              {percentLabel(shop.successPercent)}
                            </span>
                          </div>
                        </div>

                        <div>
                          <h4 className="mb-2 text-sm font-semibold text-slate-800">
                            Settled bills
                            <span className="ml-2 font-normal text-slate-500">
                              {shop.settled.length} · {formatMoney(shop.settledAmount)}
                            </span>
                          </h4>
                          <div className={scrollTableWrap}>
                            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
                              <thead className={stickyThead}>
                                <tr>
                                  <th className="px-4 py-3">Bill date</th>
                                  <th className="px-4 py-3">Details</th>
                                  <th className="px-4 py-3 text-right">Amount</th>
                                  <th className="px-4 py-3">Settled date</th>
                                  <th className="px-4 py-3 text-right">Days to settle</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 text-slate-800">
                                {shop.settled.length === 0 ? (
                                  <tr>
                                    <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                                      No settled unloads this month.
                                    </td>
                                  </tr>
                                ) : (
                                  shop.settled.map((row) => (
                                    <tr key={row.id || `${row.billDate}-${row.details}`}>
                                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{row.billDate || '—'}</td>
                                      <td className="px-4 py-3">{row.details}</td>
                                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                                        {formatMoney(row.amount)}
                                      </td>
                                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{row.settledDate || '—'}</td>
                                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                                        {row.daysToSettle == null ? '—' : row.daysToSettle}
                                      </td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div>
                          <h4 className="mb-2 text-sm font-semibold text-slate-800">
                            Pending bills
                            <span className="ml-2 font-normal text-slate-500">
                              {shop.pending.length} · {formatMoney(shop.pendingAmount)}
                              {shop.overdueAmount > 0 ? ` · overdue ${formatMoney(shop.overdueAmount)}` : ''}
                            </span>
                          </h4>
                          <div className={scrollTableWrap}>
                            <table className="w-full min-w-[860px] border-separate border-spacing-0 text-left text-sm">
                              <thead className={stickyThead}>
                                <tr>
                                  <th className="px-4 py-3">Bill date</th>
                                  <th className="px-4 py-3">Details</th>
                                  <th className="px-4 py-3 text-right">Days from billing date</th>
                                  <th className="px-4 py-3 text-right">Settled amount</th>
                                  <th className="px-4 py-3 text-right">Balance</th>
                                  <th className="px-4 py-3">Overdue</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 text-slate-800">
                                {shop.pending.length === 0 ? (
                                  <tr>
                                    <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                                      No pending balance.
                                    </td>
                                  </tr>
                                ) : (
                                  shop.pending.map((row) => (
                                    <tr
                                      key={row.id || `${row.billDate}-${row.details}`}
                                      className={row.overdue ? 'bg-rose-50/70' : undefined}
                                    >
                                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{row.billDate || '—'}</td>
                                      <td className="px-4 py-3">{row.details}</td>
                                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                                        {row.daysFromBillDate == null ? '—' : row.daysFromBillDate}
                                      </td>
                                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                                        {formatMoney(row.settledAmount)}
                                      </td>
                                      <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">
                                        {formatMoney(row.balance)}
                                      </td>
                                      <td className={`whitespace-nowrap px-4 py-3 ${row.overdue ? 'font-semibold text-rose-800' : ''}`}>
                                        {overdueLabel(row)}
                                      </td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
