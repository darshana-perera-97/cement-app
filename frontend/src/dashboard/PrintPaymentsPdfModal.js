import { useEffect, useMemo, useState } from 'react';
import {
  ModalBackdrop,
  filterControl,
  filterLabelNarrow,
  inDateRange,
  modalPanelClass,
} from './tableToolbar';
import { compareBillNumbers, downloadPaymentsListPdf, inBillNumberRange } from './paymentsListPdf';

export default function PrintPaymentsPdfModal({
  open,
  onClose,
  payments = [],
  initialDateFrom = '',
  initialDateTo = '',
}) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [billFrom, setBillFrom] = useState('');
  const [billTo, setBillTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setDateFrom(initialDateFrom || '');
    setDateTo(initialDateTo || '');
    setBillFrom('');
    setBillTo('');
    setBusy(false);
    setError(null);
  }, [open, initialDateFrom, initialDateTo]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || busy) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, busy, onClose]);

  const filtered = useMemo(() => {
    const list = (Array.isArray(payments) ? payments : []).filter((p) => {
      if (!inDateRange(p.date, dateFrom, dateTo)) return false;
      if (!inBillNumberRange(p.billNumber, billFrom, billTo)) return false;
      return true;
    });
    return list.sort((a, b) => {
      const byDate = String(a.date || '').localeCompare(String(b.date || ''));
      if (byDate !== 0) return byDate;
      return compareBillNumbers(a.billNumber, b.billNumber);
    });
  }, [payments, dateFrom, dateTo, billFrom, billTo]);

  if (!open) return null;

  const handleDownload = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      downloadPaymentsListPdf({
        rows: filtered,
        filters: {
          dateFrom,
          dateTo,
          billFrom,
          billTo,
        },
      });
      onClose();
    } catch (e) {
      setError(e?.message || 'Could not prepare the PDF.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <ModalBackdrop onClose={busy ? undefined : onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="print-payments-pdf-title"
        className={`${modalPanelClass} w-full max-w-md pb-[max(1.25rem,env(safe-area-inset-bottom))]`}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300/90 sm:hidden" aria-hidden />
        <h2 id="print-payments-pdf-title" className="text-lg font-bold text-slate-900">
          Download payments PDF
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          A4 sheet of thermal-style payment receipt strips — 3 columns per row — with customer, ID, receipt
          number, payment methods, cheques, and settling invoices.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          <label className={filterLabelNarrow}>
            Bill # from
            <input
              type="text"
              value={billFrom}
              onChange={(e) => setBillFrom(e.target.value)}
              placeholder="e.g. 001"
              className={filterControl}
              autoComplete="off"
            />
          </label>
          <label className={filterLabelNarrow}>
            Bill # to
            <input
              type="text"
              value={billTo}
              onChange={(e) => setBillTo(e.target.value)}
              placeholder="e.g. 050"
              className={filterControl}
              autoComplete="off"
            />
          </label>
        </div>

        <p className="mt-3 text-xs tabular-nums text-slate-500">
          {filtered.length} payment{filtered.length === 1 ? '' : 's'} match these filters
          {payments.length ? ` (of ${payments.length})` : ''}.
        </p>

        {error ? (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={busy || filtered.length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Preparing…' : 'Download PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
