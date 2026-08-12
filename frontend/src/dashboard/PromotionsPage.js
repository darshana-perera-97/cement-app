import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import { canEditDetails, getUsername } from '../auth';
import { useBagProducts } from './BagProductsContext';
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
  modalPanelClass,
} from './tableToolbar';
import RowDetailModal, { detailRowAttrs } from './RowDetailModal';

const apiBase = getApiBase();

const PROMO_TYPES = [
  { id: 'free_bags', label: 'Free bag issue' },
  { id: 'invoice_discount', label: 'Invoice discount' },
  { id: 'target_promotion', label: 'Target promotion' },
];

function promoType(row) {
  const t = String(row?.type ?? '').trim();
  if (t === 'invoice_discount' || t === 'target_promotion') return t;
  return 'free_bags';
}

function promoTypeLabel(type) {
  return PROMO_TYPES.find((t) => t.id === type)?.label ?? 'Free bag issue';
}

function promoAmount(row) {
  const type = promoType(row);
  if (type === 'invoice_discount' || type === 'target_promotion') {
    return Number(row.discountAmount) || 0;
  }
  return 0;
}

function normalizeCustomerName(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function totalFreeBags(row, brands) {
  return brands.reduce((s, b) => s + (Number(row[`${b.key}Bags`]) || 0), 0);
}

function requestedBags(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** @returns {string[]} user-facing errors; empty if valid */
function validatePromotionAgainstStock(form, stockByBrand, bagBrands) {
  const issues = [];
  let anyRequested = false;

  for (const b of bagBrands) {
    const requested = requestedBags(form[`${b.key}Bags`]);
    if (requested <= 0) continue;
    anyRequested = true;
    const available = stockByBrand[b.key] ?? 0;
    if (available <= 0) {
      issues.push(`${b.label} is out of stock — you cannot issue free bags.`);
    } else if (requested > available) {
      issues.push(
        `${b.label}: only ${available.toLocaleString()} bag${available === 1 ? '' : 's'} in stock (you entered ${requested.toLocaleString()}).`,
      );
    }
  }

  if (!anyRequested) {
    const anyInStock = bagBrands.some((b) => (stockByBrand[b.key] ?? 0) > 0);
    if (!anyInStock) {
      issues.push('No bags in stock right now — nothing can be issued.');
    }
  }

  return issues;
}

function emptyForm(brands, type = 'free_bags') {
  const f = {
    type,
    date: new Date().toISOString().slice(0, 10),
    customerId: '',
    billNumber: '',
    reason: '',
    billId: '',
    discountMode: 'whole_invoice',
    discountValue: '',
    discountAmount: '',
  };
  for (const b of brands) {
    f[`${b.key}Bags`] = '';
  }
  return f;
}

function formFromPromotion(promo, brands) {
  const type = promoType(promo);
  const billDigits = String(promo.billNumber ?? '').replace(/\D/g, '');
  const f = {
    type,
    date: promo.date || new Date().toISOString().slice(0, 10),
    customerId: promo.customerId || '',
    billNumber: billDigits ? String(parseInt(billDigits, 10)) : '',
    reason: promo.reason || '',
    billId: promo.billId || '',
    discountMode: promo.discountMode === 'per_bag' ? 'per_bag' : 'whole_invoice',
    discountValue: promo.discountValue != null ? String(promo.discountValue) : '',
    discountAmount: promo.discountAmount != null ? String(promo.discountAmount) : '',
  };
  for (const b of brands) {
    const v = promo[`${b.key}Bags`];
    f[`${b.key}Bags`] = v != null && v !== '' ? String(v) : '';
  }
  return f;
}

function totalBagsOnBill(bill, brands) {
  return brands.reduce((s, b) => s + (Number(bill[`${b.key}Bags`]) || 0), 0);
}

function computePreviewDiscount(form, selectedBill, brands) {
  const value = Number(form.discountValue);
  if (!Number.isFinite(value) || value <= 0 || !selectedBill) return 0;
  const billTotal = Number(selectedBill.totalAmount) || 0;
  if (billTotal <= 0) return 0;
  if (form.discountMode === 'whole_invoice') {
    return Math.min(value, billTotal);
  }
  const bags = totalBagsOnBill(selectedBill, brands);
  if (bags <= 0) return 0;
  return Math.min(Math.round(value * bags * 100) / 100, billTotal);
}

export default function PromotionsPage() {
  const { brands } = useBagProducts();
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editPromotion, setEditPromotion] = useState(null);
  const [form, setForm] = useState(() => emptyForm([]));
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [detailRow, setDetailRow] = useState(null);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [stockSummary, setStockSummary] = useState(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [bills, setBills] = useState([]);
  const [billsLoading, setBillsLoading] = useState(false);
  const [promoTab, setPromoTab] = useState('free_bags');

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
      const res = await fetch(`${apiBase}/api/promotions`);
      if (!res.ok) throw new Error('Failed to load promotions');
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

  const loadStock = useCallback(async () => {
    setStockLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/stocks/summary`);
      if (!res.ok) throw new Error('Failed to load stock');
      const data = await res.json();
      setStockSummary(data);
    } catch {
      setStockSummary(null);
    } finally {
      setStockLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    loadStock();
  }, [modalOpen, loadStock]);

  const loadBills = useCallback(async () => {
    setBillsLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/bills`);
      if (!res.ok) throw new Error('Failed to load bills');
      const data = await res.json();
      setBills(Array.isArray(data) ? data : []);
    } catch {
      setBills([]);
    } finally {
      setBillsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    loadBills();
  }, [modalOpen, loadBills]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === form.customerId),
    [customers, form.customerId],
  );

  const customerBills = useMemo(() => {
    if (!selectedCustomer) return [];
    const nk = normalizeCustomerName(selectedCustomer.name);
    return bills
      .filter((b) => normalizeCustomerName(b.customerName) === nk)
      .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
  }, [bills, selectedCustomer]);

  const selectedBill = useMemo(
    () => customerBills.find((b) => b.id === form.billId) ?? null,
    [customerBills, form.billId],
  );

  const previewDiscount = useMemo(
    () => computePreviewDiscount(form, selectedBill, brands),
    [form, selectedBill, brands],
  );

  const stockByBrand = useMemo(() => {
    const map = {};
    for (const b of stockSummary?.brands || []) {
      map[b.key] = Math.max(0, Math.floor(Number(b.availableForRequest ?? b.bags) || 0));
    }
    if (editPromotion) {
      for (const b of brands) {
        map[b.key] = (map[b.key] ?? 0) + (Number(editPromotion[`${b.key}Bags`]) || 0);
      }
    }
    return map;
  }, [stockSummary, editPromotion, brands]);

  const anyStockAvailable = useMemo(
    () => brands.some((b) => (stockByBrand[b.key] ?? 0) > 0),
    [stockByBrand, brands],
  );

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (!inDateRange(r.date, dateFrom, dateTo)) return false;
      if (customerFilter && r.customerId !== customerFilter) return false;
      return rowMatchesQuery(search, [
        r.date,
        r.customerName,
        r.billNumber,
        r.invoiceNumber,
        r.reason,
        r.enteredBy,
        promoTypeLabel(promoType(r)),
        String(promoAmount(r)),
        String(totalFreeBags(r, brands)),
      ]);
    });
  }, [rows, search, dateFrom, dateTo, customerFilter, brands]);

  const pagination = useTablePagination(filteredRows.length, [search, dateFrom, dateTo, customerFilter]);
  const pagedRows = useMemo(
    () => filteredRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filteredRows, pagination.offset, pagination.pageSize]
  );

  const openModal = () => {
    setEditPromotion(null);
    setPromoTab('free_bags');
    setForm(emptyForm(brands, 'free_bags'));
    setSaveError(null);
    loadCustomers();
    setModalOpen(true);
  };

  const openPromotionEdit = (promo) => {
    if (!promo?.id) return;
    const type = promoType(promo);
    setSaveError(null);
    loadCustomers();
    setEditPromotion(promo);
    setPromoTab(type);
    setForm(formFromPromotion(promo, brands));
    setDetailRow(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditPromotion(null);
    setPromoTab('free_bags');
    setSaveError(null);
  };

  const switchPromoTab = (tabId) => {
    if (editPromotion) return;
    setPromoTab(tabId);
    setForm((f) => ({ ...emptyForm(brands, tabId), date: f.date, customerId: f.customerId, reason: f.reason }));
    setSaveError(null);
  };

  const handleChange = (field, value) => {
    if (field === 'billNumber') {
      const digits = String(value).replace(/\D/g, '').slice(0, 3);
      setForm((f) => ({ ...f, billNumber: digits }));
      return;
    }
    setForm((f) => ({ ...f, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const username = getUsername();
    if (!username) {
      setSaveError('You need to be signed in with a username.');
      return;
    }
    if (!form.customerId) {
      setSaveError('Select a customer.');
      return;
    }
    if (!String(form.reason || '').trim()) {
      setSaveError('Enter a reason for the promotion.');
      return;
    }

    const activeType = editPromotion ? promoType(editPromotion) : promoTab;

    if (activeType === 'free_bags') {
      const stockIssues = validatePromotionAgainstStock(form, stockByBrand, brands);
      if (stockIssues.length > 0) {
        setSaveError(stockIssues.join(' '));
        return;
      }
    } else if (activeType === 'invoice_discount') {
      if (!form.billId) {
        setSaveError('Select an invoice for the discount.');
        return;
      }
      if (previewDiscount <= 0) {
        setSaveError('Enter a valid discount amount.');
        return;
      }
    } else if (activeType === 'target_promotion') {
      const amt = Number(form.discountAmount);
      if (!Number.isFinite(amt) || amt <= 0) {
        setSaveError('Enter a promotion amount greater than zero.');
        return;
      }
    }

    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        type: activeType,
        date: form.date,
        customerId: form.customerId,
        reason: String(form.reason).trim(),
      };
      if (activeType === 'free_bags') {
        payload.billNumber = form.billNumber || undefined;
        for (const b of brands) {
          payload[`${b.key}Bags`] = form[`${b.key}Bags`];
        }
      } else if (activeType === 'invoice_discount') {
        payload.billId = form.billId;
        payload.discountMode = form.discountMode;
        payload.discountValue = form.discountValue;
      } else {
        payload.discountAmount = form.discountAmount;
      }
      const isEdit = !!editPromotion?.id;
      const res = await fetch(
        isEdit ? `${apiBase}/api/promotions/${encodeURIComponent(editPromotion.id)}` : `${apiBase}/api/promotions`,
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            isEdit ? { ...payload, updatedBy: username } : { ...payload, enteredBy: username },
          ),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || 'Save failed');
        return;
      }
      await load();
      closeModal();
    } catch {
      setSaveError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (promo) => {
    if (!promo?.id) return;
    const label = promo.customerName ? ` for ${promo.customerName}` : '';
    const type = promoType(promo);
    const stockNote =
      type === 'free_bags' ? ' Live stock totals will be restored.' : ' Customer balance and cashier will be updated.';
    if (!window.confirm(`Delete this promotion${label}?${stockNote}`)) return;
    setDeletingId(promo.id);
    try {
      const res = await fetch(`${apiBase}/api/promotions/${encodeURIComponent(promo.id)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Delete failed');
        return;
      }
      setDetailRow(null);
      await load();
    } catch {
      alert('Could not reach the server.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">Record promotions: free bags, invoice discounts, or target rewards.</p>
        <button
          type="button"
          onClick={openModal}
          className="inline-flex w-full shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03] sm:w-auto"
        >
          Add promotion
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
            ? `Showing ${filteredRows.length} of ${rows.length} promotion${rows.length === 1 ? '' : 's'}`
            : null
        }
      >
        <label className={filterLabel}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Customer, bill #, reason…"
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
              No promotions yet. Use &quot;Add promotion&quot; to record free bags for a customer.
            </p>
          ) : filteredRows.length === 0 ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              No rows match your search or filters.
            </p>
          ) : (
            pagedRows.map((r) => (
              <MobileRowCard
                key={r.id}
                title={r.customerName || '—'}
                subtitle={r.date}
                onClick={() => setDetailRow(r)}
                fields={[
                  { label: 'Type', value: promoTypeLabel(promoType(r)) },
                  { label: 'Bill / Invoice', value: r.invoiceNumber || (r.billNumber ? `#${r.billNumber}` : '—') },
                  { label: 'Amount', value: money(promoAmount(r)) },
                  { label: 'Free bags', value: promoType(r) === 'free_bags' ? totalFreeBags(r, brands) : '—' },
                  { label: 'Reason', value: r.reason || '—' },
                ]}
              />
            ))
          )}
        </div>
        <div className={`hidden sm:block ${scrollTableWrap}`}>
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
                <th className="px-4 py-3">Customer</th>
                <th className="whitespace-nowrap px-4 py-3">Type</th>
                <th className="whitespace-nowrap px-4 py-3 font-mono">Bill / Invoice</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Free bags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    No promotions yet. Use &quot;Add promotion&quot; to record a promotion for a customer.
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    No rows match your search or filters.
                  </td>
                </tr>
              ) : (
                pagedRows.map((r) => {
                  const type = promoType(r);
                  return (
                  <tr
                    key={r.id}
                    {...detailRowAttrs(() => setDetailRow(r), 'hover:bg-slate-50/80')}
                    aria-label={`Promotion ${r.customerName || ''}`}
                  >
                    <td className={`whitespace-nowrap px-4 py-3 tabular-nums ${stickyFirstTd}`}>{r.date}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{r.customerName || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">{promoTypeLabel(type)}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-sm">
                      {r.invoiceNumber || (r.billNumber ? `#${r.billNumber}` : '—')}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium text-slate-900">
                      {promoAmount(r) > 0 ? money(promoAmount(r)) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-indigo-800">
                      {type === 'free_bags' ? totalFreeBags(r, brands) : '—'}
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

      {modalOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="promo-modal-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            aria-label="Close"
            onClick={closeModal}
          />
          <div className={`${modalPanelClass} max-h-[90vh] overflow-y-auto`}>
            <h2 id="promo-modal-title" className="text-lg font-bold text-slate-900">
              {editPromotion ? 'Edit promotion' : 'Add promotion'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Logged in as {getUsername() || '—'}.
              {promoTab === 'free_bags'
                ? ' Free bags reduce live stock; customer is notified by WhatsApp/email.'
                : ' Deducts from customer ledger and cashier; no customer notification.'}
            </p>

            {!editPromotion ? (
              <div className="mt-4 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1" role="tablist">
                {PROMO_TYPES.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={promoTab === tab.id}
                    onClick={() => switchPromoTab(tab.id)}
                    className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition sm:text-sm ${
                      promoTab === tab.id
                        ? 'bg-white text-indigo-800 shadow-sm ring-1 ring-slate-200'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm font-medium text-indigo-800">{promoTypeLabel(promoTab)}</p>
            )}

            <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
              {saveError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{saveError}</p>
              ) : null}
              <label className="block text-sm font-medium text-slate-600">
                Issue date
                <input
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => handleChange('date', e.target.value)}
                  className={filterControl}
                />
              </label>
              <label className="block text-sm font-medium text-slate-600">
                Customer
                <select
                  required
                  value={form.customerId}
                  onChange={(e) => {
                    handleChange('customerId', e.target.value);
                    handleChange('billId', '');
                  }}
                  className={filterControl}
                >
                  <option value="">Select customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-600">
                Reason
                <textarea
                  required
                  rows={3}
                  value={form.reason}
                  onChange={(e) => handleChange('reason', e.target.value)}
                  placeholder="e.g. Loyalty reward, target achieved, invoice adjustment…"
                  className={`${filterControl} min-h-[5rem] resize-y`}
                />
              </label>

              {promoTab === 'free_bags' ? (
                <>
                  <label className="block text-sm font-medium text-slate-600">
                    Bill number <span className="font-normal text-slate-400">(optional reference)</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.billNumber}
                      onChange={(e) => handleChange('billNumber', e.target.value)}
                      placeholder="e.g. 001"
                      className={filterControl}
                      maxLength={3}
                    />
                  </label>
                  <div>
                    <p className="text-sm font-medium text-slate-600">Free bags by brand</p>
                    {!stockLoading && !anyStockAvailable ? (
                      <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-100">
                        No bags in stock right now — you cannot issue free bags.
                      </p>
                    ) : null}
                    <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {brands.map((b) => {
                        const available = stockByBrand[b.key] ?? 0;
                        const outOfStock = !stockLoading && available <= 0;
                        return (
                          <label key={b.key} className="block text-xs font-medium text-slate-600">
                            {b.label}
                            <span className="ml-1 font-normal text-slate-400">
                              {stockLoading ? '…' : outOfStock ? 'Out of stock' : `${available.toLocaleString()} in stock`}
                            </span>
                            <input
                              type="number"
                              min={0}
                              step={1}
                              value={form[`${b.key}Bags`]}
                              onChange={(e) => handleChange(`${b.key}Bags`, e.target.value)}
                              className={filterControl}
                              placeholder="0"
                              disabled={stockLoading || outOfStock}
                            />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : null}

              {promoTab === 'invoice_discount' ? (
                <>
                  <label className="block text-sm font-medium text-slate-600">
                    Invoice
                    <select
                      required
                      value={form.billId}
                      onChange={(e) => handleChange('billId', e.target.value)}
                      className={filterControl}
                      disabled={!form.customerId || billsLoading}
                    >
                      <option value="">
                        {!form.customerId
                          ? 'Select a customer first'
                          : billsLoading
                            ? 'Loading invoices…'
                            : customerBills.length === 0
                              ? 'No invoices for this customer'
                              : 'Select invoice'}
                      </option>
                      {customerBills.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.date} · {b.invoiceNumber || b.stockId || b.id} · {money(b.totalAmount)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium text-slate-600">Discount type</legend>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name="discountMode"
                        checked={form.discountMode === 'whole_invoice'}
                        onChange={() => handleChange('discountMode', 'whole_invoice')}
                      />
                      Amount for whole invoice (LKR)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name="discountMode"
                        checked={form.discountMode === 'per_bag'}
                        onChange={() => handleChange('discountMode', 'per_bag')}
                      />
                      Amount per bag (LKR)
                    </label>
                  </fieldset>
                  <label className="block text-sm font-medium text-slate-600">
                    {form.discountMode === 'per_bag' ? 'Discount per bag (LKR)' : 'Discount for invoice (LKR)'}
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      required
                      value={form.discountValue}
                      onChange={(e) => handleChange('discountValue', e.target.value)}
                      className={filterControl}
                      placeholder="0.00"
                    />
                  </label>
                  {selectedBill && previewDiscount > 0 ? (
                    <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-100">
                      Total discount: {money(previewDiscount)} · Invoice total: {money(selectedBill.totalAmount)} ·
                      Customer owes after discount: {money(Math.max(0, (Number(selectedBill.totalAmount) || 0) - previewDiscount))}
                    </p>
                  ) : null}
                </>
              ) : null}

              {promoTab === 'target_promotion' ? (
                <label className="block text-sm font-medium text-slate-600">
                  Promotion amount (LKR)
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    value={form.discountAmount}
                    onChange={(e) => handleChange('discountAmount', e.target.value)}
                    className={filterControl}
                    placeholder="Reward for target achievement"
                  />
                </label>
              ) : null}

              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="submit"
                  disabled={
                    saving ||
                    (promoTab === 'free_bags' && (stockLoading || !anyStockAvailable)) ||
                    (promoTab === 'invoice_discount' && (billsLoading || !form.billId))
                  }
                  className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/25 transition hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : editPromotion ? 'Save changes' : 'Save promotion'}
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <RowDetailModal
        open={!!detailRow}
        row={detailRow}
        variant="promotion"
        onClose={() => setDetailRow(null)}
        actions={
          detailRow?.id && canEditDetails() ? (
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => openPromotionEdit(detailRow)}
                className="w-full rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-800 ring-1 ring-indigo-100 hover:bg-indigo-100"
              >
                Edit promotion
              </button>
              <button
                type="button"
                disabled={deletingId === detailRow.id}
                onClick={() => handleDelete(detailRow)}
                className="w-full rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-800 ring-1 ring-rose-100 hover:bg-rose-100 disabled:opacity-50"
              >
                {deletingId === detailRow.id ? 'Deleting…' : 'Delete promotion'}
              </button>
            </div>
          ) : null
        }
      />
    </div>
  );
}
