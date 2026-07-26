import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getApiBase } from '../apiBase';
import { getUsername } from '../auth';
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
import { getPaymentCheques } from './paymentCheques';

const apiBase = getApiBase();

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

let chequeKeySeq = 0;
function newChequeLine(overrides = {}) {
  chequeKeySeq += 1;
  return {
    key: `chq-${chequeKeySeq}`,
    id: '',
    amount: '',
    chequeDate: todayYmdLocal(),
    chequeNumber: '',
    chequeDeposited: false,
    ...overrides,
  };
}

const emptyForm = () => ({
  customerId: '',
  billNumber: '',
  cashAmount: '',
  cheques: [newChequeLine()],
  date: todayYmdLocal(),
  note: '',
});

function formFromPayment(payment) {
  const chequeRows = getPaymentCheques(payment);
  const cheques =
    chequeRows.length > 0
      ? chequeRows.map((c) =>
          newChequeLine({
            id: c.id || '',
            amount: String(c.amount),
            chequeDate: c.chequeDate || todayYmdLocal(),
            chequeNumber: c.chequeNumber,
            chequeDeposited: c.chequeDeposited,
          }),
        )
      : [newChequeLine()];
  const billDigits = String(payment.billNumber ?? '').replace(/\D/g, '');
  const billNumber = billDigits ? String(parseInt(billDigits, 10)) : '';
  return {
    customerId: payment.customerId || '',
    billNumber,
    cashAmount: payment.cashAmount != null && payment.cashAmount !== '' ? String(payment.cashAmount) : '',
    cheques,
    date: payment.date || todayYmdLocal(),
    note: payment.note || '',
  };
}

