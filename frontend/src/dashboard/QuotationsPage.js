import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiBase } from '../apiBase';
import { authFetch, getUsername, isAdmin } from '../auth';
import { DEFAULT_SHOP_NAME } from '../shopConfig';
import { useBagProducts } from './BagProductsContext';
import { quotationPdfBlobUrl } from './quotationPdf';
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
  rowMatchesQuery,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
  useTablePagination,
  modalPanelClass4xl,
  ModalBackdrop,
} from './tableToolbar';
import RowDetailModal, { detailRowAttrs } from './RowDetailModal';

const apiBase = getApiBase();

const DEFAULT_PAYMENT_TERMS = 'Payment within 30 days of invoice.';
const DEFAULT_DELIVERY_TERMS = 'Delivery within 3–5 working days of confirmation.';

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function todayYmdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd || todayYmdLocal())
    .split('-')
    .map((n) => parseInt(n, 10));
  if (!y || !m || !d) return todayYmdLocal();
  const dt = new Date(y, m - 1, d + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

let lineKeySeq = 0;
function newKey(prefix) {
  lineKeySeq += 1;
  return `${prefix}-${lineKeySeq}`;
}

function newItemLine(overrides = {}) {
  return {
    key: newKey('item'),
    product: '',
    productKey: '',
    quantity: '',
    unitCost: '',
    ...overrides,
  };
}

function lastQuotationTerms(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return null;
  // Prefer newest createdAt, then newest date / quotation number.
  const sorted = [...list].sort((a, b) => {
    const created = String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    if (created !== 0) return created;
    const dateCmp = String(b.date || '').localeCompare(String(a.date || ''));
    if (dateCmp !== 0) return dateCmp;
    return String(b.quotationNumber || '').localeCompare(String(a.quotationNumber || ''));
  });
  const c = sorted[0]?.conditions;
  if (!c || typeof c !== 'object') return null;
  return {
    paymentTerms: String(c.paymentTerms ?? '').trim(),
    deliveryTerms: String(c.deliveryTerms ?? '').trim(),
  };
}

function emptyConditions(lastTerms = null) {
  const paymentTerms =
    String(lastTerms?.paymentTerms ?? '').trim() || DEFAULT_PAYMENT_TERMS;
  const deliveryTerms =
    String(lastTerms?.deliveryTerms ?? '').trim() || DEFAULT_DELIVERY_TERMS;
  return {
    validUntil: addDaysYmd(todayYmdLocal(), 7),
    paymentTerms,
    deliveryTerms,
    pricesSubjectToChange: true,
    stockAvailability: true,
    quotationNotOrder: true,
    vatAlsoAdded: false,
  };
}

function emptyForm(lastTerms = null) {
  return {
    date: todayYmdLocal(),
    customerId: '',
    items: [newItemLine()],
    conditions: emptyConditions(lastTerms),
    note: '',
  };
}

function itemLineTotal(item) {
  return (Number(item?.quantity) || 0) * (Number(item?.unitCost) || 0);
}

function itemsLineTotalSum(items) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => sum + itemLineTotal(item), 0);
}

function productSummary(row) {
  const items = Array.isArray(row?.items) ? row.items : [];
  if (items.length === 0) return '—';
  const labels = items.map((item) => String(item.product || '').trim()).filter(Boolean);
  if (labels.length <= 2) return labels.join(', ') || '—';
  return `${labels[0]}, ${labels[1]} +${labels.length - 2}`;
}

function formFromQuotation(row) {
  const items =
    Array.isArray(row?.items) && row.items.length > 0
      ? row.items.map((item) =>
          newItemLine({
            product: item.product || '',
            productKey: item.productKey || '',
            quantity: item.quantity != null && item.quantity !== '' ? String(item.quantity) : '',
            unitCost: item.unitCost != null && item.unitCost !== '' ? String(item.unitCost) : '',
          }),
        )
      : [newItemLine()];
  const c = row?.conditions && typeof row.conditions === 'object' ? row.conditions : {};
  return {
    date: row?.date || todayYmdLocal(),
    customerId: row?.customerId || '',
    items,
    conditions: {
      validUntil: c.validUntil || addDaysYmd(row?.date || todayYmdLocal(), 7),
      paymentTerms: c.paymentTerms || DEFAULT_PAYMENT_TERMS,
      deliveryTerms: c.deliveryTerms || DEFAULT_DELIVERY_TERMS,
      pricesSubjectToChange: Boolean(c.pricesSubjectToChange),
      stockAvailability: Boolean(c.stockAvailability),
      quotationNotOrder: Boolean(c.quotationNotOrder),
      vatAlsoAdded: Boolean(c.vatAlsoAdded),
    },
    note: row?.note || '',
  };
}

