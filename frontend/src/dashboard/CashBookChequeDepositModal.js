import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getApiBase } from '../apiBase';
import { getUsername } from '../auth';
import { buildChequeTableRows, depositQueueRowKey } from './paymentCheques';
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

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function bankAccountOptionLabel(a) {
  const nick = String(a.nickName ?? '').trim() || 'Account';
  const detail = [a.bank, a.accountNumber].map((x) => String(x ?? '').trim()).filter(Boolean).join(' · ');
  return detail ? `${nick} — ${detail}` : nick;
}

function isChequeConvertible(chequeDate, asOf = todayYmdLocal()) {
  const cd = String(chequeDate ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cd)) return false;
  return cd <= asOf;
}

function buildPendingChequeRows(payments, asOf = todayYmdLocal()) {
  return buildChequeTableRows(payments, (p, c, flat) => {
    if (c.chequeDeposited || c.chequeReturned) return null;
    if (!isChequeConvertible(flat.chequeDate, asOf)) return null;
    return {
      rowKey: depositQueueRowKey({ id: p.id, chequeId: c.id }),
      paymentId: p.id,
      chequeId: c.id,
      customerName: String(p.customerName ?? '').trim() || '—',
      billNumber: p.billNumber != null ? String(p.billNumber) : '—',
      chequeNumber: flat.chequeNumber,
      chequeDate: flat.chequeDate,
      amount: flat.amount,
    };
  }).sort((a, b) => {
    const d = a.chequeDate.localeCompare(b.chequeDate);
    if (d !== 0) return d;
    return a.rowKey.localeCompare(b.rowKey);
  });
}

export default function CashBookChequeDepositModal({ open, onClose, onSaved, bankAccounts = [] }) {
  const [date, setDate] = useState(todayYmdLocal);
  const [bankAccountId, setBankAccountId] = useState('');
  const [description, setDescription] = useState('');
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [pendingRows, setPendingRows] = useState([]);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [queueError, setQueueError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    setQueueError(null);
    try {
      const res = await fetch(`${apiBase}/api/payments`);
      if (!res.ok) throw new Error('Failed to load cheques');
      const data = await res.json();
      const payments = Array.isArray(data) ? data : [];
      setPendingRows(buildPendingChequeRows(payments));
    } catch (e) {
      setQueueError(e.message || 'Could not load pending cheques');
      setPendingRows([]);
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setDate(todayYmdLocal());
    setBankAccountId('');
    setDescription('');
    setSelectedKeys([]);
    setSaveError(null);
    loadQueue();
  }, [open, loadQueue]);

  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  const selectedTotal = useMemo(
    () => pendingRows.filter((r) => selectedSet.has(r.rowKey)).reduce((s, r) => s + r.amount, 0),
    [pendingRows, selectedSet],
  );

  const toggleRow = (rowKey) => {
    setSelectedKeys((prev) =>
      prev.includes(rowKey) ? prev.filter((k) => k !== rowKey) : [...prev, rowKey],
    );
  };

  const selectAll = () => setSelectedKeys(pendingRows.map((r) => r.rowKey));
  const clearAll = () => setSelectedKeys([]);

  const blocked =
    bankAccounts.length === 0 || !bankAccountId || selectedKeys.length === 0 || loadingQueue;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const recordedBy = getUsername().trim();
    if (!recordedBy) {
      setSaveError('Sign in with a username to record deposits.');
      return;
    }
    if (!bankAccountId) {
      setSaveError('Select the bank account for this deposit.');
      return;
    }
    if (selectedKeys.length === 0) {
      setSaveError('Select at least one cheque.');
      return;
    }
    const byKey = new Map(pendingRows.map((r) => [r.rowKey, r]));
    const cheques = selectedKeys
      .map((key) => byKey.get(key))
      .filter(Boolean)
      .map((r) => ({
        paymentId: r.paymentId,
        ...(r.chequeId && r.chequeId !== '_legacy' ? { chequeId: r.chequeId } : {}),
      }));

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${apiBase}/api/cheque-deposits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordedBy,
          bankAccountId,
          date,
          description,
          cheques,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || 'Save failed');
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
      aria-labelledby="cheque-deposit-title"
    >
      <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" aria-label="Close" onClick={onClose} />
      <div
        className={`${modalPanelClass} flex max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-bottom,0px)))] w-full max-w-none flex-col overflow-hidden !p-0 sm:max-w-lg`}
      >
        <div className="shrink-0 border-b border-slate-100 px-4 pb-3 pt-3 sm:px-6 sm:pt-6">
          <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-slate-300/90 sm:hidden" aria-hidden />
          <h2 id="cheque-deposit-title" className="text-lg font-bold text-slate-900">
            Cheque deposits
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Choose the shop account and cheques to deposit. Only cheques whose converting date is today or
            earlier are listed.
          </p>
        </div>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            {saveError ? (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{saveError}</p>
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
                  value={bankAccountId}
                  onChange={(e) => setBankAccountId(e.target.value)}
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

            <label className="block text-sm font-medium text-slate-600">
              Deposit date
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={fieldClass}
                disabled={saving}
              />
            </label>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-600">
                  Cheques to deposit <span className="text-rose-600">*</span>
                </p>
                {pendingRows.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={saving || loadingQueue}
                      onClick={selectAll}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      disabled={saving || loadingQueue}
                      onClick={clearAll}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Clear
                    </button>
                    {selectedKeys.length > 0 ? (
                      <span className="text-xs font-medium text-indigo-700">
                        {selectedKeys.length} selected · {money(selectedTotal)}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">Select one or more</span>
                    )}
                  </div>
                ) : null}
              </div>
              {queueError ? (
                <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{queueError}</p>
              ) : null}
              {loadingQueue ? (
                <p className="mt-3 text-sm text-slate-500">Loading pending cheques…</p>
              ) : pendingRows.length === 0 ? (
                <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-600 ring-1 ring-slate-100">
                  No cheques ready to deposit. Future-dated cheques appear here once their converting date
                  arrives.
                </p>
              ) : (
                <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto overscroll-contain pr-1">
                  {pendingRows.map((r) => {
                    const checked = selectedSet.has(r.rowKey);
                    return (
                      <li key={r.rowKey}>
                        <label
                          className={`flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 ring-1 transition ${
                            checked ? 'bg-indigo-50 ring-indigo-200' : 'bg-white ring-slate-200 hover:ring-slate-300'
                          } ${saving ? 'cursor-not-allowed opacity-60' : ''}`}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/35"
                            checked={checked}
                            disabled={saving}
                            onChange={() => toggleRow(r.rowKey)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-slate-900">
                              {r.chequeNumber !== '—' ? r.chequeNumber : 'Cheque'}{' '}
                              <span className="font-normal text-slate-500">· {money(r.amount)}</span>
                            </span>
                            <span className="mt-0.5 block text-xs text-slate-500">
                              {r.chequeDate} · {r.customerName} · Bill #{r.billNumber}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <label className="block text-sm font-medium text-slate-600">
              Note <span className="font-normal text-slate-400">(optional)</span>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={fieldClass}
                placeholder="Branch, slip #, etc."
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
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Record deposit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
