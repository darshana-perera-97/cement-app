import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import { authFetch } from '../auth';
import {
  LoadingSpinner,
  TableFiltersBar,
  filterControl,
  filterLabel,
  rowMatchesQuery,
} from './tableToolbar';
import { OverdueBillsTable } from './AnalyticsPage';

const apiRoot = getApiBase() || '';

export default function OverdueBillsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${apiRoot}/api/overdue-bills`);
      if (!res.ok) throw new Error('Failed to load overdue bills');
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || 'Could not load data');
      setRows([]);
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

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Unpaid credit bills past each customer&apos;s payment window.
      </p>

      <TableFiltersBar
        hint={
          !loading && rows.length > 0
            ? `Showing ${filteredRows.length} of ${rows.length} overdue bill${rows.length === 1 ? '' : 's'}`
            : null
        }
      >
        <label className={filterLabel}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Customer, details, dates…"
            className={filterControl}
          />
        </label>
      </TableFiltersBar>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <OverdueBillsTable rows={filteredRows} totalLoadedCount={rows.length} resetKey={search} />
      )}
    </div>
  );
}
