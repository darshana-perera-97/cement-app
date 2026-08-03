import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiBase } from '../apiBase';
import { authFetch, getUsername } from '../auth';
import { modalPanelClass } from './tableToolbar';
import { getPaymentCheques } from './paymentCheques';
import {
  normalizePaymentReceiptInput,
  suggestNextPaymentReceiptNumber,
} from './paymentReceipt';
import {
  billDetailsLine,
  buildCustomerOutstandingBills,
} from './pendingBills';

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

const emptyForm = (receiptNumber = '') => ({
  customerId: '',
  billNumber: receiptNumber,
  appliedBillIds: [],
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
  const billNumber = String(payment.billNumber ?? '').trim();
  const appliedBillIds = Array.isArray(payment.appliedBillIds)
    ? payment.appliedBillIds.map(String)
    : Array.isArray(payment.appliedBills)
      ? payment.appliedBills.map((b) => String(b.id ?? '')).filter(Boolean)
      : [];
  return {
    customerId: payment.customerId || '',
    billNumber,
    appliedBillIds,
    cashAmount: payment.cashAmount != null && payment.cashAmount !== '' ? String(payment.cashAmount) : '',
    cheques,
    date: payment.date || todayYmdLocal(),
    note: payment.note || '',
  };
}

export default function RecordPaymentModal({
  open,
  onClose,
  onSaved,
  prefillCustomerId = '',
  editPayment = null,
  lockCustomer = false,
  customerName = '',
}) {
  const receiptNumberTouched = useRef(false);
  const [payments, setPayments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [bills, setBills] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const loadBills = useCallback(async () => {
    try {
      const res = await authFetch(`${apiBase}/api/bills`);
      if (!res.ok) throw new Error('Failed to load bills');
      const data = await res.json();
      setBills(Array.isArray(data) ? data : []);
    } catch {
      setBills([]);
    }
  }, []);

  const loadCustomers = useCallback(async () => {
    try {
      const res = await authFetch(`${apiBase}/api/customers`);
      if (!res.ok) throw new Error('Failed to load customers');
      const data = await res.json();
      setCustomers(Array.isArray(data) ? data : []);
    } catch {
      setCustomers([]);
    }
  }, []);

  const loadPayments = useCallback(async () => {
    try {
      const res = await authFetch(`${apiBase}/api/payments`);
      if (!res.ok) throw new Error('Failed to load payments');
      const data = await res.json();
      setPayments(Array.isArray(data) ? data : []);
    } catch {
      setPayments([]);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    receiptNumberTouched.current = false;
    setSaveError(null);
    loadCustomers();
    loadBills();
    loadPayments();
  }, [open, loadCustomers, loadBills, loadPayments]);

  useEffect(() => {
    if (!open) return;
    if (editPayment) {
      setForm(formFromPayment(editPayment));
      return;
    }
    setForm({
      ...emptyForm(suggestNextPaymentReceiptNumber(payments)),
      customerId: prefillCustomerId || '',
    });
  }, [open, editPayment, prefillCustomerId, payments]);

  useEffect(() => {
    if (!open || editPayment || receiptNumberTouched.current) return;
    const next = suggestNextPaymentReceiptNumber(payments);
    setForm((f) => (f.billNumber === next ? f : { ...f, billNumber: next }));
  }, [open, editPayment, payments]);

  const handleChange = (field, value) => {
    if (field === 'billNumber') {
      receiptNumberTouched.current = true;
      setForm((f) => ({ ...f, billNumber: String(value).slice(0, 40) }));
      return;
    }
    if (field === 'customerId') {
      setForm((f) => ({ ...f, customerId: value, appliedBillIds: [] }));
      return;
    }
    setForm((f) => ({ ...f, [field]: value }));
  };

  const toggleAppliedBill = (billId) => {
    const id = String(billId ?? '').trim();
    if (!id) return;
    setForm((f) => {
      const set = new Set(f.appliedBillIds);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...f, appliedBillIds: [...set] };
    });
  };

  const customerBillOptions = useMemo(() => {
    if (!form.customerId) return [];
    const outstanding = buildCustomerOutstandingBills(customers, bills, payments, form.customerId, {
      excludePaymentId: editPayment?.id || null,
    });
    const byId = new Map(outstanding.map((r) => [r.id, r]));
    for (const id of form.appliedBillIds) {
      if (byId.has(id)) continue;
      const bill = bills.find((b) => b.id === id);
      if (!bill) continue;
      byId.set(id, {
        id: bill.id,
        billDate: bill.date,
        outstandingAmount: 0,
        billTotal: Number(bill.totalAmount) || 0,
        details: billDetailsLine(bill),
      });
    }
    return [...byId.values()].sort((a, b) => String(a.billDate).localeCompare(String(b.billDate)));
  }, [form.customerId, form.appliedBillIds, customers, bills, payments, editPayment?.id]);

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

  const lockedCustomerLabel =
    customerName ||
    customers.find((c) => c.id === form.customerId)?.name ||
    '—';

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
    const receiptNumber = normalizePaymentReceiptInput(form.billNumber);
    if (!receiptNumber) {
      setSaveError('Enter a payment receipt # (letters and/or numbers).');
      return;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9 \-._/]*$/.test(receiptNumber)) {
      setSaveError('Receipt # can use letters, numbers, spaces, and . _ - /');
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
    if (
      payments.some(
        (r) => String(r.billNumber || '').trim() === receiptNumber && r.id !== editPayment?.id,
      )
    ) {
      setSaveError('This payment receipt number is already used.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        customerId: form.customerId,
        billNumber: receiptNumber,
        appliedBillIds: form.appliedBillIds,
        cashAmount: cash,
        cheques: chequeLines,
        date: form.date,
        note: form.note.trim(),
      };
      const isEdit = !!editPayment?.id;
      const res = await authFetch(
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
      if (onSaved) await onSaved(data);
      onClose();
    } catch {
      setSaveError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="record-payment-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className={`${modalPanelClass} flex max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-bottom,0px)))] w-full max-w-none flex-col overflow-hidden !p-0 sm:max-w-xl lg:max-w-4xl`}
      >
        <div className="shrink-0 border-b border-slate-100 px-4 pb-3 pt-3 sm:px-6 sm:pt-6">
          <div
            className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-slate-300/90 sm:hidden"
            aria-hidden
          />
          <h2 id="record-payment-modal-title" className="text-lg font-bold text-slate-900 sm:text-xl">
            {editPayment ? 'Edit payment' : 'Record payment'}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Logged in as {getUsername() || '—'}.
          </p>
        </div>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            <div className="space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-8 lg:gap-y-4 lg:space-y-0">
              {saveError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100 lg:col-span-2">
                  {saveError}
                </p>
              ) : null}
              <div className="min-w-0 space-y-4">
                {lockCustomer ? (
                  <div className="block text-sm font-medium text-slate-600">
                    Customer
                    <p className="mt-1 rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-semibold text-slate-900 ring-1 ring-slate-200">
                      {lockedCustomerLabel}
                    </p>
                  </div>
                ) : (
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
                )}
                {form.customerId ? (
                  <fieldset className="rounded-xl bg-slate-50/90 p-3 ring-1 ring-slate-100 sm:p-4">
                    <legend className="px-1 text-sm font-semibold text-slate-800">
                      Credit bills this payment is for
                    </legend>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      Optional. Select one or more outstanding bills. Customer balances still follow opening balance
                      first, then oldest bills.
                    </p>
                    {customerBillOptions.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-500">No outstanding credit bills for this customer.</p>
                    ) : (
                      <ul className="mt-3 max-h-[min(36vh,14rem)] space-y-2 overflow-y-auto overscroll-contain sm:max-h-48 lg:max-h-[min(52vh,22rem)]">
                        {customerBillOptions.map((b) => {
                          const checked = form.appliedBillIds.includes(b.id);
                          return (
                            <li key={b.id}>
                              <label
                                className={`flex cursor-pointer gap-3 rounded-lg px-3 py-3 text-sm ring-1 transition sm:py-2.5 ${
                                  checked
                                    ? 'bg-indigo-50 ring-indigo-200'
                                    : 'bg-white ring-slate-200 hover:bg-slate-50'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  className="mt-1 h-[1.125rem] w-[1.125rem] shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/35 sm:mt-0.5 sm:h-4 sm:w-4"
                                  checked={checked}
                                  onChange={() => toggleAppliedBill(b.id)}
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="flex flex-col gap-0.5 sm:block">
                                    <span className="font-medium tabular-nums text-slate-900">{b.billDate || '—'}</span>
                                    <span className="font-semibold tabular-nums text-emerald-800 sm:ml-2 sm:inline">
                                      {b.outstandingAmount > 0
                                        ? `${money(b.outstandingAmount)} due`
                                        : 'Settled'}
                                      {b.billTotal > 0 ? (
                                        <span className="ml-1 text-xs font-normal text-slate-500 sm:ml-2">
                                          of {money(b.billTotal)}
                                        </span>
                                      ) : null}
                                    </span>
                                  </span>
                                  <span className="mt-1 block text-xs leading-snug text-slate-600">{b.details}</span>
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {form.appliedBillIds.length > 0 ? (
                      <p className="mt-2 text-xs font-medium text-indigo-700">
                        {form.appliedBillIds.length} bill{form.appliedBillIds.length === 1 ? '' : 's'} selected
                      </p>
                    ) : null}
                  </fieldset>
                ) : null}
              </div>
              <div className="min-w-0 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-slate-600">
                    Payment receipt #
                    <input
                      type="text"
                      autoComplete="off"
                      required
                      maxLength={40}
                      value={form.billNumber}
                      onChange={(e) => handleChange('billNumber', e.target.value)}
                      className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 font-mono text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                      placeholder="e.g. PAY-012 or 013"
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
                <p className="text-xs font-normal text-slate-500">
                  {editPayment
                    ? 'Receipt # is unique across payments. Change either field if needed.'
                    : 'Receipt # is filled from the last saved payment (+1). You can change it before saving.'}
                </p>
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
                <p className="flex flex-col gap-1 text-sm text-slate-600 sm:flex-row sm:flex-wrap sm:items-baseline">
                  <span>
                    Total payment:{' '}
                    <span className="font-semibold tabular-nums text-slate-900">
                      {money((Number(form.cashAmount) || 0) + chequeTotalPreview)}
                    </span>
                  </span>
                  {chequeTotalPreview > 0 ? (
                    <span className="text-xs text-slate-500 sm:ml-2">
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
              </div>
            </div>
          </div>
          <div className="shrink-0 border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur-sm sm:px-6 sm:py-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 sm:w-auto sm:py-2.5"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || customers.length === 0}
                className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-md disabled:opacity-60 sm:w-auto sm:py-2.5"
              >
                {saving ? 'Saving…' : editPayment ? 'Save changes' : 'Save payment'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
