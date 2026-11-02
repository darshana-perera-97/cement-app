import { useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import {
  LoadingSpinner,
  ModalBackdrop,
  TableFiltersBar,
  TablePaginationBar,
  filterControl,
  filterLabel,
  filterLabelNarrow,
  inDateRange,
  mobileCardList,
  MobileRowCard,
  modalPanelClass4xl,
  useTablePagination,
} from './tableToolbar';
import {
  buildLoadDetailRows,
  downloadLoadDetailsExcel,
  downloadLoadDetailsPdf,
  loadDetailBagTotal,
} from './loadDetailsExport';

const apiBase = getApiBase();

const downloadButtonClass =
  'inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-100 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

function display(value) {
  const text = String(value ?? '').trim();
  return text || '—';
}

function locationParts(value) {
  return String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function rowMatchesLocation(row, location) {
  const selected = String(location ?? '').trim();
  if (!selected) return true;
  return locationParts(row.transportLocation).some(
    (part) => part.toLowerCase() === selected.toLowerCase(),
  );
}

function rowMatchesBrand(row, brand) {
  const selected = String(brand ?? '').trim();
  if (!selected) return true;
  return String(row.itemName ?? '').trim().toLowerCase() === selected.toLowerCase();
}

function DoorStepBadge({ value }) {
  const label = value === 'Yes' || value === 'No' || value === 'Mixed' ? value : '—';
  const tone =
    label === 'Yes'
      ? 'bg-indigo-50 text-indigo-800'
      : label === 'Mixed'
        ? 'bg-amber-50 text-amber-800'
        : 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${tone}`}>{label}</span>
  );
}

export default function LoadDetailsModal({ open, loads, brands, onClose }) {
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [transportLocation, setTransportLocation] = useState('');
  const [brand, setBrand] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setDateFrom('');
    setDateTo('');
    setTransportLocation('');
    setBrand('');
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/purchase-orders`);
        if (!res.ok) throw new Error('Failed to load purchase orders');
        const data = await res.json();
        if (!cancelled) setPurchaseOrders(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) {
          setError(e.message || 'Could not load purchase orders');
          setPurchaseOrders([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const allRows = useMemo(
    () => buildLoadDetailRows(loads, purchaseOrders, brands),
    [loads, purchaseOrders, brands],
  );

  const locationOptions = useMemo(() => {
    const seen = new Map();
    for (const row of allRows) {
      for (const part of locationParts(row.transportLocation)) {
        const key = part.toLowerCase();
        if (!seen.has(key)) seen.set(key, part);
      }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [allRows]);

  const brandOptions = useMemo(() => {
    const seen = new Map();
    for (const row of allRows) {
      const name = String(row.itemName ?? '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [allRows]);

  const filteredRows = useMemo(() => {
    if (dateFrom && dateTo && dateFrom > dateTo) return [];
    return allRows.filter(
      (row) =>
        inDateRange(row.date, dateFrom, dateTo) &&
        rowMatchesLocation(row, transportLocation) &&
        rowMatchesBrand(row, brand),
    );
  }, [allRows, dateFrom, dateTo, transportLocation, brand]);

  const pagination = useTablePagination(filteredRows.length, [
    dateFrom,
    dateTo,
    transportLocation,
    brand,
    open,
  ]);
  const pagedRows = useMemo(
    () => filteredRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filteredRows, pagination.offset, pagination.pageSize],
  );
  const totalBags = useMemo(() => loadDetailBagTotal(filteredRows), [filteredRows]);
  const dateOrderInvalid = Boolean(dateFrom && dateTo && dateFrom > dateTo);

  const downloadOptions = { dateFrom, dateTo, transportLocation, brand };
  const filtersActive = Boolean(dateFrom || dateTo || transportLocation || brand);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="load-details-title"
    >
      <ModalBackdrop onClose={onClose} />
      <div className={modalPanelClass4xl}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 id="load-details-title" className="text-lg font-bold text-slate-900">
              Load details
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              One line per item on a load. Item name is the product name, without the product code.
              Download uses the date range, transport location, and brand below.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              className={downloadButtonClass}
              disabled={loading || filteredRows.length === 0}
              onClick={() => downloadLoadDetailsPdf(filteredRows, downloadOptions)}
            >
              Download PDF
            </button>
            <button
              type="button"
              className={downloadButtonClass}
              disabled={loading || filteredRows.length === 0}
              onClick={() => downloadLoadDetailsExcel(filteredRows, downloadOptions)}
            >
              Download Excel
            </button>
          </div>
        </div>

        <div className="mt-4">
          <TableFiltersBar
            hint={
              loading
                ? null
                : `${filteredRows.length} line${filteredRows.length === 1 ? '' : 's'} · ${totalBags.toLocaleString()} bags`
            }
          >
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
            <label className={filterLabel}>
              Transport location
              <select
                value={transportLocation}
                onChange={(e) => setTransportLocation(e.target.value)}
                className={filterControl}
              >
                <option value="">All locations</option>
                {locationOptions.map((location) => (
                  <option key={location} value={location}>
                    {location}
                  </option>
                ))}
              </select>
            </label>
            <label className={filterLabel}>
              Brand
              <select
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className={filterControl}
              >
                <option value="">All brands</option>
                {brandOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            {filtersActive ? (
              <button
                type="button"
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                  setTransportLocation('');
                  setBrand('');
                }}
                className="self-end rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Clear filters
              </button>
            ) : null}
          </TableFiltersBar>
        </div>

        {dateOrderInvalid ? (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-100" role="alert">
            From date is after to date.
          </p>
        ) : null}
        {error ? (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-100" role="alert">
            {error}. Date, lorry, item, bags, and invoice still come from the load. Driver and transport
            location may be blank.
          </p>
        ) : null}

        <div className={`mt-4 ${mobileCardList}`}>
          {loading ? (
            <p className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              <LoadingSpinner />
            </p>
          ) : filteredRows.length === 0 ? (
            <p className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              {allRows.length === 0
                ? 'No load items yet.'
                : 'No load items match these filters.'}
            </p>
          ) : (
            pagedRows.map((row) => (
              <MobileRowCard
                key={row.rowKey}
                title={display(row.itemName)}
                subtitle={`${display(row.date)} · ${display(row.lorryNumber)}`}
                badge={<DoorStepBadge value={row.doorstep} />}
                fields={[
                  { label: 'Driver', value: display(row.driverName) },
                  { label: 'Bags', value: Number(row.bags || 0).toLocaleString() },
                  { label: 'Invoice', value: display(row.invoiceNumber) },
                  { label: 'Transport location', value: display(row.transportLocation) },
                ]}
              />
            ))
          )}
        </div>

        <div className="mt-4 hidden overflow-x-auto rounded-2xl ring-1 ring-slate-100 sm:block">
          <table className="w-full min-w-[980px] border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/90 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="whitespace-nowrap px-3 py-3">Date</th>
                <th className="whitespace-nowrap px-3 py-3">Lorry number</th>
                <th className="whitespace-nowrap px-3 py-3">Driver name</th>
                <th className="whitespace-nowrap px-3 py-3">Item name</th>
                <th className="whitespace-nowrap px-3 py-3 text-right">Bags</th>
                <th className="whitespace-nowrap px-3 py-3">Invoice number</th>
                <th className="whitespace-nowrap px-3 py-3">Transport location</th>
                <th className="whitespace-nowrap px-3 py-3">Door step</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    {allRows.length === 0
                      ? 'No load items yet.'
                      : 'No load items match these filters.'}
                  </td>
                </tr>
              ) : (
                pagedRows.map((row) => (
                  <tr key={row.rowKey} className="bg-white">
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-700">{display(row.date)}</td>
                    <td className="whitespace-nowrap px-3 py-3">{display(row.lorryNumber)}</td>
                    <td className="px-3 py-3">{display(row.driverName)}</td>
                    <td className="px-3 py-3 font-medium text-slate-900">{display(row.itemName)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      {Number(row.bags || 0).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">{display(row.invoiceNumber)}</td>
                    <td className="px-3 py-3">{display(row.transportLocation)}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <DoorStepBadge value={row.doorstep} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {!loading && filteredRows.length > 0 ? (
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50 text-sm font-semibold text-slate-900">
                  <td className="px-3 py-3" colSpan={4}>
                    Total
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                    {totalBags.toLocaleString()}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>

        {!loading && filteredRows.length > 0 ? (
          <TablePaginationBar
            className="mt-3"
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            totalCount={filteredRows.length}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        ) : null}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
