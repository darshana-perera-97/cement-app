import { useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import { authFetch, getUsername } from '../auth';
import { buildCustomerChequeRows, chequeStatusBucket } from './paymentCheques';
import { LoadingSpinner, scrollTableWrap, stickyFirstTd, stickyFirstTh, stickyThead } from './tableToolbar';

const apiBase = getApiBase();

const CHEQUE_TABS = [
  { id: 'pending', label: 'Pending' },
  { id: 'deposited', label: 'Deposited' },
  { id: 'returned', label: 'Returned' },
];

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
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

function formatDateTime(iso) {
  const s = String(iso ?? '').trim();
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function CustomerChequesPanel({
  customerId,
  payments = [],
  loading = false,
  canMarkReturn = false,
  onUpdated,
}) {
  const [tab, setTab] = useState('pending');
  const [markingKey, setMarkingKey] = useState(null);
  const [actionError, setActionError] = useState(null);

  const allRows = useMemo(
    () => buildCustomerChequeRows(payments, customerId),
    [payments, customerId],
  );

  const counts = useMemo(() => {
    const c = { pending: 0, deposited: 0, returned: 0 };
    for (const row of allRows) {
      const bucket = chequeStatusBucket(row);
      if (c[bucket] != null) c[bucket] += 1;
    }
    return c;
  }, [allRows]);

  const rows = useMemo(() => allRows.filter((r) => chequeStatusBucket(r) === tab), [allRows, tab]);

  const handleMarkReturned = async (row) => {
    const username = getUsername();
    if (!username) {
      setActionError('Sign in with a username to mark cheques as returned.');
      return;
    }
    const label = row.chequeNumber !== '—' ? row.chequeNumber : 'this cheque';
    if (!window.confirm(`Mark cheque ${label} (${money(row.amount)}) as returned? The customer balance will be updated.`)) {
      return;
    }
    setMarkingKey(row.rowKey);
    setActionError(null);
    try {
      const res = await authFetch(
        `${apiBase}/api/payments/${encodeURIComponent(row.paymentId)}/cheque-returned`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recordedBy: username,
            chequeId: row.chequeId !== '_legacy' ? row.chequeId : undefined,
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error || 'Could not mark cheque as returned');
        return;
      }
      onUpdated?.();
    } catch {
      setActionError('Could not reach the server');
    } finally {
      setMarkingKey(null);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-bold text-slate-900">Cheques</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Cheques from this customer&apos;s payments — pending, deposited at the bank, or returned.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {CHEQUE_TABS.map((opt) => {
          const active = tab === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setTab(opt.id)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                active
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {opt.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
                  active ? 'bg-indigo-500/40 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {counts[opt.id] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {actionError ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{actionError}</p>
      ) : null}

      <div className={`rounded-2xl bg-white ring-1 ring-slate-200 ${scrollTableWrap}`}>
        {loading ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            <LoadingSpinner label="Loading cheques…" />
          </p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            {allRows.length === 0
              ? 'No cheques recorded for this customer yet.'
              : `No ${tab} cheques.`}
          </p>
        ) : (
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className={`px-4 py-3 ${stickyFirstTh}`}>Cheque</th>
                <th className="px-3 py-3">Converting</th>
                <th className="px-3 py-3 text-right">Amount</th>
                <th className="px-3 py-3">Receipt</th>
                <th className="px-3 py-3">Status</th>
                {canMarkReturn && tab !== 'returned' ? (
                  <th className="px-3 py-3 text-right">Action</th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {rows.map((r) => {
                const busy = markingKey === r.rowKey;
                let statusLabel = 'Pending deposit';
                let statusClass = 'bg-amber-50 text-amber-900 ring-amber-100';
                if (r.chequeReturned) {
                  statusLabel = r.chequeReturnedBy
                    ? `Returned · ${r.chequeReturnedBy}`
                    : 'Returned';
                  statusClass = 'bg-rose-50 text-rose-900 ring-rose-100';
                } else if (r.chequeDeposited) {
                  statusLabel = r.chequeDepositedBy
                    ? `Deposited · ${r.chequeDepositedBy}`
                    : 'Deposited';
                  statusClass = 'bg-emerald-50 text-emerald-900 ring-emerald-100';
                }
                return (
                  <tr key={r.rowKey} className="hover:bg-slate-50/60">
                    <td className={`whitespace-nowrap px-4 py-2.5 font-medium ${stickyFirstTd}`}>
                      {r.chequeNumber !== '—' ? r.chequeNumber : '—'}
                      <span className="mt-0.5 block text-xs font-normal text-slate-500">
                        Payment {formatDisplayDate(r.paymentDate)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-700">
                      {formatDisplayDate(r.chequeDate)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums">
                      {money(r.amount)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                      {r.billNumber !== '—' ? `#${r.billNumber}` : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${statusClass}`}
                      >
                        {statusLabel}
                      </span>
                      {r.chequeReturned && r.chequeReturnedAt ? (
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {formatDateTime(r.chequeReturnedAt)}
                        </span>
                      ) : r.chequeDeposited && r.chequeDepositedAt ? (
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {formatDateTime(r.chequeDepositedAt)}
                        </span>
                      ) : null}
                    </td>
                    {canMarkReturn && tab !== 'returned' ? (
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleMarkReturned(r)}
                          className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-800 transition hover:bg-rose-100 disabled:opacity-60"
                        >
                          {busy ? 'Saving…' : 'Mark returned'}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
