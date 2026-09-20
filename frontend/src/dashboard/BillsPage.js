import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiBase } from '../apiBase';
import { authFetch, canEditDetails, getUsername } from '../auth';
import { usePrinter } from '../printer/PrinterProvider';
import { DEFAULT_SHOP_NAME } from '../shopConfig';
import { useBagProducts } from './BagProductsContext';
import { formatBrandLabel } from './brandTheme';
import { billsInvoicesPdfBlobUrl, downloadBillsInvoicesPdf } from './billsInvoicesPdf';
import {
  BILL_INVOICE_NUMBER_PATTERN,
  isBillInvoiceNumberTaken,
  normalizeBillInvoiceNumber,
  suggestNextBillInvoiceNumber,
} from './billInvoiceNumber';
import {
  LoadingSpinner,
  MobileRowCard,
  TableFiltersBar,
  TablePaginationBar,
  filterControl,
  filterLabel,
  filterLabelNarrow,
  inDateRange,
  mobileCardList,
  rowMatchesQuery,
  scrollTableWrap,
  stickyDateColWidth,
  stickyFirstOfPairTd,
  stickyFirstOfPairTh,
  stickySecondTd,
  stickySecondTh,
  stickyTheadTransparent,
  useTablePagination,
  modalPanelClass3xl,
  modalPanelClass4xl,
} from './tableToolbar';
import RowDetailModal, { detailRowAttrs } from './RowDetailModal';

const apiBase = getApiBase();

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function emptyForm(brands) {
  const f = {
    date: new Date().toISOString().slice(0, 10),
    customerId: '',
    invoiceNumber: '',
    note: '',
  };
  for (const b of brands) {
    f[`${b.key}Bags`] = '';
    f[`${b.key}UnitPrice`] = '';
  }
  return f;
}

function formFromBill(bill, customers, brands) {
  const name = String(bill.customerName ?? '').trim();
  const match = customers.find((c) => String(c.name ?? '').trim() === name);
  const f = {
    date: String(bill.date ?? '').trim() || new Date().toISOString().slice(0, 10),
    customerId: match?.id ?? '',
    invoiceNumber: String(bill.invoiceNumber ?? '').trim(),
    note: String(bill.note ?? '').trim(),
  };
  for (const b of brands) {
    const bags = bill[`${b.key}Bags`];
    const price = bill[`${b.key}UnitPrice`];
    f[`${b.key}Bags`] = bags != null && bags !== '' ? String(bags) : '';
    f[`${b.key}UnitPrice`] = price != null && price !== '' ? String(price) : '';
  }
  return f;
}

