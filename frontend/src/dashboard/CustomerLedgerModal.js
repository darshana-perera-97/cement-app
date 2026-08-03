import { useEffect, useMemo, useState } from 'react';
import {
  LoadingSpinner,
  TableFiltersBar,
  filterControl,
  filterLabelNarrow,
  mobileCardList,
  MobileRowCard,
  modalPanelClass4xl,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
} from './tableToolbar';
import { buildCustomerLedgerRows } from './customerLedger';
import { downloadCustomerLedgerReport } from './customerLedgerExport';

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

function balanceTone(balance) {
  const n = Number(balance) || 0;
  if (n < 0) return 'text-emerald-800';
  if (n > 0) return 'text-slate-900';
  return 'text-slate-600';
}

export default function CustomerLedgerModal({ open, customer, transactions, loading, onClose }) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const ledgerRows = useMemo(
    () => buildCustomerLedgerRows(transactions, { dateFrom, dateTo }),
    [transactions, dateFrom, dateTo],
  );

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const row of ledgerRows) {
      if (row.kind === 'starting') continue;
      debit += Number(row.debit) || 0;
      credit += Number(row.credit) || 0;
    }
    const closing = ledgerRows.length > 0 ? ledgerRows[ledgerRows.length - 1].balance : 0;
    return { debit, credit, closing, count: ledgerRows.filter((r) => r.kind !== 'starting').length };
  }, [ledgerRows]);

  if (!open) return null;

  const periodSelected = Boolean(dateFrom || dateTo);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customer-ledger-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className={`${modalPanelClass4xl} flex max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-bottom,0px)))] w-full max-w-none flex-col overflow-hidden !p-0 sm:max-w-6xl`}
      >
        <div className="shrink-0 border-b border-slate-100 px-4 pb-3 pt-3 sm:px-6 sm:pt-6">
          <div
            className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-slate-300/90 sm:hidden"
            aria-hidden
          />
          <h2 id="customer-ledger-title" className="text-lg font-bold text-slate-900 sm:text-xl">
            Ledger — {customer?.name || 'Customer'}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Account activity in date order. Debits increase what is owed; credits are payments. Balance is amount
            still owed (negative means overpaid).
          </p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          <TableFiltersBar
            hint={
              !loading
                ? `${totals.count} entr${totals.count === 1 ? 'y' : 'ies'}${periodSelected && dateFrom ? ' · starting balance included' : ''}`
                : null
            }
          >
            <label className={filterLabelNarrow}>
              From
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className={filterControl}
              />
            </label>
            <label className={filterLabelNarrow}>
              To
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className={filterControl}
              />
            </label>
            {dateFrom || dateTo ? (
              <button
                type="button"
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                }}
                className="self-end rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Clear dates
              </button>
            ) : null}
          </TableFiltersBar>

          <div className="mt-3">
            {loading ? (
              <p className="flex items-center justify-center gap-2 rounded-2xl bg-slate-50 px-4 py-12 text-sm text-slate-500 ring-1 ring-slate-100">
                <LoadingSpinner /> Loading ledger…
              </p>
            ) : ledgerRows.length === 0 ? (
              <p className="rounded-2xl bg-slate-50 px-4 py-12 text-center text-sm text-slate-500 ring-1 ring-slate-100">
                {transactions.length === 0
                  ? 'No account activity recorded for this customer yet.'
                  : 'No entries in this date range.'}
              </p>
            ) : (
              <>
                <div className={mobileCardList}>
                  {ledgerRows.map((row) => (
                    <MobileRowCard
                      key={row.id}
                      title={row.kind === 'starting' ? 'Starting balance' : formatDisplayDate(row.date)}
                      subtitle={row.type}
                      badge={
                        row.kind === 'starting' ? (
                          <span className="rounded-md bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-900">
                            Opening
                          </span>
                        ) : null
                      }
                      fields={[
                        { label: 'Details', value: row.details || '—' },
                        {
                          label: 'Debit',
                          value: row.debit != null && row.debit > 0 ? money(row.debit) : '—',
                        },
                        {
                          label: 'Credit',
                          value: row.credit != null && row.credit > 0 ? money(row.credit) : '—',
                        },
                        {
                          label: 'Balance',
                          value: money(row.balance),
                        },
                      ]}
                    />
                  ))}
                </div>
                <div className={`hidden sm:block ${scrollTableWrap}`}>
                  <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
                    <thead className={stickyThead}>
                      <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3">Details</th>
                        <th className="whitespace-nowrap px-4 py-3 text-right">Debit</th>
                        <th className="whitespace-nowrap px-4 py-3 text-right">Credit</th>
                        <th className="whitespace-nowrap px-4 py-3 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-800">
                      {ledgerRows.map((row) => (
                        <tr
                          key={row.id}
                          className={
                            row.kind === 'starting'
                              ? 'bg-indigo-50/50 font-medium'
                              : 'hover:bg-slate-50/80'
                          }
                        >
                          <td className={`whitespace-nowrap px-4 py-3 tabular-nums text-slate-700 ${stickyFirstTd}`}>
                            {row.kind === 'starting' ? formatDisplayDate(row.date) : formatDisplayDate(row.date)}
                          </td>
                          <td className="px-4 py-3 text-slate-800">{row.type}</td>
                          <td className="max-w-[16rem] px-4 py-3 text-xs text-slate-600">{row.details || '—'}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-900">
                            {row.debit != null && row.debit > 0 ? money(row.debit) : '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-emerald-800">
                            {row.credit != null && row.credit > 0 ? money(row.credit) : '—'}
                          </td>
                          <td
                            className={`whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums ${balanceTone(row.balance)}`}
                          >
                            {money(row.balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {!loading && ledgerRows.length > 0 ? (
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                <p className="text-[10px] font-semibold uppercase text-slate-500">Entries</p>
                <p className="font-bold tabular-nums text-slate-900">{totals.count}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                <p className="text-[10px] font-semibold uppercase text-slate-500">Total debit</p>
                <p className="font-bold tabular-nums text-slate-900">{money(totals.debit)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                <p className="text-[10px] font-semibold uppercase text-slate-500">Total credit</p>
                <p className="font-bold tabular-nums text-emerald-800">{money(totals.credit)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                <p className="text-[10px] font-semibold uppercase text-slate-500">Closing balance</p>
                <p className={`font-bold tabular-nums ${balanceTone(totals.closing)}`}>{money(totals.closing)}</p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur-sm sm:px-6 sm:py-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 sm:w-auto sm:py-2.5"
            >
              Close
            </button>
            <button
              type="button"
              disabled={loading || ledgerRows.length === 0}
              onClick={() =>
                downloadCustomerLedgerReport(customer, ledgerRows, {
                  dateFrom,
                  dateTo,
                })
              }
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-100 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-5 sm:py-2.5"
            >
              Download
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
