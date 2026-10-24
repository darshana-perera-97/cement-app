import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { getApiBase } from '../apiBase';
import { authFetch, getFirstAllowedDashboardPath, isManagerOrAdmin } from '../auth';
import {
  LoadingSpinner,
  TableFiltersBar,
  TablePaginationBar,
  filterControl,
  filterLabel,
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

const ACTIONS = [
  { value: '', label: 'All actions' },
  { value: 'add', label: 'Add' },
  { value: 'edit', label: 'Edit' },
  { value: 'delete', label: 'Delete' },
  { value: 'cancel', label: 'Cancel' },
  { value: 'accept', label: 'Accept' },
];

const CATEGORIES = [
  { value: '', label: 'All categories' },
  { value: 'Free bag issue', label: 'Free bag issue' },
  { value: 'Payment collection', label: 'Payment collection' },
  { value: 'Billing', label: 'Billing' },
  { value: 'Purchase order', label: 'Purchase order' },
  { value: 'Stock addition', label: 'Stock addition' },
];

const ACTION_BADGE = {
  add: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  edit: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
  delete: 'bg-rose-50 text-rose-700 ring-rose-100',
  cancel: 'bg-amber-50 text-amber-800 ring-amber-100',
  accept: 'bg-sky-50 text-sky-800 ring-sky-100',
};

function actionLabel(action) {
  const found = ACTIONS.find((item) => item.value === action);
  return found ? found.label : action || '—';
}

function ActionBadge({ action }) {
  const tone = ACTION_BADGE[action] || 'bg-slate-50 text-slate-600 ring-slate-100';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${tone}`}>
      {actionLabel(action)}
    </span>
  );
}

export default function HistoryPage() {
  const apiRoot = getApiBase() || '';
  const allowed = isManagerOrAdmin();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [category, setCategory] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${apiRoot}/api/history`);
      if (res.status === 401) {
        setError('Sign in again to view history.');
        setRows([]);
        return;
      }
      if (res.status === 403) {
        setError('Only managers and admin can view history.');
        setRows([]);
        return;
      }
      if (!res.ok) throw new Error('Failed to load history');
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || 'Could not load history');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [allowed, apiRoot]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (action && row.action !== action) return false;
      if (category && row.category !== category) return false;
      if (!inDateRange(row.date, from, to)) return false;
      return rowMatchesQuery(search, [
        row.userName,
        row.username,
        row.shopName,
        row.category,
        row.description,
        actionLabel(row.action),
        row.date,
        row.time,
      ]);
    });
  }, [rows, search, action, category, from, to]);

  const pagination = useTablePagination(filteredRows.length, [search, action, category, from, to]);
  const pagedRows = useMemo(
    () => filteredRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filteredRows, pagination.offset, pagination.pageSize],
  );

  if (!allowed) {
    return <Navigate to={getFirstAllowedDashboardPath()} replace />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-sm text-slate-500">
          Free bag issues, payment collections, billings, purchase orders, stock additions, and other user activity.
        </p>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex w-full shrink-0 items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-60 sm:w-auto"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <TableFiltersBar
        hint={
          rows.length > 0
            ? `Showing ${filteredRows.length} of ${rows.length} activit${rows.length === 1 ? 'y' : 'ies'}`
            : null
        }
      >
        <label className={filterLabel}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Shop, user, or description…"
            className={filterControl}
          />
        </label>
        <label className={filterLabel}>
          Action
          <select value={action} onChange={(e) => setAction(e.target.value)} className={filterControl}>
            {ACTIONS.map((item) => (
              <option key={item.value || 'all'} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className={filterLabel}>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={filterControl}>
            {CATEGORIES.map((item) => (
              <option key={item.value || 'all-cat'} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className={filterLabel}>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={filterControl} />
        </label>
        <label className={filterLabel}>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={filterControl} />
        </label>
      </TableFiltersBar>

      {error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      {loading && rows.length === 0 ? (
        <div className="flex justify-center rounded-2xl bg-white py-16 ring-1 ring-slate-100">
          <LoadingSpinner />
        </div>
      ) : (
        <>
          <div className={mobileCardList}>
            {pagedRows.length === 0 ? (
              <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
                {rows.length === 0
                  ? 'No activity yet. New adds, edits, deletes, cancellations, and acceptances will show up here.'
                  : 'No matches.'}
              </p>
            ) : (
              pagedRows.map((row) => (
                <MobileRowCard
                  key={row.id}
                  title={row.shopName || row.category || row.userName || row.username || 'Unknown'}
                  subtitle={row.description}
                  badge={<ActionBadge action={row.action} />}
                  fields={[
                    { label: 'Date', value: row.date || '—' },
                    { label: 'Time', value: row.time || '—' },
                    { label: 'User', value: row.userName || row.username || '—' },
                    { label: 'Shop', value: row.shopName || '—' },
                    { label: 'Category', value: row.category || '—' },
                  ]}
                />
              ))
            )}
          </div>

          <div className={`hidden sm:block ${scrollTableWrap}`}>
            <table className="w-full min-w-[980px] data-table border-separate border-spacing-0 text-left text-sm">
              <thead className={stickyThead}>
                <tr className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className={`px-3 py-3 ${stickyFirstTh}`}>Date</th>
                  <th className="px-3 py-3">Time</th>
                  <th className="px-3 py-3">User</th>
                  <th className="px-3 py-3">Shop</th>
                  <th className="px-3 py-3">Category</th>
                  <th className="px-3 py-3">Action</th>
                  <th className="px-3 py-3">Description</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-sm text-slate-500">
                      {rows.length === 0
                        ? 'No activity yet. Free bag issues, payments, billings, POs, and stock additions will show up here.'
                        : 'No matches.'}
                    </td>
                  </tr>
                ) : (
                  pagedRows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className={`whitespace-nowrap px-3 py-3 font-medium tabular-nums text-slate-800 ${stickyFirstTd}`}>
                        {row.date || '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-600">{row.time || '—'}</td>
                      <td className="px-3 py-3 text-slate-800">{row.userName || row.username || 'Unknown'}</td>
                      <td className="px-3 py-3 text-slate-800">{row.shopName || '—'}</td>
                      <td className="px-3 py-3 text-slate-700">{row.category || '—'}</td>
                      <td className="px-3 py-3">
                        <ActionBadge action={row.action} />
                      </td>
                      <td className="px-3 py-3 text-slate-600">{row.description || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {filteredRows.length > 0 ? (
            <TablePaginationBar
              page={pagination.page}
              totalPages={pagination.totalPages}
              pageSize={pagination.pageSize}
              totalCount={filteredRows.length}
              onPageChange={pagination.setPage}
              onPageSizeChange={pagination.setPageSize}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