function normalizeCustomerNameKey(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function formatUnitPrice(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

/** Newest non-zero unit price per brand, keyed by customer id. */
function lastUnitPricesByCustomerId(bills, customers, brands) {
  const nameToId = new Map();
  for (const c of customers) {
    const nk = normalizeCustomerNameKey(c.name);
    const id = String(c.id ?? '').trim();
    if (nk && id && !nameToId.has(nk)) nameToId.set(nk, id);
  }
  const sorted = [...(Array.isArray(bills) ? bills : [])].sort((a, b) => {
    const da = String(a.date || '');
    const db = String(b.date || '');
    if (da !== db) return db.localeCompare(da);
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });
  const out = new Map();
  for (const bill of sorted) {
    const id = nameToId.get(normalizeCustomerNameKey(bill.customerName));
    if (!id) continue;
    if (!out.has(id)) out.set(id, {});
    const prices = out.get(id);
    for (const b of brands) {
      if (prices[b.key] != null) continue;
      const p = Number(bill[`${b.key}UnitPrice`]);
      if (Number.isFinite(p) && p > 0) prices[b.key] = p;
    }
  }
  return out;
}

function fillLastPricesOnForm(form, brands, lastPrices, brandKey = null) {
  if (!lastPrices || typeof lastPrices !== 'object') return form;
  const keys = brandKey ? [brandKey] : brands.map((b) => b.key);
  let next = form;
  for (const key of keys) {
    const bags = Number(form[`${key}Bags`]);
    if (!Number.isFinite(bags) || bags < 1) continue;
    if (String(form[`${key}UnitPrice`] ?? '').trim()) continue;
    const filled = formatUnitPrice(lastPrices[key]);
    if (!filled) continue;
    if (next === form) next = { ...form };
    next[`${key}UnitPrice`] = filled;
  }
  return next;
}

function applyAllLastPrices(form, brands, lastPrices) {
  if (!lastPrices || typeof lastPrices !== 'object') return form;
  let next = form;
  for (const b of brands) {
    const filled = formatUnitPrice(lastPrices[b.key]);
    if (!filled) continue;
    if (next === form) next = { ...form };
    next[`${b.key}UnitPrice`] = filled;
  }
  return next;
}

const LAST_UNLOADED_ITEM_COUNT = 5;

function sortRecordsNewestFirst(records) {
  return [...(Array.isArray(records) ? records : [])].sort((a, b) => {
    const da = String(a.date || '');
    const db = String(b.date || '');
    if (da !== db) return db.localeCompare(da);
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });
}

function brandKeysWithBags(row, brands) {
  const keys = [];
  for (const b of brands) {
    const n = Number(row?.[`${b.key}Bags`]);
    if (Number.isFinite(n) && n > 0) keys.push(b.key);
  }
  return keys;
}

function rowMatchesCustomer(row, customer) {
  if (!row || !customer) return false;
  const id = String(customer.id || '').trim();
  if (id && String(row.customerId || '').trim() === id) return true;
  const nameKey = normalizeCustomerNameKey(customer.name);
  if (!nameKey) return false;
  return (
    normalizeCustomerNameKey(row.customerName) === nameKey ||
    normalizeCustomerNameKey(row.shopName) === nameKey
  );
}

function appendUniqueKeysFromRecords(records, brands, keys, seen, limit) {
  for (const row of sortRecordsNewestFirst(records)) {
    for (const key of brandKeysWithBags(row, brands)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
      if (keys.length >= limit) return;
    }
  }
}

/** Newest unique products with bags, preferring the selected customer's last unload. */
function lastUnloadedBrandKeys({ unloads, loads, bills, brands, customer }) {
  const limit = LAST_UNLOADED_ITEM_COUNT;
  const keys = [];
  const seen = new Set();
  if (customer) {
    const customerUnloads = (unloads || []).filter((row) => rowMatchesCustomer(row, customer));
    const approved = customerUnloads.filter(
      (r) => String(r.status || '').trim().toLowerCase() === 'approved',
    );
    const customerBills = (bills || []).filter((row) => rowMatchesCustomer(row, customer));
    appendUniqueKeysFromRecords(
      approved.length ? approved : customerUnloads.length ? customerUnloads : customerBills,
      brands,
      keys,
      seen,
      limit,
    );
  }
  if (keys.length < limit) appendUniqueKeysFromRecords(unloads, brands, keys, seen, limit);
  if (keys.length < limit) appendUniqueKeysFromRecords(loads, brands, keys, seen, limit);
  if (keys.length < limit) appendUniqueKeysFromRecords(bills, brands, keys, seen, limit);
  if (keys.length < limit) {
    for (const b of brands) {
      if (seen.has(b.key)) continue;
      seen.add(b.key);
      keys.push(b.key);
      if (keys.length >= limit) break;
    }
  }
  return keys;
}

function lastUnloadBagsByBrand(records, brands) {
  const out = {};
  for (const row of sortRecordsNewestFirst(records)) {
    for (const b of brands) {
      if (out[b.key] != null) continue;
      const n = Number(row?.[`${b.key}Bags`]);
      if (Number.isFinite(n) && n > 0) out[b.key] = n;
    }
  }
  return out;
}

function visibleSaleBrands({ brands, lastKeys, form, showAll }) {
  if (showAll) return brands;
  const lastSet = new Set(lastKeys);
  const extraKeys = [];
  for (const b of brands) {
    if (lastSet.has(b.key)) continue;
    const bags = Number(form?.[`${b.key}Bags`]);
    if (Number.isFinite(bags) && bags > 0) extraKeys.push(b.key);
  }
  const byKey = new Map(brands.map((b) => [b.key, b]));
  return [...lastKeys, ...extraKeys].map((k) => byKey.get(k)).filter(Boolean);
}

function printPdfFrame(frame, fallbackUrl) {
  if (frame?.contentWindow) {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      return;
    } catch {
      /* fall through */
    }
  }
  if (fallbackUrl) window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
}

function BillSaleFormFields({
  form,
  customers,
  brands,
  visibleBrands,
  onChange,
  lastPrices = {},
  lastUnloadBags = {},
  isEdit = false,
  onLoadLastPrices,
  loadingLastPrices = false,
  showAllItems = false,
  onToggleAllItems,
  hiddenItemCount = 0,
}) {
  const listedBrands = Array.isArray(visibleBrands) && visibleBrands.length > 0 ? visibleBrands : brands;
  const canToggleItems = typeof onToggleAllItems === 'function' && (hiddenItemCount > 0 || showAllItems);

  return (
    <>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="block text-xs font-medium text-slate-600">
          Invoice #
          <input
            type="text"
            autoComplete="off"
            required
            maxLength={40}
            value={form.invoiceNumber}
            onChange={(e) => onChange('invoiceNumber', e.target.value)}
            className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-2.5 py-2 font-mono text-xs ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
            placeholder="e.g. INV-012 or CS100"
          />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Date
          <input
            type="date"
            required
            value={form.date}
            onChange={(e) => onChange('date', e.target.value)}
            className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-2.5 py-2 text-xs ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
          />
        </label>
        <p className="text-[11px] font-normal text-slate-500 sm:col-span-2">
          {isEdit
            ? 'Invoice # must be unique across all credit bills.'
            : 'Filled from the last saved invoice (+1). You can change it before saving.'}
        </p>
        <label className="block text-xs font-medium text-slate-600 sm:col-span-2">
          Customer
          <select
            required
            value={form.customerId}
            onChange={(e) => onChange('customerId', e.target.value)}
            className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-2.5 py-2 text-xs ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={customers.length === 0}
          >
            <option value="">
              {customers.length === 0 ? 'No customers yet — add some on Customers' : 'Select customer…'}
            </option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Bags &amp; unit price (LKR)</p>
            <p className="mt-0.5 text-[10px] font-normal text-slate-400">
              {showAllItems
                ? 'Full product list. Enter bags and price for the items on this invoice.'
                : 'Last unloaded items. Select a customer, then Load last prices if you want previous unit prices.'}
            </p>
          </div>
          {onLoadLastPrices ? (
            <button
              type="button"
              onClick={onLoadLastPrices}
              disabled={!form.customerId || loadingLastPrices}
              className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[11px] font-medium text-indigo-800 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingLastPrices ? 'Loading…' : 'Load last prices'}
            </button>
          ) : null}
        </div>
        <div
          className={
            showAllItems
              ? 'mt-2 max-h-[min(48vh,28rem)] space-y-2 overflow-y-auto overscroll-contain pr-0.5'
              : 'mt-2 space-y-2'
          }
        >
          {listedBrands.map((b) => {
            const last = lastPrices[b.key];
            const lastLabel = formatUnitPrice(last);
            const lastBags = lastUnloadBags[b.key];
            return (
            <div key={b.key} className="grid grid-cols-1 items-end gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              <span
                className="min-w-0 truncate text-[11px] font-normal text-slate-700 sm:col-span-2 lg:col-span-1"
                title={formatBrandLabel(b) || b.label}
              >
                {formatBrandLabel(b) || b.label}
                {lastBags != null ? (
                  <span className="ml-1 font-normal text-slate-400">· last unload {lastBags}</span>
                ) : null}
              </span>
              <label className="text-[10px] text-slate-500">
                Bags
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={form[`${b.key}Bags`]}
                  onChange={(e) => onChange(`${b.key}Bags`, e.target.value)}
                  className="mt-0.5 w-full rounded-lg border-0 bg-white px-2 py-1.5 text-xs tabular-nums ring-1 ring-slate-200"
                />
              </label>
              <label className="text-[10px] text-slate-500">
                Price / bag
                {lastLabel ? (
                  <span className="ml-1 font-normal text-slate-400">· last {lastLabel}</span>
                ) : null}
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={form[`${b.key}UnitPrice`]}
                  onChange={(e) => onChange(`${b.key}UnitPrice`, e.target.value)}
                  className="mt-0.5 w-full rounded-lg border-0 bg-white px-2 py-1.5 text-xs tabular-nums ring-1 ring-slate-200"
                />
              </label>
            </div>
            );
          })}
        </div>
        {canToggleItems ? (
          <button
            type="button"
            onClick={onToggleAllItems}
            className="mt-2.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
          >
            {showAllItems
              ? 'Show last unloaded items'
              : `View all items${hiddenItemCount > 0 ? ` (${hiddenItemCount} more)` : ''}`}
          </button>
        ) : null}
      </div>
      <label className="block text-xs font-medium text-slate-600">
        Note (optional)
        <textarea
          rows={2}
          value={form.note ?? ''}
          onChange={(e) => onChange('note', e.target.value)}
          className="mt-1 w-full resize-y rounded-xl border-0 bg-slate-100 px-2.5 py-2 text-xs ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
          placeholder="e.g. Delivery remarks, special instructions…"
        />
      </label>
    </>
  );
}

