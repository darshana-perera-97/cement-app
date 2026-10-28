import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import { authFetch } from '../auth';
import { downloadOverduePaymentsPdf } from './overduePaymentsPdf';
import { buildOverduePaymentRows } from './pendingBills';
import RowDetailModal, { detailRowAttrs } from './RowDetailModal';
import {
  LoadingSpinner,
  MobileRowCard,
  TableFiltersBar,
  TablePaginationBar,
  filterControl,
  filterLabel,
  filterLabelNarrow,
  inDateRange,
  mobileCardList,
  pageSizeOptionsWith,
  rowMatchesQuery,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
  useTablePagination,
} from './tableToolbar';
import { OverdueBillsTable } from './AnalyticsPage';

const apiRoot = getApiBase() || '';

const PAGE_TABS = [
  { id: 'bills', label: 'Overdue bills' },
  { id: 'payments', label: 'Overdue payments' },
];

function formatLkrExact(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function matchesDaysRange(value, fromRaw, toRaw) {
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  const from = String(fromRaw ?? '').trim();
  const to = String(toRaw ?? '').trim();
  if (from !== '') {
    const min = Number(from);
    if (Number.isFinite(min) && n < min) return false;
  }
  if (to !== '') {
    const max = Number(to);
    if (Number.isFinite(max) && n > max) return false;
  }
  return true;
}

function formatDisplayDate(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '—';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function OverduePaymentsTable({ rows, totalLoadedCount, resetKey = '' }) {
  const [detailRow, setDetailRow] = useState(null);
  const pagination = useTablePagination(rows.length, [resetKey, rows.length]);
  const pagedRows = useMemo(
    () => rows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [rows, pagination.offset, pagination.pageSize],
  );

  return (
    <div className="space-y-3">
      <div className={mobileCardList}>
        {rows.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
            {totalLoadedCount === 0
              ? 'No bills were settled after the credit window.'
              : 'No rows match your filters.'}
          </p>
        ) : (
          pagedRows.map((row) => (
            <MobileRowCard
              key={row.id}
              title={row.customerName || '—'}
              subtitle={row.description || undefined}
              badge={
                <span className="inline-flex items-center rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold tabular-nums text-amber-800 ring-1 ring-amber-100">
                  {row.daysPastCredit ?? '—'}d past credit
                </span>
              }
              onClick={() => setDetailRow(row)}
              fields={[
                { label: 'Settled date', value: formatDisplayDate(row.settledDate) },
                { label: 'Days to settle', value: row.daysToSettle ?? '—' },
                { label: 'Overdue days', value: row.daysPastCredit ?? '—' },
                { label: 'Amount', value: formatLkrExact(row.amount) },
              ]}
            />
          ))
        )}
      </div>
      <div className={`-mx-1 hidden sm:block ${scrollTableWrap}`}>
        <table className="w-full min-w-[980px] data-table border-separate border-spacing-0 text-left text-sm">
          <thead className={stickyThead}>
            <tr className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              <th className={`pb-3 pl-1 pr-3 ${stickyFirstTh}`}>Settled date</th>
              <th className="pb-3 pr-3">Customer</th>
              <th className="pb-3 pr-3">Description</th>
              <th className="pb-3 pr-3 text-right">Days to settle</th>
              <th className="pb-3 pr-3 text-right">Overdue days</th>
              <th className="pb-3 pr-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm text-slate-500">
                  {totalLoadedCount === 0
                    ? 'No bills were settled after the credit window.'
                    : 'No rows match your filters.'}
                </td>
              </tr>
            ) : (
              pagedRows.map((row) => (
                <tr
                  key={row.id}
                  {...detailRowAttrs(() => setDetailRow(row), 'text-slate-700')}
                  aria-label={`Late settlement ${row.customerName || ''}`}
                >
                  <td className={`whitespace-nowrap py-3.5 pl-1 pr-3 tabular-nums text-slate-700 ${stickyFirstTd}`}>
                    {formatDisplayDate(row.settledDate)}
                  </td>
                  <td className="max-w-[180px] py-3.5 pr-3 font-semibold text-slate-900">
                    <span className="line-clamp-2">{row.customerName}</span>
                  </td>
                  <td className="max-w-[320px] py-3.5 pr-3 text-xs leading-snug text-slate-600 sm:text-sm">
                    <span className="line-clamp-3">{row.description}</span>
                  </td>
                  <td className="py-3.5 pr-3 text-right tabular-nums text-slate-700">
                    {row.daysToSettle ?? '—'}
                  </td>
                  <td className="py-3.5 pr-3 text-right">
                    <span className="inline-flex min-w-[2rem] justify-end font-semibold tabular-nums text-rose-600">
                      {row.daysPastCredit ?? '—'}
                    </span>
                  </td>
                  <td className="py-3.5 pr-1 text-right font-semibold tabular-nums text-slate-900">
                    {formatLkrExact(row.amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {totalLoadedCount > 0 ? (
        <TablePaginationBar
          page={pagination.page}
          totalPages={pagination.totalPages}
          pageSize={pagination.pageSize}
          totalCount={rows.length}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
          pageSizeOptions={pageSizeOptionsWith(10)}
        />
      ) : null}
      <RowDetailModal
        open={!!detailRow}
        row={detailRow}
        variant="overduePayment"
        onClose={() => setDetailRow(null)}
      />
    </div>
  );
}

export default function OverdueBillsPage() {
  const [tab, setTab] = useState('bills');
  const [rows, setRows] = useState([]);
  const [paymentRows, setPaymentRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [paymentsError, setPaymentsError] = useState(null);
  const [search, setSearch] = useState('');
  const [settledFrom, setSettledFrom] = useState('');
  const [settledTo, setSettledTo] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [overdueDaysFrom, setOverdueDaysFrom] = useState('');
  const [overdueDaysTo, setOverdueDaysTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPaymentsError(null);
    try {
      const [overdueRes, custRes, billsRes, payRes, promoRes, retRes] = await Promise.all([
        authFetch(`${apiRoot}/api/overdue-bills`),
        authFetch(`${apiRoot}/api/customers`),
        authFetch(`${apiRoot}/api/bills`),
        authFetch(`${apiRoot}/api/payments`),
        authFetch(`${apiRoot}/api/promotions`),
        authFetch(`${apiRoot}/api/returns`),
      ]);

      if (!overdueRes.ok) {
        setError('Failed to load overdue bills');
        setRows([]);
      } else {
        const data = await overdueRes.json();
        setRows(Array.isArray(data) ? data : []);
      }

      if (!custRes.ok || !billsRes.ok || !payRes.ok) {
        setPaymentsError('Failed to load overdue payments');
        setPaymentRows([]);
      } else {
        const customers = await custRes.json();
        const bills = await billsRes.json();
        const payments = await payRes.json();
        const promotions = promoRes.ok ? await promoRes.json() : [];
        const returnsRows = retRes.ok ? await retRes.json() : [];
        setPaymentRows(
          buildOverduePaymentRows(
            Array.isArray(customers) ? customers : [],
            Array.isArray(bills) ? bills : [],
            Array.isArray(payments) ? payments : [],
            Array.isArray(promotions) ? promotions : [],
            Array.isArray(returnsRows) ? returnsRows : [],
          ),
        );
      }
    } catch (e) {
      const message = e.message || 'Could not load data';
      setError(message);
      setPaymentsError(message);
      setRows([]);
      setPaymentRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) =>
        rowMatchesQuery(search, [
          row.customerName,
          row.details,
          row.billDate,
          row.dueDate,
          row.daysOverdue,
          row.outstandingAmount,
        ]),
      ),
    [rows, search],
  );

  const paymentCustomers = useMemo(() => {
    const names = new Set();
    for (const row of paymentRows) {
      const name = String(row.customerName ?? '').trim();
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [paymentRows]);

  const filteredPayments = useMemo(
    () =>
      paymentRows.filter((row) => {
        if (customerFilter && row.customerName !== customerFilter) return false;
        if (!inDateRange(row.settledDate, settledFrom, settledTo)) return false;
        if (!matchesDaysRange(row.daysPastCredit, overdueDaysFrom, overdueDaysTo)) return false;
        return rowMatchesQuery(search, [
          row.settledDate,
          row.customerName,
          row.description,
          row.amount,
          row.daysToSettle,
          row.daysPastCredit,
        ]);
      }),
    [paymentRows, search, customerFilter, settledFrom, settledTo, overdueDaysFrom, overdueDaysTo],
  );

  const paymentFilterKey = `${search}|${settledFrom}|${settledTo}|${customerFilter}|${overdueDaysFrom}|${overdueDaysTo}`;

  const handleDownloadPayments = useCallback(() => {
    downloadOverduePaymentsPdf({
      rows: filteredPayments,
      filters: {
        dateFrom: settledFrom,
        dateTo: settledTo,
        customer: customerFilter,
        overdueDaysFrom,
        overdueDaysTo,
        search,
      },
    });
  }, [filteredPayments, settledFrom, settledTo, customerFilter, overdueDaysFrom, overdueDaysTo, search]);

  const activeError = tab === 'payments' ? paymentsError : error;
  const activeCount = tab === 'payments' ? paymentRows.length : rows.length;
  const filteredCount = tab === 'payments' ? filteredPayments.length : filteredRows.length;
  const noun = tab === 'payments' ? 'overdue payment' : 'overdue bill';

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        {tab === 'payments'
          ? 'Bills paid after each customer’s credit window (bill date plus credit days).'
          : "Unpaid credit bills past each customer's payment window."}
      </p>

      <div
        className="flex flex-wrap gap-1.5 rounded-xl bg-slate-100/90 p-1 ring-1 ring-slate-200/60"
        role="tablist"
        aria-label="Overdue bills and payments"
      >
        {PAGE_TABS.map((item) => {
          const active = tab === item.id;
          const count = item.id === 'payments' ? paymentRows.length : rows.length;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
                active
                  ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                  : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'
              }`}
            >
              {item.label}
              <span
                className={`rounded-md px-1.5 py-0.5 text-xs tabular-nums ${
                  active ? 'bg-slate-100 text-slate-700' : 'bg-slate-200/70 text-slate-600'
                }`}
              >
                {loading ? '…' : count}
              </span>
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        <TableFiltersBar
          hint={
            !loading && activeCount > 0
              ? `Showing ${filteredCount} of ${activeCount} ${noun}${activeCount === 1 ? '' : 's'}`
              : null
          }
        >
          {tab === 'payments' ? (
            <>
              <label className={filterLabelNarrow}>
                Settled from
                <input
                  type="date"
                  value={settledFrom}
                  onChange={(e) => setSettledFrom(e.target.value)}
                  className={filterControl}
                />
              </label>
              <label className={filterLabelNarrow}>
                Settled to
                <input
                  type="date"
                  value={settledTo}
                  onChange={(e) => setSettledTo(e.target.value)}
                  className={filterControl}
                />
              </label>
              <label className={filterLabel}>
                Customer
                <select
                  value={customerFilter}
                  onChange={(e) => setCustomerFilter(e.target.value)}
                  className={filterControl}
                >
                  <option value="">All customers</option>
                  {paymentCustomers.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={filterLabelNarrow}>
                Overdue days from
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={overdueDaysFrom}
                  onChange={(e) => setOverdueDaysFrom(e.target.value)}
                  placeholder="Min"
                  className={filterControl}
                />
              </label>
              <label className={filterLabelNarrow}>
                Overdue days to
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={overdueDaysTo}
                  onChange={(e) => setOverdueDaysTo(e.target.value)}
                  placeholder="Max"
                  className={filterControl}
                />
              </label>
            </>
          ) : null}
          <label className={filterLabel}>
            Search
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                tab === 'payments' ? 'Customer, description, settled date…' : 'Customer, details, dates…'
              }
              className={filterControl}
            />
          </label>
          {tab === 'payments' ? (
            <button
              type="button"
              onClick={handleDownloadPayments}
              disabled={loading || !!paymentsError || filteredPayments.length === 0}
              className="inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:self-end"
            >
              Download PDF
            </button>
          ) : null}
        </TableFiltersBar>

        {activeError ? (
          <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
            {activeError}
          </p>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-16">
            <LoadingSpinner size="lg" />
          </div>
        ) : tab === 'payments' ? (
          <div className="mt-4">
            <OverduePaymentsTable
              rows={filteredPayments}
              totalLoadedCount={paymentRows.length}
              resetKey={paymentFilterKey}
            />
          </div>
        ) : (
          <div className="mt-4">
            <OverdueBillsTable rows={filteredRows} totalLoadedCount={rows.length} resetKey={search} />
          </div>
        )}
      </div>
    </div>
  );
}
