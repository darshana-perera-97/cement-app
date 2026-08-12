import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiBase } from '../apiBase';
import { authFetch, getUsername } from '../auth';
import { modalPanelClass } from './tableToolbar';
import {
  normalizePaymentReceiptInput,
  suggestNextPaymentReceiptNumber,
} from './paymentReceipt';
import {
  buildCustomerOutstandingBills,
} from './pendingBills';
import { getPaymentCheques } from './paymentCheques';
import { SRI_LANKA_BANKS, bankCodeForName } from './sriLankaBanks';

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
    amount: '',
    chequeDate: todayYmdLocal(),
    chequeNumber: '',
    chequeBank: '',
    chequeBankCode: '',
    chequeBranchCode: '',
    ...overrides,
  };
}

function lastChequeDefaultsForCustomer(payments, customerId) {
  const cid = String(customerId ?? '').trim();
  if (!cid) return null;
  const sorted = (Array.isArray(payments) ? payments : [])
    .filter((p) => String(p.customerId ?? '').trim() === cid)
    .sort((a, b) =>
      String(b.createdAt || `${b.date}T23:59:59`).localeCompare(
        String(a.createdAt || `${a.date}T23:59:59`),
      ),
    );
  for (const payment of sorted) {
    const cheques = getPaymentCheques(payment);
    if (cheques.length === 0) continue;
    const last = cheques[cheques.length - 1];
    return {
      chequeBank: last.chequeBank || '',
      chequeBankCode: last.chequeBankCode || '',
      chequeBranchCode: last.chequeBranchCode || '',
      chequeDate: last.chequeDate || todayYmdLocal(),
    };
  }
  return null;
}

const emptyForm = (receiptNumber = '') => ({
  customerId: '',
  billNumber: receiptNumber,
  cashAmount: '',
  cdmAmount: '',
  cdmNumber: '',
  onlineTransferAmount: '',
  onlineTransferReference: '',
  cheques: [newChequeLine()],
  billAllocations: {},
  date: todayYmdLocal(),
  note: '',
});

const inputClass =
  'mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35';

