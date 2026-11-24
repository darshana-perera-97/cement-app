import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getApiBase } from '../apiBase';
import { authFetch, isCollector } from '../auth';
import { formatReportItemLabel } from './brandTheme';
import { useBagProducts } from './BagProductsContext';
import { buildPendingBillRows, buildReturnChequeRows } from './pendingBills';
import { downloadReturnChequesPdf, returnChequeDocumentBlobUrl } from './returnChequesPdf';
import RowDetailModal, { detailRowAttrs } from './RowDetailModal';
import {
  LoadingSpinner,
  MobileRowCard,
  ModalBackdrop,
  mobileCardList,
  modalPanelClass4xl,
  modalPanelClassMd,
  TableFiltersBar,
  TablePaginationBar,
  filterControl,
  filterLabel,
  filterLabelNarrow,
  inDateRange,
  rowMatchesQuery,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
  useTablePagination,
} from './tableToolbar';

const apiRoot = getApiBase() || '';

const PAGE_TABS = [
  { id: 'pending-bills', label: 'Pending bills' },
  { id: 'return-cheques', label: 'Return Cheques' },
];

function localYmd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysFromYmdToToday(fromYmd, toYmd = localYmd()) {
  if (!fromYmd || !toYmd || fromYmd.length < 10 || toYmd.length < 10) return 0;
  const t0 = new Date(
    parseInt(fromYmd.slice(0, 4), 10),
    parseInt(fromYmd.slice(5, 7), 10) - 1,
    parseInt(fromYmd.slice(8, 10), 10),
  ).getTime();
  const t1 = new Date(
    parseInt(toYmd.slice(0, 4), 10),
    parseInt(toYmd.slice(5, 7), 10) - 1,
    parseInt(toYmd.slice(8, 10), 10),
  ).getTime();
  return Math.max(0, Math.round((t1 - t0) / (24 * 60 * 60 * 1000)));
}

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function SortGlyph({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 5v14M8 5l-3 3M8 5l3 3M16 19V5M16 19l-3-3M16 19l3-3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function returnDateSortLabel(dir) {
  return dir === 'desc' ? 'Newest first' : 'Oldest first';
}

function ReturnDateSortPopup({ dateSort, onDateSortChange }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const activeDir = returnDateSortLabel(dateSort);
  const nonDefault = dateSort !== 'asc';

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const popup =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="fixed inset-0 z-[120] flex items-end justify-center p-0 sm:items-center sm:p-4"
            role="presentation"
          >
            <ModalBackdrop onClose={() => setOpen(false)} />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className={`${modalPanelClassMd} w-full max-w-sm pb-[max(1.25rem,env(safe-area-inset-bottom))]`}
            >
              <div
                className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-slate-300/90 sm:hidden"
                aria-hidden
              />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id={titleId} className="text-lg font-bold text-slate-900">
                    Sort return cheques
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">Return date · {activeDir}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                  aria-label="Close sort"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M6 6l12 12M18 6L6 18"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>

              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Order</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {[
                    { id: 'asc', label: 'Oldest first' },
                    { id: 'desc', label: 'Newest first' },
                  ].map((option) => {
                    const active = dateSort === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => onDateSortChange(option.id)}
                        className={`rounded-xl px-3.5 py-3 text-sm font-semibold transition ${
                          active
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-50 text-slate-700 ring-1 ring-slate-200 hover:bg-white'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="mt-5 w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition hover:bg-indigo-700"
              >
                Done
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition sm:self-end ${
          nonDefault
            ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100'
            : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
        }`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Sort by return date, ${activeDir}`}
        title={`Sort: Return date · ${activeDir}`}
      >
        <SortGlyph />
      </button>
      {popup}
    </>
  );
}

function brandLineFromBill(bill, brandKey) {
  if (!brandKey) return Number(bill.totalAmount) || 0;
  const line = Number(bill[`${brandKey}Line`]);
  if (line > 0) return line;
  const bags = Number(bill[`${brandKey}Bags`]) || 0;
  const price = Number(bill[`${brandKey}UnitPrice`]) || 0;
  return Math.round(bags * price * 100) / 100;
}

/**
 * Same line shape as Reports “Bills by month”, limited to bills still outstanding
 * after payments, promotions, and item-return credits.
 */
function buildPendingMonthlyBillRows(bills, outstandingByBillId, brands) {
  const rows = [];
  for (const bill of Array.isArray(bills) ? bills : []) {
    const id = String(bill.id ?? '').trim();
    if (!id || !outstandingByBillId.has(id)) continue;
    const outstanding = Number(outstandingByBillId.get(id)) || 0;
    if (outstanding <= 0.009) continue;

    const date = String(bill.date ?? '').slice(0, 10);
    const shop = String(bill.customerName ?? '').trim() || '—';
    const originalTotal = Number(bill.totalAmount) || 0;
    const scale =
      originalTotal > 0.009 ? Math.min(1, Math.max(0, outstanding / originalTotal)) : 1;
    const spendDays = daysFromYmdToToday(date);

    let anyBrand = false;
    for (const brand of brands) {
      const bagCount = Number(bill[brand.bagsField]) || 0;
      if (bagCount <= 0) continue;
      anyBrand = true;
      rows.push({
        rowKey: `${bill.id || date}-${brand.key}`,
        date,
        shop,
        bagType: formatReportItemLabel(brand) || brand.label,
        brandKey: brand.key,
        bagCount,
        amount: Math.round(brandLineFromBill(bill, brand.key) * scale * 100) / 100,
        settledDate: '',
        daysToSettle: null,
        spendDays,
      });
    }

    if (!anyBrand) {
      rows.push({
        rowKey: `${bill.id || date}-total`,
        date,
        shop,
        bagType: '—',
        brandKey: '',
        bagCount: 0,
        amount: Math.round(outstanding * 100) / 100,
        settledDate: '',
        daysToSettle: null,
        spendDays,
      });
    }
  }

  rows.sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    const byShop = a.shop.localeCompare(b.shop);
    if (byShop !== 0) return byShop;
    return a.bagType.localeCompare(b.bagType);
  });
  return rows;
}

function PendingBillsTab({
  loading,
  error,
  pendingRows,
  brands,
  collectorView,
}) {
  const [shopFilter, setShopFilter] = useState('');
  const [search, setSearch] = useState('');

  const shopOptions = useMemo(() => {
    const shops = new Set();
    for (const row of pendingRows) {
      const shop = String(row.shop ?? '').trim();
      if (shop && shop !== '—') shops.add(shop);
    }
    if (shopFilter && shopFilter !== '—') shops.add(shopFilter);
    return [...shops].sort((a, b) => a.localeCompare(b));
  }, [pendingRows, shopFilter]);

  const filteredRows = useMemo(() => {
    const shop = shopFilter.trim();
    return pendingRows.filter((r) => {
      if (shop && r.shop !== shop) return false;
      return rowMatchesQuery(search, [
        r.date,
        r.shop,
        r.bagType,
        r.bagCount,
        r.bagCount.toLocaleString(),
        r.amount,
        money(r.amount),
        r.spendDays,
      ]);
    });
  }, [pendingRows, shopFilter, search]);

  const totals = useMemo(
    () =>
      filteredRows.reduce(
        (acc, r) => ({
          bagCount: acc.bagCount + r.bagCount,
          amount: acc.amount + r.amount,
        }),
        { bagCount: 0, amount: 0 },
      ),
    [filteredRows],
  );

  const pagination = useTablePagination(filteredRows.length, [shopFilter, search]);
  const pagedRows = useMemo(
    () => filteredRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filteredRows, pagination.offset, pagination.pageSize],
  );

  const emptyMessage =
    shopFilter || search.trim()
      ? 'No pending bills match your shop or search.'
      : 'No pending bills.';

  return (
    <div className="rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-6">
      <h2 className="text-sm font-bold text-slate-900">Pending bills</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        {collectorView
          ? 'Unsettled credit bills for your assigned shops, after payments and item-return credits. Same columns as Bills by month.'
          : 'Open credit bills after payments and item-return credits, oldest first. Spend days count from the bill date.'}
      </p>

      <div className="mt-4">
        <TableFiltersBar
          hint={
            !loading && pendingRows.length > 0
              ? `Showing ${filteredRows.length} of ${pendingRows.length} line${
                  pendingRows.length === 1 ? '' : 's'
                }`
              : null
          }
        >
          <label className={filterLabel}>
            Shop
            <select
              value={shopFilter}
              onChange={(e) => setShopFilter(e.target.value)}
              className={filterControl}
            >
              <option value="">All shops</option>
              {shopOptions.map((shop) => (
                <option key={shop} value={shop}>
                  {shop}
                </option>
              ))}
            </select>
          </label>
          <label className={filterLabel}>
            Search
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Shop, bag type, date, amount…"
              className={filterControl}
            />
          </label>
        </TableFiltersBar>

        {error ? (
          <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
            {error}
          </p>
        ) : null}

        <div className={`mt-5 ${mobileCardList}`}>
          {loading ? (
            <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
              <LoadingSpinner />
            </p>
          ) : filteredRows.length === 0 ? (
            <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
              {emptyMessage}
            </p>
          ) : (
            <>
              {pagedRows.map((r) => (
                <MobileRowCard
                  key={r.rowKey}
                  title={r.shop}
                  subtitle={r.date}
                  badge={r.bagType !== '—' ? r.bagType : null}
                  fields={[
                    { label: 'Bags', value: r.bagCount.toLocaleString() },
                    { label: 'Amount', value: money(r.amount) },
                    { label: 'Spend days', value: r.spendDays != null ? r.spendDays : '—' },
                    { label: 'Settled', value: r.settledDate || '—' },
                    { label: 'Days', value: r.daysToSettle != null ? r.daysToSettle : '—' },
                  ]}
                />
              ))}
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-indigo-50 px-4 py-3 text-sm font-semibold text-slate-900 ring-1 ring-indigo-100">
                <span>
                  Total ({filteredRows.length} line
                  {filteredRows.length === 1 ? '' : 's'})
                </span>
                <span className="tabular-nums text-indigo-900">
                  {totals.bagCount.toLocaleString()} bags · {money(totals.amount)}
                </span>
              </div>
            </>
          )}
        </div>

        <div className={`mt-5 hidden sm:block ${scrollTableWrap}`}>
          <table className="w-full min-w-[900px] data-table border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
                <th className="whitespace-nowrap px-4 py-3">Shop name</th>
                <th className="whitespace-nowrap px-4 py-3">Bag type</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Bag count</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Spend days</th>
                <th className="whitespace-nowrap px-4 py-3">Bill settled date</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Days to settle</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                pagedRows.map((r) => {
                  const brand = brands.find((b) => b.key === r.brandKey);
                  return (
                    <tr key={r.rowKey} className="border-t border-slate-100 hover:bg-slate-50/80">
                      <td className={`whitespace-nowrap px-4 py-3 tabular-nums text-slate-600 ${stickyFirstTd}`}>
                        {r.date}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">{r.shop}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {r.bagType !== '—' ? (
                          <span
                            className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${
                              brand?.iconBg || 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {r.bagType}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-800">
                        {r.bagCount.toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                        {money(r.amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">
                        {r.spendDays != null ? r.spendDays : '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">
                        {r.settledDate || '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">
                        {r.daysToSettle != null ? r.daysToSettle : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {!loading && filteredRows.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-indigo-50/60 font-semibold text-slate-900">
                  <td className="px-4 py-3" colSpan={3}>
                    Total ({filteredRows.length} line{filteredRows.length === 1 ? '' : 's'})
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {totals.bagCount.toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-indigo-900">
                    {money(totals.amount)}
                  </td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3" colSpan={2} />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        {!loading && filteredRows.length > 0 ? (
          <TablePaginationBar
            className="mt-4"
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            totalCount={filteredRows.length}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        ) : null}
      </div>
    </div>
  );
}

function ReturnChequesTab({ loading, error, returnChequeRows, collectorView }) {
  const [shopFilter, setShopFilter] = useState('');
  const [settlementFilter, setSettlementFilter] = useState('unsettled');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [dateSort, setDateSort] = useState('asc');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [docBusyKey, setDocBusyKey] = useState('');
  const [detailRow, setDetailRow] = useState(null);
  const [docPreviewUrl, setDocPreviewUrl] = useState(null);
  const [docPreviewFilename, setDocPreviewFilename] = useState('');
  const docPreviewUrlRef = useRef(null);

  const closeDocPreview = useCallback(() => {
    if (docPreviewUrlRef.current) {
      URL.revokeObjectURL(docPreviewUrlRef.current);
      docPreviewUrlRef.current = null;
    }
    setDocPreviewUrl(null);
    setDocPreviewFilename('');
  }, []);

  useEffect(() => {
    return () => {
      if (docPreviewUrlRef.current) {
        URL.revokeObjectURL(docPreviewUrlRef.current);
        docPreviewUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!docPreviewUrl) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeDocPreview();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [docPreviewUrl, closeDocPreview]);

  const shopOptions = useMemo(() => {
    const shops = new Set();
    for (const row of returnChequeRows) {
      const shop = String(row.customerName ?? '').trim();
      if (shop && shop !== '—') shops.add(shop);
    }
    if (shopFilter && shopFilter !== '—') shops.add(shopFilter);
    return [...shops].sort((a, b) => a.localeCompare(b));
  }, [returnChequeRows, shopFilter]);

  const filteredRows = useMemo(() => {
    const shop = shopFilter.trim();
    return returnChequeRows.filter((r) => {
      if (shop && r.customerName !== shop) return false;
      if (settlementFilter === 'settled' && !r.settled) return false;
      if (settlementFilter === 'unsettled' && r.settled) return false;
      if (!inDateRange(r.returnDate, dateFrom, dateTo)) return false;
      return rowMatchesQuery(search, [
        r.returnDate,
        r.customerName,
        r.chequeNumber,
        r.chequeBank,
        r.chequeDate,
        r.receiptNumber,
        r.amount,
        money(r.amount),
        r.outstandingAmount,
        money(r.outstandingAmount),
        r.settledDate,
        r.settled ? 'settled' : 'not settled',
      ]);
    });
  }, [returnChequeRows, shopFilter, settlementFilter, dateFrom, dateTo, search]);

  const sortedRows = useMemo(() => {
    const dir = dateSort === 'desc' ? -1 : 1;
    return [...filteredRows].sort((a, b) => {
      const byDate = String(a.returnDate ?? '').localeCompare(String(b.returnDate ?? ''));
      if (byDate !== 0) return byDate * dir;
      const byShop = String(a.customerName ?? '').localeCompare(String(b.customerName ?? ''));
      if (byShop !== 0) return byShop;
      return String(a.chequeNumber ?? '').localeCompare(String(b.chequeNumber ?? ''));
    });
  }, [filteredRows, dateSort]);

  const totals = useMemo(
    () =>
      filteredRows.reduce(
        (acc, r) => ({
          amount: acc.amount + (Number(r.amount) || 0),
          paid: acc.paid + (Number(r.paidAmount) || 0),
          outstanding: acc.outstanding + (Number(r.outstandingAmount) || 0),
        }),
        { amount: 0, paid: 0, outstanding: 0 },
      ),
    [filteredRows],
  );

  const pagination = useTablePagination(filteredRows.length, [
    shopFilter,
    settlementFilter,
    dateFrom,
    dateTo,
    search,
    dateSort,
  ]);
  const pagedRows = useMemo(
    () => sortedRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [sortedRows, pagination.offset, pagination.pageSize],
  );

  const emptyMessage =
    shopFilter || search.trim() || settlementFilter !== 'all' || dateFrom || dateTo
      ? 'No return cheques match your filters.'
      : 'No return cheques.';

  const handleDownloadPdf = () => {
    setPdfBusy(true);
    try {
      downloadReturnChequesPdf({
        rows: sortedRows,
        filters: {
          shop: shopFilter,
          settlement: settlementFilter,
          dateFrom,
          dateTo,
          dateSort,
          search,
        },
      });
    } catch {
      alert('Could not build the return cheques PDF.');
    } finally {
      setPdfBusy(false);
    }
  };

  const handleViewDocument = async (row) => {
    const key = String(row?.rowKey ?? '');
    setDocBusyKey(key);
    try {
      const preview = await returnChequeDocumentBlobUrl(row);
      if (!preview) return;
      if (docPreviewUrlRef.current) {
        URL.revokeObjectURL(docPreviewUrlRef.current);
      }
      docPreviewUrlRef.current = preview.url;
      setDocPreviewUrl(preview.url);
      setDocPreviewFilename(preview.filename);
    } catch {
      alert('Could not build the cheque return document.');
    } finally {
      setDocBusyKey('');
    }
  };

  const documentButton = (row, className, label = 'View document') => (
    <button
      type="button"
      onClick={() => handleViewDocument(row)}
      disabled={docBusyKey === String(row.rowKey)}
      className={className}
    >
      {docBusyKey === String(row.rowKey) ? 'Preparing…' : label}
    </button>
  );

  return (
    <div className="rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-6">
      <h2 className="text-sm font-bold text-slate-900">Return Cheques</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        {collectorView
          ? 'Returned customer cheques for your assigned shops. Sort by return date, download a document for each cheque, or download the list as PDF.'
          : 'Returned customer cheques with settlement progress. Sort by return date, download a document for each cheque, or download the list as PDF.'}
      </p>

      <div className="mt-4">
        <TableFiltersBar
          hint={
            !loading && returnChequeRows.length > 0
              ? `Showing ${filteredRows.length} of ${returnChequeRows.length} cheque${
                  returnChequeRows.length === 1 ? '' : 's'
                }`
              : null
          }
        >
          <label className={filterLabel}>
            Shop
            <select
              value={shopFilter}
              onChange={(e) => setShopFilter(e.target.value)}
              className={filterControl}
            >
              <option value="">All shops</option>
              {shopOptions.map((shop) => (
                <option key={shop} value={shop}>
                  {shop}
                </option>
              ))}
            </select>
          </label>
          <label className={filterLabel}>
            Settlement
            <select
              value={settlementFilter}
              onChange={(e) => setSettlementFilter(e.target.value)}
              className={filterControl}
            >
              <option value="unsettled">Not settled</option>
              <option value="settled">Settled</option>
              <option value="all">All</option>
            </select>
          </label>
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
            Search
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Shop, cheque #, bank, receipt…"
              className={filterControl}
            />
          </label>
          <ReturnDateSortPopup dateSort={dateSort} onDateSortChange={setDateSort} />
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={loading || !!error || pdfBusy || filteredRows.length === 0}
            className="inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:self-end"
          >
            {pdfBusy ? 'Preparing…' : 'Download PDF'}
          </button>
        </TableFiltersBar>

        {error ? (
          <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
            {error}
          </p>
        ) : null}

        <div className={`mt-5 ${mobileCardList}`}>
          {loading ? (
            <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
              <LoadingSpinner />
            </p>
          ) : filteredRows.length === 0 ? (
            <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
              {emptyMessage}
            </p>
          ) : (
            <>
              {pagedRows.map((r) => (
                <MobileRowCard
                  key={r.rowKey}
                  title={r.customerName}
                  subtitle={r.returnDate || '—'}
                  badge={r.settled ? 'Settled' : 'Not settled'}
                  onClick={() => setDetailRow(r)}
                  fields={[
                    { label: 'Cheque #', value: r.chequeNumber ? `#${r.chequeNumber}` : '—' },
                    { label: 'Bank', value: r.chequeBank || '—' },
                    { label: 'Cheque date', value: r.chequeDate || '—' },
                    { label: 'Receipt', value: r.receiptNumber || '—' },
                    { label: 'Amount', value: money(r.amount) },
                    { label: 'Outstanding', value: money(r.outstandingAmount) },
                    { label: 'Settled date', value: r.settledDate || '—' },
                    { label: 'Days', value: r.daysFromReturn != null ? r.daysFromReturn : '—' },
                  ]}
                  actions={documentButton(
                    r,
                    'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 ring-1 ring-slate-100 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60',
                  )}
                />
              ))}
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-slate-900 ring-1 ring-rose-100">
                <span>
                  Total ({filteredRows.length} cheque
                  {filteredRows.length === 1 ? '' : 's'})
                </span>
                <span className="tabular-nums text-rose-900">
                  {money(totals.outstanding)} outstanding · {money(totals.amount)} face
                </span>
              </div>
            </>
          )}
        </div>

        <div className={`mt-5 hidden sm:block ${scrollTableWrap}`}>
          <table className="w-full min-w-[1100px] data-table border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th
                  className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}
                  aria-sort={dateSort === 'asc' ? 'ascending' : 'descending'}
                >
                  <span className="inline-flex items-center gap-1">
                    Return date
                    <span aria-hidden="true">{dateSort === 'asc' ? '↑' : '↓'}</span>
                  </span>
                </th>
                <th className="whitespace-nowrap px-4 py-3">Shop</th>
                <th className="whitespace-nowrap px-4 py-3">Cheque #</th>
                <th className="whitespace-nowrap px-4 py-3">Bank</th>
                <th className="whitespace-nowrap px-4 py-3">Cheque date</th>
                <th className="whitespace-nowrap px-4 py-3">Receipt</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Paid</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Outstanding</th>
                <th className="whitespace-nowrap px-4 py-3">Status</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Days</th>
                <th className="whitespace-nowrap px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-slate-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-slate-500">
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                pagedRows.map((r) => (
                  <tr
                    key={r.rowKey}
                    {...detailRowAttrs(
                      () => setDetailRow(r),
                      'border-t border-slate-100 hover:bg-slate-50/80',
                    )}
                    aria-label={`Return cheque ${r.customerName || ''}`}
                  >
                    <td className={`whitespace-nowrap px-4 py-3 tabular-nums text-slate-600 ${stickyFirstTd}`}>
                      {r.returnDate || '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">
                      {r.customerName}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-slate-800">
                      {r.chequeNumber ? `#${r.chequeNumber}` : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{r.chequeBank || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">
                      {r.chequeDate || '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {r.receiptNumber || '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                      {money(r.amount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700">
                      {money(r.paidAmount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-rose-900">
                      {money(r.outstandingAmount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {r.settled ? (
                        <span className="inline-flex rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-900 ring-1 ring-emerald-100">
                          Settled{r.settledDate ? ` · ${r.settledDate}` : ''}
                        </span>
                      ) : (
                        <span className="inline-flex rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-900 ring-1 ring-rose-100">
                          Not settled
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">
                      {r.daysFromReturn != null ? r.daysFromReturn : '—'}
                    </td>
                    <td
                      className="whitespace-nowrap px-4 py-3"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      {documentButton(
                        r,
                        'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 ring-1 ring-slate-100 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60',
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {!loading && filteredRows.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-rose-50/60 font-semibold text-slate-900">
                  <td className="px-4 py-3" colSpan={6}>
                    Total ({filteredRows.length} cheque{filteredRows.length === 1 ? '' : 's'})
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {money(totals.amount)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {money(totals.paid)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-rose-900">
                    {money(totals.outstanding)}
                  </td>
                  <td className="px-4 py-3" colSpan={3} />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        {!loading && filteredRows.length > 0 ? (
          <TablePaginationBar
            className="mt-4"
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            totalCount={filteredRows.length}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        ) : null}
      </div>

      <RowDetailModal
        open={!!detailRow}
        row={detailRow}
        variant="returnCheque"
        onClose={() => setDetailRow(null)}
        actions={
          detailRow ? (
            <div className="mt-4">
              {documentButton(
                detailRow,
                'inline-flex w-full items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-800 ring-1 ring-indigo-100 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60',
                'View document',
              )}
            </div>
          ) : null
        }
      />

      {docPreviewUrl
        ? createPortal(
            <div
              className="fixed inset-0 z-[110] flex items-end justify-center p-0 sm:items-center sm:p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="return-cheque-doc-preview-title"
            >
              <button
                type="button"
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                aria-label="Close"
                onClick={closeDocPreview}
              />
              <div
                className={`${modalPanelClass4xl} flex max-h-[min(96dvh,calc(100dvh-env(safe-area-inset-bottom,0px)))] w-full max-w-none flex-col overflow-hidden !p-0 sm:max-w-[48rem]`}
              >
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
                  <h2
                    id="return-cheque-doc-preview-title"
                    className="text-sm font-semibold text-slate-900 sm:text-base"
                  >
                    Cheque Return Notice (A4)
                  </h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={docPreviewUrl}
                      download={docPreviewFilename || 'cheque-return.pdf'}
                      className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 ring-1 ring-indigo-100 hover:bg-indigo-100"
                    >
                      Download
                    </a>
                    <button
                      type="button"
                      onClick={closeDocPreview}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Close
                    </button>
                  </div>
                </div>
                <iframe
                  title="Cheque return document preview"
                  src={docPreviewUrl}
                  className="min-h-[70vh] w-full flex-1 border-0 bg-slate-100"
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export default function PendingBillsPage() {
  const { brands } = useBagProducts();
  const collectorView = isCollector();
  const [activeTab, setActiveTab] = useState('pending-bills');
  const [bills, setBills] = useState([]);
  const [payments, setPayments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [returnsRows, setReturnsRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [billsRes, paymentsRes, customersRes, promoRes, returnsRes] = await Promise.all([
        authFetch(`${apiRoot}/api/bills`),
        authFetch(`${apiRoot}/api/payments`),
        authFetch(`${apiRoot}/api/customers`),
        authFetch(`${apiRoot}/api/promotions`),
        authFetch(`${apiRoot}/api/returns`),
      ]);
      if (!billsRes.ok) throw new Error('Failed to load bills');
      if (!paymentsRes.ok) throw new Error('Failed to load payments');
      if (!customersRes.ok) throw new Error('Failed to load customers');
      const [billsData, paymentsData, customersData, promoData, returnsData] = await Promise.all([
        billsRes.json(),
        paymentsRes.json(),
        customersRes.json(),
        promoRes.ok ? promoRes.json() : Promise.resolve([]),
        returnsRes.ok ? returnsRes.json() : Promise.resolve([]),
      ]);
      setBills(Array.isArray(billsData) ? billsData : []);
      setPayments(Array.isArray(paymentsData) ? paymentsData : []);
      setCustomers(Array.isArray(customersData) ? customersData : []);
      setPromotions(Array.isArray(promoData) ? promoData : []);
      setReturnsRows(Array.isArray(returnsData) ? returnsData : []);
    } catch (e) {
      setError(e.message || 'Could not load data');
      setBills([]);
      setPayments([]);
      setCustomers([]);
      setPromotions([]);
      setReturnsRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const outstandingByBillId = useMemo(() => {
    const map = new Map();
    const rows = buildPendingBillRows(customers, bills, payments, {
      promotions,
      returnsRows,
    });
    for (const row of rows) {
      const id = String(row.id ?? '').trim();
      if (!id || row.isOpeningBalance || row.isReturnCheque) continue;
      map.set(id, Number(row.outstandingAmount) || 0);
    }
    return map;
  }, [customers, bills, payments, promotions, returnsRows]);

  const pendingRows = useMemo(
    () => buildPendingMonthlyBillRows(bills, outstandingByBillId, brands),
    [bills, outstandingByBillId, brands],
  );

  const returnChequeRows = useMemo(
    () => buildReturnChequeRows(customers, bills, payments),
    [customers, bills, payments],
  );

  const returnChequeCounts = useMemo(() => {
    let unsettled = 0;
    let settled = 0;
    for (const row of returnChequeRows) {
      if (row.settled) settled += 1;
      else unsettled += 1;
    }
    return { unsettled, settled, all: returnChequeRows.length };
  }, [returnChequeRows]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Unsettled credit bills and returned customer cheques. Switch tabs to manage pending bills or
        return cheques.
      </p>

      <div
        className="flex flex-wrap gap-1.5 rounded-xl bg-slate-100/90 p-1 ring-1 ring-slate-200/60"
        role="tablist"
        aria-label="Pending Bills & RC"
      >
        {PAGE_TABS.map((tab) => {
          const active = activeTab === tab.id;
          const count =
            tab.id === 'pending-bills'
              ? pendingRows.length
              : returnChequeCounts.unsettled;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
                active
                  ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                  : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'
              }`}
            >
              {tab.label}
              <span
                className={`rounded-md px-1.5 py-0.5 text-xs tabular-nums ${
                  active ? 'bg-slate-100 text-slate-700' : 'bg-slate-200/70 text-slate-600'
                }`}
              >
                {loading ? '…' : count}
              </span>
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {activeTab === 'pending-bills' ? (
          <PendingBillsTab
            loading={loading}
            error={error}
            pendingRows={pendingRows}
            brands={brands}
            collectorView={collectorView}
          />
        ) : (
          <ReturnChequesTab
            loading={loading}
            error={error}
            returnChequeRows={returnChequeRows}
            collectorView={collectorView}
          />
        )}
      </div>
    </div>
  );
}
