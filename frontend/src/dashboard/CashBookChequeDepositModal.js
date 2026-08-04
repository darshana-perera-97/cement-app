import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getApiBase } from '../apiBase';
import { authFetch, getUsername } from '../auth';
import { buildChequeTableRows, depositQueueRowKey } from './paymentCheques';
import {
  filterControl,
  modalPanelClass,
  rowMatchesQuery,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
} from './tableToolbar';

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

function formatDisplayDate(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '—';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function bankAccountOptionLabel(a) {
  const nick = String(a.nickName ?? '').trim() || 'Account';
  const detail = [a.bank, a.accountNumber].map((x) => String(x ?? '').trim()).filter(Boolean).join(' · ');
  return detail ? `${nick} — ${detail}` : nick;
}

function isChequeConvertingDateReady(chequeDate, asOf = todayYmdLocal()) {
  const cd = String(chequeDate ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cd)) return false;
  return cd <= asOf;
}

function buildPendingCustomerChequeRows(payments, asOf = todayYmdLocal()) {
  return buildChequeTableRows(payments, (p, c, flat) => {
    if (c.chequeDeposited || c.chequeReturned) return null;
    if (!isChequeConvertingDateReady(flat.chequeDate, asOf)) return null;
    return {
      rowKey: depositQueueRowKey({ id: p.id, chequeId: c.id }),
      source: 'customer',
      paymentId: p.id,
      chequeId: c.id,
      fromLabel: String(p.customerName ?? '').trim() || '—',
      refLabel: p.billNumber != null ? String(p.billNumber) : '—',
      chequeNumber: flat.chequeNumber,
      chequeDate: flat.chequeDate,
      amount: flat.amount,
    };
  });
}

function buildPendingCompanyChequeRows(entries, asOf = todayYmdLocal()) {
  const rows = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (String(e.category ?? '').trim() !== 'company_cheque') continue;
    if (e.chequeDeposited) continue;
    const amount = Math.max(0, Number(e.amount) || 0);
    if (amount <= 0) continue;
    const chequeDate = String(e.chequeDate ?? e.date ?? '').slice(0, 10);
    if (!isChequeConvertingDateReady(chequeDate, asOf)) continue;
    rows.push({
      rowKey: `company:${e.id}`,
      source: 'company',
      cashBookEntryId: e.id,
      fromLabel: 'Company',
      refLabel: String(e.date ?? '').slice(0, 10) || '—',
      chequeNumber: String(e.chequeNumber ?? '').trim() || '—',
      chequeDate,
      amount,
    });
  }
  return rows;
}

function buildPendingOwnerChequeRows(entries, asOf = todayYmdLocal()) {
  const rows = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (String(e.category ?? '').trim() !== 'owner_share') continue;
    if (String(e.ownerShareDirection ?? '').trim() !== 'from_owner') continue;
    if (String(e.paymentMethod ?? '').trim() !== 'cheque') continue;
    if (e.chequeDeposited) continue;
    const amount = Math.max(0, Number(e.amount) || 0);
    if (amount <= 0) continue;
    const chequeDate = String(e.chequeDate ?? e.date ?? '').slice(0, 10);
    if (!isChequeConvertingDateReady(chequeDate, asOf)) continue;
    rows.push({
      rowKey: `owner:${e.id}`,
      source: 'owner',
      cashBookEntryId: e.id,
      fromLabel: 'Owner',
      refLabel: String(e.description ?? '').trim() || String(e.date ?? '').slice(0, 10) || '—',
      chequeNumber: String(e.chequeNumber ?? '').trim() || '—',
      chequeDate,
      amount,
    });
  }
  return rows;
}

function buildPendingChequeRows(payments, companyCheques, ownerCheques, asOf = todayYmdLocal()) {
  return [
    ...buildPendingCustomerChequeRows(payments, asOf),
    ...buildPendingCompanyChequeRows(companyCheques, asOf),
    ...buildPendingOwnerChequeRows(ownerCheques, asOf),
  ].sort(
    (a, b) => {
      const d = a.chequeDate.localeCompare(b.chequeDate);
      if (d !== 0) return d;
      return a.rowKey.localeCompare(b.rowKey);
    },
  );
}

