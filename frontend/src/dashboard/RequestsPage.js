import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { getApiBase } from '../apiBase';
import { authFetch, getUsername, isManagerOrAdmin } from '../auth';
import { useBagProducts } from './BagProductsContext';
import {
  LoadingSpinner,
  TableFiltersBar,
  TablePaginationBar,
  filterControl,
  filterLabel,
  mobileCardList,
  MobileRowCard,
  rowMatchesQuery,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
  useTablePagination,
  modalPanelClass,
  ModalBackdrop,
} from './tableToolbar';
import { getPaymentCheques, cdmPortion, onlineTransferPortion } from './paymentCheques';
import RowDetailModal, { detailRowAttrs } from './RowDetailModal';

const apiBase = getApiBase();

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function totalBags(row, brands) {
  return brands.reduce((s, b) => s + (Number(row[`${b.key}Bags`]) || 0), 0);
}

function bagLines(row, brands) {
  return brands.filter((b) => (Number(row[`${b.key}Bags`]) || 0) > 0)
    .map((b) => `${b.label} ${Number(row[`${b.key}Bags`])}`)
    .join(', ');
}

function isPendingRequest(row) {
  const s = String(row?.status ?? 'pending').trim().toLowerCase();
  return s !== 'approved' && s !== 'rejected';
}

function paymentRequestSummary(row) {
  const parts = [];
  const cdm = cdmPortion(row);
  const online = onlineTransferPortion(row);
  if (cdm > 0) {
    parts.push(`CDM ${money(cdm)}${row.cdmNumber ? ` · ${row.cdmNumber}` : ''}`);
  }
  if (online > 0) {
    parts.push(`Online ${money(online)}${row.onlineTransferReference ? ` · ${row.onlineTransferReference}` : ''}`);
  }
  const cheques = getPaymentCheques(row);
  if (cheques.length > 0) {
    parts.push(`${cheques.length} cheque${cheques.length === 1 ? '' : 's'}`);
  }
  const cash = Number(row.cashAmount) || 0;
  if (cash > 0) parts.push(`Cash ${money(cash)}`);
  return parts.join(' · ') || money(row.amount);
}

function normalizeRequestRow(row, kind) {
  return { ...row, requestKind: kind };
}

function paymentApprovalBreakdown(row) {
  const lines = [];
  const cash = Number(row.cashAmount) || 0;
  if (cash > 0) lines.push({ label: 'Cash', value: money(cash) });
  const cdm = cdmPortion(row);
  if (cdm > 0) {
    lines.push({
      label: 'CDM deposit',
      value: `${money(cdm)}${row.cdmNumber ? ` · #${row.cdmNumber}` : ''}`,
    });
  }
  const online = onlineTransferPortion(row);
  if (online > 0) {
    lines.push({
      label: 'Online transfer',
      value: `${money(online)}${row.onlineTransferReference ? ` · ref ${row.onlineTransferReference}` : ''}`,
    });
  }
  for (const c of getPaymentCheques(row)) {
    lines.push({
      label: 'Cheque',
      value: `${money(c.amount)}${c.chequeNumber ? ` · #${c.chequeNumber}` : ''}`,
    });
  }
  return lines;
}

function emptyPriceForm(row, brands) {
  const f = {};
  for (const b of brands) {
    const bags = Number(row[`${b.key}Bags`]) || 0;
    f[`${b.key}UnitPrice`] = bags > 0 ? '' : '';
  }
  return f;
}

