/** Compact horizontal select — all accounts in one row (multi or single). */
export default function BankAccountMultiSelect({
  accounts,
  selectedIds,
  onChange,
  disabled = false,
  emptyMessage = 'No bank accounts. Add them under Shop.',
  singleSelect = false,
  accountAmounts = null,
  accountPendingAmounts = null,
  formatAmount = null,
  amountsLoading = false,
}) {
  const selectedSet = new Set(selectedIds || []);

  const pick = (id) => {
    if (disabled) return;
    if (singleSelect) {
      onChange([id]);
      return;
    }
    const next = selectedSet.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
    onChange(next);
  };

  const selectAll = () => {
    if (disabled || singleSelect) return;
    onChange(accounts.map((a) => a.id).filter(Boolean));
  };

  const clearAll = () => {
    if (disabled) return;
    onChange([]);
  };

  if (!accounts.length) {
    return <p className="text-sm text-slate-500">{emptyMessage}</p>;
  }

  const showAmounts = accountAmounts != null && typeof formatAmount === 'function';
  const showPending =
    showAmounts && accountPendingAmounts != null && typeof formatAmount === 'function';

  return (
    <div className="space-y-2">
      {!singleSelect ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={selectAll}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Select all
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={clearAll}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Clear
          </button>
          {selectedIds.length > 0 ? (
            <span className="text-xs font-medium text-indigo-700">{selectedIds.length} selected</span>
          ) : (
            <span className="text-xs text-slate-500">Select one or more</span>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          {selectedIds.length > 0 ? (
            <span className="font-medium text-indigo-700">Account selected</span>
          ) : (
            <span className="font-medium text-amber-800">Required — tap the account for this deposit</span>
          )}
        </p>
      )}
      <div
        className="-mx-1 flex gap-2 overflow-x-auto overscroll-x-contain px-1 pb-1 scrollbar-hide"
        role={singleSelect ? 'radiogroup' : undefined}
        aria-label="Bank accounts"
      >
        {accounts.map((a) => {
          const checked = selectedSet.has(a.id);
          const bankLine = [a.bank, a.accountNumber].filter((x) => String(x ?? '').trim()).join(' · ');
          return (
            <button
              key={a.id}
              type="button"
              disabled={disabled}
              onClick={() => pick(a.id)}
              role={singleSelect ? 'radio' : undefined}
              aria-checked={singleSelect ? checked : undefined}
              aria-pressed={!singleSelect ? checked : undefined}
              className={`min-w-[10rem] max-w-[12rem] shrink-0 rounded-xl px-3 py-2.5 text-left ring-1 transition ${
                checked ? 'bg-indigo-50 ring-indigo-200' : 'bg-white ring-slate-200 hover:ring-slate-300'
              } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
            >
              <span className="block truncate text-sm font-semibold text-slate-900">{a.nickName || '—'}</span>
              <span className="mt-0.5 block truncate text-[11px] leading-snug text-slate-500">{bankLine || '—'}</span>
              {showAmounts ? (
                <span
                  className={`mt-1.5 block text-sm font-bold tabular-nums tracking-tight ${
                    Number(accountAmounts[a.id]) < 0 ? 'text-red-700' : 'text-sky-800'
                  }`}
                >
                  {amountsLoading ? '—' : formatAmount(Number(accountAmounts[a.id]) || 0)}
                </span>
              ) : null}
              {showPending && Number(accountPendingAmounts[a.id]) > 0 ? (
                <span className="mt-0.5 block text-[11px] font-medium tabular-nums text-amber-800">
                  Pending out: {formatAmount(Number(accountPendingAmounts[a.id]) || 0)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function formatBankAccountsLabel(entry) {
  const snap = entry?.bankAccounts;
  if (Array.isArray(snap) && snap.length > 0) {
    return snap.map((a) => a.nickName || a.bank || a.id).filter(Boolean).join(', ');
  }
  const ids = entry?.bankAccountIds;
  if (Array.isArray(ids) && ids.length > 0) return ids.join(', ');
  return '';
}
