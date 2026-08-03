import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import { authFetch } from '../auth';
import { buildChequeTableRows, depositQueueRowKey } from './paymentCheques';
import {
  LoadingSpinner,
  TableFiltersBar,
  filterControl,
  filterLabel,
  mobileCardList,
  MobileRowCard,
  rowMatchesQuery,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
} from './tableToolbar';

const apiRoot = getApiBase() || '';

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function buildPendingChequeRows(payments) {
  return buildChequeTableRows(payments, (p, c, flat) => {
    if (c.chequeDeposited || c.chequeReturned) return null;
    return {
      rowKey: depositQueueRowKey({ id: p.id, chequeId: c.id }),
      customerName: String(p.customerName ?? '').trim() || '—',
      billNumber: p.billNumber != null ? String(p.billNumber) : '—',
      chequeNumber: flat.chequeNumber,
      chequeDate: flat.chequeDate,
      amount: flat.amount,
    };
  }).sort((a, b) => {
    const d = a.chequeDate.localeCompare(b.chequeDate);
    if (d !== 0) return d;
    return a.rowKey.localeCompare(b.rowKey);
  });
}

export default function PendingChequesPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${apiRoot}/api/payments`);
      if (!res.ok) throw new Error('Failed to load payments');
      const payments = await res.json();
      setRows(buildPendingChequeRows(Array.isArray(payments) ? payments : []));
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
          row.billNumber,
          row.chequeNumber,
          row.chequeDate,
          row.amount,
        ]),
      ),
    [rows, search],
  );

  const totalAmount = useMemo(
    () => filteredRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
    [filteredRows],
  );

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Cheque payments not yet marked as deposited at the bank.
      </p>

      <TableFiltersBar
        hint={
          !loading && rows.length > 0
            ? `${filteredRows.length} pending cheque${filteredRows.length === 1 ? '' : 's'} · ${money(totalAmount)} total`
            : null
        }
      >
        <label className={filterLabel}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Customer, bill #, cheque #…"
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
        <div className="space-y-3">
          <div className={mobileCardList}>
            {filteredRows.length === 0 ? (
              <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
                {rows.length === 0 ? 'No pending cheques.' : 'No matches.'}
              </p>
            ) : (
              filteredRows.map((row) => (
                <MobileRowCard
                  key={row.rowKey}
                  title={row.customerName}
                  subtitle={`Bill #${row.billNumber} · Cheque #${row.chequeNumber}`}
                  fields={[
                    { label: 'Cheque date', value: row.chequeDate || '—' },
                    { label: 'Amount', value: money(row.amount) },
                  ]}
                />
              ))
            )}
          </div>
          <div className={`hidden sm:block ${scrollTableWrap}`}>
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm">
              <thead className={stickyThead}>
                <tr className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className={`px-3 py-3 ${stickyFirstTh}`}>Customer</th>
                  <th className="px-3 py-3 font-mono">Bill #</th>
                  <th className="px-3 py-3 font-mono">Cheque #</th>
                  <th className="px-3 py-3">Cheque date</th>
                  <th className="px-3 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-sm text-slate-500">
                      {rows.length === 0 ? 'No pending cheques.' : 'No matches.'}
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr key={row.rowKey} className="hover:bg-slate-50/80">
                      <td className={`max-w-[180px] px-3 py-3 font-medium text-slate-900 ${stickyFirstTd}`}>
                        <span className="line-clamp-2">{row.customerName}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs tabular-nums">
                        {row.billNumber}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs">{row.chequeNumber}</td>
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-600">
                        {row.chequeDate || '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-violet-800">
                        {money(row.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