function validateForm(form) {
  if (!String(form.date || '').trim()) return 'Date is required.';
  if (!String(form.customerId || '').trim()) return 'Select a customer.';
  const items = Array.isArray(form.items) ? form.items : [];
  const filled = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const product = String(item.product || '').trim();
    const quantity = Number(item.quantity) || 0;
    const unitCost = Number(item.unitCost) || 0;
    if (!product && quantity <= 0 && unitCost <= 0) continue;
    if (!product) return `Item ${i + 1}: select a product.`;
    if (unitCost <= 0) return `Item ${i + 1}: per item cost must be greater than 0.`;
    if (quantity <= 0) return `Item ${i + 1}: amount must be greater than 0.`;
    filled.push(item);
  }
  if (filled.length === 0) return 'Add at least one item with product, cost, and amount.';

  const c = form.conditions || {};
  if (!String(c.validUntil || '').trim()) return 'Valid until date is required.';
  if (String(c.validUntil) < String(form.date)) {
    return 'Valid until must be on or after the quotation date.';
  }
  if (!String(c.paymentTerms || '').trim()) return 'Payment terms are required.';
  if (!String(c.deliveryTerms || '').trim()) return 'Delivery terms are required.';
  if (!c.pricesSubjectToChange) {
    return 'Confirm that prices are subject to change until confirmation.';
  }
  if (!c.stockAvailability) {
    return 'Confirm that supply depends on stock availability.';
  }
  if (!c.quotationNotOrder) {
    return 'Confirm that this quotation is not a confirmed order.';
  }
  return null;
}

