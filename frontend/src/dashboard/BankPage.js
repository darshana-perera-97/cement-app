import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import { getUsername } from '../auth';
import {
  LoadingSpinner,
  TableFiltersBar,
  TablePaginationBar,
  filterControl,
  filterLabel,
  filterLabelNarrow,
  inDateRange,
  mobileCardList,
  MobileRowCard,
  rowMatchesQuery,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
  useTablePagination,
} from './tableToolbar';
import RowDetailModal, { detailRowAttrs } from './RowDetailModal';
import { buildChequeTableRows, chequePortion, depositQueueRowKey } from './paymentCheques';

const apiBase = getApiBase();

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

/** Matches backend `paymentCreditToCustomer`: cash + cheque credited to the customer. */
function paymentTotal(p) {
  const total = Number(p.amount) || 0;
  if (total > 0) return total;
  return (Number(p.cashAmount) || 0) + (Number(p.chequeAmount) || 0);
}

/** Physical cash in + bank deposit line (all treated as banked daily). */
function cashPortion(p) {
  if (p.cashAmount !== undefined || p.chequeAmount !== undefined) {
    return Math.max(0, Number(p.cashAmount) || 0);
  }
  return paymentTotal(p);
}

function buildDailyRows(payments) {
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

function formatDepositedAt(iso) {
  const raw = String(iso ?? '').trim();
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildChequeRows(payments) {
  const rows = buildChequeTableRows(payments, (p, c, flat) => ({
    id: p.id,
    chequeId: c.id,
    rowKey: flat.rowKey,
    chequeDate: flat.chequeDate,
    amount: flat.amount,
    chequeNumber: flat.chequeNumber,
    chequeDeposited: flat.chequeDeposited,
    chequeDepositedAt: flat.chequeDepositedAt,
    chequeDepositedBy: flat.chequeDepositedBy,
    customerName: String(p.customerName ?? '').trim() || '—',
    billNumber: p.billNumber != null ? String(p.billNumber) : '—',
    paymentDate: String(p.date ?? '').slice(0, 10) || '—',
    sortAt: p.createdAt || `${p.date}T12:00:00`,
  }));
  rows.sort((a, b) => {
    const cmp = a.chequeDate.localeCompare(b.chequeDate);
    if (cmp !== 0) return cmp;
    return String(a.sortAt).localeCompare(String(b.sortAt));
  });
  return rows;
}

const tabBtn =
  'rounded-lg px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40';
const tabActive = 'bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200/80';
const tabIdle = 'text-slate-600 hover:bg-white/60';

export default function BankPage() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('cash');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [detailDaily, setDetailDaily] = useState(null);
  const [detailCheque, setDetailCheque] = useState(null);
  const [markingChequeId, setMarkingChequeId] = useState(null);
  const [markErr, setMarkErr] = useState(null);
  const [chequeFilter, setChequeFilter] = useState('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/payments`);
      if (!res.ok) throw new Error('Failed to load payments');
      const data = await res.json();
      setPayments(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || 'Could not load data');
      setPayments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleMarkChequeDeposited = useCallback(
    async (row) => {
      const username = getUsername();
      if (!username) {
        setMarkErr('Sign in with a username to record deposits.');
        return;
      }
      const rowKey = depositQueueRowKey(row);
      setMarkErr(null);
      setMarkingChequeId(rowKey);
      try {
        const res = await fetch(
          `${apiBase}/api/payments/${encodeURIComponent(row.id)}/cheque-deposited`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recordedBy: username,
              ...(row.chequeId && row.chequeId !== '_legacy' ? { chequeId: row.chequeId } : {}),
            }),
          },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMarkErr(data.error || 'Update failed');
          return;
        }
        await load();
      } catch {
        setMarkErr('Could not reach server');
      } finally {
        setMarkingChequeId(null);
      }
    },
    [load],
  );

  const dailyAll = useMemo(() => buildDailyRows(payments), [payments]);
  const dailyRows = useMemo(
    () => dailyAll.filter((r) => inDateRange(r.date, dateFrom, dateTo)),
    [dailyAll, dateFrom, dateTo],
  );

  const chequeAll = useMemo(() => buildChequeRows(payments), [payments]);
  const chequeInRange = useMemo(
    () => chequeAll.filter((r) => inDateRange(r.chequeDate, dateFrom, dateTo)),
    [chequeAll, dateFrom, dateTo],
  );
  const chequeRows = useMemo(() => {
    let rows = chequeInRange;
    if (chequeFilter === 'pending') rows = rows.filter((r) => !r.chequeDeposited);
    else if (chequeFilter === 'deposited') rows = rows.filter((r) => r.chequeDeposited);
    if (!search.trim()) return rows;
    return rows.filter((r) =>
      rowMatchesQuery(search, [
        r.chequeDate,
        r.paymentDate,
        r.chequeNumber,
        r.customerName,
        r.billNumber,
        r.chequeDepositedBy,
        r.chequeDepositedAt,
        formatDepositedAt(r.chequeDepositedAt),
        String(r.amount),
        r.chequeDeposited ? 'deposited' : 'pending',
      ]),
    );
  }, [chequeInRange, chequeFilter, search]);

  const chequePendingCount = useMemo(
    () => chequeInRange.filter((r) => !r.chequeDeposited).length,
    [chequeInRange],
  );
  const chequeDepositedCount = useMemo(
    () => chequeInRange.filter((r) => r.chequeDeposited).length,
    [chequeInRange],
  );

  const dailyPagination = useTablePagination(dailyRows.length, [dateFrom, dateTo]);
  const pagedDailyRows = useMemo(
    () => dailyRows.slice(dailyPagination.offset, dailyPagination.offset + dailyPagination.pageSize),
    [dailyRows, dailyPagination.offset, dailyPagination.pageSize],
  );

  const chequePagination = useTablePagination(chequeRows.length, [dateFrom, dateTo, chequeFilter, search]);
  const pagedChequeRows = useMemo(
    () => chequeRows.slice(chequePagination.offset, chequePagination.offset + chequePagination.pageSize),
    [chequeRows, chequePagination.offset, chequePagination.pageSize],
  );

  const dailyTotals = useMemo(() => {
    return dailyRows.reduce(
      (acc, r) => ({
        cashIn: acc.cashIn + r.cashIn,
        bankDeposit: acc.bankDeposit + r.bankDeposit,
        totalIncome: acc.totalIncome + r.totalIncome,
      }),
      { cashIn: 0, bankDeposit: 0, totalIncome: 0 },
    );
  }, [dailyRows]);

  const chequeTotal = useMemo(
    () => chequeRows.reduce((s, r) => s + r.amount, 0),
    [chequeRows],
  );
  const chequePendingTotal = useMemo(
    () => chequeInRange.filter((r) => !r.chequeDeposited).reduce((s, r) => s + r.amount, 0),
    [chequeInRange],
  );
  const chequeDepositedTotal = useMemo(
    () => chequeInRange.filter((r) => r.chequeDeposited).reduce((s, r) => s + r.amount, 0),
    [chequeInRange],
  );

  return (
    <div className="space-y-5">
      <div className="rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-6">
        <h1 className="text-lg font-bold text-slate-900">Bank</h1>
      </div>

      <TableFiltersBar
        hint={
          tab === 'cash'
            ? !loading && dailyRows.length > 0
              ? `${dailyRows.length} day${dailyRows.length === 1 ? '' : 's'} in range`
              : null
            : !loading && chequeInRange.length > 0
              ? search.trim()
                ? `${chequeRows.length} of ${chequeInRange.length} cheques · ${chequePendingCount} pending · ${chequeDepositedCount} deposited`
                : `${chequePendingCount} pending · ${chequeDepositedCount} deposited`
              : null
        }
      >
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
        {tab === 'cheque' ? (
          <label className={filterLabel}>
            Search
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cheque #, customer, bill #, amount…"
              className={filterControl}
            />
          </label>
        ) : null}
      </TableFiltersBar>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      <div className="inline-flex rounded-xl bg-slate-100/90 p-1 ring-1 ring-slate-200/60">
        <button
          type="button"
          className={`${tabBtn} ${tab === 'cash' ? tabActive : tabIdle}`}
          onClick={() => setTab('cash')}
        >
          Cash IN
        </button>
        <button
          type="button"
          className={`${tabBtn} ${tab === 'cheque' ? tabActive : tabIdle}`}
          onClick={() => setTab('cheque')}
        >
          Cheque
        </button>
      </div>

      {tab === 'cash' ? (
        <div className="space-y-3">
          <div className={mobileCardList}>
            {loading ? (
              <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
                <LoadingSpinner />
              </p>
            ) : dailyRows.length === 0 ? (
              <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
                No payment days in this range.
              </p>
            ) : (
              pagedDailyRows.map((r) => (
                <MobileRowCard
                  key={r.date}
                  title={r.date}
                  onClick={() => setDetailDaily(r)}
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
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
              <thead className={stickyThead}>
                <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Cash in</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Bank deposit</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Total income (cash + cheque)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                      <LoadingSpinner />
                    </td>
                  </tr>
                ) : dailyRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                      No payment days in this range.
                    </td>
                  </tr>
                ) : (
                  pagedDailyRows.map((r) => (
                    <tr
                      key={r.date}
                      {...detailRowAttrs(() => setDetailDaily(r), 'hover:bg-slate-50/80')}
                      aria-label={`Bank summary ${r.date}`}
                    >
                      <td className={`whitespace-nowrap px-4 py-3 tabular-nums font-medium ${stickyFirstTd}`}>
                        {r.date}
                      </td>
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
              {!loading && dailyRows.length > 0 ? (
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50/90 text-sm font-semibold text-slate-900">
                    <td className={`px-4 py-3 ${stickyFirstTd}`}>Range total</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(dailyTotals.cashIn)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(dailyTotals.bankDeposit)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(dailyTotals.totalIncome)}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
          {!loading && dailyRows.length > 0 ? (
            <TablePaginationBar
              page={dailyPagination.page}
              totalPages={dailyPagination.totalPages}
              pageSize={dailyPagination.pageSize}
              totalCount={dailyRows.length}
              onPageChange={dailyPagination.setPage}
              onPageSizeChange={dailyPagination.setPageSize}
            />
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { key: 'all', label: 'All' },
              { key: 'pending', label: 'Pending' },
              { key: 'deposited', label: 'Deposited' },
            ].map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={`${tabBtn} ${chequeFilter === key ? tabActive : tabIdle}`}
                onClick={() => setChequeFilter(key)}
              >
                {label}
                {!loading && chequeInRange.length > 0 ? (
                  <span className="ml-1.5 tabular-nums text-slate-400">
                    (
                    {key === 'all'
                      ? chequeInRange.length
                      : key === 'pending'
                        ? chequePendingCount
                        : chequeDepositedCount}
                    )
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {!loading && chequeInRange.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-100">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Pending deposit</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-amber-950">{money(chequePendingTotal)}</p>
                <p className="mt-0.5 text-xs text-amber-700">
                  {chequePendingCount} cheque{chequePendingCount === 1 ? '' : 's'} awaiting bank
                </p>
              </div>
              <div className="rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-100">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Already deposited</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-emerald-950">{money(chequeDepositedTotal)}</p>
                <p className="mt-0.5 text-xs text-emerald-700">
                  {chequeDepositedCount} cheque{chequeDepositedCount === 1 ? '' : 's'} marked at bank
                </p>
              </div>
            </div>
          ) : null}

          {markErr ? (
            <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-100" role="alert">
              {markErr}
            </p>
          ) : null}
          <div className={mobileCardList}>
            {loading ? (
              <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
                <LoadingSpinner />
              </p>
            ) : chequeRows.length === 0 ? (
              <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
                {search.trim()
                  ? 'No cheques match your search or filters.'
                  : chequeInRange.length === 0
                    ? 'No cheques in this range.'
                    : chequeFilter === 'pending'
                      ? 'No pending cheques in this range.'
                      : chequeFilter === 'deposited'
                        ? 'No deposited cheques in this range.'
                        : 'No cheques in this range.'}
              </p>
            ) : (
              pagedChequeRows.map((r) => {
                const rowKey = depositQueueRowKey(r);
                const depositedLabel = r.chequeDepositedBy || formatDepositedAt(r.chequeDepositedAt);
                return (
                  <MobileRowCard
                    key={rowKey}
                    title={r.chequeNumber || '—'}
                    subtitle={`${r.chequeDate} · ${r.customerName || '—'}`}
                    badge={
                      r.chequeDeposited ? (
                        <span className="inline-flex rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900 ring-1 ring-emerald-200">
                          Deposited
                        </span>
                      ) : (
                        <span className="inline-flex rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">
                          Pending
                        </span>
                      )
                    }
                    fields={[
                      { label: 'Amount', value: money(r.amount) },
                      { label: 'Bill #', value: r.billNumber || '—' },
                      ...(r.chequeDeposited && depositedLabel
                        ? [
                            {
                              label: 'Deposited',
                              value: [
                                r.chequeDepositedBy ? `by ${r.chequeDepositedBy}` : '',
                                r.chequeDepositedAt ? formatDepositedAt(r.chequeDepositedAt) : '',
                              ]
                                .filter(Boolean)
                                .join(' · '),
                            },
                          ]
                        : []),
                    ]}
                    actions={
                      <>
                        <button
                          type="button"
                          onClick={() => setDetailCheque(r)}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                        >
                          Details
                        </button>
                        {!r.chequeDeposited ? (
                          <button
                            type="button"
                            disabled={!!markingChequeId}
                            onClick={() => handleMarkChequeDeposited(r)}
                            className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {markingChequeId === rowKey ? 'Saving…' : 'Mark deposited'}
                          </button>
                        ) : null}
                      </>
                    }
                  />
                );
              })
            )}
          </div>
          <div className={`hidden sm:block ${scrollTableWrap}`}>
            <table className="w-full min-w-[560px] border-separate border-spacing-0 text-left text-sm">
              <thead className={stickyThead}>
                <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Cheque date</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
                  <th className="whitespace-nowrap px-4 py-3 font-mono">Cheque #</th>
                  <th className="whitespace-nowrap px-4 py-3 text-center">Deposit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                      <LoadingSpinner />
                    </td>
                  </tr>
                ) : chequeRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                      {search.trim()
                        ? 'No cheques match your search or filters.'
                        : chequeInRange.length === 0
                          ? 'No cheques in this range.'
                          : chequeFilter === 'pending'
                            ? 'No pending cheques in this range.'
                            : chequeFilter === 'deposited'
                              ? 'No deposited cheques in this range.'
                              : 'No cheques in this range.'}
                    </td>
                  </tr>
                ) : (
                  pagedChequeRows.map((r) => {
                    const rowKey = depositQueueRowKey(r);
                    const depositedLabel = r.chequeDepositedBy || formatDepositedAt(r.chequeDepositedAt);
                    return (
                      <tr
                        key={rowKey}
                        {...detailRowAttrs(
                          () => setDetailCheque(r),
                          r.chequeDeposited ? 'bg-emerald-50/40 hover:bg-emerald-50/70' : 'hover:bg-slate-50/80',
                        )}
                        aria-label={`Cheque ${r.chequeNumber || rowKey}`}
                      >
                        <td className={`whitespace-nowrap px-4 py-3 tabular-nums ${stickyFirstTd}`}>
                          {r.chequeDate}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-violet-800">
                          {money(r.amount)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-sm">{r.chequeNumber}</td>
                        <td className="px-4 py-3 text-center">
                          {r.chequeDeposited ? (
                            <div className="inline-flex flex-col items-center gap-0.5">
                              <span className="inline-flex rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900 ring-1 ring-emerald-200">
                                Deposited
                              </span>
                              {depositedLabel ? (
                                <span className="max-w-[140px] text-[10px] leading-tight text-emerald-800">
                                  {r.chequeDepositedBy ? `by ${r.chequeDepositedBy}` : ''}
                                  {r.chequeDepositedBy && r.chequeDepositedAt ? ' · ' : ''}
                                  {r.chequeDepositedAt ? formatDepositedAt(r.chequeDepositedAt) : ''}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={!!markingChequeId}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMarkChequeDeposited(r);
                              }}
                              className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {markingChequeId === rowKey ? 'Saving…' : 'Mark deposited'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {!loading && chequeRows.length > 0 ? (
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50/90 text-sm font-semibold text-slate-900">
                    <td className={`px-4 py-3 ${stickyFirstTd}`}>Range total</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(chequeTotal)}</td>
                    <td className="px-4 py-3" colSpan={2} />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
          {!loading && chequeRows.length > 0 ? (
            <TablePaginationBar
              page={chequePagination.page}
              totalPages={chequePagination.totalPages}
              pageSize={chequePagination.pageSize}
              totalCount={chequeRows.length}
              onPageChange={chequePagination.setPage}
              onPageSizeChange={chequePagination.setPageSize}
            />
          ) : null}
        </div>
      )}

      <RowDetailModal open={!!detailDaily} row={detailDaily} variant="bankDaily" onClose={() => setDetailDaily(null)} />
      <RowDetailModal open={!!detailCheque} row={detailCheque} variant="bankCheque" onClose={() => setDetailCheque(null)} />
    </div>
  );
}
