import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getApiBase } from '../apiBase';
import { getUsername } from '../auth';
import { modalPanelClass } from './tableToolbar';
import { BANK_CHARGE_TYPE_OPTIONS } from './cashBookCategories';

const apiBase = getApiBase();

function todayYmdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const emptyForm = () => ({
  date: todayYmdLocal(),
  amount: '',
  description: '',
  bankAccountId: '',
  chargeType: '',
});

const fieldClass =
  'mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35';

function bankAccountOptionLabel(a) {
  const nick = String(a.nickName ?? '').trim() || 'Account';
  const detail = [a.bank, a.accountNumber].map((x) => String(x ?? '').trim()).filter(Boolean).join(' · ');
  return detail ? `${nick} — ${detail}` : nick;
}

export default function CashBookBankChargeModal({ open, onClose, onSaved, bankAccounts = [] }) {
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
      setSaveError('Sign in with a username to record this expense.');
      return;
    }
    if (!form.bankAccountId) {
      setSaveError('Select the bank account.');
      return;
    }
    if (!form.chargeType) {
      setSaveError('Select an expense reason.');
      return;
    }
    if (form.chargeType === 'other' && !form.description.trim()) {
      setSaveError('Enter a note for Others.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${apiBase}/api/cash-book-entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'bank_charge',
          date: form.date,
          amount: form.amount,
          description: form.description,
          recordedBy,
          bankAccountIds: [form.bankAccountId],
          chargeType: form.chargeType,
        }),
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

  const needsNote = form.chargeType === 'other';
  const blocked =
    bankAccounts.length === 0 || !form.bankAccountId || !form.chargeType || (needsNote && !form.description.trim());

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bank-charge-title"
    >
      <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" aria-label="Close" onClick={onClose} />
      <div
        className={`${modalPanelClass} flex max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-bottom,0px)))] w-full max-w-none flex-col overflow-hidden !p-0 sm:max-w-lg`}
      >
        <div className="shrink-0 border-b border-slate-100 px-4 pb-3 pt-3 sm:px-6 sm:pt-6">
          <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-slate-300/90 sm:hidden" aria-hidden />
          <h2 id="bank-charge-title" className="text-lg font-bold text-slate-900">
            Expenses
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Deducts the amount from the selected bank account. Cashier cash is unchanged.
          </p>
        </div>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            {saveError ? (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{saveError}</p>
            ) : null}

            <label className="block text-sm font-medium text-slate-600">
              Reason <span className="text-rose-600">*</span>
              <select
                required
                value={form.chargeType}
                onChange={(e) => handleChange('chargeType', e.target.value)}
                className={fieldClass}
                disabled={saving}
              >
                <option value="">Select reason…</option>
                {BANK_CHARGE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium text-slate-600">
              Bank account <span className="text-rose-600">*</span>
              {bankAccounts.length === 0 ? (
                <p className="mt-2 text-sm font-normal text-slate-500">
                  No bank accounts yet.{' '}
                  <Link to="/dashboard/shop" className="font-semibold text-indigo-700 hover:text-indigo-900">
                    Add accounts in Shop
                  </Link>
                  .
                </p>
              ) : (
                <select
                  required
                  value={form.bankAccountId}
                  onChange={(e) => handleChange('bankAccountId', e.target.value)}
                  className={fieldClass}
                  disabled={saving}
                >
                  <option value="">Select account…</option>
                  {bankAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {bankAccountOptionLabel(a)}
                    </option>
                  ))}
                </select>
              )}
            </label>

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
                Amount (LKR)
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
              Note {needsNote ? <span className="text-rose-600">*</span> : <span className="font-normal text-slate-400">(optional)</span>}
              <textarea
                rows={2}
                required={needsNote}
                value={form.description}
                onChange={(e) => handleChange('description', e.target.value)}
                className={fieldClass}
                placeholder={needsNote ? 'Describe this expense' : 'Optional detail'}
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
              disabled={saving || blocked}
              className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