export default function QuotationsPage() {
  const { brands } = useBagProducts();
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(() => emptyForm());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [detailRow, setDetailRow] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [shopDetails, setShopDetails] = useState({ shopName: DEFAULT_SHOP_NAME });
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
  const [pdfPreviewFilename, setPdfPreviewFilename] = useState('');
  const [pdfPreviewTitle, setPdfPreviewTitle] = useState('');
  const pdfPreviewUrlRef = useRef(null);
  const pdfPreviewFrameRef = useRef(null);

  const admin = isAdmin();
  const formTotal = useMemo(() => itemsLineTotalSum(form.items), [form.items]);

  const productOptions = useMemo(() => {
    return (Array.isArray(brands) ? brands : []).map((b) => ({
      key: b.key,
      label: String(b.label || '').trim() || b.key,
      value: b.label || b.key,
    }));
  }, [brands]);

  const productsForLine = useCallback(
    (item) => {
      const current = String(item?.product ?? '').trim();
      const opts = productOptions.slice();
      if (current && !opts.some((o) => o.value === current)) {
        opts.unshift({ key: `custom-${current}`, label: current, value: current });
      }
      return opts;
    },
    [productOptions],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [qtRes, custRes] = await Promise.all([
        authFetch(`${apiBase}/api/quotations`),
        fetch(`${apiBase}/api/customers`),
      ]);
      if (!qtRes.ok) throw new Error('Failed to load quotations');
      if (!custRes.ok) throw new Error('Failed to load customers');
      const qtData = await qtRes.json();
      const custData = await custRes.json();
      setRows(Array.isArray(qtData) ? qtData : []);
      setCustomers(Array.isArray(custData) ? custData : []);
    } catch (e) {
      setError(e.message || 'Could not load quotations');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/shop`);
        if (!res.ok) return;
        const data = await res.json();
        setShopDetails({
          shopName: String(data?.shopName ?? '').trim() || DEFAULT_SHOP_NAME,
          registrationNo: data?.registrationNo ?? '',
          addressLine1: data?.addressLine1 ?? '',
          addressLine2: data?.addressLine2 ?? '',
          email: data?.email ?? '',
          contactNumber: data?.contactNumber ?? '',
          dealerTagline: data?.dealerTagline ?? '',
        });
      } catch {
        setShopDetails({ shopName: DEFAULT_SHOP_NAME });
      }
    })();
  }, []);

  useEffect(() => {
    return () => {
      if (pdfPreviewUrlRef.current) {
        URL.revokeObjectURL(pdfPreviewUrlRef.current);
        pdfPreviewUrlRef.current = null;
      }
    };
  }, []);

  const closePdfPreview = useCallback(() => {
    if (pdfPreviewUrlRef.current) {
      URL.revokeObjectURL(pdfPreviewUrlRef.current);
      pdfPreviewUrlRef.current = null;
    }
    setPdfPreviewUrl(null);
    setPdfPreviewFilename('');
    setPdfPreviewTitle('');
  }, []);

  const openPdfPreview = useCallback(
    (row, e) => {
      e?.stopPropagation?.();
      if (!row) return;
      const preview = quotationPdfBlobUrl(row, {
        ...shopDetails,
        shopName: shopDetails.shopName || DEFAULT_SHOP_NAME,
      });
      if (!preview) return;
      if (pdfPreviewUrlRef.current) {
        URL.revokeObjectURL(pdfPreviewUrlRef.current);
      }
      pdfPreviewUrlRef.current = preview.url;
      setPdfPreviewUrl(preview.url);
      setPdfPreviewFilename(preview.filename);
      setPdfPreviewTitle(String(row.quotationNumber || '').trim() || 'Quotation');
    },
    [shopDetails],
  );

  const printPdfPreview = useCallback(() => {
    const frame = pdfPreviewFrameRef.current;
    if (frame?.contentWindow) {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        return;
      } catch {
        /* fall through */
      }
    }
    if (pdfPreviewUrl) window.open(pdfPreviewUrl, '_blank', 'noopener,noreferrer');
  }, [pdfPreviewUrl]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (customerFilter && String(r.customerId) !== String(customerFilter)) return false;
      if (!inDateRange(r.date, dateFrom, dateTo)) return false;
      const itemProducts = (Array.isArray(r.items) ? r.items : []).map((i) => i.product);
      return rowMatchesQuery(search, [
        r.quotationNumber,
        r.customerName,
        r.customerId,
        r.note,
        String(r.totalAmount ?? ''),
        r.conditions?.paymentTerms,
        r.conditions?.deliveryTerms,
        ...itemProducts,
      ]);
    });
  }, [rows, search, dateFrom, dateTo, customerFilter]);

  const pagination = useTablePagination(filteredRows.length, [search, dateFrom, dateTo, customerFilter]);
  const pagedRows = useMemo(
    () => filteredRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filteredRows, pagination.offset, pagination.pageSize],
  );

  const openCreate = () => {
    setEditing(null);
    setSaveError(null);
    setForm(emptyForm(lastQuotationTerms(rows)));
    setModalOpen(true);
  };

  const openEdit = (row, e) => {
    e?.stopPropagation?.();
    setEditing(row);
    setSaveError(null);
    setForm(formFromQuotation(row));
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditing(null);
    setSaveError(null);
  };

  const handleConditionChange = (field, value) => {
    setForm((f) => ({
      ...f,
      conditions: { ...f.conditions, [field]: value },
    }));
  };

  const handleDateChange = (value) => {
    setForm((f) => {
      const next = { ...f, date: value };
      const validUntil = String(f.conditions?.validUntil || '');
      if (!validUntil || validUntil < value) {
        next.conditions = { ...f.conditions, validUntil: addDaysYmd(value, 7) };
      }
      return next;
    });
  };

  const handleItemChange = (key, field, value) => {
    setForm((f) => ({
      ...f,
      items: f.items.map((item) => {
        if (item.key !== key) return item;
        if (field === 'product') {
          const match = productOptions.find((o) => o.value === value);
          return { ...item, product: value, productKey: match?.key || '' };
        }
        return { ...item, [field]: value };
      }),
    }));
  };

  const addItemLine = () => {
    setForm((f) => ({ ...f, items: [...f.items, newItemLine()] }));
  };

  const removeItemLine = (key) => {
    setForm((f) => {
      const items = f.items.filter((item) => item.key !== key);
      return { ...f, items: items.length > 0 ? items : [newItemLine()] };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const username = getUsername();
    if (!username) {
      setSaveError('Sign in to save quotations.');
      return;
    }
    const validationError = validateForm(form);
    if (validationError) {
      setSaveError(validationError);
      return;
    }

    const items = form.items
      .map((item) => {
        const product = String(item.product || '').trim();
        const quantity = Number(item.quantity) || 0;
        const unitCost = Number(item.unitCost) || 0;
        if (!product && quantity <= 0 && unitCost <= 0) return null;
        const entry = { product, quantity, unitCost };
        if (item.productKey) entry.productKey = item.productKey;
        return entry;
      })
      .filter(Boolean);

    const payload = {
      date: form.date,
      customerId: form.customerId,
      items,
      conditions: {
        validUntil: form.conditions.validUntil,
        paymentTerms: String(form.conditions.paymentTerms || '').trim(),
        deliveryTerms: String(form.conditions.deliveryTerms || '').trim(),
        pricesSubjectToChange: Boolean(form.conditions.pricesSubjectToChange),
        stockAvailability: Boolean(form.conditions.stockAvailability),
        quotationNotOrder: Boolean(form.conditions.quotationNotOrder),
        vatAlsoAdded: Boolean(form.conditions.vatAlsoAdded),
      },
      note: String(form.note || '').trim(),
      recordedBy: username,
    };

    setSaving(true);
    setSaveError(null);
    try {
      const url = editing?.id
        ? `${apiBase}/api/quotations/${encodeURIComponent(editing.id)}`
        : `${apiBase}/api/quotations`;
      const res = await authFetch(url, {
        method: editing?.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || 'Could not save quotation');
        return;
      }
      await load();
      if (detailRow?.id && data?.id && detailRow.id === data.id) {
        setDetailRow(data);
      }
      setModalOpen(false);
      setEditing(null);
    } catch {
      setSaveError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  const openDeleteConfirm = (row, e) => {
    e?.stopPropagation?.();
    setDeleteError(null);
    setDeleteTarget(row);
  };

  const closeDeleteConfirm = () => {
    if (deleteBusy) return;
    setDeleteTarget(null);
    setDeleteError(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget?.id) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await authFetch(`${apiBase}/api/quotations/${encodeURIComponent(deleteTarget.id)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteError(data.error || 'Could not delete quotation');
        return;
      }
      await load();
      if (detailRow?.id === deleteTarget.id) setDetailRow(null);
      setDeleteTarget(null);
    } catch {
      setDeleteError('Could not reach the server.');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">
          Create customer quotations with item costs, amounts, and required terms before confirming an
          order.
        </p>
        {admin ? (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex w-full shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03] sm:w-auto"
          >
            New quotation
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      <TableFiltersBar
        hint={
          !loading && rows.length > 0
            ? `Showing ${filteredRows.length} of ${rows.length} quotation${rows.length === 1 ? '' : 's'}`
            : null
        }
      >
        <label className={filterLabel}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="QT #, customer, product…"
            className={filterControl}
          />
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
          Customer
          <select
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
            className={filterControl}
          >
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </TableFiltersBar>

      <div className="space-y-3">
        <div className={mobileCardList}>
          {loading ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              <LoadingSpinner />
            </p>
          ) : rows.length === 0 ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              No quotations yet.{admin ? ' Create one to get started.' : ''}
            </p>
          ) : filteredRows.length === 0 ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              No quotations match your search or filters.
            </p>
          ) : (
            pagedRows.map((r) => (
              <MobileRowCard
                key={r.id}
                title={r.quotationNumber || '—'}
                subtitle={[r.date, r.customerName].filter(Boolean).join(' · ') || '—'}
                fields={[
                  { label: 'Items', value: productSummary(r) },
                  { label: 'Total', value: money(r.totalAmount) },
                  {
                    label: 'Valid until',
                    value: r.conditions?.validUntil || '—',
                  },
                ]}
                actions={
                  <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto">
                    <button
                      type="button"
                      onClick={() => setDetailRow(r)}
                      className="shrink-0 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                    >
                      View
                    </button>
                    {admin ? (
                      <>
                        <button
                          type="button"
                          onClick={(e) => openEdit(r, e)}
                          className="shrink-0 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={(e) => openPdfPreview(r, e)}
                          className="shrink-0 whitespace-nowrap rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                        >
                          Download PDF
                        </button>
                        <button
                          type="button"
                          onClick={(e) => openDeleteConfirm(r, e)}
                          className="shrink-0 whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                        >
                          Delete
                        </button>
                      </>
                    ) : null}
                  </div>
                }
              />
            ))
          )}
        </div>

        <div className={`${scrollTableWrap} hidden md:block`}>
          <table className="data-table min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className={stickyThead}>
              <tr>
                <th className={`whitespace-nowrap px-4 py-3 font-semibold text-slate-600 ${stickyFirstTh}`}>
                  Quotation
                </th>
                <th className="px-3 py-3 font-semibold text-slate-600">Date</th>
                <th className="px-3 py-3 font-semibold text-slate-600">Customer</th>
                <th className="px-3 py-3 font-semibold text-slate-600">Items</th>
                <th className="px-3 py-3 font-semibold text-slate-600 text-right">Total</th>
                <th className="px-3 py-3 font-semibold text-slate-600">Valid until</th>
                <th className="px-3 py-3 font-semibold text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-slate-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-slate-500">
                    No quotations yet.
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-slate-500">
                    No quotations match your filters.
                  </td>
                </tr>
              ) : (
                pagedRows.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer hover:bg-slate-50/80"
                    {...detailRowAttrs(() => setDetailRow(r))}
                  >
                    <td className={`whitespace-nowrap px-4 py-2.5 ${stickyFirstTd}`}>
                      <span className="font-mono text-xs font-semibold text-indigo-700">
                        {r.quotationNumber || '—'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">{r.date || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-800">{r.customerName || '—'}</td>
                    <td className="max-w-[220px] px-3 py-2.5 text-slate-700">
                      <span className="line-clamp-2" title={productSummary(r)}>
                        {productSummary(r)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900">
                      {money(r.totalAmount)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">
                      {r.conditions?.validUntil || '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-nowrap items-center gap-1.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDetailRow(r);
                          }}
                          className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                        >
                          View
                        </button>
                        {admin ? (
                          <>
                            <button
                              type="button"
                              onClick={(e) => openEdit(r, e)}
                              className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={(e) => openPdfPreview(r, e)}
                              className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                            >
                              Download PDF
                            </button>
                            <button
                              type="button"
                              onClick={(e) => openDeleteConfirm(r, e)}
                              className="shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                            >
                              Delete
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
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

      <RowDetailModal
        open={!!detailRow}
        row={detailRow}
        variant="quotation"
        onClose={() => setDetailRow(null)}
        actions={
          admin && detailRow ? (
            <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto">
              <button
                type="button"
                onClick={() => {
                  openEdit(detailRow);
                  setDetailRow(null);
                }}
                className="shrink-0 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={(e) => openPdfPreview(detailRow, e)}
                className="shrink-0 whitespace-nowrap rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
              >
                Download PDF
              </button>
              <button
                type="button"
                onClick={() => {
                  openDeleteConfirm(detailRow);
                  setDetailRow(null);
                }}
                className="shrink-0 whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
              >
                Delete
              </button>
            </div>
          ) : null
        }
      />

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <ModalBackdrop onClose={closeModal} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="quotation-modal-title"
            className={`${modalPanelClass4xl} max-h-[92vh] overflow-y-auto`}
          >
            <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
              <h2 id="quotation-modal-title" className="text-lg font-semibold text-slate-900">
                {editing ? `Edit ${editing.quotationNumber || 'quotation'}` : 'New quotation'}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Select items, set per-item cost and amount, then confirm the required conditions.
                Logged in as {getUsername() || '—'}.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5 px-5 py-4 sm:px-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">
                    Date <span className="text-rose-600">*</span>
                  </span>
                  <input
                    type="date"
                    required
                    value={form.date}
                    onChange={(e) => handleDateChange(e.target.value)}
                    className={`${filterControl} mt-1.5`}
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">
                    Customer <span className="text-rose-600">*</span>
                  </span>
                  <select
                    required
                    value={form.customerId}
                    onChange={(e) => setForm((f) => ({ ...f, customerId: e.target.value }))}
                    className={`${filterControl} mt-1.5`}
                  >
                    <option value="">Select customer…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Items</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Product, per item cost, and amount are required on each line.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={addItemLine}
                    disabled={productOptions.length === 0}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Add item
                  </button>
                </div>

                {productOptions.length === 0 ? (
                  <p className="mt-3 text-sm text-amber-700">
                    No products found. Add products under Shop first.
                  </p>
                ) : (
                  <div className="mt-3 overflow-x-auto rounded-xl bg-white ring-1 ring-slate-200/80">
                    <table className="min-w-[640px] w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2.5">Item</th>
                          <th className="w-28 px-3 py-2.5">Amount</th>
                          <th className="w-40 px-3 py-2.5">Per item cost</th>
                          <th className="w-32 px-3 py-2.5 text-right">Line total</th>
                          <th className="w-10 px-2 py-2.5">
                            <span className="sr-only">Remove</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {form.items.map((item, idx) => {
                          const lineTotal = itemLineTotal(item);
                          return (
                            <tr key={item.key}>
                              <td className="px-3 py-2 align-top">
                                <select
                                  value={item.product}
                                  onChange={(e) => handleItemChange(item.key, 'product', e.target.value)}
                                  className={filterControl}
                                  aria-label={`Item ${idx + 1}`}
                                >
                                  <option value="">Select…</option>
                                  {productsForLine(item).map((p) => (
                                    <option key={p.key} value={p.value}>
                                      {p.label}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-3 py-2 align-top">
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  inputMode="decimal"
                                  value={item.quantity}
                                  onChange={(e) => handleItemChange(item.key, 'quantity', e.target.value)}
                                  placeholder="0"
                                  className={filterControl}
                                  aria-label={`Amount ${idx + 1}`}
                                />
                              </td>
                              <td className="px-3 py-2 align-top">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  inputMode="decimal"
                                  value={item.unitCost}
                                  onChange={(e) => handleItemChange(item.key, 'unitCost', e.target.value)}
                                  placeholder="0.00"
                                  className={filterControl}
                                  aria-label={`Per item cost ${idx + 1}`}
                                />
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right align-middle text-sm font-semibold tabular-nums text-slate-900">
                                {money(lineTotal)}
                              </td>
                              <td className="px-2 py-2 align-middle">
                                {form.items.length > 1 ? (
                                  <button
                                    type="button"
                                    onClick={() => removeItemLine(item.key)}
                                    className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                                    aria-label={`Remove item ${idx + 1}`}
                                  >
                                    ×
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-slate-200 bg-indigo-50/60">
                          <td colSpan={3} className="px-3 py-2.5 text-right text-sm font-semibold text-indigo-900">
                            Total amount
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm font-bold tabular-nums text-indigo-900">
                            {money(formTotal)}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
                <h3 className="text-sm font-semibold text-slate-800">Required conditions</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Terms and acknowledgements must be completed before saving.
                </p>

                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm sm:col-span-2 sm:max-w-xs">
                    <span className="font-medium text-slate-700">
                      Valid until <span className="text-rose-600">*</span>
                    </span>
                    <input
                      type="date"
                      required
                      value={form.conditions.validUntil}
                      onChange={(e) => handleConditionChange('validUntil', e.target.value)}
                      className={`${filterControl} mt-1.5`}
                    />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    <span className="font-medium text-slate-700">
                      Payment terms <span className="text-rose-600">*</span>
                    </span>
                    <textarea
                      required
                      rows={2}
                      value={form.conditions.paymentTerms}
                      onChange={(e) => handleConditionChange('paymentTerms', e.target.value)}
                      className={`${filterControl} mt-1.5`}
                      placeholder={DEFAULT_PAYMENT_TERMS}
                    />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    <span className="font-medium text-slate-700">
                      Delivery terms <span className="text-rose-600">*</span>
                    </span>
                    <textarea
                      required
                      rows={2}
                      value={form.conditions.deliveryTerms}
                      onChange={(e) => handleConditionChange('deliveryTerms', e.target.value)}
                      className={`${filterControl} mt-1.5`}
                      placeholder={DEFAULT_DELIVERY_TERMS}
                    />
                  </label>
                </div>

                <div className="mt-4 space-y-2.5">
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200/80">
                    <input
                      type="checkbox"
                      checked={!!form.conditions.pricesSubjectToChange}
                      onChange={(e) => handleConditionChange('pricesSubjectToChange', e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-slate-800">
                      Prices are subject to change until the order is confirmed{' '}
                      <span className="text-rose-600">*</span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200/80">
                    <input
                      type="checkbox"
                      checked={!!form.conditions.stockAvailability}
                      onChange={(e) => handleConditionChange('stockAvailability', e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-slate-800">
                      Supply depends on stock availability at confirmation{' '}
                      <span className="text-rose-600">*</span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200/80">
                    <input
                      type="checkbox"
                      checked={!!form.conditions.quotationNotOrder}
                      onChange={(e) => handleConditionChange('quotationNotOrder', e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-slate-800">
                      This quotation is an offer only and is not a confirmed order{' '}
                      <span className="text-rose-600">*</span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200/80">
                    <input
                      type="checkbox"
                      checked={!!form.conditions.vatAlsoAdded}
                      onChange={(e) => handleConditionChange('vatAlsoAdded', e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-slate-800">VAT also added for this bill</span>
                  </label>
                </div>
              </div>

              <label className="block text-sm">
                <span className="font-medium text-slate-700">Note</span>
                <textarea
                  rows={2}
                  value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                  className={`${filterControl} mt-1.5`}
                  placeholder="Optional note…"
                />
              </label>

              {saveError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100" role="alert">
                  {saveError}
                </p>
              ) : null}

              <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || productOptions.length === 0}
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03] disabled:opacity-50"
                >
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create quotation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-[110] flex items-end justify-center p-4 sm:items-center">
          <ModalBackdrop onClose={closeDeleteConfirm} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="quotation-delete-title"
            className="relative z-10 w-full max-w-md rounded-2xl bg-white p-5 shadow-xl ring-1 ring-slate-100"
          >
            <h2 id="quotation-delete-title" className="text-lg font-semibold text-slate-900">
              Delete quotation?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              This will permanently remove{' '}
              <span className="font-mono font-semibold text-slate-900">
                {deleteTarget.quotationNumber || 'this quotation'}
              </span>
              {deleteTarget.customerName ? ` for ${deleteTarget.customerName}` : ''}.
            </p>
            {deleteError ? (
              <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100" role="alert">
                {deleteError}
              </p>
            ) : null}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeDeleteConfirm}
                disabled={deleteBusy}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
              >
                Keep
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteBusy}
                className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-50"
              >
                {deleteBusy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pdfPreviewUrl ? (
        <div
          className="fixed inset-0 z-[120] flex items-end justify-center p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quotation-preview-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            aria-label="Close"
            onClick={closePdfPreview}
          />
          <div
            className={`${modalPanelClass4xl} flex max-h-[min(96dvh,calc(100dvh-env(safe-area-inset-bottom,0px)))] w-full max-w-none flex-col overflow-hidden !p-0 sm:max-w-3xl`}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
              <h2 id="quotation-preview-title" className="min-w-0 truncate text-sm font-semibold text-slate-900 sm:text-base">
                {pdfPreviewTitle || 'Quotation'}
              </h2>
              <div className="flex flex-nowrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={printPdfPreview}
                  className="shrink-0 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Print
                </button>
                <a
                  href={pdfPreviewUrl}
                  download={pdfPreviewFilename || 'quotation.pdf'}
                  className="shrink-0 whitespace-nowrap rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 ring-1 ring-indigo-100 hover:bg-indigo-100"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={closePdfPreview}
                  className="shrink-0 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>
            <iframe
              ref={pdfPreviewFrameRef}
              title="Quotation PDF preview"
              src={pdfPreviewUrl}
              className="min-h-[70vh] w-full flex-1 border-0 bg-slate-100"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
