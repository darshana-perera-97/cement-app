import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getApiBase } from '../apiBase';
import { authFetch, getUsername, isAdmin } from '../auth';
import { useBagProducts } from './BagProductsContext';
import { formatBrandLabel } from './brandTheme';
import { downloadReturnInvoiceForRow } from './returnInvoicePdf';
import { downloadReturnsTablePdf } from './returnsTablePdf';
import {
  LoadingSpinner,
  MobileRowCard,
  ModalBackdrop,
  TableFiltersBar,
  TablePaginationBar,
  filterControl,
  filterLabel,
  filterLabelNarrow,
  inDateRange,
  mobileCardList,
  modalPanelClass2xl,
  rowMatchesQuery,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
  useTablePagination,
} from './tableToolbar';
import RowDetailModal, { detailRowAttrs } from './RowDetailModal';

const apiBase = getApiBase();

const TABS = [
  { id: 'item_return', label: 'Return items' },
  { id: 'damage', label: 'Damage items', adminOnly: true },
  { id: 'price_change', label: 'Price changes', adminOnly: true },
];

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function normalizeCustomerName(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function kindLabel(row) {
  const kind = String(row?.kind ?? '').trim();
  if (kind === 'damage') return 'Damage items';
  if (kind === 'price_change') {
    return String(row.direction ?? '').trim() === 'up' ? 'Price increase' : 'Price drop';
  }
  const settlement = String(row.settlement ?? '').trim();
  if (settlement === 'damage') return 'Damage items';
  if (settlement === 'cash') return 'Cash return';
  return 'Return invoice';
}

function rowTypeFilterValue(row) {
  const kind = String(row?.kind ?? '').trim();
  if (kind === 'price_change') return 'price_change';
  if (kind === 'damage' || String(row.settlement ?? '').trim() === 'damage') return 'damage';
  return 'item_return';
}

function invoiceRef(row) {
  return (
    row.returnInvoiceNumber ||
    row.damageInvoiceNumber ||
    row.invoiceNumber ||
    '—'
  );
}

function totalBags(row, brands) {
  return brands.reduce((s, b) => s + (Number(row[`${b.key}Bags`]) || 0), 0);
}

function emptyBagFields(brands) {
  const f = {};
  for (const b of brands) f[`${b.key}Bags`] = '';
  return f;
}

function emptyForm(brands) {
  return {
    date: new Date().toISOString().slice(0, 10),
    customerId: '',
    billId: '',
    settlement: 'credit_note',
    direction: 'down',
    amount: '',
    note: '',
    ...emptyBagFields(brands),
  };
}

function bagsOnBill(bill, key) {
  return Math.max(0, Math.floor(Number(bill?.[`${key}Bags`]) || 0));
}

function alreadyReturnedBags(rows, billId, key) {
  let n = 0;
  for (const row of rows) {
    if (String(row.kind ?? '') !== 'item_return') continue;
    if (String(row.billId ?? '') !== String(billId ?? '')) continue;
    n += Math.max(0, Math.floor(Number(row[`${key}Bags`]) || 0));
  }
  return n;
}

export default function ReturnsPage() {
  const { brands } = useBagProducts();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [bills, setBills] = useState([]);
  const [stockSummary, setStockSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('item_return');
  const [form, setForm] = useState(() => emptyForm([]));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [detailRow, setDetailRow] = useState(null);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [pdfBusyId, setPdfBusyId] = useState(null);
  const [tablePdfBusy, setTablePdfBusy] = useState(false);

  const admin = isAdmin();
  const visibleTabs = useMemo(() => TABS.filter((t) => !t.adminOnly || admin), [admin]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [retRes, custRes, billRes] = await Promise.all([
        fetch(`${apiBase}/api/returns`),
        fetch(`${apiBase}/api/customers`),
        fetch(`${apiBase}/api/bills`),
      ]);
      if (!retRes.ok) throw new Error('Failed to load returns');
      const retData = await retRes.json();
      setRows(Array.isArray(retData) ? retData : []);
      if (custRes.ok) {
        const custData = await custRes.json();
        setCustomers(Array.isArray(custData) ? custData : []);
      }
      if (billRes.ok) {
        const billData = await billRes.json();
        setBills(Array.isArray(billData) ? billData : []);
      }
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

  const loadStock = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/stocks/summary`);
      if (!res.ok) throw new Error('Failed to load stock');
      setStockSummary(await res.json());
    } catch {
      setStockSummary(null);
    }
  }, []);

  const openModal = (tabId = 'item_return') => {
    const allowed = visibleTabs.some((t) => t.id === tabId) ? tabId : 'item_return';
    setActiveTab(allowed);
    setForm(emptyForm(brands));
    setSaveError(null);
    setModalOpen(true);
    if (allowed === 'damage') loadStock();
  };

  useEffect(() => {
    const next = searchParams.get('new');
    if (!next) return;
    openModal(next);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('new');
    setSearchParams(nextParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once from query
  }, [searchParams]);

  const closeModal = () => {
    setModalOpen(false);
    setSaveError(null);
  };

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === form.customerId) || null,
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

  const returnPreview = useMemo(() => {
    if (!selectedBill) return { amount: 0, bags: 0 };
    let amount = 0;
    let bags = 0;
    for (const b of brands) {
      const qty = Math.floor(Number(form[`${b.key}Bags`]) || 0);
      if (qty <= 0) continue;
      bags += qty;
      amount += qty * (Number(selectedBill[`${b.key}UnitPrice`]) || 0);
    }
    return { amount: Math.round(amount * 100) / 100, bags };
  }, [selectedBill, form, brands]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (!inDateRange(r.date, dateFrom, dateTo)) return false;
      if (kindFilter && rowTypeFilterValue(r) !== kindFilter) return false;
      return rowMatchesQuery(search, [
        r.date,
        r.customerName,
        r.invoiceNumber,
        r.returnInvoiceNumber,
        r.damageInvoiceNumber,
        r.note,
        r.enteredBy,
        kindLabel(r),
        String(r.amount ?? ''),
      ]);
    });
  }, [rows, search, dateFrom, dateTo, kindFilter]);

  const pagination = useTablePagination(filteredRows.length, [search, dateFrom, dateTo, kindFilter]);
  const pagedRows = useMemo(
    () => filteredRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filteredRows, pagination.offset, pagination.pageSize],
  );

  const handleChange = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const switchTab = (tabId) => {
    setActiveTab(tabId);
    setForm((f) => ({ ...emptyForm(brands), date: f.date, customerId: f.customerId, note: f.note }));
    setSaveError(null);
    if (tabId === 'damage') loadStock();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const username = getUsername();
    if (!username) {
      setSaveError('You need to be signed in with a username.');
      return;
    }
    if ((activeTab !== 'item_return' || form.settlement === 'damage') && !admin) {
      setSaveError('Only an admin can record damage items or price changes.');
      return;
    }

    const payload = {
      kind: activeTab,
      date: form.date,
      note: String(form.note || '').trim(),
      enteredBy: username,
      customerId: form.customerId || undefined,
    };

    if (activeTab === 'item_return') {
      if (!form.customerId) {
        setSaveError('Select a shop.');
        return;
      }
      if (!form.billId) {
        setSaveError('Select an invoice.');
        return;
      }
      if (returnPreview.bags <= 0 || returnPreview.amount <= 0) {
        setSaveError('Enter bags to return from this invoice.');
        return;
      }
      payload.billId = form.billId;
      payload.settlement = form.settlement;
      for (const b of brands) payload[`${b.key}Bags`] = form[`${b.key}Bags`];
    } else if (activeTab === 'damage') {
      const any = brands.some((b) => Math.floor(Number(form[`${b.key}Bags`]) || 0) > 0);
      if (!any) {
        setSaveError('Enter bags to send to damage items.');
        return;
      }
      for (const b of brands) payload[`${b.key}Bags`] = form[`${b.key}Bags`];
    } else {
      if (!form.customerId) {
        setSaveError('Select a shop.');
        return;
      }
      const amt = Number(form.amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        setSaveError('Enter a price change amount greater than zero.');
        return;
      }
      payload.direction = form.direction;
      payload.amount = form.amount;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const res = await authFetch(`${apiBase}/api/returns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || 'Save failed');
        return;
      }
      await load();
      closeModal();
      if (data.returnInvoiceNumber || data.damageInvoiceNumber) {
        try {
          await downloadReturnInvoiceForRow(data);
        } catch {
          /* list still has a download action */
        }
      }
    } catch {
      setSaveError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = async (row) => {
    if (!row?.id) return;
    setPdfBusyId(row.id);
    try {
      await downloadReturnInvoiceForRow(row);
    } catch {
      alert('Could not build the invoice PDF.');
    } finally {
      setPdfBusyId(null);
    }
  };

  const handleDownloadTablePdf = () => {
    if (!admin) return;
    setTablePdfBusy(true);
    try {
      downloadReturnsTablePdf({
        rows: filteredRows,
        brands,
        filters: {
          search,
          dateFrom,
          dateTo,
          kindFilter,
        },
      });
    } catch {
      alert('Could not build the returns PDF.');
    } finally {
      setTablePdfBusy(false);
    }
  };

  const canDownload = (row) =>
    Boolean(row?.returnInvoiceNumber || row?.damageInvoiceNumber);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">
          Record invoice returns, damage write-offs, and shop price changes. Ledger and stock update when you save.
        </p>
        <button
          type="button"
          onClick={() => openModal('item_return')}
          className="inline-flex w-full shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03] sm:w-auto"
        >
          New return
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
            ? `Showing ${filteredRows.length} of ${rows.length} record${rows.length === 1 ? '' : 's'}`
            : null
        }
      >
        <label className={filterLabel}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Shop, invoice, note…"
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
          Type
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className={filterControl}>
            <option value="">All types</option>
            <option value="item_return">Return items</option>
            <option value="damage">Damage items</option>
            <option value="price_change">Price changes</option>
          </select>
        </label>
        {admin ? (
          <button
            type="button"
            onClick={handleDownloadTablePdf}
            disabled={loading || !!error || tablePdfBusy || filteredRows.length === 0}
            className="inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:self-end"
          >
            {tablePdfBusy ? 'Preparing…' : 'Download PDF'}
          </button>
        ) : null}
      </TableFiltersBar>

      <div className="space-y-3">
        <div className={mobileCardList}>
          {loading ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              <LoadingSpinner />
            </p>
          ) : rows.length === 0 ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              No returns yet. Use &quot;New return&quot; to record one.
            </p>
          ) : filteredRows.length === 0 ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              No rows match your search or filters.
            </p>
          ) : (
            pagedRows.map((r) => (
              <MobileRowCard
                key={r.id}
                title={r.customerName || kindLabel(r)}
                subtitle={r.date}
                onClick={() => setDetailRow(r)}
                fields={[
                  { label: 'Type', value: kindLabel(r) },
                  { label: 'Invoice', value: invoiceRef(r) },
                  { label: 'Amount', value: Number(r.amount) > 0 ? money(r.amount) : '—' },
                  { label: 'Bags', value: totalBags(r, brands) || '—' },
                  { label: 'Note', value: r.note || '—' },
                ]}
              />
            ))
          )}
        </div>
        <div className={`hidden sm:block ${scrollTableWrap}`}>
          <table className="w-full min-w-[900px] data-table border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
                <th className="px-4 py-3">Shop</th>
                <th className="whitespace-nowrap px-4 py-3">Type</th>
                <th className="whitespace-nowrap px-4 py-3 font-mono">Invoice</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Bags</th>
                <th className="px-4 py-3">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    No returns yet. Use &quot;New return&quot; to record one.
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    No rows match your search or filters.
                  </td>
                </tr>
              ) : (
                pagedRows.map((r) => (
                  <tr
                    key={r.id}
                    {...detailRowAttrs(() => setDetailRow(r), 'hover:bg-slate-50/80')}
                    aria-label={`${kindLabel(r)} ${r.customerName || ''}`}
                  >
                    <td className={`whitespace-nowrap px-4 py-3 tabular-nums ${stickyFirstTd}`}>{r.date}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{r.customerName || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">{kindLabel(r)}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-sm">{invoiceRef(r)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium text-slate-900">
                      {Number(r.amount) > 0 ? money(r.amount) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-indigo-800">
                      {totalBags(r, brands) || '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.enteredBy || '—'}</td>
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
        open={Boolean(detailRow)}
        row={detailRow}
        onClose={() => setDetailRow(null)}
        title={detailRow ? kindLabel(detailRow) : 'Return'}
        subtitle={detailRow?.customerName || detailRow?.date}
        actions={
          detailRow && canDownload(detailRow) ? (
            <button
              type="button"
              onClick={() => handleDownload(detailRow)}
              disabled={pdfBusyId === detailRow.id}
              className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {pdfBusyId === detailRow.id ? 'Preparing…' : 'Download invoice'}
            </button>
          ) : null
        }
      />

      {modalOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="returns-modal-title"
        >
          <ModalBackdrop onClose={closeModal} />
          <div className={`${modalPanelClass2xl} max-h-[90vh] overflow-y-auto`}>
            <h2 id="returns-modal-title" className="text-lg font-bold text-slate-900">
              New return
            </h2>
            <p className="mt-1 text-sm text-slate-500">Logged in as {getUsername() || '—'}.</p>

            <div className="mt-4 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1" role="tablist">
              {visibleTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  onClick={() => switchTab(tab.id)}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition sm:text-sm ${
                    activeTab === tab.id
                      ? 'bg-white text-indigo-800 shadow-sm ring-1 ring-slate-200'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
              {saveError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{saveError}</p>
              ) : null}

              <label className="block text-sm font-medium text-slate-600">
                Date
                <input
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => handleChange('date', e.target.value)}
                  className={filterControl}
                />
              </label>

              {activeTab !== 'damage' ? (
                <label className="block text-sm font-medium text-slate-600">
                  Shop
                  <select
                    required
                    value={form.customerId}
                    onChange={(e) => {
                      handleChange('customerId', e.target.value);
                      handleChange('billId', '');
                    }}
                    className={filterControl}
                  >
                    <option value="">Select shop</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="block text-sm font-medium text-slate-600">
                  Shop (optional)
                  <select
                    value={form.customerId}
                    onChange={(e) => handleChange('customerId', e.target.value)}
                    className={filterControl}
                  >
                    <option value="">Warehouse / no shop</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {activeTab === 'item_return' ? (
                <>
                  <label className="block text-sm font-medium text-slate-600">
                    Invoice
                    <select
                      required
                      value={form.billId}
                      onChange={(e) => handleChange('billId', e.target.value)}
                      className={filterControl}
                      disabled={!selectedCustomer}
                    >
                      <option value="">{selectedCustomer ? 'Select invoice' : 'Select a shop first'}</option>
                      {customerBills.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.invoiceNumber || b.id} · {b.date} · {money(b.totalAmount)}
                        </option>
                      ))}
                    </select>
                  </label>

                  {selectedBill ? (
                    <div className="space-y-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bags to return</p>
                      {brands.map((b) => {
                        const sold = bagsOnBill(selectedBill, b.key);
                        const used = alreadyReturnedBags(rows, selectedBill.id, b.key);
                        const remaining = Math.max(0, sold - used);
                        if (sold <= 0) return null;
                        return (
                          <label key={b.key} className="block text-sm font-medium text-slate-600">
                            {formatBrandLabel(b) || b.label}{' '}
                            <span className="font-normal text-slate-400">
                              ({remaining} of {sold} left)
                            </span>
                            <input
                              type="number"
                              min="0"
                              max={remaining}
                              step="1"
                              value={form[`${b.key}Bags`]}
                              onChange={(e) => handleChange(`${b.key}Bags`, e.target.value)}
                              className={filterControl}
                            />
                          </label>
                        );
                      })}
                      <p className="text-sm font-semibold text-slate-800">
                        Credit {money(returnPreview.amount)} · {returnPreview.bags} bag
                        {returnPreview.bags === 1 ? '' : 's'}
                      </p>
                    </div>
                  ) : null}

                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium text-slate-600">Settle as</legend>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name="settlement"
                        checked={form.settlement === 'credit_note'}
                        onChange={() => handleChange('settlement', 'credit_note')}
                      />
                      Return invoice (download credit note, update ledger and stock)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name="settlement"
                        checked={form.settlement === 'cash'}
                        onChange={() => handleChange('settlement', 'cash')}
                      />
                      Return cash (credit customer and cashier, update stock)
                    </label>
                    {admin ? (
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="radio"
                          name="settlement"
                          checked={form.settlement === 'damage'}
                          onChange={() => handleChange('settlement', 'damage')}
                        />
                        Damage items (credit shop, add bags to Damages stock)
                      </label>
                    ) : null}
                    {form.settlement === 'damage' ? (
                      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-100">
                        Bags leave this invoice and go into Damages as one stock item. They are not added back to
                        sellable brand stock.
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500">
                        Returned bags are added back to the matching brand stock.
                      </p>
                    )}
                  </fieldset>
                </>
              ) : null}

              {activeTab === 'damage' ? (
                <div className="space-y-2 rounded-xl bg-amber-50/70 p-3 ring-1 ring-amber-100">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                    Move bags from stock to Damages
                  </p>
                  {brands
                    .map((b) => {
                      const available = Math.max(
                        0,
                        Math.floor(
                          Number(
                            (stockSummary?.brands || []).find((s) => s.key === b.key)?.availableForRequest ??
                              (stockSummary?.brands || []).find((s) => s.key === b.key)?.bags,
                          ) || 0,
                        ),
                      );
                      return { b, available };
                    })
                    .filter(({ b, available }) => available > 0 || Number(form[`${b.key}Bags`]) > 0)
                    .map(({ b, available }) => (
                      <label key={b.key} className="block text-sm font-medium text-slate-600">
                        {formatBrandLabel(b) || b.label}{' '}
                        <span className="font-normal text-slate-400">({available} in stock)</span>
                        <input
                          type="number"
                          min="0"
                          max={available}
                          step="1"
                          value={form[`${b.key}Bags`]}
                          onChange={(e) => handleChange(`${b.key}Bags`, e.target.value)}
                          className={filterControl}
                        />
                      </label>
                    ))}
                  {!(stockSummary?.brands || []).some((s) => Number(s.availableForRequest ?? s.bags) > 0) ? (
                    <p className="text-sm text-amber-800">No sellable bags in stock to write off.</p>
                  ) : null}
                </div>
              ) : null}

              {activeTab === 'price_change' ? (
                <>
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium text-slate-600">Change</legend>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name="direction"
                        checked={form.direction === 'down'}
                        onChange={() => handleChange('direction', 'down')}
                      />
                      Price drop (credit shop ledger)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name="direction"
                        checked={form.direction === 'up'}
                        onChange={() => handleChange('direction', 'up')}
                      />
                      Price increase (charge shop ledger)
                    </label>
                  </fieldset>
                  <label className="block text-sm font-medium text-slate-600">
                    Amount (LKR)
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={form.amount}
                      onChange={(e) => handleChange('amount', e.target.value)}
                      className={filterControl}
                    />
                  </label>
                </>
              ) : null}

              <label className="block text-sm font-medium text-slate-600">
                Note
                <input
                  type="text"
                  value={form.note}
                  onChange={(e) => handleChange('note', e.target.value)}
                  className={filterControl}
                  placeholder="Optional"
                />
              </label>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
