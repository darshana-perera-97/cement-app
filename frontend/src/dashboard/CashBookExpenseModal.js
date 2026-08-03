import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getApiBase } from '../apiBase';
import { getUsername } from '../auth';
import { modalPanelClass } from './tableToolbar';
import { modalTitleForCategory, BANK_DEPOSIT_TYPE_OPTIONS } from './cashBookCategories';

const apiBase = getApiBase();

function todayYmdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const emptyForm = (initialBankAccountIds = []) => ({
  date: todayYmdLocal(),
  amount: '',
  description: '',
  staffUserId: '',
  lorryId: '',
  meterReading: '',
  bankAccountIds: Array.isArray(initialBankAccountIds) ? [...initialBankAccountIds] : [],
  depositType: 'bank_deposit',
  depositTypeOther: '',
});

const fieldClass =
  'mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35';

function bankAccountOptionLabel(a) {
  const nick = String(a.nickName ?? '').trim() || 'Account';
  const detail = [a.bank, a.accountNumber].map((x) => String(x ?? '').trim()).filter(Boolean).join(' · ');
  return detail ? `${nick} — ${detail}` : nick;
}

const NO_INITIAL_BANK_ACCOUNT_IDS = [];

function normalizeFormFields(form) {
  const base = emptyForm();
  return {
    ...base,
    ...form,
    bankAccountIds: Array.isArray(form?.bankAccountIds) ? [...form.bankAccountIds] : base.bankAccountIds,
    depositType: String(form?.depositType ?? base.depositType),
    depositTypeOther: String(form?.depositTypeOther ?? ''),
    description: String(form?.description ?? ''),
  };
}

