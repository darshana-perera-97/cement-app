function formatTargetMonthLabel(monthLabel) {
  const raw = String(monthLabel ?? '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})$/);
  if (!match) return '';
  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return raw;
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function MetricCell({ label, value, valueClassName = '', title = '' }) {
  return (
    <div className="min-w-0 rounded-lg bg-white px-2.5 py-2 ring-1 ring-slate-100" title={title || undefined}>
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 truncate text-sm font-bold tabular-nums text-slate-900 ${valueClassName}`}>{value}</p>
    </div>
  );
}

function ContactLine({ label, children }) {
  return (
    <div className="flex min-w-0 gap-2 text-sm leading-snug">
      <span className="w-[4.25rem] shrink-0 text-xs font-medium text-slate-500">{label}</span>
      <span className="min-w-0 flex-1 font-medium text-slate-800">{children}</span>
    </div>
  );
}

function MonthlyTargetStrip({ customer, onEditTarget }) {
  const tgt = Math.max(0, Number(customer?.monthlyTargetBags) || 0);
  const sld = Math.max(0, Number(customer?.monthlyBagsSold) || 0);
  const monthText = formatTargetMonthLabel(customer?.monthlyTargetMonth);

  if (tgt <= 0) {
    return (
      <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-2 ring-1 ring-slate-100">
        <p className="text-xs text-slate-500">No monthly bag target</p>
        {onEditTarget ? (
          <button
            type="button"
            onClick={onEditTarget}
            className="shrink-0 text-xs font-semibold text-indigo-700 hover:text-indigo-900"
          >
            Set
          </button>
        ) : null}
      </div>
    );
  }

  const pct =
    customer?.monthlyTargetProgressPct != null
      ? Number(customer.monthlyTargetProgressPct)
      : Math.round((sld / tgt) * 1000) / 10;
  const barWidth = Math.min(100, pct);
  const met = sld >= tgt;
  const remaining = Math.max(0, tgt - sld);

  return (
    <div className="min-w-0 rounded-lg bg-indigo-50/40 px-2.5 py-2 ring-1 ring-indigo-100/80">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Monthly bags{monthText ? ` · ${monthText}` : ''}
        </p>
        {onEditTarget ? (
          <button
            type="button"
            onClick={onEditTarget}
            className="text-[10px] font-semibold text-indigo-700 hover:text-indigo-900"
          >
            Edit
          </button>
        ) : null}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <span className="text-sm font-bold tabular-nums text-slate-900">
          {sld.toLocaleString()}
          <span className="text-xs font-semibold text-slate-500"> / {tgt.toLocaleString()}</span>
        </span>
        <span className={`text-xs font-bold tabular-nums ${met ? 'text-emerald-700' : 'text-indigo-700'}`}>
          {pct}%
          {!met ? ` · ${remaining.toLocaleString()} left` : ' · met'}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200/90">
        <div
          className={`h-full rounded-full ${met ? 'bg-emerald-500' : 'bg-indigo-500'}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
    </div>
  );
}

export default function CustomerProfilePanel({
  customer,
  amountToPay,
  overpayment,
  overdue,
  allPaid,
  dueHint,
  summary,
  formatMoney,
  formatDisplayDate,
  defaultOverdueDays,
  onEditTarget = null,
}) {
  const overdueDays = customer?.overdueDays ?? defaultOverdueDays;

  let statusBadge = null;
  if (overdue) {
    statusBadge = (
      <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-800">
        Overdue
      </span>
    );
  } else if (allPaid) {
    statusBadge = (
      <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
        Settled
      </span>
    );
  } else if (amountToPay > 0) {
    statusBadge = (
      <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
        Balance due
      </span>
    );
  }

  const termsParts = [];
  if (customer?.dueDate && dueHint?.text) {
    termsParts.push(dueHint.tone === 'overdue' ? `Payment ${dueHint.text}` : dueHint.text);
  }
  termsParts.push(`${overdueDays}d bill overdue window`);

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-slate-50/80 to-indigo-50/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {statusBadge}
          {overpayment > 0 ? (
            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800 ring-1 ring-emerald-100">
              Credit {formatMoney(overpayment)}
            </span>
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Amount to pay</p>
          <p
            className={`text-xl font-bold tabular-nums leading-tight sm:text-2xl ${
              overdue && amountToPay > 0 ? 'text-rose-800' : 'text-slate-900'
            }`}
          >
            {formatMoney(amountToPay)}
          </p>
        </div>
      </div>

      <div className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-1.5">
          {customer?.location ? <ContactLine label="Location">{customer.location}</ContactLine> : null}
          <ContactLine label="Email">
            {customer?.email ? (
              <a href={`mailto:${customer.email}`} className="break-all text-indigo-700 hover:text-indigo-900">
                {customer.email}
              </a>
            ) : (
              <span className="text-slate-400">—</span>
            )}
          </ContactLine>
          <ContactLine label="Contact">
            {customer?.contactNumber ? (
              <a href={`tel:${customer.contactNumber}`} className="text-indigo-700 hover:text-indigo-900">
                {customer.contactNumber}
              </a>
            ) : (
              <span className="text-slate-400">—</span>
            )}
          </ContactLine>
          <ContactLine label="Collector">
            {customer?.collectorName ? (
              <span>{customer.collectorName}</span>
            ) : (
              <span className="text-slate-400">—</span>
            )}
          </ContactLine>
          <p className="pt-0.5 text-xs leading-snug text-slate-500">{termsParts.join(' · ')}</p>
        </div>
        <MonthlyTargetStrip customer={customer} onEditTarget={onEditTarget} />
      </div>

      <div
        className={`grid gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-2.5 ${
          overpayment > 0 ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4'
        }`}
      >
        {overpayment > 0 ? (
          <MetricCell label="Overpayment" value={formatMoney(overpayment)} valueClassName="text-emerald-800" />
        ) : null}
        <MetricCell
          label="Opening"
          value={formatMoney(customer?.pastBill)}
          title={
            customer?.pastBillUpdatedAt
              ? `Updated ${formatDisplayDate(String(customer.pastBillUpdatedAt).slice(0, 10))}`
              : undefined
          }
        />
        <MetricCell label="Charged" value={formatMoney(summary.totalCharged)} title="Opening + credit sales" />
        <MetricCell
          label="Paid"
          value={formatMoney(summary.totalPaid)}
          valueClassName="text-emerald-800"
          title="All recorded payments"
        />
        <MetricCell
          label="Net balance"
          value={formatMoney(amountToPay)}
          valueClassName={overdue && amountToPay > 0 ? 'text-rose-800' : ''}
          title="Current amount to collect"
        />
      </div>
    </section>
  );
}
