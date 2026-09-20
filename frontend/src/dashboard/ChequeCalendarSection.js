import { useMemo, useState } from 'react';
import {
  CHEQUE_CALENDAR_KIND_MAP,
  CHEQUE_CALENDAR_KINDS,
  itemsByDate,
  monthGrid,
  summarizeChequeItems,
  todayYmdLocal,
} from './chequeCalendar';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function moneyCompact(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

function formatMonthTitle(year, monthIndex) {
  return new Date(year, monthIndex, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

function formatDayHeading(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function shiftMonth(year, monthIndex, delta) {
  const next = new Date(year, monthIndex + delta, 1);
  return { year: next.getFullYear(), monthIndex: next.getMonth() };
}

function kindCountsForDay(dayItems) {
  const counts = [];
  for (const kind of CHEQUE_CALENDAR_KINDS) {
    const n = dayItems.filter((item) => item.kind === kind.id).length;
    if (n > 0) counts.push({ kind, count: n });
  }
  return counts;
}

export default function ChequeCalendarSection({ items = [] }) {
  const today = todayYmdLocal();
  const [view, setView] = useState(() => {
    const [y, m] = today.split('-').map(Number);
    return { year: y, monthIndex: m - 1 };
  });
  const [selectedYmd, setSelectedYmd] = useState(today);
  const [hiddenKinds, setHiddenKinds] = useState(() => new Set());

  const visibleItems = useMemo(
    () => items.filter((item) => !hiddenKinds.has(item.kind)),
    [items, hiddenKinds],
  );

  const monthPrefix = `${view.year}-${String(view.monthIndex + 1).padStart(2, '0')}`;
  const monthItems = useMemo(
    () => visibleItems.filter((item) => item.date.startsWith(monthPrefix)),
    [visibleItems, monthPrefix],
  );
  const byDate = useMemo(() => itemsByDate(visibleItems), [visibleItems]);
  const monthTotals = useMemo(() => summarizeChequeItems(monthItems), [monthItems]);
  const cells = useMemo(() => monthGrid(view.year, view.monthIndex), [view.year, view.monthIndex]);
  const selectedItems = byDate.get(selectedYmd) || [];

  const goMonth = (delta) => {
    const next = shiftMonth(view.year, view.monthIndex, delta);
    setView(next);
    const nextPrefix = `${next.year}-${String(next.monthIndex + 1).padStart(2, '0')}`;
    if (today.startsWith(nextPrefix)) {
      setSelectedYmd(today);
    } else if (!selectedYmd.startsWith(nextPrefix)) {
      setSelectedYmd(`${nextPrefix}-01`);
    }
  };

  const goToday = () => {
    const [y, m] = today.split('-').map(Number);
    setView({ year: y, monthIndex: m - 1 });
    setSelectedYmd(today);
  };

  const toggleKind = (id) => {
    setHiddenKinds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectDay = (cell) => {
    setSelectedYmd(cell.ymd);
    if (!cell.inMonth) {
      const [y, m] = cell.ymd.split('-').map(Number);
      setView({ year: y, monthIndex: m - 1 });
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-slate-900">Cheque calendar</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Converting dates by month — pending cheques from shops and to the company, plus deposited,
          realized, and pending-to-deposit cheques.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {CHEQUE_CALENDAR_KINDS.map((kind) => {
          const total = monthTotals[kind.id] || { count: 0, amount: 0 };
          const hidden = hiddenKinds.has(kind.id);
          return (
            <button
              key={kind.id}
              type="button"
              onClick={() => toggleKind(kind.id)}
              aria-pressed={!hidden}
              title={kind.description}
              className={`rounded-xl p-3 text-left ring-1 transition ${
                hidden ? 'bg-slate-50 ring-slate-100 opacity-50' : `${kind.badge}`
              }`}
            >
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
                <span className={`h-2 w-2 shrink-0 rounded-full ${kind.dot}`} aria-hidden />
                {kind.short}
              </p>
              <p className={`mt-1 text-sm font-bold tabular-nums ${hidden ? 'text-slate-400' : kind.amount}`}>
                {moneyCompact(total.amount)}
              </p>
              <p className="mt-0.5 text-[11px] tabular-nums text-slate-500">
                {total.count} cheque{total.count === 1 ? '' : 's'}
              </p>
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-md shadow-slate-200/30 ring-1 ring-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-3 sm:px-4">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => goMonth(-1)}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              aria-label="Previous month"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
            <h3 className="min-w-[10.5rem] text-center text-sm font-bold text-slate-900 sm:text-base">
              {formatMonthTitle(view.year, view.monthIndex)}
            </h3>
            <button
              type="button"
              onClick={() => goMonth(1)}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              aria-label="Next month"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goToday}
              className="rounded-xl px-3 py-1.5 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100 hover:bg-indigo-50"
            >
              Today
            </button>
            <label className="sr-only" htmlFor="cheque-calendar-month">
              Jump to month
            </label>
            <input
              id="cheque-calendar-month"
              type="month"
              value={`${view.year}-${String(view.monthIndex + 1).padStart(2, '0')}`}
              onChange={(e) => {
                const value = e.target.value;
                if (!/^\d{4}-\d{2}$/.test(value)) return;
                const [y, m] = value.split('-').map(Number);
                setView({ year: y, monthIndex: m - 1 });
                const nextPrefix = `${y}-${String(m).padStart(2, '0')}`;
                if (today.startsWith(nextPrefix)) setSelectedYmd(today);
                else setSelectedYmd(`${nextPrefix}-01`);
              }}
              className="rounded-xl border-0 bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
            />
          </div>
        </div>

        <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/80">
          {WEEKDAYS.map((label) => (
            <div
              key={label}
              className="px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400 sm:text-xs"
            >
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {cells.map((cell) => {
            const dayItems = byDate.get(cell.ymd) || [];
            const kinds = kindCountsForDay(dayItems);
            const isToday = cell.ymd === today;
            const isSelected = cell.ymd === selectedYmd;
            const totalAmount = dayItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
            return (
              <button
                key={cell.ymd}
                type="button"
                onClick={() => selectDay(cell)}
                className={`min-h-[4.25rem] min-w-0 border-b border-slate-100 px-1 py-1.5 text-left sm:min-h-[5.5rem] sm:px-1.5 sm:py-2 [&:not(:nth-child(7n))]:border-r ${
                  cell.inMonth ? 'bg-white' : 'bg-slate-50/70'
                } ${isSelected ? 'ring-2 ring-inset ring-indigo-400' : ''} ${
                  isToday && !isSelected ? 'bg-indigo-50/60' : ''
                }`}
              >
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
                    isToday
                      ? 'bg-indigo-600 text-white'
                      : cell.inMonth
                        ? 'text-slate-800'
                        : 'text-slate-400'
                  }`}
                >
                  {cell.day}
                </span>
                {kinds.length > 0 ? (
                  <div className="mt-1 flex flex-wrap items-center gap-0.5 sm:mt-1.5 sm:gap-1">
                    {kinds.slice(0, 4).map(({ kind, count }) => (
                      <span
                        key={kind.id}
                        className={`inline-flex items-center gap-0.5 rounded-full px-1 py-0 text-[9px] font-semibold tabular-nums sm:px-1.5 sm:text-[10px] ${kind.cell}`}
                        title={`${kind.label}: ${count}`}
                      >
                        <span className={`hidden h-1.5 w-1.5 rounded-full sm:inline ${kind.dot}`} aria-hidden />
                        {count}
                      </span>
                    ))}
                    {kinds.length > 4 ? (
                      <span className="text-[9px] font-semibold text-slate-400">+{kinds.length - 4}</span>
                    ) : null}
                  </div>
                ) : null}
                {totalAmount > 0 ? (
                  <p className="mt-0.5 hidden truncate text-[10px] tabular-nums text-slate-500 lg:block">
                    {moneyCompact(totalAmount)}
                  </p>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-md shadow-slate-200/30 ring-1 ring-slate-100 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900">{formatDayHeading(selectedYmd)}</h3>
          {selectedItems.length > 0 ? (
            <p className="text-xs tabular-nums text-slate-500">
              {selectedItems.length} cheque{selectedItems.length === 1 ? '' : 's'} ·{' '}
              {money(selectedItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0))}
            </p>
          ) : null}
        </div>

        {selectedItems.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No cheques on this converting date.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {selectedItems.map((item) => {
              const kind = CHEQUE_CALENDAR_KIND_MAP[item.kind];
              return (
                <li key={item.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p>
                    {item.subtitle ? (
                      <p className="mt-0.5 truncate text-xs text-slate-500">{item.subtitle}</p>
                    ) : null}
                    {kind ? (
                      <span
                        className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${kind.badge}`}
                      >
                        {kind.label}
                      </span>
                    ) : null}
                  </div>
                  <p className={`shrink-0 text-sm font-semibold tabular-nums ${kind?.amount || 'text-slate-800'}`}>
                    {money(item.amount)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
