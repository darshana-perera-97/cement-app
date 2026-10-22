import { useEffect, useMemo, useState } from 'react';
import {
  LoadingSpinner,
  TableFiltersBar,
  filterControl,
  filterLabelNarrow,
  inDateRange,
  modalPanelClass4xl,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
} from './tableToolbar';
import {
  downloadInvoicesToPaymentsPdf,
  downloadPaymentsToInvoicesPdf,
} from './customerPaymentApplicationsExport';

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

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function invoiceLabel(app) {
  const invoiceNumber = String(app?.invoiceNumber || '').trim();
  if (invoiceNumber === 'Opening') return 'Opening';
  if (invoiceNumber) return invoiceNumber;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(app?.date || ''))) return String(app.date);
  if (app?.isReturnCheque) return 'Return cheque';
  return 'Invoice';
}

function receiptFromPayment(paymentTx, paymentsById) {
  const id = String(paymentTx?.paymentId || paymentTx?.id || '').trim();
  const row = id ? paymentsById.get(id) : null;
  const fromStore = String(row?.billNumber ?? '').trim();
  if (fromStore) return fromStore;
  const match = String(paymentTx?.details || '').match(/\bBill\s*#\s*([A-Za-z0-9][\w ./\-_]*)/i);
  return match ? match[1].trim() : '';
}

/**
 * Build payment → invoice and invoice → payment views from customer transactions.
 */
function buildApplicationViews(transactions, payments, { dateFrom, dateTo }) {
  const list = Array.isArray(transactions) ? transactions : [];
  const paymentsById = new Map();
  for (const p of Array.isArray(payments) ? payments : []) {
    const id = String(p?.id ?? '').trim();
    if (id) paymentsById.set(id, p);
  }

  const paymentRows = [];
  /** @type {Map<string, { billId: string, invoice: string, invoiceDate: string, amount: number, kind: string }>} */
  const invoiceMeta = new Map();
  /** @type {Map<string, Array<{ paymentId: string, paymentDate: string, receipt: string, amount: number, methods: string }>>} */
  const paymentsByBillId = new Map();

  for (const tx of list) {
    if (tx.kind === 'bill' || tx.kind === 'opening') {
      const billId = String(tx.id ?? '').trim();
      if (!billId) continue;
      const invoice =
        tx.kind === 'opening'
          ? 'Opening'
          : String(tx.invoiceNumber || '').trim() ||
            (String(tx.details || '').match(/\bInvoice\s+([A-Za-z0-9][\w./-]*)/) || [])[1] ||
            'Invoice';
      invoiceMeta.set(billId, {
        billId,
        invoice,
        invoiceDate: String(tx.date ?? '').slice(0, 10),
        amount: roundMoney(tx.amount),
        kind: tx.kind,
      });
    }
  }

  for (const tx of list) {
    if (tx.kind !== 'payment') continue;
    const paymentDate = String(tx.date ?? '').slice(0, 10);
    const paymentId = String(tx.paymentId || tx.id || '').trim();
    const receipt = receiptFromPayment(tx, paymentsById);
    const methods = String(tx.paymentMethods || '').trim();
    const applications = Array.isArray(tx.applications) ? tx.applications : [];
    const applied = [];
    let appliedTotal = 0;

    for (const app of applications) {
      const amt = roundMoney(app?.appliedAmount);
      if (amt <= 0.009) continue;
      const billId = String(app?.billId || '').trim() || `anon-${applied.length}`;
      const label = invoiceLabel(app);
      const invoiceDate = String(app?.date ?? '').slice(0, 10);
      applied.push({
        billId,
        invoice: label,
        invoiceDate,
        amount: amt,
        settled: Boolean(app?.settled),
      });
      appliedTotal = roundMoney(appliedTotal + amt);

      if (!invoiceMeta.has(billId)) {
        invoiceMeta.set(billId, {
          billId,
          invoice: label,
          invoiceDate,
          amount: roundMoney(app?.billTotal),
          kind: label === 'Opening' ? 'opening' : app?.isReturnCheque ? 'return' : 'bill',
        });
      }

      if (billId && !billId.startsWith('anon-')) {
        if (!paymentsByBillId.has(billId)) paymentsByBillId.set(billId, []);
        paymentsByBillId.get(billId).push({
          paymentId,
          paymentDate,
          receipt,
          amount: amt,
          methods,
        });
      }
    }

    if (!inDateRange(paymentDate, dateFrom, dateTo)) continue;

    const paymentAmount = roundMoney(tx.amount);
    const unallocated = roundMoney(Math.max(0, paymentAmount - appliedTotal));
    if (unallocated > 0.009) {
      applied.push({
        billId: '',
        invoice: 'On account',
        invoiceDate: '',
        amount: unallocated,
        settled: false,
      });
    }

    paymentRows.push({
      id: paymentId || `${paymentDate}-${paymentRows.length}`,
      paymentDate,
      receipt,
      methods,
      amount: paymentAmount,
      applications: applied,
    });
  }

  paymentRows.sort((a, b) => {
    const cmp = String(b.paymentDate).localeCompare(String(a.paymentDate));
    if (cmp !== 0) return cmp;
    return String(b.receipt).localeCompare(String(a.receipt));
  });

  const invoiceRows = [];
  for (const meta of invoiceMeta.values()) {
    if (!inDateRange(meta.invoiceDate, dateFrom, dateTo)) continue;
    const apps = (paymentsByBillId.get(meta.billId) || [])
      .slice()
      .sort((a, b) => String(b.paymentDate).localeCompare(String(a.paymentDate)));
    invoiceRows.push({
      ...meta,
      payments: apps,
      paidTotal: roundMoney(apps.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)),
    });
  }

  invoiceRows.sort((a, b) => {
    const cmp = String(b.invoiceDate).localeCompare(String(a.invoiceDate));
    if (cmp !== 0) return cmp;
    return String(a.invoice).localeCompare(String(b.invoice));
  });

  return { paymentRows, invoiceRows };
}

