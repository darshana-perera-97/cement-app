import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { getApiBase } from '../apiBase';
import { authFetch, canAccessCollectorUnloadPrices, getUsername } from '../auth';
import { useBagProducts } from './BagProductsContext';
import { formatBrandLabel } from './brandTheme';
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
  ModalBackdrop,
  modalPanelClass,
  rowMatchesQuery,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
  useTablePagination,
} from './tableToolbar';
import RowDetailModal from './RowDetailModal';

const apiBase = getApiBase();

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function brandName(brand) {
  return formatBrandLabel(brand) || brand.label || brand.key;
}

function totalBags(row, brands) {
  return brands.reduce((s, b) => s + (Number(row[`${b.key}Bags`]) || 0), 0);
}

function bagLines(row, brands) {
  return brands
    .filter((b) => (Number(row[`${b.key}Bags`]) || 0) > 0)
    .map((b) => `${brandName(b)} ${Number(row[`${b.key}Bags`])}`)
    .join(', ');
}

function bagTypes(row, brands) {
  return brands
    .filter((b) => (Number(row[`${b.key}Bags`]) || 0) > 0)
    .map((b) => brandName(b))
    .join(', ');
}

function unloadStatus(row) {
  const s = String(row?.status ?? 'pending').trim().toLowerCase();
  if (s === 'approved' || s === 'rejected') return s;
  return 'pending';
}

function needsPrice(row, brands) {
  return brands.some((b) => {
    const bags = Number(row[`${b.key}Bags`]) || 0;
    if (bags <= 0) return false;
    const unit = Number(row[`${b.key}UnitPrice`]);
    return !Number.isFinite(unit) || unit <= 0;
  });
}

function emptyPriceForm(row, brands) {
  const f = {};
  for (const b of brands) {
    const bags = Number(row[`${b.key}Bags`]) || 0;
    const stored = Number(row[`${b.key}UnitPrice`]);
    f[`${b.key}UnitPrice`] = bags > 0 && Number.isFinite(stored) && stored > 0 ? String(stored) : '';
  }
  return f;
}

function StatusBadge({ status, missingPrice }) {
  if (missingPrice) {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
        Needs price
      </span>
    );
  }
  if (status === 'approved') {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
        Billed
      </span>
    );
  }
  return (
    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
      Unloaded
    </span>
  );
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
                {brandName(b)}: {money(p)} / bag
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

