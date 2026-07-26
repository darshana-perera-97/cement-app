import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiBase } from '../apiBase';
import { getUsername } from '../auth';
import {
  LoadingSpinner,
  TableFiltersBar,
  TablePaginationBar,
  filterControl,
  filterLabel,
  filterLabelNarrow,
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

const emptyForm = () => ({
  name: '',
  location: '',
  contactNumber: '',
  email: '',
  pastBill: '',
});

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

export default function CustomersPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [search, setSearch] = useState('');
  const [dueFilter, setDueFilter] = useState('all');
  const [detailCustomer, setDetailCustomer] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/customers`);
      if (!res.ok) throw new Error('Failed to load customers');
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || 'Could not load data');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    load();
  }, [load]);

  const today = useMemo(() => todayYmdLocal(), []);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const overdue = r.dueDate && r.dueDate < today;
      if (dueFilter === 'overdue' && !overdue) return false;
      if (dueFilter === 'current' && overdue) return false;
      return rowMatchesQuery(search, [
        r.name,
        r.location,
        r.contactNumber,
        r.email,
        r.dueDate,
        String(r.remainingAmount ?? ''),
      ]);
    });
  }, [rows, search, dueFilter, today]);

  const pagination = useTablePagination(filteredRows.length, [search, dueFilter]);
  const pagedRows = useMemo(
    () => filteredRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filteredRows, pagination.offset, pagination.pageSize]
  );

  const openModal = () => {
    setForm(emptyForm());
    setSaveError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSaveError(null);
  };

  const handleFormChange = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const username = getUsername();
    if (!username) {
      setSaveError('You need to be signed in with a username.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${apiBase}/api/customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addedBy: username,
          name: form.name.trim(),
          location: form.location.trim(),
          contactNumber: form.contactNumber.trim(),
          email: form.email.trim(),
          pastBill: form.pastBill,
        }),
      });
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

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">Manage customers, opening balances, and amounts owed.</p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={openModal}
            className="inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03] sm:w-auto"
          >
            Add customer
          </button>
        </div>
      </div>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      <TableFiltersBar
        hint={
          !loading && rows.length > 0
            ? `Showing ${filteredRows.length} of ${rows.length} customer${rows.length === 1 ? '' : 's'}`
            : null
        }
      >
        <label className={filterLabel}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, location, phone, email, due date…"
            className={filterControl}
          />
        </label>
        <label className={filterLabelNarrow}>
          Due status
          <select
            value={dueFilter}
            onChange={(e) => setDueFilter(e.target.value)}
            className={filterControl}
          >
            <option value="all">All</option>
            <option value="overdue">Overdue only</option>
            <option value="current">Not overdue</option>
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
            No customers yet. Use &quot;Add customer&quot; to create a record.
          </p>
        ) : filteredRows.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
            No customers match your search or filters.
          </p>
        ) : (
          pagedRows.map((r) => {
            const overdue = r.dueDate && r.dueDate < today;
            return (
              <MobileRowCard
                key={r.id}
                title={r.name}
                subtitle={[r.location, r.contactNumber, r.email].filter(Boolean).join(' · ') || undefined}
                badge={
                  overdue ? (
                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-800">
                      Overdue
                    </span>
                  ) : null
                }
                fields={[
                  { label: 'Remaining', value: money(r.remainingAmount) },
                  { label: 'Due date', value: r.dueDate || '—' },
                ]}
                actions={
                  <>
                    <button
                      type="button"
                      onClick={() => setDetailCustomer(r)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                    >
                      Details
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/dashboard/customers/${encodeURIComponent(r.id)}`)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800"
                    >
                      View account
                    </button>
                  </>
                }
              />
            );
          })
        )}
      </div>
      <div className={`hidden sm:block ${scrollTableWrap}`}>
        <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm">
          <thead className={stickyThead}>
            <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className={`px-4 py-3 ${stickyFirstTh}`}>Customer name</th>
              <th className="px-4 py-3 text-right">Remaining amount</th>
              <th className="whitespace-nowrap px-4 py-3">Due date</th>
              <th className="whitespace-nowrap px-4 py-3 text-center"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                  <LoadingSpinner />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                  No customers yet. Use &quot;Add customer&quot; to create a record.
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                  No customers match your search or filters.
                </td>
              </tr>
            ) : (
              pagedRows.map((r) => {
                const overdue = r.dueDate && r.dueDate < today;
                return (
                  <tr
                    key={r.id}
                    {...detailRowAttrs(
                      () => setDetailCustomer(r),
                      overdue ? 'bg-rose-50/50 hover:bg-rose-50/80' : 'hover:bg-slate-50/80',
                    )}
                    aria-label={`Customer ${r.name || ''}`}
                  >
                    <td className={`px-4 py-3 ${stickyFirstTd}`}>
                      <p className="font-semibold text-slate-900">{r.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {r.location}
                        {r.contactNumber ? ` · ${r.contactNumber}` : ''}
                        {r.email ? ` · ${r.email}` : ''}
                      </p>
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-semibold tabular-nums ${
                        overdue ? 'text-rose-800' : 'text-slate-900'
                      }`}
                    >
                      {money(r.remainingAmount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                      <span className={overdue ? 'font-semibold text-rose-800' : 'text-slate-800'}>
                        {r.dueDate || '—'}
                      </span>
                      {overdue ? (
                        <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-800">
                          Overdue
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/dashboard/customers/${encodeURIComponent(r.id)}`);
                        }}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800"
                      >
                        View account
                      </button>
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
          aria-labelledby="customers-modal-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            aria-label="Close"
            onClick={closeModal}
          />
          <div className={modalPanelClass}>
            <h2 id="customers-modal-title" className="text-lg font-bold text-slate-900">
              Add customer
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Recorded as user: {getUsername() || '—'}. Past bill sets the opening balance to collect.
            </p>
            <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
              {saveError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">
                  {saveError}
                </p>
              ) : null}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-600 sm:col-span-2">
                Customer name
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => handleFormChange('name', e.target.value)}
                  className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                  placeholder="e.g. Perera Hardware"
                  autoComplete="organization"
                />
              </label>
              <label className="block text-sm font-medium text-slate-600">
                Location
                <input
                  type="text"
                  required
                  value={form.location}
                  onChange={(e) => handleFormChange('location', e.target.value)}
                  className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                  placeholder="Town or address"
                  autoComplete="street-address"
                />
              </label>
              <label className="block text-sm font-medium text-slate-600">
                Contact number
                <input
                  type="tel"
                  required
                  value={form.contactNumber}
                  onChange={(e) => handleFormChange('contactNumber', e.target.value)}
                  className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                  placeholder="e.g. 077 123 4567"
                  autoComplete="tel"
                />
              </label>
              <label className="block text-sm font-medium text-slate-600 sm:col-span-2">
                Email
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => handleFormChange('email', e.target.value)}
                  className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                  placeholder="e.g. shop@example.com"
                  autoComplete="email"
                />
              </label>
              <label className="block text-sm font-medium text-slate-600 sm:col-span-2">
                Past bill (amount to be paid)
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  required
                  value={form.pastBill}
                  onChange={(e) => handleFormChange('pastBill', e.target.value)}
                  className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm tabular-nums ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                  placeholder="0.00"
                />
              </label>
              </div>
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <RowDetailModal open={!!detailCustomer} row={detailCustomer} variant="customer" onClose={() => setDetailCustomer(null)} />
    </div>
  );
}