function ApplicationsCell({ items, emptyLabel = '—' }) {
  if (!items.length) {
    return <span className="text-slate-400">{emptyLabel}</span>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, index) => (
        <li
          key={`${item.key || item.label}-${index}`}
          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs sm:text-sm"
        >
          <span className="min-w-0 text-slate-700">
            <span className="font-medium text-slate-900">{item.label}</span>
            {item.sub ? <span className="text-slate-500"> · {item.sub}</span> : null}
          </span>
          <span className="shrink-0 tabular-nums font-semibold text-slate-900">{money(item.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function CustomerPaymentApplicationsModal({
  open,
  customer,
  transactions,
  payments,
  loading,
  onClose,
}) {
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

  const { paymentRows, invoiceRows } = useMemo(
    () =>
      buildApplicationViews(transactions, payments, {
        dateFrom,
        dateTo,
      }),
    [transactions, payments, dateFrom, dateTo],
  );

  const paymentTotal = useMemo(
    () => roundMoney(paymentRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)),
    [paymentRows],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customer-payment-applications-title"
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
          <h2
            id="customer-payment-applications-title"
            className="text-lg font-bold text-slate-900 sm:text-xl"
          >
            Payment applications — {customer?.name || 'Customer'}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Choose a period to see how receipts were applied to invoices, and which payments settled each
            bill.
          </p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          <TableFiltersBar
            hint={
              !loading
                ? `${paymentRows.length} payment${paymentRows.length === 1 ? '' : 's'} · ${invoiceRows.length} invoice${invoiceRows.length === 1 ? '' : 's'} in period`
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

          {loading ? (
            <p className="mt-3 flex items-center justify-center gap-2 rounded-2xl bg-slate-50 px-4 py-12 text-sm text-slate-500 ring-1 ring-slate-100">
              <LoadingSpinner /> Loading applications…
            </p>
          ) : (
            <div className="mt-4 space-y-6">
              <section>
                <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Payments → invoices</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Each receipt in the period and the invoices it settled.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {paymentRows.length > 0 ? (
                      <p className="text-xs font-semibold tabular-nums text-slate-600">
                        Total {money(paymentTotal)}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      disabled={paymentRows.length === 0}
                      onClick={() =>
                        downloadPaymentsToInvoicesPdf(customer, paymentRows, { dateFrom, dateTo })
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <path d="M12 3a1 1 0 011 1v9.586l2.293-2.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L11 13.586V4a1 1 0 011-1z" />
                        <path d="M5 18a1 1 0 011-1h12a1 1 0 110 2H6a1 1 0 01-1-1z" />
                      </svg>
                      Download PDF
                    </button>
                  </div>
                </div>
                {paymentRows.length === 0 ? (
                  <p className="rounded-2xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-500 ring-1 ring-slate-100">
                    No payments in this date range.
                  </p>
                ) : (
                  <div className={scrollTableWrap}>
                    <table className="w-full min-w-[720px] data-table border-separate border-spacing-0 text-left text-sm">
                      <thead className={stickyThead}>
                        <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
                          <th className="whitespace-nowrap px-4 py-3">Receipt</th>
                          <th className="px-4 py-3">Method</th>
                          <th className="whitespace-nowrap px-4 py-3 text-right">Payment</th>
                          <th className="min-w-[14rem] px-4 py-3">Applied to invoices</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-800">
                        {paymentRows.map((row) => (
                          <tr key={row.id} className="align-top hover:bg-slate-50/80">
                            <td
                              className={`whitespace-nowrap px-4 py-3 tabular-nums text-slate-700 ${stickyFirstTd}`}
                            >
                              {formatDisplayDate(row.paymentDate)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">
                              {row.receipt || '—'}
                            </td>
                            <td className="max-w-[10rem] px-4 py-3 text-xs text-slate-600">
                              {row.methods || '—'}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-emerald-800">
                              {money(row.amount)}
                            </td>
                            <td className="px-4 py-3">
                              <ApplicationsCell
                                items={row.applications.map((app) => ({
                                  key: `${app.billId}-${app.invoice}`,
                                  label: app.invoice,
                                  sub: app.invoiceDate ? formatDisplayDate(app.invoiceDate) : '',
                                  amount: app.amount,
                                }))}
                                emptyLabel="Not applied to an invoice"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section>
                <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Invoices → payments</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Invoices dated in the period and the payments applied to each.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={invoiceRows.length === 0}
                    onClick={() =>
                      downloadInvoicesToPaymentsPdf(customer, invoiceRows, { dateFrom, dateTo })
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M12 3a1 1 0 011 1v9.586l2.293-2.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L11 13.586V4a1 1 0 011-1z" />
                      <path d="M5 18a1 1 0 011-1h12a1 1 0 110 2H6a1 1 0 01-1-1z" />
                    </svg>
                    Download PDF
                  </button>
                </div>
                {invoiceRows.length === 0 ? (
                  <p className="rounded-2xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-500 ring-1 ring-slate-100">
                    No invoices in this date range.
                  </p>
                ) : (
                  <div className={scrollTableWrap}>
                    <table className="w-full min-w-[720px] data-table border-separate border-spacing-0 text-left text-sm">
                      <thead className={stickyThead}>
                        <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Bill date</th>
                          <th className="whitespace-nowrap px-4 py-3">Invoice</th>
                          <th className="whitespace-nowrap px-4 py-3 text-right">Bill total</th>
                          <th className="whitespace-nowrap px-4 py-3 text-right">Applied</th>
                          <th className="min-w-[14rem] px-4 py-3">Payments applied</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-800">
                        {invoiceRows.map((row) => (
                          <tr key={row.billId} className="align-top hover:bg-slate-50/80">
                            <td
                              className={`whitespace-nowrap px-4 py-3 tabular-nums text-slate-700 ${stickyFirstTd}`}
                            >
                              {formatDisplayDate(row.invoiceDate)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">
                              {row.invoice || '—'}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-900">
                              {row.amount > 0 ? money(row.amount) : '—'}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-emerald-800">
                              {row.paidTotal > 0 ? money(row.paidTotal) : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <ApplicationsCell
                                items={row.payments.map((p) => ({
                                  key: `${p.paymentId}-${p.paymentDate}`,
                                  label: p.receipt ? `Receipt ${p.receipt}` : 'Payment',
                                  sub: [
                                    formatDisplayDate(p.paymentDate),
                                    p.methods || null,
                                  ]
                                    .filter(Boolean)
                                    .join(' · '),
                                  amount: p.amount,
                                }))}
                                emptyLabel="No payments applied yet"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur-sm sm:px-6 sm:py-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 sm:w-auto sm:py-2.5"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
