import { useCallback, useEffect, useState } from 'react';
import { getApiBase } from '../apiBase';
import { getUsername } from '../auth';
import { modalPanelClass } from './tableToolbar';

const apiBase = getApiBase();

const fieldClass =
  'mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35';

const DIRECTION_TABS = [
  { id: 'from_owner', label: 'Money from owner' },
  { id: 'to_owner', label: 'Taken by owner' },
];

const PAYMENT_METHOD_OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
];

function todayYmdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const emptyForm = () => ({
  ownerShareDirection: 'from_owner',
  paymentMethod: 'cash',
  date: todayYmdLocal(),
  chequeDate: todayYmdLocal(),
  chequeNumber: '',
  amount: '',
  description: '',
});

export default function CashBookOwnerShareModal({ open, onClose, onSaved, ownerName = '' }) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm(emptyForm());
    setSaveError(null);
  }, [open]);

  const handleChange = useCallback((key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const recordedBy = getUsername().trim();
    if (!recordedBy) {
      setSaveError('Sign in with a username to record owner share.');
      return;
    }
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setSaveError('Enter a valid amount.');
      return;
    }
    if (form.paymentMethod === 'cheque' && !String(form.chequeNumber ?? '').trim()) {
      setSaveError('Cheque number is required.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const body = {
        category: 'owner_share',
        ownerShareDirection: form.ownerShareDirection,
        paymentMethod: form.paymentMethod,
        date: form.date,
        amount,
        description: String(form.description ?? '').trim(),
        recordedBy,
      };
      if (form.paymentMethod === 'cheque') {
        body.chequeNumber = String(form.chequeNumber ?? '').trim();
        body.chequeDate = form.chequeDate;
      }
      const res = await fetch(`${apiBase}/api/cash-book-entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || 'Could not save');
        return;
      }
      onSaved?.(data);
      onClose();
    } catch {
      setSaveError('Could not reach server');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const ownerLabel = String(ownerName ?? '').trim() || 'Owner';
  const isFromOwner = form.ownerShareDirection === 'from_owner';
  const isCheque = form.paymentMethod === 'cheque';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="owner-share-title"
    >
      <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" aria-label="Close" onClick={onClose} />
      <div
        className={`${modalPanelClass} flex max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-bottom,0px)))] w-full max-w-none flex-col overflow-hidden !p-0 sm:max-w-lg`}
      >
        <div className="shrink-0 border-b border-slate-100 px-4 pb-0 pt-3 sm:px-6 sm:pt-6">
          <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-slate-300/90 sm:hidden" aria-hidden />
          <h2 id="owner-share-title" className="text-lg font-bold text-slate-900">
            Owner share
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Record money {isFromOwner ? 'from' : 'taken by'} {ownerLabel} as cash or cheque.
            {isFromOwner && isCheque ? ' Owner cheques can be deposited from Cheque deposits.' : null}
          </p>
          <div
            className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200/80"
            role="tablist"
            aria-label="Owner share direction"
          >
            {DIRECTION_TABS.map(({ id, label }) => {
              const active = form.ownerShareDirection === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => handleChange('ownerShareDirection', id)}
                  disabled={saving}
                  className={`rounded-lg px-2 py-2.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 sm:px-3 ${
                    active
                      ? 'bg-white text-amber-900 shadow-sm ring-1 ring-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            {saveError ? (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{saveError}</p>
            ) : null}

            <label className="block text-sm font-medium text-slate-600">
              Payment
              <select
                required
                value={form.paymentMethod}
                onChange={(e) => handleChange('paymentMethod', e.target.value)}
                className={fieldClass}
                disabled={saving}
              >
                {PAYMENT_METHOD_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            {isCheque ? (
              <>
                <label className="block text-sm font-medium text-slate-600">
                  Cheque number <span className="text-rose-600">*</span>
                  <input
                    type="text"
                    required
                    value={form.chequeNumber}
                    onChange={(e) => handleChange('chequeNumber', e.target.value)}
                    className={fieldClass}
                    placeholder="e.g. 001234"
                    disabled={saving}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-600">
                  Converting date <span className="text-rose-600">*</span>
                  <input
                    type="date"
                    required
                    value={form.chequeDate}
                    onChange={(e) => handleChange('chequeDate', e.target.value)}
                    className={fieldClass}
                    disabled={saving}
                  />
                </label>
              </>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-600">
                Date
                <input
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => handleChange('date', e.target.value)}
                  className={fieldClass}
                  disabled={saving}
                />
              </label>
              <label className="block text-sm font-medium text-slate-600">
                Amount (LKR) <span className="text-rose-600">*</span>
                <input
                  type="number"
                  required
                  min="0.01"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => handleChange('amount', e.target.value)}
                  className={`${fieldClass} tabular-nums`}
                  placeholder="0.00"
                  disabled={saving}
                />
              </label>
            </div>

            <label className="block text-sm font-medium text-slate-600">
              Note <span className="font-normal text-slate-400">(optional)</span>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => handleChange('description', e.target.value)}
                className={fieldClass}
                placeholder="Purpose, reference, etc."
                disabled={saving}
              />
            </label>
          </div>
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-100 px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
