import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
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
import { buildStockChequeRows, buildUpcomingConvertingRows } from './stockLoadCheques';

const apiBase = getApiBase();

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

export default function CashOutPage() {
  const [loads, setLoads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/stocks`);
      if (!res.ok) throw new Error('Failed to load stock cheques');
      const data = await res.json();
      setLoads(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || 'Could not load data');
      setLoads([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const chequeRows = useMemo(() => buildStockChequeRows(loads), [loads]);

  const upcomingRows = useMemo(() => buildUpcomingConvertingRows(chequeRows), [chequeRows]);
  const upcomingGrandTotal = useMemo(
    () => upcomingRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
    [upcomingRows]
  );

  const filteredRows = useMemo(() => {
    return chequeRows.filter((r) => {
      if (!inDateRange(r.date, dateFrom, dateTo)) return false;
      return rowMatchesQuery(search, [r.date, r.chequeNumber, r.convertingDate, r.brand, r.stockId, String(r.amount)]);
    });
  }, [chequeRows, search, dateFrom, dateTo]);

  const pagination = useTablePagination(filteredRows.length, [search, dateFrom, dateTo]);
  const pagedRows = useMemo(
    () => filteredRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filteredRows, pagination.offset, pagination.pageSize]
  );

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">Track load cheques and their converting dates.</p>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      <div className="space-y-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Upcoming conversions</h2>
          <p className="mt-1 text-sm text-slate-500">
            Total amount to convert on today&apos;s date and future converting dates.
          </p>
        </div>
        <div className={mobileCardList}>
          {loading ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              <LoadingSpinner />
            </p>
          ) : upcomingRows.length === 0 ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              No cheques due for conversion today or in the future.
            </p>
          ) : (
            <>
              {upcomingRows.map((r) => (
                <MobileRowCard
                  key={r.convertingDate}
                  title={r.convertingDate}
                  fields={[{ label: 'Amount to convert', value: money(r.amount) }]}
                />
              ))}
              <MobileRowCard
                title="Grand total"
                fields={[{ label: 'Amount', value: money(upcomingGrandTotal) }]}
                className="ring-indigo-100"
              />
            </>
          )}
        </div>
        <div className={`hidden sm:block ${scrollTableWrap}`}>
          <table className="w-full min-w-[420px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="border-b border-slate-100 bg-slate-50/90 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Converting date</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Amount to convert</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={2} className="px-4 py-10 text-center text-slate-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : upcomingRows.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-4 py-10 text-center text-slate-500">
                    No cheques due for conversion today or in the future.
                  </td>
                </tr>
              ) : (
                upcomingRows.map((r) => (
                  <tr key={r.convertingDate} className="bg-white">
                    <td className={`whitespace-nowrap px-4 py-3 tabular-nums font-medium ${stickyFirstTd}`}>
                      {r.convertingDate}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium">{money(r.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {!loading && upcomingRows.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-indigo-50/60 font-semibold text-indigo-900">
                  <td className="px-4 py-3">Grand total</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(upcomingGrandTotal)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-bold text-slate-900">All cheques</h2>

      <TableFiltersBar
        hint={
          !loading && chequeRows.length > 0
            ? `Showing ${filteredRows.length} of ${chequeRows.length} cheque${chequeRows.length === 1 ? '' : 's'}`
            : null
        }
      >
        <label className={filterLabel}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cheque number, stock ID, brand…"
            className={filterControl}
          />
        </label>
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
      </TableFiltersBar>

      <div className={mobileCardList}>
        {loading ? (
          <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
            <LoadingSpinner />
          </p>
        ) : chequeRows.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
            No cheques yet. Add a stock load with cheque numbers in Loads.
          </p>
        ) : filteredRows.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
            No cheques match your search or filters.
          </p>
        ) : (
          pagedRows.map((r) => (
            <MobileRowCard
              key={r.rowKey}
              title={r.chequeNumber || '—'}
              subtitle={r.date || '—'}
              fields={[
                { label: 'Converting date', value: r.convertingDate || '—' },
                { label: 'Amount', value: money(r.amount) },
              ]}
            />
          ))
        )}
      </div>
      <div className={`hidden sm:block ${scrollTableWrap}`}>
        <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm">
          <thead className={stickyThead}>
            <tr className="border-b border-slate-100 bg-slate-50/90 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
              <th className="whitespace-nowrap px-4 py-3">Cheque number</th>
              <th className="whitespace-nowrap px-4 py-3">Converting date</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
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
                  No cheques yet. Add a stock load with cheque numbers in Loads.
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                  No cheques match your search or filters.
                </td>
              </tr>
            ) : (
              pagedRows.map((r) => (
                <tr key={r.rowKey} className="bg-white">
                  <td className={`whitespace-nowrap px-4 py-3 tabular-nums font-medium ${stickyFirstTd}`}>
                    {r.date || '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{r.chequeNumber}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">{r.convertingDate || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium">{money(r.amount)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && chequeRows.length > 0 ? (
        <TablePaginationBar
          page={pagination.page}
          totalPages={pagination.totalPages}
          pageSize={pagination.pageSize}
          totalCount={filteredRows.length}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
        />
      ) : null}
      </div>
    </div>
  );
}
