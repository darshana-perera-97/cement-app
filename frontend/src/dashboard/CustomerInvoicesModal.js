import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import {
  LoadingSpinner,
  TableFiltersBar,
  filterControl,
  filterLabelNarrow,
  inDateRange,
  mobileCardList,
  MobileRowCard,
  modalPanelClass4xl,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
} from './tableToolbar';
import { downloadCustomerInvoicesReport } from './customerInvoicesExport';
import { buildCustomerInvoiceRows } from './pendingBills';
import { isTaxInvoiceReady } from './customerTaxUtils';
import { downloadTaxInvoicePdf } from './taxInvoicesPdf';

const apiBase = getApiBase();

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

function formatDaysToSettle(row) {
  if (row.daysToSettle == null) return '—';
  return String(row.daysToSettle);
}

function statusBadge(status, isOverdue) {
  if (status === 'settled') {
    return (
      <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
        Settled
      </span>
    );
  }
  if (status === 'partial') {
    return (
      <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
        Partial
      </span>
    );
  }
  if (isOverdue) {
    return (
      <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-800">
        Overdue
      </span>
    );
  }
  return (
    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700">
      Open
    </span>
  );
}

export default function CustomerInvoicesModal({ open, customer, onClose }) {
  const [bills, setBills] = useState([]);
  const [payments, setPayments] = useState([]);
  const [shop, setShop] = useState(null);
  const [unloads, setUnloads] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [taxDownloadingId, setTaxDownloadingId] = useState(null);

  const taxReady = isTaxInvoiceReady(customer, shop);

  const load = useCallback(async () => {
    if (!customer) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [billsRes, payRes, shopRes, unloadsRes, promosRes] = await Promise.all([
        fetch(`${apiBase}/api/bills`),
        fetch(`${apiBase}/api/payments`),
        fetch(`${apiBase}/api/shop`),
        fetch(`${apiBase}/api/unloads`),
        fetch(`${apiBase}/api/promotions`),
      ]);
      if (!billsRes.ok) throw new Error('Failed to load bills');
      if (!payRes.ok) throw new Error('Failed to load payments');
      const billsData = await billsRes.json();
      const payData = await payRes.json();
      const shopData = shopRes.ok ? await shopRes.json() : null;
      const unloadsData = unloadsRes.ok ? await unloadsRes.json() : [];
      const promosData = promosRes.ok ? await promosRes.json() : [];
      setBills(Array.isArray(billsData) ? billsData : []);
      setPayments(Array.isArray(payData) ? payData : []);
      setShop(shopData);
      setUnloads(Array.isArray(unloadsData) ? unloadsData : []);
      setPromotions(Array.isArray(promosData) ? promosData : []);
    } catch (e) {
      setLoadError(e.message || 'Could not load invoices');
      setBills([]);
      setPayments([]);
      setShop(null);
      setUnloads([]);
      setPromotions([]);
    } finally {
      setLoading(false);
    }
  }, [customer]);

  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const allRows = useMemo(
    () => (customer ? buildCustomerInvoiceRows(customer, bills, payments) : []),
    [customer, bills, payments],
  );

  const filteredRows = useMemo(
    () => allRows.filter((r) => inDateRange(r.billDate, dateFrom, dateTo)),
    [allRows, dateFrom, dateTo],
  );

  const totals = useMemo(() => {
    let billed = 0;
    let paid = 0;
    let due = 0;
    for (const r of filteredRows) {
      billed += Number(r.billTotal) || 0;
      paid += Number(r.paidAmount) || 0;
      due += Number(r.outstandingAmount) || 0;
    }
    return { billed, paid, due, count: filteredRows.length };
  }, [filteredRows]);

  const billById = useMemo(() => {
    const map = new Map();
    for (const bill of bills) {
      const id = String(bill.id ?? '').trim();
      if (id) map.set(id, bill);
    }
    return map;
  }, [bills]);

  const handleDownloadTaxInvoice = (row) => {
    const bill = billById.get(String(row.id ?? '').trim());
    if (!bill || !taxReady) return;
    setTaxDownloadingId(row.id);
    try {
      downloadTaxInvoicePdf(bill, {
        customer,
        shop,
        unloads,
        promotions,
        modeOfPayment: row.status === 'settled' ? 'Paid' : 'Credit',
      });
    } finally {
      setTaxDownloadingId(null);
    }
  };

  if (!open) return null;

  const settlementDays = customer?.overdueDays ?? 14;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customer-invoices-title"
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
          <h2 id="customer-invoices-title" className="text-lg font-bold text-slate-900 sm:text-xl">
            Invoices — {customer?.name || 'Customer'}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Credit bills · settle within {settlementDays} day{settlementDays === 1 ? '' : 's'} of bill date.
            Payments apply to opening balance first, then oldest bills.
            {taxReady ? ' Tax invoice download is available per row.' : null}
          </p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          <TableFiltersBar
            hint={
              !loading
                ? `${filteredRows.length} invoice${filteredRows.length === 1 ? '' : 's'} · ${money(totals.due)} outstanding in period`
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

          {loadError ? (
            <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{loadError}</p>
          ) : null}

          <div className="mt-3">
            {loading ? (
              <p className="flex items-center justify-center gap-2 rounded-2xl bg-slate-50 px-4 py-12 text-sm text-slate-500 ring-1 ring-slate-100">
                <LoadingSpinner /> Loading invoices…
              </p>
            ) : filteredRows.length === 0 ? (
              <p className="rounded-2xl bg-slate-50 px-4 py-12 text-center text-sm text-slate-500 ring-1 ring-slate-100">
                {allRows.length === 0
                  ? 'No credit bills recorded for this customer yet.'
                  : 'No invoices in this date range.'}
              </p>
            ) : (
              <>
                <div className={mobileCardList}>
                  {filteredRows.map((r) => (
                    <MobileRowCard
                      key={r.id}
                      title={formatDisplayDate(r.billDate)}
                      subtitle={r.details}
                      badge={statusBadge(r.status, r.isOverdue)}
                      fields={[
                        { label: 'Bill total', value: money(r.billTotal) },
                        ...(r.status === 'partial'
                          ? [
                              { label: 'Paid', value: money(r.paidAmount) },
                              { label: 'Balance', value: money(r.outstandingAmount) },
                            ]
                          : r.status === 'open' || r.isOverdue
                            ? [{ label: 'Balance', value: money(r.outstandingAmount) }]
                            : []),
                        { label: 'Settled date', value: formatDisplayDate(r.settledDate) },
                        { label: 'Days to settle', value: formatDaysToSettle(r) },
                      ]}
                      actions={
                        taxReady ? (
                          <button
                            type="button"
                            onClick={() => handleDownloadTaxInvoice(r)}
                            disabled={taxDownloadingId === r.id}
                            className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-50"
                          >
                            {taxDownloadingId === r.id ? '…' : 'Tax invoice'}
                          </button>
                        ) : null
                      }
                    />
                  ))}
                </div>
                <div className={`hidden sm:block ${scrollTableWrap}`}>
                  <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
                    <thead className={stickyThead}>
                      <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Bill date</th>
                        <th className="px-4 py-3">Details</th>
                        <th className="whitespace-nowrap px-4 py-3">Settled date</th>
                        <th className="whitespace-nowrap px-4 py-3 text-right">Days to settle</th>
                        <th className="whitespace-nowrap px-4 py-3 text-right">Total</th>
                        <th className="whitespace-nowrap px-4 py-3 text-right">Paid</th>
                        <th className="whitespace-nowrap px-4 py-3 text-right">Balance</th>
                        <th className="whitespace-nowrap px-4 py-3">Status</th>
                        {taxReady ? <th className="whitespace-nowrap px-4 py-3">Actions</th> : null}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-800">
                      {filteredRows.map((r) => (
                        <tr key={r.id} className={r.isOverdue ? 'bg-rose-50/40' : 'hover:bg-slate-50/80'}>
                          <td className={`whitespace-nowrap px-4 py-3 tabular-nums ${stickyFirstTd}`}>
                            {formatDisplayDate(r.billDate)}
                          </td>
                          <td className="max-w-[14rem] px-4 py-3 text-xs text-slate-600">{r.details}</td>
                          <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700">
                            {formatDisplayDate(r.settledDate)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700">
                            {formatDaysToSettle(r)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">
                            {money(r.billTotal)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-emerald-800">
                            {r.paidAmount > 0 ? money(r.paidAmount) : '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
                            {r.outstandingAmount > 0 ? money(r.outstandingAmount) : '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">{statusBadge(r.status, r.isOverdue)}</td>
                          {taxReady ? (
                            <td className="whitespace-nowrap px-4 py-3">
                              <button
                                type="button"
                                onClick={() => handleDownloadTaxInvoice(r)}
                                disabled={taxDownloadingId === r.id}
                                className="rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-50"
                                title="Download tax invoice PDF"
                              >
                                {taxDownloadingId === r.id ? '…' : 'Tax invoice'}
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {!loading && filteredRows.length > 0 ? (
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                <p className="text-[10px] font-semibold uppercase text-slate-500">Invoices</p>
                <p className="font-bold tabular-nums text-slate-900">{totals.count}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                <p className="text-[10px] font-semibold uppercase text-slate-500">Billed</p>
                <p className="font-bold tabular-nums text-slate-900">{money(totals.billed)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                <p className="text-[10px] font-semibold uppercase text-slate-500">Paid (allocated)</p>
                <p className="font-bold tabular-nums text-emerald-800">{money(totals.paid)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                <p className="text-[10px] font-semibold uppercase text-slate-500">Balance</p>
                <p className="font-bold tabular-nums text-slate-900">{money(totals.due)}</p>
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
              disabled={loading || filteredRows.length === 0}
              onClick={() =>
                downloadCustomerInvoicesReport(customer, filteredRows, {
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