export default function CashBookExpenseModal({
  open,
  category,
  onClose,
  onSaved,
  staff,
  lorries,
  bankAccounts = [],
  initialBankAccountIds = NO_INITIAL_BANK_ACCOUNT_IDS,
}) {
  const [form, setForm] = useState(() => normalizeFormFields(emptyForm(initialBankAccountIds)));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (!open || !category) return;
    let ids = Array.isArray(initialBankAccountIds) ? [...initialBankAccountIds] : [];
    if (category === 'bank_deposit' && ids.length > 1) {
      ids = [ids[0]];
    }
    setForm(normalizeFormFields(emptyForm(ids)));
    setSaveError(null);
    // Reset only when the dialog opens or the seeded account ids change — not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialBankAccountIds joined for stable compare
  }, [open, category, initialBankAccountIds.join('|')]);

  const handleChange = useCallback((key, value) => {
    setForm((prev) => normalizeFormFields({ ...prev, [key]: value }));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!category) return;
    const f = normalizeFormFields(form);
    const recordedBy = getUsername().trim();
    if (!recordedBy) {
      setSaveError('Sign in with a username to record expenses.');
      return;
    }
    if (category === 'bank_deposit' && f.bankAccountIds.length === 0) {
      setSaveError('Select the bank account for this deposit.');
      return;
    }
    if (category === 'bank_deposit' && !f.depositType) {
      setSaveError('Select a deposit type.');
      return;
    }
    if (category === 'bank_deposit' && f.depositType === 'other' && !f.depositTypeOther.trim()) {
      setSaveError('Describe the deposit type when Other is selected.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const body = {
        category,
        date: f.date,
        amount: f.amount,
        description: f.description,
        recordedBy,
        staffUserId: f.staffUserId,
        lorryId: f.lorryId,
        meterReading: f.meterReading,
        bankAccountIds: f.bankAccountIds,
        depositType: f.depositType,
        depositTypeOther: f.depositTypeOther,
      };
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

  if (!open || !category) return null;

  const f = normalizeFormFields(form);
  const title = modalTitleForCategory(category);
  const depositBlocked =
    category === 'bank_deposit' &&
    (bankAccounts.length === 0 ||
      f.bankAccountIds.length === 0 ||
      !f.depositType ||
      (f.depositType === 'other' && !f.depositTypeOther.trim()));

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cash-book-expense-title"
    >
      <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" aria-label="Close" onClick={onClose} />
      <div
        className={`${modalPanelClass} flex max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-bottom,0px)))] w-full max-w-none flex-col overflow-hidden !p-0 sm:max-w-lg`}
      >
        <div className="shrink-0 border-b border-slate-100 px-4 pb-3 pt-3 sm:px-6 sm:pt-6">
          <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-slate-300/90 sm:hidden" aria-hidden />
          <h2 id="cash-book-expense-title" className="text-lg font-bold text-slate-900">
            {title}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {category === 'bank_deposit'
              ? 'Reduces cashier cash on hand and adds a deposit on the selected bank account(s).'
              : 'Recorded as cash out from the cashier.'}
          </p>
        </div>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            {saveError ? (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{saveError}</p>
            ) : null}

            {category === 'bank_deposit' ? (
              <>
                <label className="block text-sm font-medium text-slate-600">
                  Deposit type <span className="text-rose-600">*</span>
                  <select
                    required
                    value={f.depositType}
                    onChange={(e) => handleChange('depositType', e.target.value)}
                    className={fieldClass}
                    disabled={saving}
                  >
                    {BANK_DEPOSIT_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                {f.depositType === 'other' ? (
                  <label className="block text-sm font-medium text-slate-600">
                    Other type <span className="text-rose-600">*</span>
                    <input
                      type="text"
                      required
                      value={f.depositTypeOther}
                      onChange={(e) => handleChange('depositTypeOther', e.target.value)}
                      className={fieldClass}
                      placeholder="Describe how the cash was deposited"
                      disabled={saving}
                    />
                  </label>
                ) : null}
                <label className="block text-sm font-medium text-slate-600">
                  Deposit to account <span className="text-rose-600">*</span>
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
                      value={f.bankAccountIds[0] || ''}
                      onChange={(e) => {
                        const id = e.target.value;
                        handleChange('bankAccountIds', id ? [id] : []);
                      }}
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
              </>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-600">
                Date
                <input
                  type="date"
                  required
                  value={f.date}
                  onChange={(e) => handleChange('date', e.target.value)}
                  className={fieldClass}
                />
              </label>
              <label className="block text-sm font-medium text-slate-600">
                Amount (LKR)
                <input
                  type="number"
                  required
                  min="0.01"
                  step="0.01"
                  value={f.amount}
                  onChange={(e) => handleChange('amount', e.target.value)}
                  className={`${fieldClass} tabular-nums`}
                  placeholder="0.00"
                />
              </label>
            </div>

            {category === 'salary' ? (
              <>
                <label className="block text-sm font-medium text-slate-600">
                  Person
                  <select
                    required
                    value={f.staffUserId}
                    onChange={(e) => handleChange('staffUserId', e.target.value)}
                    className={fieldClass}
                    disabled={staff.length === 0}
                  >
                    <option value="">{staff.length === 0 ? 'No staff yet' : 'Select person…'}</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.role ? ` (${s.role})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium text-slate-600">
                  Description
                  <textarea
                    required
                    rows={3}
                    value={f.description}
                    onChange={(e) => handleChange('description', e.target.value)}
                    className={fieldClass}
                    placeholder="e.g. March salary, advance…"
                  />
                </label>
              </>
            ) : null}

            {category === 'fuel' ? (
              <>
                <label className="block text-sm font-medium text-slate-600">
                  Lorry
                  <select
                    required
                    value={f.lorryId}
                    onChange={(e) => handleChange('lorryId', e.target.value)}
                    className={fieldClass}
                    disabled={lorries.length === 0}
                  >
                    <option value="">{lorries.length === 0 ? 'No lorries yet' : 'Select lorry…'}</option>
                    {lorries.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.number}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium text-slate-600">
                  Current meter reading
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={f.meterReading}
                    onChange={(e) => handleChange('meterReading', e.target.value)}
                    className={`${fieldClass} tabular-nums`}
                    placeholder="Odometer / meter value"
                  />
                </label>
              </>
            ) : null}

            {category === 'maintenance' ? (
              <>
                <label className="block text-sm font-medium text-slate-600">
                  Vehicle
                  <select
                    required
                    value={f.lorryId}
                    onChange={(e) => handleChange('lorryId', e.target.value)}
                    className={fieldClass}
                    disabled={lorries.length === 0}
                  >
                    <option value="">{lorries.length === 0 ? 'No vehicles yet' : 'Select vehicle…'}</option>
                    {lorries.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.number}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium text-slate-600">
                  Description
                  <textarea
                    required
                    rows={3}
                    value={f.description}
                    onChange={(e) => handleChange('description', e.target.value)}
                    className={fieldClass}
                    placeholder="What was repaired or serviced?"
                  />
                </label>
              </>
            ) : null}

            {category === 'other' ? (
              <label className="block text-sm font-medium text-slate-600">
                Description
                <textarea
                  required
                  rows={3}
                  value={f.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  className={fieldClass}
                  placeholder="What was this expense for?"
                />
              </label>
            ) : null}

            {category === 'bank_deposit' ? (
              <label className="block text-sm font-medium text-slate-600">
                Note <span className="font-normal text-slate-400">(optional)</span>
                <textarea
                  rows={2}
                  value={f.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  className={fieldClass}
                  placeholder="Branch, slip #, etc."
                />
              </label>
            ) : null}
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
              disabled={saving || depositBlocked}
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