function billNoteText(row) {
  return String(row?.note ?? '').trim();
}

function BillRowNoteTooltip({ hover }) {
  if (!hover?.text) return null;
  const pad = 12;
  const maxW = 288;
  const left = Math.max(pad, Math.min(hover.x + 14, window.innerWidth - maxW - pad));
  const top = Math.min(hover.y + 18, window.innerHeight - 80);
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[200] max-w-xs whitespace-pre-wrap break-words rounded-lg bg-slate-800 px-2.5 py-1.5 text-[11px] font-normal leading-snug text-white shadow-lg ring-1 ring-black/10"
      style={{ left, top }}
    >
      {hover.text}
    </div>
  );
}

export default function BillsPage() {
  const { brands } = useBagProducts();
  const { requestAutoPrint } = usePrinter();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(() => emptyForm([]));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [loadingLastPrices, setLoadingLastPrices] = useState(false);
  const [detailBill, setDetailBill] = useState(null);
  const [editBill, setEditBill] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [shopDetails, setShopDetails] = useState({ shopName: DEFAULT_SHOP_NAME });
  const [loads, setLoads] = useState([]);
  const [unloads, setUnloads] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [hoverNote, setHoverNote] = useState(null);
  const [invoicePreviewUrl, setInvoicePreviewUrl] = useState(null);
  const [invoicePreviewFilename, setInvoicePreviewFilename] = useState('');
  const [invoicePreviewBusy, setInvoicePreviewBusy] = useState(false);
  const [addStep, setAddStep] = useState(1);
  const [showAllSaleItems, setShowAllSaleItems] = useState(false);
  const [saleInvoiceUrl, setSaleInvoiceUrl] = useState(null);
  const [saleInvoiceFilename, setSaleInvoiceFilename] = useState('');
  const invoiceNumberTouched = useRef(false);
  const invoicePreviewUrlRef = useRef(null);
  const saleInvoiceUrlRef = useRef(null);
  const saleInvoiceFrameRef = useRef(null);

  const loadCustomers = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/customers`);
      if (!res.ok) throw new Error('Failed to load customers');
      const data = await res.json();
      setCustomers(Array.isArray(data) ? data : []);
    } catch {
      setCustomers([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/bills`);
      if (!res.ok) throw new Error('Failed to load bills');
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || 'Could not load data');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  useEffect(() => {
    (async () => {
      try {
        const [shopRes, loadsRes, unloadsRes, promoRes] = await Promise.all([
          fetch(`${apiBase}/api/shop`),
          fetch(`${apiBase}/api/stocks`),
          authFetch(`${apiBase}/api/unload-requests?status=all`),
          fetch(`${apiBase}/api/promotions`),
        ]);
        if (shopRes.ok) {
          const data = await shopRes.json();
          setShopDetails({
            shopName: String(data?.shopName ?? '').trim() || DEFAULT_SHOP_NAME,
            registrationNo: data?.registrationNo ?? '',
            addressLine1: data?.addressLine1 ?? '',
            addressLine2: data?.addressLine2 ?? '',
            email: data?.email ?? '',
            contactNumber: data?.contactNumber ?? '',
            dealerTagline: data?.dealerTagline ?? '',
            deliveryNote: data?.deliveryNote ?? '',
          });
        }
        if (loadsRes.ok) {
          const data = await loadsRes.json();
          setLoads(Array.isArray(data) ? data : []);
        }
        if (unloadsRes.ok) {
          const data = await unloadsRes.json();
          setUnloads(Array.isArray(data) ? data : []);
        }
        if (promoRes.ok) {
          const data = await promoRes.json();
          setPromotions(Array.isArray(data) ? data : []);
        } else {
          setPromotions([]);
        }
      } catch {
        setShopDetails({ shopName: DEFAULT_SHOP_NAME });
        setLoads([]);
        setUnloads([]);
        setPromotions([]);
      }
    })();
  }, []);

  const stockOptions = useMemo(() => {
    const u = new Set();
    for (const r of rows) {
      const id = String(r.stockId ?? '').trim();
      if (id) u.add(id);
    }
    return [...u].sort();
  }, [rows]);

  const filterBillRows = useCallback(
    (list) =>
      list.filter((r) => {
        if (stockFilter && String(r.stockId ?? '').trim() !== stockFilter) return false;
        if (!inDateRange(r.date, dateFrom, dateTo)) return false;
        const bagParts = brands.map((b) => String(r[`${b.key}Bags`] ?? ''));
        return rowMatchesQuery(search, [
          r.date,
          r.stockId,
          r.customerName,
          r.invoiceNumber,
          r.enteredBy,
          r.note,
          String(r.totalAmount ?? ''),
          ...bagParts,
        ]);
      }),
    [search, stockFilter, dateFrom, dateTo, brands],
  );

  const filteredRows = useMemo(() => filterBillRows(rows), [rows, filterBillRows]);

  const lastPricesMap = useMemo(
    () => lastUnitPricesByCustomerId(rows, customers, brands),
    [rows, customers, brands],
  );

  const selectedLastPrices = lastPricesMap.get(String(form.customerId || '')) || {};
  const selectedCustomer = useMemo(
    () => customers.find((c) => String(c.id) === String(form.customerId || '')) || null,
    [customers, form.customerId],
  );
  const lastUnloadedKeys = useMemo(
    () =>
      lastUnloadedBrandKeys({
        unloads,
        loads,
        bills: rows,
        brands,
        customer: selectedCustomer,
      }),
    [unloads, loads, rows, brands, selectedCustomer],
  );
  const lastUnloadBags = useMemo(() => {
    const customerUnloads = selectedCustomer
      ? (unloads || []).filter((row) => rowMatchesCustomer(row, selectedCustomer))
      : [];
    const source = customerUnloads.length ? customerUnloads : unloads;
    return lastUnloadBagsByBrand(source.length ? source : loads, brands);
  }, [unloads, loads, brands, selectedCustomer]);
  const visibleAddBrands = useMemo(
    () =>
      visibleSaleBrands({
        brands,
        lastKeys: lastUnloadedKeys,
        form,
        showAll: showAllSaleItems,
      }),
    [brands, lastUnloadedKeys, form, showAllSaleItems],
  );
  const hiddenSaleItemCount = Math.max(0, brands.length - visibleAddBrands.length);

  const pagination = useTablePagination(filteredRows.length, [search, stockFilter, dateFrom, dateTo]);
  const pagedRows = useMemo(
    () => filteredRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filteredRows, pagination.offset, pagination.pageSize]
  );

  const invoicePdfOpts = useCallback(
    () => ({
      ...shopDetails,
      shopName: shopDetails.shopName || DEFAULT_SHOP_NAME,
      loads,
      unloads,
      customers,
      promotions,
      dateFrom,
      dateTo,
    }),
    [shopDetails, loads, unloads, customers, promotions, dateFrom, dateTo],
  );

  const loadBillsForInvoicePdf = useCallback(async () => {
    let billsForPdf = filteredRows;
    try {
      const res = await fetch(`${apiBase}/api/bills`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          billsForPdf = filterBillRows(data);
          setRows(data);
        }
      }
    } catch {
      /* use filteredRows already in state */
    }
    return billsForPdf;
  }, [filteredRows, filterBillRows]);

  const closeInvoicePreview = useCallback(() => {
    if (invoicePreviewUrlRef.current) {
      URL.revokeObjectURL(invoicePreviewUrlRef.current);
      invoicePreviewUrlRef.current = null;
    }
    setInvoicePreviewUrl(null);
    setInvoicePreviewFilename('');
  }, []);

  const revokeSaleInvoiceUrl = useCallback(() => {
    if (saleInvoiceUrlRef.current) {
      URL.revokeObjectURL(saleInvoiceUrlRef.current);
      saleInvoiceUrlRef.current = null;
    }
    setSaleInvoiceUrl(null);
    setSaleInvoiceFilename('');
  }, []);

  useEffect(() => {
    return () => {
      if (invoicePreviewUrlRef.current) {
        URL.revokeObjectURL(invoicePreviewUrlRef.current);
        invoicePreviewUrlRef.current = null;
      }
      if (saleInvoiceUrlRef.current) {
        URL.revokeObjectURL(saleInvoiceUrlRef.current);
        saleInvoiceUrlRef.current = null;
      }
    };
  }, []);

  const handleDownloadInvoices = useCallback(async () => {
    const billsForPdf = await loadBillsForInvoicePdf();
    downloadBillsInvoicesPdf(billsForPdf, invoicePdfOpts());
  }, [loadBillsForInvoicePdf, invoicePdfOpts]);

  const handleViewInvoices = useCallback(async () => {
    setInvoicePreviewBusy(true);
    try {
      const billsForPdf = await loadBillsForInvoicePdf();
      const preview = billsInvoicesPdfBlobUrl(billsForPdf, invoicePdfOpts());
      if (!preview) return;
      if (invoicePreviewUrlRef.current) {
        URL.revokeObjectURL(invoicePreviewUrlRef.current);
      }
      invoicePreviewUrlRef.current = preview.url;
      setInvoicePreviewUrl(preview.url);
      setInvoicePreviewFilename(preview.filename);
    } finally {
      setInvoicePreviewBusy(false);
    }
  }, [loadBillsForInvoicePdf, invoicePdfOpts]);

  const openAdd = () => {
    setSaveError(null);
    invoiceNumberTouched.current = false;
    loadCustomers();
    setAddStep(1);
    setShowAllSaleItems(false);
    revokeSaleInvoiceUrl();
    setForm({
      ...emptyForm(brands),
      invoiceNumber: suggestNextBillInvoiceNumber(rows),
    });
    setAddOpen(true);
  };

  useEffect(() => {
    if (!addOpen || invoiceNumberTouched.current) return;
    const next = suggestNextBillInvoiceNumber(rows);
    setForm((f) => (f.invoiceNumber === next ? f : { ...f, invoiceNumber: next }));
  }, [addOpen, rows]);

  const closeAdd = () => {
    setAddOpen(false);
    setSaveError(null);
    invoiceNumberTouched.current = false;
    setLoadingLastPrices(false);
    setAddStep(1);
    setShowAllSaleItems(false);
    revokeSaleInvoiceUrl();
  };

  const handleFormChange = (field, value) => {
    if (field === 'invoiceNumber') {
      invoiceNumberTouched.current = true;
      setForm((f) => ({ ...f, invoiceNumber: String(value).slice(0, 40) }));
      return;
    }
    setForm((f) => {
      const next = { ...f, [field]: value };
      const customerId = field === 'customerId' ? value : next.customerId;
      const last = lastPricesMap.get(String(customerId || '')) || {};
      const bagsMatch = /^(.+)Bags$/.exec(String(field));
      if (field === 'customerId') {
        return fillLastPricesOnForm(next, brands, last);
      }
      if (bagsMatch) {
        return fillLastPricesOnForm(next, brands, last, bagsMatch[1]);
      }
      return next;
    });
  };

  const handleLoadLastPrices = async () => {
    const customerId = String(form.customerId || '').trim();
    if (!customerId) {
      setSaveError('Select a customer first.');
      return;
    }
    setLoadingLastPrices(true);
    setSaveError(null);
    try {
      const prices = { ...(lastPricesMap.get(customerId) || {}) };
      try {
        const res = await authFetch(
          `${apiBase}/api/bills/last-unit-prices?customerId=${encodeURIComponent(customerId)}`,
        );
        if (res.ok) {
          const data = await res.json();
          if (data?.found) {
            for (const b of brands) {
              const p = Number(data[`${b.key}UnitPrice`]);
              if (Number.isFinite(p) && p > 0) prices[b.key] = p;
            }
          }
        }
      } catch {
        // Use prices already loaded from credit bills on this page.
      }
      const hasAny = brands.some((b) => Number(prices[b.key]) > 0);
      if (!hasAny) {
        setSaveError('No previous unload prices found for this customer.');
        return;
      }
      setForm((f) => applyAllLastPrices(f, brands, prices));
    } finally {
      setLoadingLastPrices(false);
    }
  };

  const validateInvoiceNumber = (excludeBillId = null) => {
    const invoiceNumber = normalizeBillInvoiceNumber(form.invoiceNumber);
    if (!invoiceNumber) {
      return 'Enter an invoice # (letters and/or numbers).';
    }
    if (!BILL_INVOICE_NUMBER_PATTERN.test(invoiceNumber)) {
      return 'Invoice # can use letters, numbers, spaces, and . _ - /';
    }
    if (isBillInvoiceNumberTaken(rows, invoiceNumber, excludeBillId)) {
      return 'This invoice # is already used on another bill.';
    }
    return null;
  };

  const buildBillBody = () => {
    const selected = customers.find((c) => c.id === form.customerId);
    if (!selected) return { error: 'Please select a customer from the list.' };
    const invoiceError = validateInvoiceNumber(editBill?.id || null);
    if (invoiceError) return { error: invoiceError };
    const body = {
      date: form.date,
      customerName: String(selected.name || '').trim(),
      invoiceNumber: normalizeBillInvoiceNumber(form.invoiceNumber),
      note: String(form.note ?? '').trim(),
    };
    for (const b of brands) {
      body[`${b.key}Bags`] = form[`${b.key}Bags`];
      body[`${b.key}UnitPrice`] = form[`${b.key}UnitPrice`];
    }
    return { body };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const username = getUsername();
    if (!username) {
      setSaveError('You need to be signed in with a username.');
      return;
    }
    const built = buildBillBody();
    if (built.error) {
      setSaveError(built.error);
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${apiBase}/api/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...built.body, enteredBy: username }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || 'Save failed');
        return;
      }
      await load();
      revokeSaleInvoiceUrl();
      const preview = billsInvoicesPdfBlobUrl([data], {
        ...invoicePdfOpts(),
        dateFrom: data.date,
        dateTo: data.date,
      });
      if (preview) {
        saleInvoiceUrlRef.current = preview.url;
        setSaleInvoiceUrl(preview.url);
        setSaleInvoiceFilename(preview.filename);
      }
      setAddStep(2);
      requestAutoPrint('billGenerate', data);
    } catch {
      setSaveError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  const handlePrintSaleInvoice = () => {
    printPdfFrame(saleInvoiceFrameRef.current, saleInvoiceUrl);
  };

  const closeBillEdit = () => {
    setEditBill(null);
    setSaveError(null);
    setLoadingLastPrices(false);
    setShowAllSaleItems(false);
  };

  const openBillEditFromDetail = () => {
    if (!detailBill) return;
    setSaveError(null);
    loadCustomers();
    setShowAllSaleItems(false);
    setEditBill(detailBill);
    setDetailBill(null);
  };

  useEffect(() => {
    if (!editBill) return;
    invoiceNumberTouched.current = true;
    const next = formFromBill(editBill, customers, brands);
    if (!next.invoiceNumber) {
      next.invoiceNumber = suggestNextBillInvoiceNumber(rows);
    }
    setForm(next);
  }, [editBill, customers, rows, brands]);

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    const username = getUsername();
    if (!username) {
      setSaveError('You need to be signed in with a username.');
      return;
    }
    if (!editBill?.id) return;
    const built = buildBillBody();
    if (built.error) {
      setSaveError(built.error);
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${apiBase}/api/bills/${encodeURIComponent(editBill.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...built.body, updatedBy: username }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || 'Update failed');
        return;
      }
      await load();
      closeBillEdit();
    } catch {
      setSaveError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">Record credit bag sales to customers and update stock.</p>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex w-full shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03] sm:w-auto"
        >
          Record credit sale
        </button>
      </div>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      <TableFiltersBar
        hint={
          !loading && rows.length > 0
            ? `Showing ${filteredRows.length} of ${rows.length} bill${rows.length === 1 ? '' : 's'}`
            : null
        }
      >
        <label className={filterLabel}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Customer, stock ID, staff, total…"
            className={filterControl}
          />
        </label>
        <label className={filterLabelNarrow}>
          Stock ID
          <select
            value={stockFilter}
            onChange={(e) => setStockFilter(e.target.value)}
            className={filterControl}
          >
            <option value="">All loads</option>
            {stockOptions.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
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
        <div className="flex flex-wrap items-end gap-2 self-end">
          <button
            type="button"
            onClick={handleDownloadInvoices}
            disabled={loading || filteredRows.length === 0 || invoicePreviewBusy}
            className="inline-flex shrink-0 items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-800 shadow-sm ring-1 ring-indigo-100 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download invoices (PDF)
          </button>
          <button
            type="button"
            onClick={handleViewInvoices}
            disabled={loading || filteredRows.length === 0 || invoicePreviewBusy}
            className="inline-flex shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {invoicePreviewBusy ? 'Generating…' : 'View Invoices'}
          </button>
        </div>
      </TableFiltersBar>

      <div className="space-y-3">
      <div className={mobileCardList}>
        {loading ? (
          <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
            <LoadingSpinner />
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
            No credit bills yet. Use &quot;Record credit sale&quot; to add one.
          </p>
        ) : filteredRows.length === 0 ? (
          <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
            No bills match your search or filters.
          </p>
        ) : (
          pagedRows.map((r) => (
            <MobileRowCard
              key={r.id}
              title={r.customerName || '—'}
              subtitle={r.date}
              badge={
                r.stockId ? (
                  <span className="rounded-lg bg-slate-100 px-2 py-1 font-mono text-[10px] font-semibold text-slate-700">
                    {r.stockId}
                  </span>
                ) : null
              }
              fields={[
                { label: 'Invoice #', value: r.invoiceNumber || '—' },
                ...brands.slice(0, 4).map((b) => ({
                  label: formatBrandLabel(b) || b.label,
                  value: String(r[`${b.key}Bags`] ?? 0),
                })),
                { label: 'Total', value: money(r.totalAmount) },
                ...(billNoteText(r) ? [{ label: 'Note', value: billNoteText(r) }] : []),
              ]}
              onClick={() => setDetailBill(r)}
            />
          ))
        )}
      </div>
      <div className={`hidden sm:block ${scrollTableWrap}`}>
        <table className="w-full min-w-[960px] data-table border-separate border-spacing-0 text-left text-sm">
          <thead className={stickyTheadTransparent}>
            <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th
                className={`whitespace-nowrap px-3 py-3 align-bottom ${stickyDateColWidth} ${stickyFirstOfPairTh}`}
              >
                Date
              </th>
              <th
                className={`min-w-[10rem] max-w-[11.25rem] px-3 py-3 align-bottom ${stickySecondTh}`}
              >
                Customer
              </th>
              <th className="whitespace-nowrap bg-slate-50 px-3 py-3 align-bottom">Invoice #</th>
              <th className="whitespace-nowrap bg-slate-50 px-3 py-3 align-bottom">Stock</th>
              {brands.map((b) => (
                <th
                  key={b.key}
                  className={`px-2 py-2 text-center ${b.ledger.head}`}
                  title={formatBrandLabel(b) || b.label}
                >
                  {b.code ? (
                    <>
                      <span className="block font-mono text-[10px] font-semibold normal-case tracking-normal">
                        {b.code}
                      </span>
                      <span className="mt-0.5 block max-w-[7.5rem] truncate text-[10px] font-normal normal-case leading-tight opacity-90">
                        {b.label}
                      </span>
                    </>
                  ) : (
                    <span className="block max-w-[7.5rem] truncate">{b.label}</span>
                  )}
                  <span className="mt-0.5 block text-[10px] font-normal normal-case opacity-90">Bags</span>
                </th>
              ))}
              <th className="whitespace-nowrap border-l border-slate-100 px-3 py-3 align-bottom text-right">
                Total bill
              </th>
            </tr>
          </thead>
          <tbody className="text-slate-800">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                  <LoadingSpinner />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                  No credit bills yet. Use &quot;Record credit sale&quot; to add one.
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                  No bills match your search or filters.
                </td>
              </tr>
            ) : (
              pagedRows.map((r) => {
                const rowLine = 'border-b border-slate-100/90';
                const note = billNoteText(r);
                const showNote = (e) => setHoverNote({ text: note, x: e.clientX, y: e.clientY });
                return (
                  <tr
                    key={r.id}
                    {...detailRowAttrs(() => {
                      setHoverNote(null);
                      setDetailBill(r);
                    })}
                    title={note ? undefined : 'Click to view full row'}
                    aria-label={
                      note
                        ? `Credit bill ${r.customerName || ''}. Note: ${note}`
                        : `Credit bill ${r.customerName || ''}`
                    }
                    onMouseEnter={note ? showNote : undefined}
                    onMouseMove={note ? showNote : undefined}
                    onMouseLeave={note ? () => setHoverNote(null) : undefined}
                  >
                    <td
                      className={`whitespace-nowrap px-3 py-3 font-medium tabular-nums ${rowLine} ${stickyDateColWidth} ${stickyFirstOfPairTd}`}
                    >
                      {r.date}
                    </td>
                    <td
                      className={`min-w-[10rem] max-w-[180px] overflow-hidden px-3 py-3 font-medium text-slate-900 ${rowLine} ${stickySecondTd}`}
                    >
                      <span className="line-clamp-2">
                        {r.customerName}
                        {note ? (
                          <span
                            className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-indigo-400 align-middle"
                            aria-hidden="true"
                          />
                        ) : null}
                      </span>
                    </td>
                    <td
                      className={`whitespace-nowrap px-3 py-3 font-mono text-sm text-slate-800 ${rowLine} bg-white`}
                    >
                      {r.invoiceNumber || '—'}
                    </td>
                    <td
                      className={`whitespace-nowrap px-3 py-3 font-mono text-sm text-slate-800 ${rowLine} bg-white`}
                    >
                      {r.stockId || '—'}
                    </td>
                    {brands.map((b) => (
                      <td
                        key={b.key}
                        className={`px-2 py-3 text-center tabular-nums ${rowLine} ${b.ledger.cellLead} transition-colors hover:brightness-[0.98]`}
                      >
                        {r[`${b.key}Bags`] ?? 0}
                      </td>
                    ))}
                    <td
                      className={`border-l border-slate-100 px-3 py-3 text-right font-semibold tabular-nums text-slate-900 ${rowLine} bg-white`}
                    >
                      {money(r.totalAmount)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {!loading && rows.length > 0 ? (
        <TablePaginationBar
          page={pagination.page}
          totalPages={pagination.totalPages}
          pageSize={pagination.pageSize}
          totalCount={filteredRows.length}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
        />
      ) : null}
      </div>

      {addOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bills-add-title"
        >
          <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" aria-label="Close" onClick={closeAdd} />
          <div
            className={`${
              addStep === 2 ? modalPanelClass4xl : modalPanelClass3xl
            } flex max-h-[min(96dvh,calc(100dvh-env(safe-area-inset-bottom,0px)))] w-full max-w-none flex-col overflow-hidden !p-0 ${
              addStep === 2 ? 'sm:max-w-5xl' : 'sm:max-w-3xl'
            }`}
          >
            <div className="shrink-0 border-b border-slate-100 px-4 pb-3 pt-4 sm:px-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="bills-add-title" className="text-sm font-semibold text-slate-900 sm:text-base">
                    {addStep === 1 ? 'Record credit sale' : 'Invoice'}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {addStep === 1
                      ? `Enter invoice details and items. Logged in as ${getUsername() || '—'}.`
                      : 'Download or print this invoice.'}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-100">
                  Step {addStep} of 2
                </span>
              </div>
              <div className="mt-3 flex items-center gap-2 text-xs" aria-label="Sale steps">
                <span className={`flex items-center gap-1.5 ${addStep === 1 ? 'font-semibold text-indigo-700' : 'text-slate-500'}`}>
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                      addStep === 1 ? 'bg-indigo-600 text-white' : 'bg-slate-400 text-white'
                    }`}
                  >
                    1
                  </span>
                  Details
                </span>
                <span className="h-px min-w-4 flex-1 bg-slate-200" aria-hidden />
                <span className={`flex items-center gap-1.5 ${addStep === 2 ? 'font-semibold text-indigo-700' : 'text-slate-400'}`}>
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                      addStep === 2 ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'
                    }`}
                  >
                    2
                  </span>
                  Invoice
                </span>
              </div>
            </div>

            {addStep === 1 ? (
              <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
                  {saveError ? (
                    <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800 ring-1 ring-red-100">{saveError}</p>
                  ) : null}
                  <BillSaleFormFields
                    form={form}
                    customers={customers}
                    brands={brands}
                    visibleBrands={visibleAddBrands}
                    onChange={handleFormChange}
                    lastPrices={selectedLastPrices}
                    lastUnloadBags={lastUnloadBags}
                    onLoadLastPrices={handleLoadLastPrices}
                    loadingLastPrices={loadingLastPrices}
                    showAllItems={showAllSaleItems}
                    onToggleAllItems={() => setShowAllSaleItems((v) => !v)}
                    hiddenItemCount={hiddenSaleItemCount}
                  />
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-100 px-4 py-3 sm:px-6">
                  <button
                    type="button"
                    onClick={closeAdd}
                    className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving || customers.length === 0}
                    className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-3.5 py-2 text-xs font-medium text-white shadow-md disabled:opacity-60"
                  >
                    {saving ? 'Saving…' : 'Continue'}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-b border-slate-100 px-4 py-3 sm:px-6">
                  {saleInvoiceUrl ? (
                    <a
                      href={saleInvoiceUrl}
                      download={saleInvoiceFilename || 'invoice.pdf'}
                      className="rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-800 ring-1 ring-indigo-100 hover:bg-indigo-100"
                    >
                      Download invoice
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={handlePrintSaleInvoice}
                    disabled={!saleInvoiceUrl}
                    className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-3.5 py-2 text-xs font-semibold text-white shadow-md disabled:opacity-60"
                  >
                    Print invoice
                  </button>
                  <button
                    type="button"
                    onClick={closeAdd}
                    className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Done
                  </button>
                </div>
                {saleInvoiceUrl ? (
                  <iframe
                    ref={saleInvoiceFrameRef}
                    title="Credit sale invoice preview"
                    src={saleInvoiceUrl}
                    className="min-h-[70vh] w-full flex-1 border-0 bg-slate-100"
                  />
                ) : (
                  <p className="px-4 py-10 text-center text-sm text-slate-500 sm:px-6">
                    Bill saved. The invoice preview could not be generated.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}

      {editBill ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bills-edit-title"
        >
          <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" aria-label="Close" onClick={closeBillEdit} />
          <div className={modalPanelClass3xl}>
            <h2 id="bills-edit-title" className="text-sm font-semibold text-slate-900">
              Edit credit sale
            </h2>
            <p className="mt-1 text-xs text-slate-500">Logged in as {getUsername() || '—'}</p>
            <form className="mt-4 space-y-3" onSubmit={handleEditSubmit}>
              {saveError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800 ring-1 ring-red-100">{saveError}</p>
              ) : null}
              <BillSaleFormFields
                form={form}
                customers={customers}
                brands={brands}
                visibleBrands={visibleAddBrands}
                onChange={handleFormChange}
                lastPrices={selectedLastPrices}
                lastUnloadBags={lastUnloadBags}
                isEdit
                onLoadLastPrices={handleLoadLastPrices}
                loadingLastPrices={loadingLastPrices}
                showAllItems={showAllSaleItems}
                onToggleAllItems={() => setShowAllSaleItems((v) => !v)}
                hiddenItemCount={hiddenSaleItemCount}
              />
              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeBillEdit}
                  className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || customers.length === 0}
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-3.5 py-2 text-xs font-medium text-white shadow-md disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <RowDetailModal
        open={!!detailBill}
        row={detailBill}
        variant="bill"
        onClose={() => setDetailBill(null)}
        actions={
          canEditDetails() ? (
            <button
              type="button"
              onClick={openBillEditFromDetail}
              className="mt-4 w-full rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-800 ring-1 ring-indigo-100 hover:bg-indigo-100"
            >
              Edit bill
            </button>
          ) : null
        }
      />
      {invoicePreviewUrl ? (
        <div
          className="fixed inset-0 z-[110] flex items-end justify-center p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="invoices-preview-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            aria-label="Close"
            onClick={closeInvoicePreview}
          />
          <div
            className={`${modalPanelClass4xl} flex max-h-[min(96dvh,calc(100dvh-env(safe-area-inset-bottom,0px)))] w-full max-w-none flex-col overflow-hidden !p-0 sm:max-w-5xl`}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
              <h2 id="invoices-preview-title" className="text-sm font-semibold text-slate-900 sm:text-base">
                Invoices
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={invoicePreviewUrl}
                  download={invoicePreviewFilename || 'invoices.pdf'}
                  className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 ring-1 ring-indigo-100 hover:bg-indigo-100"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={closeInvoicePreview}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>
            <iframe
              title="Invoices PDF preview"
              src={invoicePreviewUrl}
              className="min-h-[70vh] w-full flex-1 border-0 bg-slate-100"
            />
          </div>
        </div>
      ) : null}
      <BillRowNoteTooltip hover={hoverNote} />
    </div>
  );
}