export default function CashBookChequeDepositModal({ open, onClose, onSaved, bankAccounts = [] }) {
  const [date, setDate] = useState(todayYmdLocal);
  const [bankAccountId, setBankAccountId] = useState('');
  const [description, setDescription] = useState('');
  const [search, setSearch] = useState('');
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [payments, setPayments] = useState([]);
  const [companyCheques, setCompanyCheques] = useState([]);
  const [ownerCheques, setOwnerCheques] = useState([]);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [queueError, setQueueError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    setQueueError(null);
    try {
      const [payRes, ccRes, ownerRes] = await Promise.all([
        authFetch(`${apiBase}/api/payments`),
        authFetch(`${apiBase}/api/cash-book-entries?category=company_cheque`),
        authFetch(`${apiBase}/api/cash-book-entries?category=owner_share`),
      ]);
      if (!payRes.ok) throw new Error('Failed to load cheques');
      const payData = await payRes.json();
      setPayments(Array.isArray(payData) ? payData : []);
      if (ccRes.ok) {
        const ccData = await ccRes.json();
        setCompanyCheques(Array.isArray(ccData) ? ccData : []);
      } else {
        setCompanyCheques([]);
      }
      if (ownerRes.ok) {
        const ownerData = await ownerRes.json();
        setOwnerCheques(Array.isArray(ownerData) ? ownerData : []);
      } else {
        setOwnerCheques([]);
      }
    } catch (e) {
      setQueueError(e.message || 'Could not load pending cheques');
      setPayments([]);
      setCompanyCheques([]);
      setOwnerCheques([]);
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setDate(todayYmdLocal());
    setBankAccountId('');
    setDescription('');
    setSearch('');
    setSelectedKeys([]);
    setSaveError(null);
    loadQueue();
  }, [open, loadQueue]);

  const pendingRows = useMemo(
    () => buildPendingChequeRows(payments, companyCheques, ownerCheques),
    [payments, companyCheques, ownerCheques],
  );

  const filteredRows = useMemo(
    () =>
      pendingRows.filter((row) =>
        rowMatchesQuery(search, [
          row.fromLabel,
          row.refLabel,
          row.source,
          row.chequeNumber,
          row.chequeDate,
          row.amount,
        ]),
      ),
    [pendingRows, search],
  );

  useEffect(() => {
    const valid = new Set(pendingRows.map((r) => r.rowKey));
    setSelectedKeys((prev) => prev.filter((k) => valid.has(k)));
  }, [pendingRows]);

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

  const selectAll = () => setSelectedKeys(filteredRows.map((r) => r.rowKey));
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
      .map((r) => {
        if (r.source === 'company' || r.source === 'owner' || r.cashBookEntryId) {
          return { cashBookEntryId: r.cashBookEntryId || String(r.rowKey).replace(/^(company|owner):/, '') };
        }
        return {
          paymentId: r.paymentId,
          ...(r.chequeId && r.chequeId !== '_legacy' ? { chequeId: r.chequeId } : {}),
        };
      });

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

  const todayLabel = formatDisplayDate(todayYmdLocal());
  const showChequeList = !loadingQueue && pendingRows.length > 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cheque-deposit-title"
    >
      <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" aria-label="Close" onClick={onClose} />
      <div
        className={`${modalPanelClass} flex max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-bottom,0px)))] w-full max-w-none flex-col overflow-hidden !p-0 sm:max-w-2xl`}
      >
        <div className="shrink-0 border-b border-slate-100 px-4 pb-3 pt-3 sm:px-6 sm:pt-6">
          <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-slate-300/90 sm:hidden" aria-hidden />
          <h2 id="cheque-deposit-title" className="text-lg font-bold text-slate-900">
            Cheque deposits
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Choose the shop account and cheques to deposit. Customer and company cheques whose converting date is today
            or earlier are listed here.
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
                {showChequeList ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={saving || loadingQueue || filteredRows.length === 0}
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

              {showChequeList ? (
                <p className="mt-1 text-xs text-slate-500">
                  {pendingRows.length} cheque{pendingRows.length === 1 ? '' : 's'} with converting date on or before{' '}
                  {todayLabel}
                  {search.trim() && filteredRows.length !== pendingRows.length
                    ? ` · ${filteredRows.length} match search`
                    : ''}
                </p>
              ) : null}

              {showChequeList ? (
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search customer, company, bill #, cheque #…"
                  className={`${filterControl} mt-2`}
                  disabled={saving}
                />
              ) : null}

              {queueError ? (
                <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{queueError}</p>
              ) : null}
              {loadingQueue ? (
                <p className="mt-3 text-sm text-slate-500">Loading pending cheques…</p>
              ) : pendingRows.length === 0 ? (
                <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-600 ring-1 ring-slate-100">
                  No cheques ready to deposit. Future-dated cheques appear here once their converting date has passed.
                </p>
              ) : filteredRows.length === 0 ? (
                <p className="mt-3 rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-600 ring-1 ring-slate-100">
                  No cheques match your search.
                </p>
              ) : (
                <>
                  <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto overscroll-contain pr-1 sm:hidden">
                    {filteredRows.map((r) => {
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
                              <span className="block text-sm font-semibold text-slate-900">{r.fromLabel}</span>
                              <span className="mt-0.5 block text-xs text-slate-500">
                                {r.source === 'company'
                                  ? `Received ${r.refLabel}`
                                  : r.source === 'owner'
                                    ? r.refLabel
                                    : `Bill #${r.refLabel}`}{' '}
                                · Cheque #{r.chequeNumber}
                              </span>
                              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                                <span className="text-slate-500">
                                  Converting {formatDisplayDate(r.chequeDate)}
                                </span>
                                <span className="font-semibold tabular-nums text-violet-800">{money(r.amount)}</span>
                              </span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>

                  <div className={`mt-2 hidden max-h-64 overflow-y-auto overscroll-contain sm:block ${scrollTableWrap}`}>
                    <table className="w-full min-w-[540px] border-separate border-spacing-0 text-left text-sm">
                      <thead className={stickyThead}>
                        <tr className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          <th className="w-10 px-2 py-2">
                            <span className="sr-only">Select</span>
                          </th>
                          <th className={`px-3 py-2 ${stickyFirstTh}`}>From</th>
                          <th className="whitespace-nowrap px-3 py-2 font-mono">Ref</th>
                          <th className="whitespace-nowrap px-3 py-2 font-mono">Cheque #</th>
                          <th className="whitespace-nowrap px-3 py-2">Converting</th>
                          <th className="whitespace-nowrap px-3 py-2 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-800">
                        {filteredRows.map((r) => {
                          const checked = selectedSet.has(r.rowKey);
                          return (
                            <tr
                              key={r.rowKey}
                              className={`cursor-pointer transition ${checked ? 'bg-indigo-50/70 hover:bg-indigo-50' : 'hover:bg-slate-50/80'}`}
                              onClick={() => !saving && toggleRow(r.rowKey)}
                            >
                              <td className="px-2 py-2.5">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/35"
                                  checked={checked}
                                  disabled={saving}
                                  onChange={() => toggleRow(r.rowKey)}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </td>
                              <td className={`max-w-[160px] px-3 py-2.5 font-medium text-slate-900 ${stickyFirstTd}`}>
                                <span className="line-clamp-2">{r.fromLabel}</span>
                              </td>
                              <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs tabular-nums">
                                {r.source === 'company' ? r.refLabel : r.refLabel}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{r.chequeNumber}</td>
                              <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-600">
                                {formatDisplayDate(r.chequeDate)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-violet-800">
                                {money(r.amount)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
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
