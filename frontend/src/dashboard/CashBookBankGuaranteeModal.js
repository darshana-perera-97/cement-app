import { useCallback, useEffect, useState } from 'react';
import { getApiBase } from '../apiBase';
import { getUsername } from '../auth';
import { modalPanelClass } from './tableToolbar';
import { BANK_GUARANTEE_TYPE_OPTIONS } from './cashBookCategories';

const apiBase = getApiBase();

const fieldClass =
  'mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35';

function todayYmdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function bankAccountOptionLabel(a) {
  const nick = String(a.nickName ?? '').trim() || 'Account';
  const detail = [a.bank, a.accountNumber].map((x) => String(x ?? '').trim()).filter(Boolean).join(' · ');
  return detail ? `${nick} — ${detail}` : nick;
}

const emptyForm = () => ({
  date: todayYmdLocal(),
  expireDate: '',
  amount: '',
  guaranteeType: 'fixed_deposit',
  guaranteeTypeOther: '',
  bankAccountId: '',
  distributorId: '',
  description: '',
});

export default function CashBookBankGuaranteeModal({ open, onClose, onSaved, bankAccounts = [], distributors = [] }) {
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
      setSaveError('Sign in with a username to record a bank guarantee.');
      return;
    }
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setSaveError('Enter a valid amount.');
      return;
    }
    if (form.guaranteeType === 'other' && !String(form.guaranteeTypeOther ?? '').trim()) {
      setSaveError('Describe the guarantee type when Other is selected.');
      return;
    }
    const distributorId = String(form.distributorId ?? '').trim();
    if (!distributorId) {
      setSaveError('Select a distributor.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const body = {
        date: form.date,
        amount,
        guaranteeType: form.guaranteeType,
        description: String(form.description ?? '').trim(),
        recordedBy,
        distributorId,
      };
      if (form.guaranteeType === 'other') {
        body.guaranteeTypeOther = String(form.guaranteeTypeOther ?? '').trim();
      }
      const bankAccountId = String(form.bankAccountId ?? '').trim();
      if (bankAccountId) body.bankAccountId = bankAccountId;
      const expireDate = String(form.expireDate ?? '').trim();
      if (expireDate) body.expireDate = expireDate;
      const res = await fetch(`${apiBase}/api/bank-guarantees`, {
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

  const isOther = form.guaranteeType === 'other';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bank-guarantee-title"
    >
      <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" aria-label="Close" onClick={onClose} />
      <div
        className={`${modalPanelClass} flex max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-bottom,0px)))] w-full max-w-none flex-col overflow-hidden !p-0 sm:max-w-lg`}
      >
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
          <h2 id="bank-guarantee-title" className="text-lg font-bold text-slate-900">
            Add bank guarantee
          </h2>
          <p className="mt-1 text-sm text-slate-500">Record collateral held at the bank for a specific distributor.</p>
        </div>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
            <label className="block text-sm font-medium text-slate-700">
              Distributor
              <select
                value={form.distributorId}
                onChange={(e) => handleChange('distributorId', e.target.value)}
                className={fieldClass}
                required
              >
                <option value="">— Select distributor —</option>
                {distributors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {String(d.name ?? '').trim() || d.id}
                  </option>
                ))}
              </select>
            </label>
            {distributors.length === 0 ? (
              <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-100">
                Add distributors in Shop before recording a bank guarantee.
              </p>
            ) : null}
            <label className="block text-sm font-medium text-slate-700">
              Type
              <select
                value={form.guaranteeType}
                onChange={(e) => handleChange('guaranteeType', e.target.value)}
                className={fieldClass}
                required
              >
                {BANK_GUARANTEE_TYPE_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {isOther ? (
              <label className="block text-sm font-medium text-slate-700">
                Other type description
                <input
                  type="text"
                  value={form.guaranteeTypeOther}
                  onChange={(e) => handleChange('guaranteeTypeOther', e.target.value)}
                  className={fieldClass}
                  placeholder="Describe the guarantee type"
                  required
                />
              </label>
            ) : null}
            <label className="block text-sm font-medium text-slate-700">
              Date
              <input
                type="date"
                value={form.date}
                onChange={(e) => handleChange('date', e.target.value)}
                className={fieldClass}
                required
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Expiry date <span className="font-normal text-slate-400">(optional)</span>
              <input
                type="date"
                value={form.expireDate}
                onChange={(e) => handleChange('expireDate', e.target.value)}
                className={fieldClass}
                min={form.date || undefined}
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Amount (LKR)
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => handleChange('amount', e.target.value)}
                className={fieldClass}
                placeholder="0"
                required
              />
            </label>
            {bankAccounts.length > 0 ? (
              <label className="block text-sm font-medium text-slate-700">
                Bank account <span className="font-normal text-slate-400">(optional)</span>
                <select
                  value={form.bankAccountId}
                  onChange={(e) => handleChange('bankAccountId', e.target.value)}
                  className={fieldClass}
                >
                  <option value="">— Not linked to an account —</option>
                  {bankAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {bankAccountOptionLabel(a)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="block text-sm font-medium text-slate-700">
              Notes <span className="font-normal text-slate-400">(optional)</span>
              <textarea
                value={form.description}
                onChange={(e) => handleChange('description', e.target.value)}
                className={`${fieldClass} min-h-[4.5rem] resize-y`}
                placeholder="Reference, bank branch…"
                rows={3}
              />
            </label>
            {saveError ? (
              <p className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-800 ring-1 ring-red-100" role="alert">
                {saveError}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2 border-t border-slate-100 px-5 py-4 sm:px-6">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || distributors.length === 0}
              className="flex-1 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition hover:brightness-[1.03] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Add guarantee'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
