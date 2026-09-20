import { useEffect, useMemo, useState } from 'react';
import { usePrinter } from '../printer/PrinterProvider';
import { closeCollectionDay, fetchCollectionDayClose, todayYmdLocal } from './collectionDayClose';
import { LoadingSpinner, ModalBackdrop, modalPanelClassMd } from './tableToolbar';

function formatReportDate(ymd) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? '').trim());
  if (!match) return ymd || '—';
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function PrintCollectionsSummaryModal({ open, onClose, reportDate, printPayload }) {
  const { requestPrint } = usePrinter();
  const [statusLoading, setStatusLoading] = useState(false);
  const [alreadyClosed, setAlreadyClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const today = todayYmdLocal();
  const dateLabel = formatReportDate(reportDate);
  const isToday = String(reportDate || '') === today;
  const isFuture = String(reportDate || '') > today;

  const payload = useMemo(
    () => (printPayload && typeof printPayload === 'object' ? printPayload : {}),
    [printPayload],
  );

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setError(null);
    setBusy(false);
    setStatusLoading(true);
    fetchCollectionDayClose(reportDate)
      .then((data) => {
        if (cancelled) return;
        setAlreadyClosed(Boolean(data.closed));
      })
      .catch((e) => {
        if (cancelled) return;
        setAlreadyClosed(false);
        setError(e.message || 'Could not load collection status');
      })
      .finally(() => {
        if (!cancelled) setStatusLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, reportDate]);

  if (!open) return null;

  const printSummary = (collectionOver) => {
    onClose();
    requestPrint('dailyCollections', { ...payload, reportDate, collectionOver: Boolean(collectionOver) });
  };

  const handlePrintOnly = () => {
    if (busy) return;
    printSummary(alreadyClosed);
  };

  const handleCloseCollection = async () => {
    if (busy || isFuture) return;
    if (alreadyClosed) {
      printSummary(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await closeCollectionDay(reportDate);
      printSummary(true);
    } catch (e) {
      setError(e.message || 'Could not close collection for this day.');
      setBusy(false);
    }
  };

  const overQuestion = isToday ? 'Is collection over for today?' : `Is collection over for ${dateLabel}?`;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="print-collections-summary-title"
    >
      <ModalBackdrop onClose={busy ? undefined : onClose} />
      <div className={`${modalPanelClassMd} z-10`}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300/90 sm:hidden" aria-hidden />
        <h2 id="print-collections-summary-title" className="text-lg font-bold text-slate-900">
          Print summary
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Print a collections receipt for <span className="font-semibold text-slate-700">{dateLabel}</span>.
        </p>

        {statusLoading ? (
          <p className="mt-5 rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-100">
            <LoadingSpinner label="Checking collection status…" />
          </p>
        ) : alreadyClosed ? (
          <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-950 ring-1 ring-amber-100">
            Collection for this day is already over. You cannot add more payments, and the receipt will show that
            collection is over.
          </p>
        ) : (
          <div className="mt-4 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-100">
            <p className="text-sm font-semibold text-slate-900">{overQuestion}</p>
            <p className="mt-1.5 text-sm text-slate-600">
              If you confirm, it will be printed on the receipt and you will not be able to add payments for this day
              again.
            </p>
            {isFuture ? (
              <p className="mt-2 text-sm text-amber-800">You can only close collection for today or a past day.</p>
            ) : null}
          </div>
        )}

        {error ? (
          <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col gap-2">
          {!statusLoading && !alreadyClosed ? (
            <button
              type="button"
              onClick={handleCloseCollection}
              disabled={busy || isFuture}
              className="w-full rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Closing collection…' : 'Yes, collection is over'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={alreadyClosed ? handleCloseCollection : handlePrintOnly}
            disabled={busy || statusLoading}
            className="w-full rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-semibold text-sky-800 ring-1 ring-sky-100 transition hover:bg-sky-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {alreadyClosed ? 'Print summary' : 'Print only'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
