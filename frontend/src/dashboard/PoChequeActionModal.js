import { useEffect, useState } from 'react';
import { getApiBase } from '../apiBase';
import { authFetch, getUsername } from '../auth';
import { ModalBackdrop, modalPanelClass } from './tableToolbar';

const apiRoot = getApiBase() || '';

const fieldClass =
  'mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35';

function ymdFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayYmdLocal() {
  return ymdFromDate(new Date());
}

function tomorrowYmdLocal() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return ymdFromDate(d);
}

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function bankAccountOptionLabel(a) {
  const nick = String(a?.nickName ?? '').trim() || 'Account';
  const detail = [a?.bank, a?.accountNumber].map((x) => String(x ?? '').trim()).filter(Boolean).join(' · ');
  return detail ? `${nick} — ${detail}` : nick;
}

const ACTIONS = [
  {
    id: 'hold',
    title: 'Hold the cheque up to a date',
    detail: 'Keep this cheque and set the date it can be used until.',
  },
  {
    id: 'return',
    title: 'Return the cheque',
    detail: 'Give the cheque back and record how the purchase is settled.',
  },
  {
    id: 'settle_today',
    title: 'Settle the cheque today',
    detail: 'Close this cheque today with cash or a bank transfer.',
  },
];

function MethodChoices({ methods, value, onChange }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-700">How is this settled?</legend>
      {methods.map((method) => (
        <label
          key={method.id}
          className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ${
            value === method.id ? 'bg-indigo-50 ring-indigo-200' : 'bg-slate-50 ring-slate-200'
          }`}
        >
          <input
            type="radio"
            name="settlementMethod"
            value={method.id}
            checked={value === method.id}
            onChange={() => onChange(method.id)}
          />
          <span className="text-sm font-medium text-slate-900">{method.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

export default function PoChequeActionModal({ open, cheque, bankAccounts, onClose, onSaved }) {
  const [step, setStep] = useState('choose');
  const [action, setAction] = useState('');
  const [holdUntil, setHoldUntil] = useState('');
  const [method, setMethod] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setStep('choose');
    setAction('');
    setHoldUntil('');
    setMethod('');
    setBankAccountId('');
    setChequeNumber('');
    setChequeDate('');
    setReference('');
    setSaving(false);
    setError(null);
  }, [open, cheque?.poId, cheque?.chequeNumber, cheque?.chequeDate, cheque?.bankAccountId, cheque?.amount]);

  if (!open || !cheque) return null;

  const accounts = Array.isArray(bankAccounts) ? bankAccounts : [];
  const numberLabel = cheque.chequeNumber ? `#${cheque.chequeNumber}` : 'Cheque';
  const summary = [
    numberLabel,
    money(cheque.amount),
    cheque.bankLabel,
    cheque.distributorName,
    cheque.product,
    cheque.poNumber ? `PO ${cheque.poNumber}` : '',
  ]
    .filter((part) => part && part !== '—')
    .join(' · ');

  const chooseAction = (id) => {
    setAction(id);
    setMethod('');
    setError(null);
    setStep('details');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (step !== 'details') return;
    const recordedBy = getUsername().trim();
    if (!recordedBy) {
      setError('Sign in with your username to update this cheque.');
      return;
    }
    const today = todayYmdLocal();
    const body = {
      recordedBy,
      action,
      today,
      chequeNumber: cheque.chequeNumber,
      chequeDate: cheque.chequeDate,
      bankAccountId: cheque.bankAccountId,
      amount: cheque.amount,
    };

    if (action === 'hold') {
      const date = String(holdUntil ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        setError('Enter the hold ending date.');
        return;
      }
      if (date <= today) {
        setError('Hold ending date must be after today.');
        return;
      }
      body.holdUntil = date;
    } else if (action === 'return' || action === 'settle_today') {
      if (action === 'settle_today' && method !== 'cash' && method !== 'bank_transfer') {
        setError('Choose cash or bank transfer.');
        return;
      }
      if (method !== 'cash' && method !== 'bank_transfer' && method !== 'cheque') {
        setError('Choose how this cheque is settled.');
        return;
      }
      body.settlementMethod = method;
      body.settlementDate = today;
      if (method === 'bank_transfer' || method === 'cheque') {
        if (!bankAccountId) {
          setError('Select a bank account.');
          return;
        }
        body.settlementBankAccountId = bankAccountId;
      }
      if (method === 'bank_transfer' && String(reference).trim()) {
        body.settlementReference = String(reference).trim();
      }
      if (method === 'cheque') {
        const nextNumber = String(chequeNumber).trim();
        const nextDate = String(chequeDate).trim();
        if (!nextNumber) {
          setError('Enter the new cheque number.');
          return;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
          setError('Enter a converting date for the new cheque.');
          return;
        }
        body.settlementChequeNumber = nextNumber;
        body.settlementChequeDate = nextDate;
      }
    } else {
      setError('Choose the next step.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await authFetch(
        `${apiRoot}/api/purchase-orders/${encodeURIComponent(cheque.poId)}/cheque-action`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not update this cheque');
        return;
      }
      onSaved?.(data);
    } catch {
      setError('Could not reach server');
    } finally {
      setSaving(false);
    }
  };

  const returnMethods = [
    { id: 'cash', label: 'Cash' },
    { id: 'bank_transfer', label: 'Bank transfer' },
    { id: 'cheque', label: 'Another cheque' },
  ];
  const settleMethods = [
    { id: 'cash', label: 'Cash' },
    { id: 'bank_transfer', label: 'Bank transfer' },
  ];

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <ModalBackdrop onClose={saving ? undefined : onClose} />
      <form className={modalPanelClass} onSubmit={handleSubmit}>
        <h2 className="text-lg font-bold text-slate-900">Cheque next step</h2>
        <p className="mt-1 text-sm text-slate-600">{summary}</p>

        {step === 'choose' ? (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-medium text-slate-700">Select the next step</p>
            {ACTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => chooseAction(item.id)}
                className="block w-full rounded-xl bg-slate-50 px-3 py-3 text-left ring-1 ring-slate-200 transition hover:bg-indigo-50 hover:ring-indigo-200"
              >
                <span className="block text-sm font-semibold text-slate-900">{item.title}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{item.detail}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <p className="text-sm font-semibold text-slate-900">
              {ACTIONS.find((item) => item.id === action)?.title}
            </p>

            {action === 'hold' ? (
              <label className="block text-sm font-medium text-slate-700">
                Hold ending date
                <input
                  type="date"
                  required
                  min={tomorrowYmdLocal()}
                  value={holdUntil}
                  onChange={(e) => setHoldUntil(e.target.value)}
                  className={fieldClass}
                />
              </label>
            ) : null}

            {action === 'return' ? (
              <MethodChoices methods={returnMethods} value={method} onChange={setMethod} />
            ) : null}
            {action === 'settle_today' ? (
              <MethodChoices methods={settleMethods} value={method} onChange={setMethod} />
            ) : null}

            {method === 'bank_transfer' ? (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-slate-700">
                  Bank account
                  <select
                    required
                    value={bankAccountId}
                    onChange={(e) => setBankAccountId(e.target.value)}
                    className={fieldClass}
                  >
                    <option value="">Select account</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {bankAccountOptionLabel(a)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Transfer reference
                  <input
                    type="text"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="Optional"
                    className={fieldClass}
                  />
                </label>
                <p className="text-xs text-slate-500">The transfer is recorded for today.</p>
              </div>
            ) : null}

            {method === 'cheque' ? (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-slate-700">
                  New cheque number
                  <input
                    type="text"
                    required
                    value={chequeNumber}
                    onChange={(e) => setChequeNumber(e.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Converting date
                  <input
                    type="date"
                    required
                    value={chequeDate}
                    onChange={(e) => setChequeDate(e.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Bank account
                  <select
                    required
                    value={bankAccountId}
                    onChange={(e) => setBankAccountId(e.target.value)}
                    className={fieldClass}
                  >
                    <option value="">Select account</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {bankAccountOptionLabel(a)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}

            {method === 'cash' ? (
              <p className="text-sm text-slate-600">
                {action === 'settle_today'
                  ? 'This cheque is settled in cash today.'
                  : 'This cheque is returned and the purchase is settled in cash today.'}
              </p>
            ) : null}
          </div>
        )}

        {error ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {step === 'details' ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setStep('choose');
                setError(null);
              }}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Back
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Close
            </button>
          )}
          {step === 'details' ? (
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