export default function PaymentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const appliedCustomerPrefill = useRef(false);
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editPayment, setEditPayment] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [detailPayment, setDetailPayment] = useState(null);

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
      const res = await fetch(`${apiBase}/api/payments`);
      if (!res.ok) throw new Error('Failed to load payments');
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
    if (appliedCustomerPrefill.current) return;
    const customerId = searchParams.get('customerId')?.trim();
    if (!customerId) return;
    appliedCustomerPrefill.current = true;
    setCustomerFilter(customerId);
    if (searchParams.get('record') === '1') {
      setForm({ ...emptyForm(), customerId });
      setSaveError(null);
      setModalOpen(true);
    }
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (!inDateRange(r.date, dateFrom, dateTo)) return false;
      if (customerFilter && r.customerId !== customerFilter) return false;
      if (
        !rowMatchesQuery(search, [
          r.date,
          r.billNumber,
          r.customerName,
          r.note,
          r.recordedBy,
          String(r.amount),
          ...getPaymentCheques(r).flatMap((c) => [c.chequeDate, c.chequeNumber]),
        ])
      ) {
        return false;
      }
      return true;
    });
  }, [rows, search, dateFrom, dateTo, customerFilter]);

  const pagination = useTablePagination(filteredRows.length, [
    search,
    dateFrom,
    dateTo,
    customerFilter,
  ]);
  const pagedRows = useMemo(
    () => filteredRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filteredRows, pagination.offset, pagination.pageSize]
  );

  const openModal = (prefillCustomerId = '') => {
    setEditPayment(null);
    setForm({ ...emptyForm(), customerId: prefillCustomerId || '' });
    setSaveError(null);
    loadCustomers();
    setModalOpen(true);
  };

  const openPaymentEdit = (payment) => {
    if (!payment?.id) return;
    setSaveError(null);
    loadCustomers();
    setEditPayment(payment);
    setForm(formFromPayment(payment));
    setDetailPayment(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditPayment(null);
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

  const handleChequeChange = (key, field, value) => {
    setForm((f) => ({
      ...f,
      cheques: f.cheques.map((c) => (c.key === key ? { ...c, [field]: value } : c)),
    }));
  };

  const addChequeLine = () => {
    setForm((f) => ({ ...f, cheques: [...f.cheques, newChequeLine()] }));
  };

  const removeChequeLine = (key) => {
    setForm((f) => {
      const next = f.cheques.filter((c) => c.key !== key);
      return { ...f, cheques: next.length > 0 ? next : [newChequeLine()] };
    });
  };

  const chequeTotalPreview = form.cheques.reduce((s, c) => s + (Number(c.amount) || 0), 0);

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
    if (!form.billNumber || form.billNumber.length < 1) {
      setSaveError('Enter a bill number (1–3 digits, e.g. 001).');
      return;
    }
    const cash = Number(form.cashAmount) || 0;
    const chequeLines = [];
    for (let i = 0; i < form.cheques.length; i++) {
      const line = form.cheques[i];
      if (line.chequeDeposited) {
        const amount = Number(line.amount) || 0;
        if (amount <= 0) continue;
        const entry = {
          amount,
          chequeDate: line.chequeDate,
          chequeNumber: String(line.chequeNumber).trim(),
        };
        if (line.id) entry.id = line.id;
        chequeLines.push(entry);
        continue;
      }
      const amount = Number(line.amount) || 0;
      if (amount <= 0) continue;
      if (!line.chequeDate || !/^\d{4}-\d{2}-\d{2}$/.test(line.chequeDate)) {
        setSaveError(`Cheque ${i + 1}: enter a valid cheque date.`);
        return;
      }
      if (!String(line.chequeNumber).trim()) {
        setSaveError(`Cheque ${i + 1}: enter a cheque number.`);
        return;
      }
      const entry = {
        amount,
        chequeDate: line.chequeDate,
        chequeNumber: String(line.chequeNumber).trim(),
      };
      if (line.id) entry.id = line.id;
      chequeLines.push(entry);
    }
    const chequeTotal = chequeLines.reduce((s, c) => s + c.amount, 0);
    if (cash <= 0 && chequeTotal <= 0) {
      setSaveError('Enter a cash amount and/or at least one cheque so the total is greater than 0.');
      return;
    }
    const padBill = String(parseInt(form.billNumber, 10)).padStart(3, '0');
    if (rows.some((r) => String(r.billNumber || '') === padBill && r.id !== editPayment?.id)) {
      setSaveError('This bill number is already used.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        customerId: form.customerId,
        billNumber: form.billNumber,
        cashAmount: cash,
        cheques: chequeLines,
        date: form.date,
        note: form.note.trim(),
      };
      const isEdit = !!editPayment?.id;
      const res = await fetch(
        isEdit ? `${apiBase}/api/payments/${encodeURIComponent(editPayment.id)}` : `${apiBase}/api/payments`,
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            isEdit ? { ...payload, updatedBy: username } : { ...payload, recordedBy: username },
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

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">Record cash and cheque payments against customer balances.</p>
        <button
          type="button"
          onClick={openModal}
          className="inline-flex w-full shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03] sm:w-auto"
        >
          Record payment
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
            ? `Showing ${filteredRows.length} of ${rows.length} payment${rows.length === 1 ? '' : 's'}`
            : null
        }
      >
        <label className={filterLabel}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Customer, bill #, note, amount…"
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
            No payments yet. Record one to update customer balances.
          </p>
        ) : filteredRows.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
            No payments match your search or filters.
          </p>
        ) : (
          pagedRows.map((r) => (
            <MobileRowCard
              key={r.id}
              title={r.customerName || '—'}
              subtitle={`${r.date || '—'} · Bill #${r.billNumber || '—'}`}
              fields={[
                { label: 'Amount', value: `−${money(r.amount)}` },
                { label: 'Recorded by', value: r.recordedBy || '—' },
              ]}
              actions={
                <>
                  <button
                    type="button"
                    onClick={() => setDetailPayment(r)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                  >
                    Details
                  </button>
                  {r.customerId ? (
                    <Link
                      to={`/dashboard/customers/${encodeURIComponent(r.customerId)}`}
                      className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                    >
                      Customer
                    </Link>
                  ) : null}
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
              <th className="whitespace-nowrap px-4 py-3 font-mono">Bill #</th>
              <th className="px-4 py-3">Customer</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
              <th className="whitespace-nowrap px-4 py-3">Recorded by</th>
              <th className="whitespace-nowrap px-4 py-3 text-center"> </th>
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
                  No payments yet. Record one to update customer balances.
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  No payments match your search or filters.
                </td>
              </tr>
            ) : (
              pagedRows.map((r) => (
                <tr
                  key={r.id}
                  {...detailRowAttrs(() => setDetailPayment(r), 'hover:bg-slate-50/80')}
                  aria-label={`Payment ${r.billNumber || r.id || ''}`}
                >
                  <td className={`whitespace-nowrap px-4 py-3 tabular-nums ${stickyFirstTd}`}>{r.date}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-sm font-semibold tabular-nums text-slate-800">
                    {r.billNumber || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{r.customerName || '—'}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-emerald-700">
                    −{money(r.amount)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.recordedBy || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <Link
                      to={`/dashboard/customers/${encodeURIComponent(r.customerId)}`}
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Customer
                    </Link>
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

      {modalOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="payments-modal-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            aria-label="Close"
            onClick={closeModal}
          />
          <div className={modalPanelClass}>
            <h2 id="payments-modal-title" className="text-lg font-bold text-slate-900">
              {editPayment ? 'Edit payment' : 'Record payment'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Stored in payments.json. Logged in as {getUsername() || '—'}.
            </p>
            <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
              {saveError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{saveError}</p>
              ) : null}
              <label className="block text-sm font-medium text-slate-600">
                Customer
                <select
                  required
                  value={form.customerId}
                  onChange={(e) => handleChange('customerId', e.target.value)}
                  className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                  disabled={customers.length === 0}
                >
                  <option value="">{customers.length === 0 ? 'No customers yet' : 'Select customer…'}</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-600">
                Bill number
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  required
                  maxLength={3}
                  value={form.billNumber}
                  onChange={(e) => handleChange('billNumber', e.target.value)}
                  className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 font-mono text-sm tabular-nums ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                  placeholder="e.g. 1 → 001"
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  1–3 digits, padded to 3. Must be unique across all payments.
                </span>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-600">
                  Cash (LKR)
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={form.cashAmount}
                    onChange={(e) => handleChange('cashAmount', e.target.value)}
                    className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm tabular-nums ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                    placeholder="0"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-600">
                  Payment date
                  <input
                    type="date"
                    required
                    value={form.date}
                    onChange={(e) => handleChange('date', e.target.value)}
                    className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                  />
                </label>
              </div>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">Cheques</p>
                  <button
                    type="button"
                    onClick={addChequeLine}
                    className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-50"
                  >
                    + Add cheque
                  </button>
                </div>
                {form.cheques.map((line, index) => (
                  <div
                    key={line.key}
                    className="rounded-xl bg-slate-50/90 p-4 ring-1 ring-slate-100"
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Cheque {index + 1}
                        {line.chequeDeposited ? (
                          <span className="ml-2 normal-case text-emerald-700">(deposited)</span>
                        ) : null}
                      </p>
                      {form.cheques.length > 1 && !line.chequeDeposited ? (
                        <button
                          type="button"
                          onClick={() => removeChequeLine(line.key)}
                          className="text-xs font-medium text-slate-500 hover:text-rose-600"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    {line.chequeDeposited ? (
                      <p className="mb-3 text-xs text-slate-500">
                        This cheque is already marked as deposited and cannot be changed here.
                      </p>
                    ) : null}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-sm font-medium text-slate-600">
                        Amount (LKR)
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={line.amount}
                          onChange={(e) => handleChequeChange(line.key, 'amount', e.target.value)}
                          disabled={line.chequeDeposited}
                          className="mt-1 w-full rounded-xl border-0 bg-white px-3 py-2.5 text-sm tabular-nums ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35 disabled:cursor-not-allowed disabled:opacity-60"
                          placeholder="0"
                        />
                      </label>
                      <label className="block text-sm font-medium text-slate-600">
                        Cheque date
                        <input
                          type="date"
                          value={line.chequeDate}
                          onChange={(e) => handleChequeChange(line.key, 'chequeDate', e.target.value)}
                          disabled={line.chequeDeposited}
                          className="mt-1 w-full rounded-xl border-0 bg-white px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </label>
                    </div>
                    <label className="mt-3 block text-sm font-medium text-slate-600">
                      Cheque number
                      <input
                        type="text"
                        autoComplete="off"
                        value={line.chequeNumber}
                        onChange={(e) => handleChequeChange(line.key, 'chequeNumber', e.target.value)}
                        disabled={line.chequeDeposited}
                        className="mt-1 w-full rounded-xl border-0 bg-white px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35 disabled:cursor-not-allowed disabled:opacity-60"
                        placeholder="e.g. 123456"
                      />
                    </label>
                  </div>
                ))}
              </div>
              <p className="text-sm text-slate-600">
                Total payment:{' '}
                <span className="font-semibold tabular-nums text-slate-900">
                  {money((Number(form.cashAmount) || 0) + chequeTotalPreview)}
                </span>
                {chequeTotalPreview > 0 ? (
                  <span className="ml-2 text-xs text-slate-500">
                    (cheques: {money(chequeTotalPreview)})
                  </span>
                ) : null}
              </p>
              <label className="block text-sm font-medium text-slate-600">
                Note (optional)
                <input
                  type="text"
                  value={form.note}
                  onChange={(e) => handleChange('note', e.target.value)}
                  className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                  placeholder="e.g. Reference, remarks…"
                />
              </label>
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
                  disabled={saving || customers.length === 0}
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md disabled:opacity-60"
                >
                  {saving ? 'Saving…' : editPayment ? 'Save changes' : 'Save payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <RowDetailModal
        open={!!detailPayment}
        row={detailPayment}
        variant="payment"
        onClose={() => setDetailPayment(null)}
        actions={
          <button
            type="button"
            onClick={() => openPaymentEdit(detailPayment)}
            className="mt-4 w-full rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-800 ring-1 ring-indigo-100 hover:bg-indigo-100"
          >
            Edit payment
          </button>
        }
      />
    </div>
  );
}