function LastPricesPopup({ open, preview, brands, onApply, onClose }) {
  if (!open || !preview?.found) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true">
      <ModalBackdrop onClose={onClose} />
      <div className={`${modalPanelClass} w-full max-w-md`}>
        <h3 className="text-lg font-bold text-slate-900">Use last bill prices?</h3>
        <p className="mt-2 text-sm text-slate-600">
          From credit bill dated <span className="font-semibold text-slate-800">{preview.date}</span> for{' '}
          <span className="font-semibold text-slate-800">{preview.customerName}</span>.
        </p>
        <ul className="mt-3 space-y-1 text-sm text-slate-700">
          {brands.map((b) => {
            const p = preview[`${b.key}UnitPrice`];
            if (p == null || Number(p) <= 0) return null;
            return (
              <li key={b.key}>
                {b.label}: {money(p)} / bag
              </li>
            );
          })}
        </ul>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onApply}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Apply prices
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RequestsPage() {
  const { brands } = useBagProducts();
  const allowed = isManagerOrAdmin();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [approveRow, setApproveRow] = useState(null);
  const [priceForm, setPriceForm] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [lastPreview, setLastPreview] = useState(null);
  const [lastPopupOpen, setLastPopupOpen] = useState(false);
  const [loadingLast, setLoadingLast] = useState(false);
  const [rejectingId, setRejectingId] = useState(null);
  const [detailRow, setDetailRow] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [unloadRes, paymentRes] = await Promise.all([
        authFetch(`${apiBase}/api/unload-requests?status=pending`),
        authFetch(`${apiBase}/api/payment-requests?status=pending`),
      ]);
      if (!unloadRes.ok) throw new Error('Failed to load requests');
      const unloadData = await unloadRes.json();
      const paymentData = paymentRes.ok ? await paymentRes.json() : [];
      const combined = [
        ...(Array.isArray(unloadData) ? unloadData : []).map((r) => normalizeRequestRow(r, 'unload')),
        ...(Array.isArray(paymentData) ? paymentData : []).map((r) => normalizeRequestRow(r, 'payment')),
      ].sort((a, b) =>
        String(b.createdAt || `${b.date}T12:00:00`).localeCompare(String(a.createdAt || `${a.date}T12:00:00`)),
      );
      setRows(combined);
    } catch (e) {
      setError(e.message || 'Could not load requests');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 5000);
    return () => window.clearInterval(id);
  }, [load]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const fields = [
        r.date,
        r.customerName,
        r.note,
        r.billNumber,
        r.recordedBy,
        r.requestKind === 'payment' ? 'payment approval' : 'unload',
      ];
      if (r.requestKind === 'payment') {
        fields.push(paymentRequestSummary(r));
      } else {
        fields.push(r.driverName, String(totalBags(r, brands)), bagLines(r, brands));
      }
      return rowMatchesQuery(search, fields);
    });
  }, [rows, search, brands]);

  const pagination = useTablePagination(filtered.length, [search]);
  const paged = useMemo(
    () => filtered.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filtered, pagination.offset, pagination.pageSize],
  );

  const openApprove = (row) => {
    setDetailRow(null);
    setSaveError(null);
    setApproveRow(row);
    if (row.requestKind === 'payment') {
      setPriceForm({});
      setLastPreview(null);
      setLastPopupOpen(false);
      return;
    }
    setPriceForm(emptyPriceForm(row, brands));
    setLastPreview(null);
    setLastPopupOpen(false);
  };

  const closeApprove = () => {
    setApproveRow(null);
    setPriceForm({});
    setSaveError(null);
    setLastPopupOpen(false);
    setLastPreview(null);
  };

  const fetchLastPrices = async () => {
    if (!approveRow?.customerId) return;
    setLoadingLast(true);
    setSaveError(null);
    try {
      const res = await authFetch(
        `${apiBase}/api/bills/last-unit-prices?customerId=${encodeURIComponent(approveRow.customerId)}`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || 'Could not load last prices');
        return;
      }
      if (!data.found) {
        setSaveError('No previous bill found for this shop.');
        return;
      }
      setLastPreview(data);
      setLastPopupOpen(true);
    } catch {
      setSaveError('Could not load last prices');
    } finally {
      setLoadingLast(false);
    }
  };

  const applyLastPrices = () => {
    if (!lastPreview) return;
    const next = { ...priceForm };
    for (const b of brands) {
      const bags = Number(approveRow?.[`${b.key}Bags`]) || 0;
      if (bags <= 0) continue;
      const p = lastPreview[`${b.key}UnitPrice`];
      if (p != null && Number(p) > 0) {
        next[`${b.key}UnitPrice`] = String(p);
      }
    }
    setPriceForm(next);
    setLastPopupOpen(false);
  };

  const submitApprove = async (e) => {
    e.preventDefault();
    if (!approveRow?.id) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (approveRow.requestKind === 'payment') {
        const res = await authFetch(
          `${apiBase}/api/payment-requests/${encodeURIComponent(approveRow.id)}/approve`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ approvedBy: getUsername() }),
          },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSaveError(data.error || 'Approval failed');
          return;
        }
        closeApprove();
        await load();
        return;
      }
      const payload = { enteredBy: getUsername() };
      for (const b of brands) {
        payload[`${b.key}UnitPrice`] = priceForm[`${b.key}UnitPrice`];
      }
      const res = await authFetch(`${apiBase}/api/unload-requests/${encodeURIComponent(approveRow.id)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || 'Approval failed');
        return;
      }
      closeApprove();
      await load();
    } catch {
      setSaveError('Network error');
    } finally {
      setSaving(false);
    }
  };

  const rejectRequest = async (row) => {
    if (!row?.id) return;
    setRejectingId(row.id);
    try {
      const url =
        row.requestKind === 'payment'
          ? `${apiBase}/api/payment-requests/${encodeURIComponent(row.id)}/reject`
          : `${apiBase}/api/unload-requests/${encodeURIComponent(row.id)}/reject`;
      const res = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejectedBy: getUsername() }),
      });
      if (res.ok) await load();
    } finally {
      setRejectingId(null);
    }
  };

  if (!allowed) {
    return <Navigate to="/dashboard/analytics" replace />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Requests</h1>
        <p className="mt-1 text-sm text-slate-500">
          Driver unload submissions and CDM / online transfer payments waiting for manager approval.
        </p>
      </div>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      <TableFiltersBar hint={loading ? 'Loading…' : `${filtered.length} pending request${filtered.length === 1 ? '' : 's'}`}>
        <label className={filterLabel}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Shop, driver, date…"
            className={filterControl}
          />
        </label>
      </TableFiltersBar>

      {loading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner />
        </div>
      ) : (
        <div className="space-y-3">
          <div className={mobileCardList}>
            {filtered.length === 0 ? (
              <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
                No pending requests.
              </p>
            ) : (
              paged.map((row) => (
                <MobileRowCard
                  key={`${row.requestKind}-${row.id}`}
                  title={row.customerName}
                  subtitle={
                    row.requestKind === 'payment'
                      ? `${row.date} · Payment · ${paymentRequestSummary(row)}`
                      : `${row.date} · ${row.driverName || 'Driver'} · ${totalBags(row, brands)} bags`
                  }
                  onClick={() => setDetailRow(row)}
                  fields={[
                    {
                      label: 'Type',
                      value: row.requestKind === 'payment' ? 'Payment approval' : 'Unload',
                    },
                    row.requestKind === 'payment'
                      ? { label: 'Amount', value: money(row.amount) }
                      : { label: 'Bags', value: bagLines(row, brands) || '—' },
                  ]}
                  actions={
                    <>
                      <button
                        type="button"
                        onClick={() => openApprove(row)}
                        className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white"
                      >
                        Approve…
                      </button>
                      <button
                        type="button"
                        disabled={rejectingId === row.id}
                        onClick={() => rejectRequest(row)}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"
                      >
                        Reject
                      </button>
                    </>
                  }
                />
              ))
            )}
          </div>

          <div className={`hidden sm:block ${scrollTableWrap}`}>
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
              <thead className={stickyThead}>
                <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Shop</th>
                  <th className="px-4 py-3">Details</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                      No pending requests.
                    </td>
                  </tr>
                ) : (
                  paged.map((row) => (
                    <tr
                      key={`${row.requestKind}-${row.id}`}
                      {...detailRowAttrs(() => setDetailRow(row), 'hover:bg-slate-50/80')}
                      aria-label={`Request ${row.customerName || ''}`}
                    >
                      <td className={`whitespace-nowrap px-4 py-3 tabular-nums ${stickyFirstTd}`}>{row.date}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {row.requestKind === 'payment' ? 'Payment approval' : 'Unload'}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">{row.customerName}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {row.requestKind === 'payment'
                          ? paymentRequestSummary(row)
                          : `${row.driverName || '—'} · ${bagLines(row, brands) || '—'}`}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div
                          className="flex justify-end gap-2"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => openApprove(row)}
                            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                          >
                            Approve…
                          </button>
                          <button
                            type="button"
                            disabled={rejectingId === row.id}
                            onClick={() => rejectRequest(row)}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {!loading && filtered.length > 0 ? (
            <TablePaginationBar
              page={pagination.page}
              totalPages={pagination.totalPages}
              pageSize={pagination.pageSize}
              totalCount={filtered.length}
              onPageChange={pagination.setPage}
              onPageSizeChange={pagination.setPageSize}
            />
          ) : null}
        </div>
      )}

      {approveRow ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true">
          <ModalBackdrop onClose={closeApprove} />
          <form onSubmit={submitApprove} className={`${modalPanelClass} max-h-[90dvh] w-full max-w-lg overflow-y-auto`}>
            {approveRow.requestKind === 'payment' ? (
              <>
                <h2 className="text-lg font-bold text-slate-900">Approve payment?</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Review the payment evidence below. Approving will credit the customer account.
                </p>

                <dl className="mt-4 grid gap-2 rounded-xl bg-slate-50 p-4 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Shop</dt>
                    <dd className="font-semibold text-slate-900">{approveRow.customerName}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Payment date</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">{approveRow.date}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Receipt #</dt>
                    <dd className="font-mono font-semibold text-slate-900">{approveRow.billNumber || '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Recorded by</dt>
                    <dd className="text-slate-800">{approveRow.recordedBy || '—'}</dd>
                  </div>
                </dl>

                <div className="mt-4 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment breakdown</p>
                  <ul className="space-y-2 rounded-xl bg-emerald-50/80 p-3 ring-1 ring-emerald-100">
                    {paymentApprovalBreakdown(approveRow).map((line, i) => (
                      <li key={`${line.label}-${i}`} className="flex justify-between gap-3 text-sm">
                        <span className="text-slate-600">{line.label}</span>
                        <span className="text-right font-medium tabular-nums text-slate-900">{line.value}</span>
                      </li>
                    ))}
                    <li className="flex justify-between gap-3 border-t border-emerald-200/80 pt-2 text-sm">
                      <span className="font-semibold text-emerald-900">Total</span>
                      <span className="font-bold tabular-nums text-emerald-900">{money(approveRow.amount)}</span>
                    </li>
                  </ul>
                </div>

                {approveRow.cdmNumber ? (
                  <div className="mt-3 rounded-xl bg-sky-50 px-3 py-2.5 text-sm ring-1 ring-sky-100">
                    <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">CDM evidence</p>
                    <p className="mt-1 font-mono text-sky-950">{approveRow.cdmNumber}</p>
                  </div>
                ) : null}
                {approveRow.onlineTransferReference ? (
                  <div className="mt-3 rounded-xl bg-teal-50 px-3 py-2.5 text-sm ring-1 ring-teal-100">
                    <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Transfer reference</p>
                    <p className="mt-1 font-mono text-teal-950">{approveRow.onlineTransferReference}</p>
                  </div>
                ) : null}
                {approveRow.note ? (
                  <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-100">
                    <span className="font-medium text-slate-500">Note: </span>
                    {approveRow.note}
                  </p>
                ) : null}
              </>
            ) : (
              <>
            <h2 className="text-lg font-bold text-slate-900">Approve unload request</h2>
            <p className="mt-1 text-sm text-slate-500">Creates a credit bill with the driver&apos;s date and bag counts.</p>

            <dl className="mt-4 grid gap-2 rounded-xl bg-slate-50 p-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Shop</dt>
                <dd className="font-semibold text-slate-900">{approveRow.customerName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Date</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{approveRow.date}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Driver</dt>
                <dd className="text-slate-800">{approveRow.driverName || '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Bags</dt>
                <dd className="mt-1 text-slate-800">{bagLines(approveRow, brands)}</dd>
              </div>
            </dl>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={fetchLastPrices}
                disabled={loadingLast}
                className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-800 hover:bg-indigo-100 disabled:opacity-60"
              >
                {loadingLast ? 'Loading…' : 'Load last prices for this shop'}
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Unit price (LKR / bag)</p>
              {brands.map((b) => {
                const bags = Number(approveRow[`${b.key}Bags`]) || 0;
                if (bags <= 0) return null;
                return (
                  <label key={b.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-slate-800">
                      {b.label} <span className="text-slate-400">({bags} bags)</span>
                    </span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      required
                      value={priceForm[`${b.key}UnitPrice`] ?? ''}
                      onChange={(e) => setPriceForm((f) => ({ ...f, [`${b.key}UnitPrice`]: e.target.value }))}
                      className="w-32 rounded-lg border border-slate-200 px-2 py-2 text-sm tabular-nums"
                    />
                  </label>
                );
              })}
            </div>
              </>
            )}

            {saveError ? (
              <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100" role="alert">
                {saveError}
              </p>
            ) : null}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeApprove}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {saving
                  ? 'Approving…'
                  : approveRow.requestKind === 'payment'
                    ? 'Approve payment'
                    : 'Approve & create bill'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <LastPricesPopup
        open={lastPopupOpen}
        preview={lastPreview}
        brands={brands}
        onApply={applyLastPrices}
        onClose={() => setLastPopupOpen(false)}
      />

      <RowDetailModal
        open={!!detailRow}
        row={detailRow}
        variant={detailRow?.requestKind === 'payment' ? 'payment' : 'unloadRequest'}
        onClose={() => setDetailRow(null)}
        actions={
          detailRow?.id &&
          (detailRow.requestKind === 'payment' ||
            (detailRow.requestKind !== 'payment' && isPendingRequest(detailRow))) ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => openApprove(detailRow)}
                className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 sm:flex-1"
              >
                Approve…
              </button>
              <button
                type="button"
                disabled={rejectingId === detailRow.id}
                onClick={() => {
                  rejectRequest(detailRow);
                  setDetailRow(null);
                }}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:flex-1"
              >
                {rejectingId === detailRow.id ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          ) : null
        }
      />
    </div>
  );
}