export default function CollectorSeparateBillSettlementModal({
  open,
  onClose,
  onSaved,
  prefillCustomerId = '',
  lockCustomer = false,
  customerName = '',
}) {
  const receiptNumberTouched = useRef(false);
  const [step, setStep] = useState(1);
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
    setStep(1);
    setSaveError(null);
    loadCustomers();
    loadBills();
    loadPayments();
  }, [open, loadCustomers, loadBills, loadPayments]);

  useEffect(() => {
    if (!open) return;
    const defaults = prefillCustomerId
      ? lastChequeDefaultsForCustomer(payments, prefillCustomerId)
      : null;
    setForm({
      ...emptyForm(suggestNextPaymentReceiptNumber(payments)),
      customerId: prefillCustomerId || '',
      cheques: [newChequeLine(defaults || {})],
    });
  }, [open, prefillCustomerId, payments]);

  useEffect(() => {
    if (!open || receiptNumberTouched.current) return;
    const next = suggestNextPaymentReceiptNumber(payments);
    setForm((f) => (f.billNumber === next ? f : { ...f, billNumber: next }));
  }, [open, payments]);

  const pendingBills = useMemo(() => {
    if (!form.customerId) return [];
    return buildCustomerOutstandingBills(customers, bills, payments, form.customerId).sort((a, b) =>
      String(a.billDate).localeCompare(String(b.billDate)),
    );
  }, [form.customerId, customers, bills, payments]);

  const chequeTotal = useMemo(
    () => form.cheques.reduce((s, c) => s + (Number(c.amount) || 0), 0),
    [form.cheques],
  );

  const cashTotal = Number(form.cashAmount) || 0;
  const cdmTotal = Number(form.cdmAmount) || 0;
  const onlineTransferTotal = Number(form.onlineTransferAmount) || 0;
  const paymentTotal = Math.round((cashTotal + chequeTotal + cdmTotal + onlineTransferTotal) * 100) / 100;

  const allocatedTotal = useMemo(() => {
    let sum = 0;
    for (const bill of pendingBills) {
      sum += Number(form.billAllocations[bill.id]) || 0;
    }
    return Math.round(sum * 100) / 100;
  }, [pendingBills, form.billAllocations]);

  const unallocatedTotal = Math.round((paymentTotal - allocatedTotal) * 100) / 100;

  const handleChange = (field, value) => {
    if (field === 'billNumber') {
      receiptNumberTouched.current = true;
      setForm((f) => ({ ...f, billNumber: String(value).slice(0, 40) }));
      return;
    }
    if (field === 'customerId') {
      const defaults = lastChequeDefaultsForCustomer(payments, value);
      setForm((f) => ({
        ...f,
        customerId: value,
        billAllocations: {},
        cheques: [newChequeLine(defaults || {})],
      }));
      return;
    }
    setForm((f) => ({ ...f, [field]: value }));
  };

  const handleBillAllocationChange = (billId, value) => {
    const id = String(billId ?? '').trim();
    if (!id) return;
    setForm((f) => ({
      ...f,
      billAllocations: { ...f.billAllocations, [id]: value },
    }));
  };

  const handleChequeChange = (key, field, value) => {
    setForm((f) => ({
      ...f,
      cheques: f.cheques.map((c) => {
        if (c.key !== key) return c;
        const next = { ...c, [field]: value };
        if (field === 'chequeBank') {
          const code = bankCodeForName(value);
          if (code) next.chequeBankCode = code;
        }
        return next;
      }),
    }));
  };

  const addChequeLine = () => {
    setForm((f) => {
      const template = f.cheques[0];
      const defaults = template
        ? {
            chequeBank: template.chequeBank,
            chequeBankCode: template.chequeBankCode,
            chequeBranchCode: template.chequeBranchCode,
            chequeDate: template.chequeDate,
          }
        : {};
      return { ...f, cheques: [...f.cheques, newChequeLine(defaults)] };
    });
  };

  const removeChequeLine = (key) => {
    setForm((f) => {
      const next = f.cheques.filter((c) => c.key !== key);
      return { ...f, cheques: next.length > 0 ? next : [newChequeLine()] };
    });
  };

  const lockedCustomerLabel =
    customerName ||
    customers.find((c) => c.id === form.customerId)?.name ||
    '—';

  const validateStep1 = () => {
    if (!form.customerId) {
      setSaveError('Select a shop.');
      return false;
    }
    const receiptNumber = normalizePaymentReceiptInput(form.billNumber);
    if (!receiptNumber) {
      setSaveError('Enter a payment receipt # (letters and/or numbers).');
      return false;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9 \-._/]*$/.test(receiptNumber)) {
      setSaveError('Receipt # can use letters, numbers, spaces, and . _ - /');
      return false;
    }
    if (paymentTotal <= 0) {
      setSaveError('Enter a cash, cheque, CDM deposit, and/or online transfer amount so the total is greater than 0.');
      return false;
    }
    if (cdmTotal > 0 && !String(form.cdmNumber).trim()) {
      setSaveError('Enter a CDM number when CDM deposit amount is greater than 0.');
      return false;
    }
    if (onlineTransferTotal > 0 && !String(form.onlineTransferReference).trim()) {
      setSaveError('Enter an online transfer reference number when online transfer amount is greater than 0.');
      return false;
    }
    for (let i = 0; i < form.cheques.length; i++) {
      const line = form.cheques[i];
      const amount = Number(line.amount) || 0;
      if (amount <= 0) continue;
      if (!line.chequeDate || !/^\d{4}-\d{2}-\d{2}$/.test(line.chequeDate)) {
        setSaveError(`Cheque ${i + 1}: enter a valid conversion date.`);
        return false;
      }
      if (!String(line.chequeNumber).trim()) {
        setSaveError(`Cheque ${i + 1}: enter a cheque number.`);
        return false;
      }
    }
    if (
      payments.some(
        (r) => String(r.billNumber || '').trim() === receiptNumber,
      )
    ) {
      setSaveError('This payment receipt number is already used.');
      return false;
    }
    setSaveError(null);
    return true;
  };

  const handleNext = (e) => {
    e.preventDefault();
    if (!validateStep1()) return;
    setStep(2);
  };

  const handleBack = () => {
    setSaveError(null);
    setStep(1);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const username = getUsername();
    if (!username) {
      setSaveError('You need to be signed in with a username.');
      return;
    }
    if (!validateStep1()) {
      setStep(1);
      return;
    }

    const receiptNumber = normalizePaymentReceiptInput(form.billNumber);
    const billCashAllocations = [];
    for (const bill of pendingBills) {
      const amount = Number(form.billAllocations[bill.id]) || 0;
      if (amount <= 0) continue;
      if (amount > bill.outstandingAmount + 0.009) {
        setSaveError(
          `Amount for bill ${bill.billDate || bill.id} cannot exceed ${money(bill.outstandingAmount)} outstanding.`,
        );
        return;
      }
      billCashAllocations.push({ billId: bill.id, cashAmount: amount });
    }
    if (billCashAllocations.length === 0) {
      setSaveError('Enter an amount for at least one pending invoice.');
      return;
    }
    if (Math.abs(allocatedTotal - paymentTotal) > 0.009) {
      setSaveError(
        `Allocated total (${money(allocatedTotal)}) must equal payment total (${money(paymentTotal)}).`,
      );
      return;
    }

    const chequeLines = [];
    for (const line of form.cheques) {
      const amount = Number(line.amount) || 0;
      if (amount <= 0) continue;
      chequeLines.push({
        amount,
        chequeDate: line.chequeDate,
        chequeNumber: String(line.chequeNumber).trim(),
        chequeBank: String(line.chequeBank).trim(),
        chequeBankCode: String(line.chequeBankCode).trim(),
        chequeBranchCode: String(line.chequeBranchCode).trim(),
      });
    }

    setSaving(true);
    setSaveError(null);
    try {
      const res = await authFetch(`${apiBase}/api/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: form.customerId,
          billNumber: receiptNumber,
          cashAmount: cashTotal,
          cdmAmount: cdmTotal,
          cdmNumber: String(form.cdmNumber).trim(),
          onlineTransferAmount: onlineTransferTotal,
          onlineTransferReference: String(form.onlineTransferReference).trim(),
          cheques: chequeLines,
          billCashAllocations,
          date: form.date,
          note: form.note.trim(),
          recordedBy: username,
        }),
      });
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
      aria-labelledby="collector-bill-settlement-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className={`${modalPanelClass} flex max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-bottom,0px)))] w-full max-w-none flex-col overflow-hidden !p-0 sm:max-w-xl lg:max-w-3xl`}
      >
        <div className="shrink-0 border-b border-slate-100 px-4 pb-3 pt-3 sm:px-6 sm:pt-6">
          <div
            className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-slate-300/90 sm:hidden"
            aria-hidden
          />
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="collector-bill-settlement-title" className="text-lg font-bold text-slate-900 sm:text-xl">
                {step === 1 ? 'Record payment' : 'Allocate to invoices'}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {step === 1
                  ? 'Select the shop and enter cash or cheque payment details.'
                  : 'Split the payment across pending invoices. You can settle any invoices in any order — partial amounts are allowed.'}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100">
              Step {step} of 2
            </span>
          </div>
        </div>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={step === 1 ? handleNext : handleSubmit}
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            <div className="space-y-4">
              {saveError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">
                  {saveError}
                </p>
              ) : null}

              {step === 1 ? (
                <>
                  {lockCustomer ? (
                    <div className="block text-sm font-medium text-slate-600">
                      Shop
                      <p className="mt-1 rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-semibold text-slate-900 ring-1 ring-slate-200">
                        {lockedCustomerLabel}
                      </p>
                    </div>
                  ) : (
                    <label className="block text-sm font-medium text-slate-600">
                      Shop
                      <select
                        required
                        value={form.customerId}
                        onChange={(e) => handleChange('customerId', e.target.value)}
                        className={inputClass}
                        disabled={customers.length === 0}
                      >
                        <option value="">{customers.length === 0 ? 'No shops yet' : 'Select shop…'}</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
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
                        className={`${inputClass} font-mono`}
                        placeholder="e.g. PAY-012"
                      />
                    </label>
                    <label className="block text-sm font-medium text-slate-600">
                      Payment date
                      <input
                        type="date"
                        required
                        value={form.date}
                        onChange={(e) => handleChange('date', e.target.value)}
                        className={inputClass}
                      />
                    </label>
                  </div>
                  <label className="block text-sm font-medium text-slate-600">
                    Cash (LKR)
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={form.cashAmount}
                      onChange={(e) => handleChange('cashAmount', e.target.value)}
                      className={`${inputClass} tabular-nums`}
                      placeholder="0"
                    />
                  </label>
                  <fieldset className="rounded-xl bg-sky-50/70 p-3 ring-1 ring-sky-100 sm:p-4">
                    <legend className="px-1 text-sm font-semibold text-slate-800">CDM deposit</legend>
                    <p className="mt-1 text-xs text-slate-500">Amount and CDM number as evidence. Requires manager approval.</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="block text-sm font-medium text-slate-600">
                        Amount (LKR)
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={form.cdmAmount}
                          onChange={(e) => handleChange('cdmAmount', e.target.value)}
                          className="mt-1 w-full rounded-xl border-0 bg-white px-3 py-2.5 text-sm tabular-nums ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                          placeholder="0"
                        />
                      </label>
                      <label className="block text-sm font-medium text-slate-600">
                        CDM number <span className="text-rose-600">*</span>
                        <input
                          type="text"
                          autoComplete="off"
                          value={form.cdmNumber}
                          onChange={(e) => handleChange('cdmNumber', e.target.value)}
                          className="mt-1 w-full rounded-xl border-0 bg-white px-3 py-2.5 font-mono text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                          placeholder="e.g. CDM receipt / slip no."
                        />
                      </label>
                    </div>
                  </fieldset>
                  <fieldset className="rounded-xl bg-teal-50/70 p-3 ring-1 ring-teal-100 sm:p-4">
                    <legend className="px-1 text-sm font-semibold text-slate-800">Online transfer</legend>
                    <p className="mt-1 text-xs text-slate-500">Amount and bank reference as evidence. Requires manager approval.</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="block text-sm font-medium text-slate-600">
                        Amount (LKR)
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={form.onlineTransferAmount}
                          onChange={(e) => handleChange('onlineTransferAmount', e.target.value)}
                          className="mt-1 w-full rounded-xl border-0 bg-white px-3 py-2.5 text-sm tabular-nums ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                          placeholder="0"
                        />
                      </label>
                      <label className="block text-sm font-medium text-slate-600">
                        Transfer reference # <span className="text-rose-600">*</span>
                        <input
                          type="text"
                          autoComplete="off"
                          value={form.onlineTransferReference}
                          onChange={(e) => handleChange('onlineTransferReference', e.target.value)}
                          className="mt-1 w-full rounded-xl border-0 bg-white px-3 py-2.5 font-mono text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                          placeholder="e.g. bank ref / transaction ID"
                        />
                      </label>
                    </div>
                  </fieldset>
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
                          </p>
                          {form.cheques.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => removeChequeLine(line.key)}
                              className="text-xs font-medium text-slate-500 hover:text-rose-600"
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="block text-sm font-medium text-slate-600">
                            Amount (LKR)
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              value={line.amount}
                              onChange={(e) => handleChequeChange(line.key, 'amount', e.target.value)}
                              className="mt-1 w-full rounded-xl border-0 bg-white px-3 py-2.5 text-sm tabular-nums ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                              placeholder="0"
                            />
                          </label>
                          <label className="block text-sm font-medium text-slate-600">
                            Conversion date
                            <input
                              type="date"
                              value={line.chequeDate}
                              onChange={(e) => handleChequeChange(line.key, 'chequeDate', e.target.value)}
                              className="mt-1 w-full rounded-xl border-0 bg-white px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                            />
                          </label>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <label className="block text-sm font-medium text-slate-600">
                            Bank
                            <select
                              value={line.chequeBank}
                              onChange={(e) => handleChequeChange(line.key, 'chequeBank', e.target.value)}
                              className="mt-1 w-full rounded-xl border-0 bg-white px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                            >
                              <option value="">Select bank…</option>
                              {SRI_LANKA_BANKS.map((b) => (
                                <option key={`${b.code}-${b.name}`} value={b.name}>
                                  {b.name} ({b.code})
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block text-sm font-medium text-slate-600">
                            Bank code
                            <input
                              type="text"
                              inputMode="numeric"
                              autoComplete="off"
                              maxLength={4}
                              value={line.chequeBankCode}
                              onChange={(e) =>
                                handleChequeChange(line.key, 'chequeBankCode', e.target.value.replace(/\D/g, '').slice(0, 4))
                              }
                              className="mt-1 w-full rounded-xl border-0 bg-white px-3 py-2.5 font-mono text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                              placeholder="e.g. 7056"
                            />
                          </label>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <label className="block text-sm font-medium text-slate-600">
                            Branch code
                            <input
                              type="text"
                              inputMode="numeric"
                              autoComplete="off"
                              maxLength={3}
                              value={line.chequeBranchCode}
                              onChange={(e) =>
                                handleChequeChange(
                                  line.key,
                                  'chequeBranchCode',
                                  e.target.value.replace(/\D/g, '').slice(0, 3),
                                )
                              }
                              className="mt-1 w-full rounded-xl border-0 bg-white px-3 py-2.5 font-mono text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                              placeholder="e.g. 080"
                            />
                          </label>
                          <label className="block text-sm font-medium text-slate-600">
                            Cheque number
                            <input
                              type="text"
                              autoComplete="off"
                              value={line.chequeNumber}
                              onChange={(e) => handleChequeChange(line.key, 'chequeNumber', e.target.value)}
                              className="mt-1 w-full rounded-xl border-0 bg-white px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                              placeholder="e.g. 123456"
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="flex flex-col gap-1 text-sm text-slate-600 sm:flex-row sm:flex-wrap sm:items-baseline">
                    <span>
                      Total payment:{' '}
                      <span className="font-semibold tabular-nums text-slate-900">{money(paymentTotal)}</span>
                    </span>
                    {chequeTotal > 0 || cdmTotal > 0 || onlineTransferTotal > 0 ? (
                      <span className="text-xs text-slate-500 sm:ml-2">
                        (
                        {[
                          cashTotal > 0 ? `cash ${money(cashTotal)}` : null,
                          chequeTotal > 0 ? `cheques ${money(chequeTotal)}` : null,
                          cdmTotal > 0 ? `CDM ${money(cdmTotal)}` : null,
                          onlineTransferTotal > 0 ? `online ${money(onlineTransferTotal)}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                        )
                      </span>
                    ) : cashTotal > 0 ? (
                      <span className="text-xs text-slate-500 sm:ml-2">(cash only)</span>
                    ) : null}
                  </p>
                  <label className="block text-sm font-medium text-slate-600">
                    Note (optional)
                    <input
                      type="text"
                      value={form.note}
                      onChange={(e) => handleChange('note', e.target.value)}
                      className={inputClass}
                      placeholder="e.g. Collection route, remarks…"
                    />
                  </label>
                </>
              ) : (
                <>
                  <div className="rounded-xl bg-indigo-50/90 p-4 ring-1 ring-indigo-100">
                    <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Payment total</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-indigo-950">{money(paymentTotal)}</p>
                    <p className="mt-1 text-sm text-indigo-800/90">
                      {[
                        cashTotal > 0 ? `Cash ${money(cashTotal)}` : null,
                        chequeTotal > 0 ? `Cheques ${money(chequeTotal)}` : null,
                        cdmTotal > 0 ? `CDM ${money(cdmTotal)}` : null,
                        onlineTransferTotal > 0 ? `Online ${money(onlineTransferTotal)}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </p>
                    <p className="mt-2 text-sm text-indigo-700">
                      Shop: <span className="font-semibold">{lockedCustomerLabel}</span>
                    </p>
                  </div>

                  <div className="rounded-xl bg-slate-50/90 p-3 ring-1 ring-slate-100 sm:p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-800">Pending invoices</p>
                      <p className="text-xs tabular-nums text-slate-600">
                        Allocated {money(allocatedTotal)} of {money(paymentTotal)}
                        {Math.abs(unallocatedTotal) > 0.009 ? (
                          <span className={unallocatedTotal > 0 ? ' text-amber-700' : ' text-rose-700'}>
                            {' '}
                            · {unallocatedTotal > 0 ? `${money(unallocatedTotal)} left` : `${money(Math.abs(unallocatedTotal))} over`}
                          </span>
                        ) : (
                          <span className=" text-emerald-700"> · Fully allocated</span>
                        )}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Enter how much of this payment applies to each invoice. Settle any invoices in any order — partial amounts are allowed.
                    </p>
                    {pendingBills.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-500">No outstanding credit invoices for this shop.</p>
                    ) : (
                      <ul className="mt-3 space-y-2">
                        {pendingBills.map((b) => (
                          <li
                            key={b.id}
                            className="rounded-lg bg-white px-3 py-3 ring-1 ring-slate-200 sm:flex sm:items-center sm:gap-4"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="font-medium tabular-nums text-slate-900">{b.billDate || '—'}</p>
                              <p className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-800">
                                {money(b.outstandingAmount)} due
                                {b.billTotal > 0 ? (
                                  <span className="ml-1 text-xs font-normal text-slate-500">
                                    of {money(b.billTotal)}
                                  </span>
                                ) : null}
                              </p>
                              <p className="mt-1 text-xs leading-snug text-slate-600">{b.details}</p>
                            </div>
                            <label className="mt-3 block shrink-0 text-sm font-medium text-slate-600 sm:mt-0 sm:w-36">
                              Amount (LKR)
                              <input
                                type="number"
                                min={0}
                                max={b.outstandingAmount}
                                step={0.01}
                                value={form.billAllocations[b.id] ?? ''}
                                onChange={(e) => handleBillAllocationChange(b.id, e.target.value)}
                                className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm tabular-nums ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                                placeholder="0"
                              />
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="shrink-0 border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur-sm sm:px-6 sm:py-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              {step === 2 ? (
                <button
                  type="button"
                  onClick={handleBack}
                  disabled={saving}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 sm:w-auto sm:py-2.5"
                >
                  Back
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 sm:w-auto sm:py-2.5"
                >
                  Cancel
                </button>
              )}
              {step === 1 ? (
                <button
                  type="submit"
                  disabled={customers.length === 0 || paymentTotal <= 0}
                  className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-md disabled:opacity-60 sm:w-auto sm:py-2.5"
                >
                  Next
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={
                    saving ||
                    pendingBills.length === 0 ||
                    paymentTotal <= 0 ||
                    Math.abs(unallocatedTotal) > 0.009 ||
                    allocatedTotal <= 0
                  }
                  className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-md disabled:opacity-60 sm:w-auto sm:py-2.5"
                >
                  {saving ? 'Saving…' : 'Save payment'}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
