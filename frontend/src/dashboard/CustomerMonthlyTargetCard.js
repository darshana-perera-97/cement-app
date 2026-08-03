function formatTargetMonthLabel(monthLabel) {
  const raw = String(monthLabel ?? '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})$/);
  if (!match) return raw || '';
  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return raw;
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/**
 * Featured monthly bag target for the customer account page.
 */
export default function CustomerMonthlyTargetCard({
  sold = 0,
  target = 0,
  progressPct = null,
  monthLabel = '',
  onSetTarget = null,
  embedded = false,
}) {
  const tgt = Math.max(0, Number(target) || 0);
  const sld = Math.max(0, Number(sold) || 0);
  const monthText = formatTargetMonthLabel(monthLabel);

  if (tgt <= 0) {
    return (
      <div
        className={`rounded-xl bg-white/90 ring-1 ring-slate-200/80 ${
          embedded ? 'p-3' : 'flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'
        }`}
      >
        <div className="min-w-0">
          <p className={`font-bold text-slate-900 ${embedded ? 'text-xs uppercase tracking-wide text-slate-500' : 'text-sm'}`}>
            Monthly bag target
          </p>
          <p className={`text-slate-600 ${embedded ? 'mt-1 text-xs' : 'mt-1 text-sm'}`}>
            {embedded ? 'No target set.' : 'Track credit sales bags against a monthly goal for this customer.'}
          </p>
        </div>
        {onSetTarget ? (
          <button
            type="button"
            onClick={onSetTarget}
            className={`shrink-0 rounded-lg border border-indigo-200 bg-white font-semibold text-indigo-800 shadow-sm transition hover:bg-indigo-50 ${
              embedded ? 'mt-2 w-full px-2.5 py-1.5 text-xs' : 'rounded-xl px-4 py-2.5 text-sm'
            }`}
          >
            Set target
          </button>
        ) : embedded ? (
          <p className="mt-1 text-xs text-slate-400">Not configured</p>
        ) : (
          <p className="text-sm text-slate-400">Not configured</p>
        )}
      </div>
    );
  }

  const pct = progressPct != null ? Number(progressPct) : Math.round((sld / tgt) * 1000) / 10;
  const barWidth = Math.min(100, pct);
  const met = sld >= tgt;
  const remaining = Math.max(0, tgt - sld);
  const overBy = Math.max(0, sld - tgt);

  let statusLabel = 'In progress';
  let statusClass = 'bg-indigo-100 text-indigo-900 ring-indigo-200/80';
  if (met) {
    statusLabel = overBy > 0 ? 'Above target' : 'Target met';
    statusClass = 'bg-emerald-100 text-emerald-900 ring-emerald-200/80';
  } else if (pct >= 75) {
    statusLabel = 'Almost there';
    statusClass = 'bg-amber-50 text-amber-900 ring-amber-200/80';
  }

  if (embedded) {
    return (
      <div className="rounded-xl bg-white/90 p-3 ring-1 ring-indigo-100/80">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Monthly bag target</p>
            {monthText ? <p className="mt-0.5 text-xs font-medium text-slate-600">{monthText}</p> : null}
          </div>
          {onSetTarget ? (
            <button
              type="button"
              onClick={onSetTarget}
              className="shrink-0 text-xs font-semibold text-indigo-700 hover:text-indigo-900"
            >
              Edit
            </button>
          ) : null}
        </div>
        <p className="mt-2 text-xl font-bold tabular-nums text-slate-900">
          {sld.toLocaleString()}
          <span className="text-sm font-semibold text-slate-400"> / {tgt.toLocaleString()}</span>
        </p>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"
          role="progressbar"
          aria-valuenow={Math.min(sld, tgt)}
          aria-valuemin={0}
          aria-valuemax={tgt}
        >
          <div
            className={`h-full rounded-full ${met ? 'bg-emerald-500' : 'bg-indigo-500'}`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1 text-xs">
          <span className={`font-bold tabular-nums ${met ? 'text-emerald-700' : 'text-indigo-700'}`}>{pct}%</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${statusClass}`}
          >
            {statusLabel}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-600">
          {met
            ? overBy > 0
              ? `+${overBy.toLocaleString()} over target`
              : 'Goal reached'
            : `${remaining.toLocaleString()} bags to go`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-slate-900">Monthly bag target</h3>
            {monthText ? (
              <span className="rounded-full bg-white/90 px-2.5 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200/90">
                {monthText}
              </span>
            ) : null}
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ring-1 ${statusClass}`}
            >
              {statusLabel}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            Credit sales bags dated in this calendar month (all brands).
          </p>
        </div>
        {onSetTarget ? (
          <button
            type="button"
            onClick={onSetTarget}
            className="rounded-lg border border-slate-200/90 bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-indigo-200 hover:text-indigo-800"
          >
            Edit target
          </button>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_minmax(0,14rem)] sm:items-end">
        <div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-3xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-4xl">
              {sld.toLocaleString()}
              <span className="text-lg font-semibold text-slate-400 sm:text-xl">
                {' '}
                / {tgt.toLocaleString()}
              </span>
            </p>
            <p className="text-sm font-medium text-slate-500">bags sold</p>
          </div>
          <div
            className="mt-4 h-3 overflow-hidden rounded-full bg-slate-200/90 shadow-inner"
            role="progressbar"
            aria-valuenow={Math.min(sld, tgt)}
            aria-valuemin={0}
            aria-valuemax={tgt}
            aria-label={`Monthly target ${pct}% complete`}
          >
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${
                met ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' : 'bg-gradient-to-r from-indigo-600 to-violet-500'
              }`}
              style={{ width: `${barWidth}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className={`font-bold tabular-nums ${met ? 'text-emerald-700' : 'text-indigo-700'}`}>
              {pct}% of target
            </span>
            {met ? (
              <span className="font-medium text-emerald-800">
                {overBy > 0 ? `+${overBy.toLocaleString()} bags over target` : 'Goal reached'}
              </span>
            ) : (
              <span className="text-slate-600">
                <span className="font-semibold tabular-nums text-slate-800">{remaining.toLocaleString()}</span> bags
                to go
              </span>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-1">
          <div className="rounded-xl bg-white/80 px-3 py-2.5 ring-1 ring-slate-200/80">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Target</dt>
            <dd className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{tgt.toLocaleString()}</dd>
          </div>
          <div className="rounded-xl bg-white/80 px-3 py-2.5 ring-1 ring-slate-200/80">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Sold</dt>
            <dd className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{sld.toLocaleString()}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
