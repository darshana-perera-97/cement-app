/** Progress toward monthly bag target (current calendar month, from API). */
export default function MonthlyTargetProgressBar({
  sold = 0,
  target = 0,
  progressPct = null,
  monthLabel = '',
  compact = false,
  className = '',
}) {
  const tgt = Math.max(0, Number(target) || 0);
  const sld = Math.max(0, Number(sold) || 0);
  if (tgt <= 0) {
    return (
      <span className={`text-xs text-slate-400 ${className}`.trim()}>
        {compact ? '—' : 'No monthly target set'}
      </span>
    );
  }
  const pct = progressPct != null ? Number(progressPct) : Math.round((sld / tgt) * 1000) / 10;
  const barWidth = Math.min(100, pct);
  const met = sld >= tgt;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-xs text-slate-600">
        <span className="tabular-nums">
          <span className="font-semibold text-slate-800">{sld.toLocaleString()}</span>
          <span className="text-slate-500"> / {tgt.toLocaleString()} bags</span>
        </span>
        <span className={`font-semibold tabular-nums ${met ? 'text-emerald-700' : 'text-indigo-700'}`}>
          {pct}%
        </span>
      </div>
      <div
        className={`mt-1.5 overflow-hidden rounded-full bg-slate-200 ${compact ? 'h-1.5' : 'h-2'}`}
        role="progressbar"
        aria-valuenow={Math.min(sld, tgt)}
        aria-valuemin={0}
        aria-valuemax={tgt}
        aria-label={`Monthly target ${pct}%`}
      >
        <div
          className={`h-full rounded-full transition-[width] ${met ? 'bg-emerald-500' : 'bg-indigo-500'}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      {monthLabel && !compact ? (
        <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">This month ({monthLabel})</p>
      ) : null}
    </div>
  );
}