export default function CollectorUnloadsPage() {
  const { brands } = useBagProducts();
  const allowed = canAccessCollectorUnloadPrices();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editRow, setEditRow] = useState(null);
  const [priceForm, setPriceForm] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [lastPreview, setLastPreview] = useState(null);
  const [lastPopupOpen, setLastPopupOpen] = useState(false);
  const [loadingLast, setLoadingLast] = useState(false);
  const [detailRow, setDetailRow] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authFetch(`${apiBase}/api/collector/unloads`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load unloads');
      }
      setRows(Array.isArray(data) ? data : []);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || 'Could not load unloads');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return undefined;
    load();
    return undefined;
  }, [allowed, load]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const status = unloadStatus(r);
      if (statusFilter === 'needs-price' && !needsPrice(r, brands)) return false;
      if (statusFilter === 'pending' && status !== 'pending') return false;
      if (statusFilter === 'approved' && status !== 'approved') return false;
      if (!inDateRange(r.date, dateFrom, dateTo)) return false;
      return rowMatchesQuery(search, [
        r.date,
        r.customerName,
        r.driverName,
        r.recordedBy,
        r.vehicleNumber,
        r.stockId,
        r.invoiceNumber,
        r.note,
        String(totalBags(r, brands)),
        bagLines(r, brands),
        bagTypes(r, brands),
        status,
      ]);
    });
  }, [rows, search, dateFrom, dateTo, statusFilter, brands]);

  const pagination = useTablePagination(filtered.length, [search, dateFrom, dateTo, statusFilter]);
  const paged = useMemo(
    () => filtered.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filtered, pagination.offset, pagination.pageSize],
  );

  const openEdit = (row, event) => {
    event?.stopPropagation?.();
    setDetailRow(null);
    setSaveError(null);
    setEditRow(row);
    setPriceForm(emptyPriceForm(row, brands));
    setLastPreview(null);
    setLastPopupOpen(false);
  };
  const openDetail = openEdit;

  const closeEdit = () => {
    setEditRow(null);
    setPriceForm({});
    setSaveError(null);
    setLastPopupOpen(false);
    setLastPreview(null);
  };

  const fetchLastPrices = async () => {
    if (!editRow?.customerId) return;
    setLoadingLast(true);
    setSaveError(null);
    try {
      const res = await authFetch(
        `${apiBase}/api/bills/last-unit-prices?customerId=${encodeURIComponent(editRow.customerId)}`,
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
      const bags = Number(editRow?.[`${b.key}Bags`]) || 0;
      if (bags <= 0) continue;
      const p = lastPreview[`${b.key}UnitPrice`];
      if (p != null && Number(p) > 0) {
        next[`${b.key}UnitPrice`] = String(p);
      }
    }
    setPriceForm(next);
    setLastPopupOpen(false);
  };

  const submitPrices = async (e) => {
    e.preventDefault();
    if (!editRow?.id) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = { updatedBy: getUsername() };
      for (const b of brands) {
        const bags = Number(editRow[`${b.key}Bags`]) || 0;
        if (bags <= 0) continue;
        payload[`${b.key}UnitPrice`] = priceForm[`${b.key}UnitPrice`];
      }
      const res = await authFetch(`${apiBase}/api/collector/unloads/${encodeURIComponent(editRow.id)}/prices`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || 'Could not save prices');
        return;
      }
      closeEdit();
      await load();
    } catch {
      setSaveError('Could not save prices');
    } finally {
      setSaving(false);
    }
  };

  if (!allowed) {
    return <Navigate to="/dashboard/customers" replace />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Unloads</h1>
        <p className="mt-1 text-sm text-slate-500">
          Bags unloaded from lorries at your shops. Update the selling price for each load.
        </p>
      </div>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      <TableFiltersBar
        hint={loading ? 'Loading…' : `${filtered.length} unload${filtered.length === 1 ? '' : 's'}`}
      >
        <label className={filterLabel}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Shop, lorry, driver…"
            className={filterControl}
          />
        </label>
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
        <label className={filterLabelNarrow}>
          Show
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={filterControl}
          >
            <option value="all">All unloads</option>
            <option value="needs-price">Needs price</option>
            <option value="pending">Pending bill</option>
            <option value="approved">Already billed</option>
          </select>
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
                No unloaded loads from lorries yet.
              </p>
            ) : (
              paged.map((row) => (
                <MobileRowCard
                  key={row.id}
                  title={row.customerName || 'Shop'}
                  subtitle={row.date || '—'}
                  fields={[{ label: 'Bag type', value: bagTypes(row, brands) || '—' }]}
                  actions={
                    <button
                      type="button"
                      onClick={(e) => openEdit(row, e)}
                      className="w-full rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                    >
                      Update price
                    </button>
                  }
                />
              ))
            )}
          </div>

          <div className="hidden overflow-hidden rounded-[20px] bg-white shadow-md shadow-slate-200/30 ring-1 ring-slate-100 sm:block">
            <div className={scrollTableWrap}>
              <table className="w-full min-w-[36rem] border-separate border-spacing-0 text-left text-sm">
                <thead className={stickyThead}>
                  <tr>
                    <th className={`whitespace-nowrap px-3 py-3 ${stickyFirstTh}`}>Date</th>
                    <th className="px-3 py-3">Shop name</th>
                    <th className="px-3 py-3">Bag type</th>
                    <th className="px-3 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">
                        No unloaded loads from lorries yet.
                      </td>
                    </tr>
                  ) : (
                    paged.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/80">
                        <td className={`whitespace-nowrap px-3 py-3 tabular-nums text-slate-700 ${stickyFirstTd}`}>
                          {row.date || '—'}
                        </td>
                        <td className="px-3 py-3 font-semibold text-slate-900">{row.customerName || '—'}</td>
                        <td className="max-w-[18rem] px-3 py-3 text-slate-700">{bagTypes(row, brands) || '—'}</td>
                        <td className="px-3 py-3 text-right">
                          <button
                            type="button"
                            onClick={(e) => openDetail(row, e)}
                            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                          >
                            Update price
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <TablePaginationBar
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            totalCount={filtered.length}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        </div>
      )}

      {editRow ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
          <ModalBackdrop onClose={closeEdit} />
          <form onSubmit={submitPrices} className={`${modalPanelClass} z-10 w-full max-w-lg`}>
            <h2 className="text-lg font-bold text-slate-900">Update unload price</h2>
            <p className="mt-1 text-sm text-slate-500">
              {editRow.stockItemUnloadPriceEnabled
                ? 'Default is the unloading price per bag from the stock load. Keep it to create the invoice now. Change it and admin must accept the request first.'
                : 'Set the unit price for bags unloaded at this shop. Saving creates the invoice for pending loads. Billed loads update the credit bill.'}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs font-medium text-slate-500">Shop</dt>
                <dd className="font-semibold text-slate-900">{editRow.customerName}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-500">Date</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{editRow.date}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-500">Lorry</dt>
                <dd className="font-semibold text-slate-900">{editRow.vehicleNumber || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-500">Driver</dt>
                <dd className="text-slate-800">{editRow.driverName || '—'}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs font-medium text-slate-500">Bags</dt>
                <dd className="mt-1 text-slate-800">{bagLines(editRow, brands)}</dd>
              </div>
            </dl>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={fetchLastPrices}
                disabled={loadingLast || !editRow.customerId}
                className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-800 hover:bg-indigo-100 disabled:opacity-60"
              >
                {loadingLast ? 'Loading…' : 'Load last prices for this shop'}
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Unit price (LKR / bag)</p>
              {brands.map((b) => {
                const bags = Number(editRow[`${b.key}Bags`]) || 0;
                if (bags <= 0) return null;
                const defaultPrice = Number(editRow.stockUnloadPrices?.[`${b.key}UnitPrice`]);
                const current = Number(priceForm[`${b.key}UnitPrice`]);
                const changed =
                  editRow.stockItemUnloadPriceEnabled &&
                  Number.isFinite(defaultPrice) &&
                  defaultPrice > 0 &&
                  Number.isFinite(current) &&
                  Math.round(current * 100) !== Math.round(defaultPrice * 100);
                return (
                  <label key={b.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-slate-800">
                      {brandName(b)} <span className="text-slate-400">({bags} bags)</span>
                      {editRow.stockItemUnloadPriceEnabled && Number.isFinite(defaultPrice) && defaultPrice > 0 ? (
                        <span className="mt-0.5 block text-[11px] font-normal text-slate-500">
                          Default {money(defaultPrice)} / bag
                          {changed ? ' · needs admin approval' : ''}
                        </span>
                      ) : null}
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

            {saveError ? (
              <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100" role="alert">
                {saveError}
              </p>
            ) : null}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeEdit}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save prices'}
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
        variant="unloadRequest"
        onClose={() => setDetailRow(null)}
        actions={
          detailRow?.id ? (
            <div className="mt-4 space-y-3">
              <StatusBadge
                status={unloadStatus(detailRow)}
                missingPrice={needsPrice(detailRow, brands)}
              />
              <button
                type="button"
                onClick={() => openEdit(detailRow)}
                className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Update price
              </button>
            </div>
          ) : null
        }
      />
    </div>
  );
}
