import { useCallback, useEffect, useState } from 'react';
import { getApiBase } from '../apiBase';
import { getUsername } from '../auth';
import { modalPanelClass } from './tableToolbar';

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

const emptyForm = () => ({
  date: todayYmdLocal(),
  chequeDate: todayYmdLocal(),
  chequeNumber: '',
  amount: '',
  description: '',
});

export default function CashBookCompanyChequeModal({ open, onClose, onSaved }) {
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
      setSaveError('Sign in with a username to record cheques.');
      return;
    }
    const chequeNumber = String(form.chequeNumber ?? '').trim();
    if (!chequeNumber) {
      setSaveError('Cheque number is required.');
      return;
    }
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setSaveError('Enter a valid cheque amount.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${apiBase}/api/cash-book-entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'company_cheque',
          date: form.date,
          chequeDate: form.chequeDate,
          chequeNumber,
          amount,
          description: String(form.description ?? '').trim(),
          recordedBy,
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

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="company-cheque-title"
    >
      <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" aria-label="Close" onClick={onClose} />
      <div
        className={`${modalPanelClass} flex max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-bottom,0px)))] w-full max-w-none flex-col overflow-hidden !p-0 sm:max-w-lg`}
      >
        <div className="shrink-0 border-b border-slate-100 px-4 pb-3 pt-3 sm:px-6 sm:pt-6">
          <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-slate-300/90 sm:hidden" aria-hidden />
          <h2 id="company-cheque-title" className="text-lg font-bold text-slate-900">
            Company cheque
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Record a company cheque received and add it to the cashier.
          </p>
        </div>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            {saveError ? (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{saveError}</p>
            ) : null}

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

            <div className="grid gap-3 sm:grid-cols-2">
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
              <label className="block text-sm font-medium text-slate-600">
                Record date
                <input
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => handleChange('date', e.target.value)}
                  className={fieldClass}
                  disabled={saving}
                />
              </label>
            </div>

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

            <label className="block text-sm font-medium text-slate-600">
              Note <span className="font-normal text-slate-400">(optional)</span>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => handleChange('description', e.target.value)}
                className={fieldClass}
                placeholder="Source, payer, etc."
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
              className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Add cheque'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
