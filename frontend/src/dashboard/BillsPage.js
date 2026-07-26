import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import { getUsername } from '../auth';
import { BRANDS } from './brandTheme';
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
  stickyFirstTd,
  stickyFirstThTransparent,
  stickyTheadTransparent,
  useTablePagination,
  modalPanelClass,
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

function emptyForm() {
  const f = {
    date: new Date().toISOString().slice(0, 10),
    customerId: '',
  };
  for (const b of BRANDS) {
    f[`${b.key}Bags`] = '';
    f[`${b.key}UnitPrice`] = '';
  }
  return f;
}

function formFromBill(bill, customers) {
  const name = String(bill.customerName ?? '').trim();
  const match = customers.find((c) => String(c.name ?? '').trim() === name);
  const f = {
    date: String(bill.date ?? '').trim() || new Date().toISOString().slice(0, 10),
    customerId: match?.id ?? '',
  };
  for (const b of BRANDS) {
    const bags = bill[`${b.key}Bags`];
    const price = bill[`${b.key}UnitPrice`];
    f[`${b.key}Bags`] = bags != null && bags !== '' ? String(bags) : '';
    f[`${b.key}UnitPrice`] = price != null && price !== '' ? String(price) : '';
  }
  return f;
}

function BillSaleFormFields({ form, customers, onChange }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-600 sm:col-span-2">
          Date
          <input
            type="date"
            required
            value={form.date}
            onChange={(e) => onChange('date', e.target.value)}
            className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
          />
        </label>
        <label className="block text-sm font-medium text-slate-600 sm:col-span-2">
          Customer
          <select
            required
            value={form.customerId}
            onChange={(e) => onChange('customerId', e.target.value)}
            className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35 disabled:cursor-not-allowed disabled:opacity-60"
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
      <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bags &amp; unit price (LKR)</p>
        <div className="mt-3 space-y-3">
          {BRANDS.map((b) => (
            <div key={b.key} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <span className="text-sm font-medium text-slate-800 sm:col-span-2 lg:col-span-1">{b.label}</span>
              <label className="text-xs text-slate-500">
                Bags
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={form[`${b.key}Bags`]}
                  onChange={(e) => onChange(`${b.key}Bags`, e.target.value)}
                  className="mt-0.5 w-full rounded-lg border-0 bg-white px-2 py-2 text-sm tabular-nums ring-1 ring-slate-200"
                />
              </label>
              <label className="text-xs text-slate-500">
                Price / bag
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={form[`${b.key}UnitPrice`]}
                  onChange={(e) => onChange(`${b.key}UnitPrice`, e.target.value)}
                  className="mt-0.5 w-full rounded-lg border-0 bg-white px-2 py-2 text-sm tabular-nums ring-1 ring-slate-200"
                />
              </label>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default function BillsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [detailBill, setDetailBill] = useState(null);
  const [editBill, setEditBill] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

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

  const stockOptions = useMemo(() => {
    const u = new Set();
    for (const r of rows) {
      const id = String(r.stockId ?? '').trim();
      if (id) u.add(id);
    }
    return [...u].sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (stockFilter && String(r.stockId ?? '').trim() !== stockFilter) return false;
      if (!inDateRange(r.date, dateFrom, dateTo)) return false;
      const bagParts = BRANDS.map((b) => String(r[`${b.key}Bags`] ?? ''));
      return rowMatchesQuery(search, [
        r.date,
        r.stockId,
        r.customerName,
        r.enteredBy,
        String(r.totalAmount ?? ''),
        ...bagParts,
      ]);
    });
  }, [rows, search, stockFilter, dateFrom, dateTo]);

  const pagination = useTablePagination(filteredRows.length, [search, stockFilter, dateFrom, dateTo]);
  const pagedRows = useMemo(
    () => filteredRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filteredRows, pagination.offset, pagination.pageSize]
  );

  const openAdd = () => {
    setSaveError(null);
    loadCustomers();
    setForm(emptyForm());
    setAddOpen(true);
  };

  const closeAdd = () => {
    setAddOpen(false);
    setSaveError(null);
  };

  const handleFormChange = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const buildBillBody = () => {
    const selected = customers.find((c) => c.id === form.customerId);
    if (!selected) return { error: 'Please select a customer from the list.' };
    const body = {
      date: form.date,
      customerName: String(selected.name || '').trim(),
    };
    for (const b of BRANDS) {
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
      closeAdd();
    } catch {
      setSaveError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  const closeBillEdit = () => {
    setEditBill(null);
    setSaveError(null);
  };

  const openBillEditFromDetail = () => {
    if (!detailBill) return;
    setSaveError(null);
    loadCustomers();
    setEditBill(detailBill);
    setDetailBill(null);
  };

  useEffect(() => {
    if (!editBill) return;
    setForm(formFromBill(editBill, customers));
  }, [editBill, customers]);

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
                ...BRANDS.slice(0, 4).map((b) => ({
                  label: b.label,
                  value: String(r[`${b.key}Bags`] ?? 0),
                })),
                { label: 'Total', value: money(r.totalAmount) },
              ]}
              onClick={() => setDetailBill(r)}
            />
          ))
        )}
      </div>
      <div className={`hidden sm:block ${scrollTableWrap}`}>
        <table className="w-full min-w-[960px] border-separate border-spacing-0 text-left text-sm">
          <thead className={stickyTheadTransparent}>
            <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className={`whitespace-nowrap bg-slate-50/95 px-3 py-3 align-bottom ${stickyFirstThTransparent}`}>
                Date
              </th>
              <th className="whitespace-nowrap bg-slate-50/95 px-3 py-3 align-bottom">Stock</th>
              <th className="whitespace-nowrap bg-slate-50/95 px-3 py-3 align-bottom">Customer</th>
              {BRANDS.map((b) => (
                <th key={b.key} className={`whitespace-nowrap px-2 py-2 text-center ${b.ledger.head}`}>
                  {b.label}
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
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  <LoadingSpinner />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  No credit bills yet. Use &quot;Record credit sale&quot; to add one.
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  No bills match your search or filters.
                </td>
              </tr>
            ) : (
              pagedRows.map((r) => {
                const rowLine = 'border-b border-slate-100/90';
                return (
                  <tr
                    key={r.id}
                    {...detailRowAttrs(() => setDetailBill(r))}
                    aria-label={`Credit bill ${r.customerName || ''}`}
                  >
                    <td
                      className={`whitespace-nowrap px-3 py-3 font-medium ${rowLine} bg-slate-50/70 tabular-nums ${stickyFirstTd}`}
                    >
                      {r.date}
                    </td>
                    <td
                      className={`whitespace-nowrap px-3 py-3 font-mono text-sm text-slate-800 ${rowLine} bg-slate-50/70`}
                    >
                      {r.stockId || '—'}
                    </td>
                    <td className={`max-w-[180px] px-3 py-3 font-medium text-slate-900 ${rowLine} bg-slate-50/70`}>
                      <span className="line-clamp-2">{r.customerName}</span>
                    </td>
                    {BRANDS.map((b) => (
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
          className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bills-add-title"
        >
          <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" aria-label="Close" onClick={closeAdd} />
          <div className={modalPanelClass}>
            <h2 id="bills-add-title" className="text-lg font-bold text-slate-900">
              Record credit sale
            </h2>
            <p className="mt-1 text-sm text-slate-500">Logged in as {getUsername() || '—'}</p>
            <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
              {saveError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{saveError}</p>
              ) : null}
              <BillSaleFormFields form={form} customers={customers} onChange={handleFormChange} />
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeAdd}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || customers.length === 0}
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save bill'}
                </button>
              </div>
            </form>
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
          <div className={modalPanelClass}>
            <h2 id="bills-edit-title" className="text-lg font-bold text-slate-900">
              Edit credit sale
            </h2>
            <p className="mt-1 text-sm text-slate-500">Logged in as {getUsername() || '—'}</p>
            <form className="mt-5 space-y-4" onSubmit={handleEditSubmit}>
              {saveError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{saveError}</p>
              ) : null}
              <BillSaleFormFields form={form} customers={customers} onChange={handleFormChange} />
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeBillEdit}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || customers.length === 0}
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md disabled:opacity-60"
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
          <button
            type="button"
            onClick={openBillEditFromDetail}
            className="mt-4 w-full rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-800 ring-1 ring-indigo-100 hover:bg-indigo-100"
          >
            Edit bill
          </button>
        }
      />
    </div>
  );
}
