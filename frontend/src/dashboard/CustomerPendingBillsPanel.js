import { useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import { authFetch } from '../auth';
import { buildCustomerOutstandingBills } from './pendingBills';
import RowDetailModal, { detailRowAttrs } from './RowDetailModal';
import {
  LoadingSpinner,
  mobileCardList,
  MobileRowCard,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
} from './tableToolbar';

const apiBase = getApiBase();

const BILL_TABS = [
  { id: 'remaining', label: 'All remaining' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'within', label: 'Within terms' },
];

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

function todayYmdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysBetweenYmd(fromYmd, toYmd) {
  if (!fromYmd || !toYmd || fromYmd.length < 10 || toYmd.length < 10) return 0;
  const t0 = new Date(
    parseInt(fromYmd.slice(0, 4), 10),
    parseInt(fromYmd.slice(5, 7), 10) - 1,
    parseInt(fromYmd.slice(8, 10), 10),
  ).getTime();
  const t1 = new Date(
    parseInt(toYmd.slice(0, 4), 10),
    parseInt(toYmd.slice(5, 7), 10) - 1,
    parseInt(toYmd.slice(8, 10), 10),
  ).getTime();
  return Math.max(0, Math.round((t1 - t0) / (24 * 60 * 60 * 1000)));
}

function isOverdueRow(row) {
  return Number(row?.daysOverdue) > 0;
}

function billStatusBucket(row) {
  return isOverdueRow(row) ? 'overdue' : 'within';
}

function enrichPendingRow(row, todayYmd) {
  const due = String(row?.dueDate ?? '').slice(0, 10);
  const overdue = isOverdueRow(row);
  const daysLeftUntilDue =
    !overdue && due && /^\d{4}-\d{2}-\d{2}$/.test(due) && due >= todayYmd
      ? daysBetweenYmd(todayYmd, due)
      : 0;
  return { ...row, isOverdue: overdue, daysLeftUntilDue };
}

function comparePendingRows(a, b) {
  const aOverdue = isOverdueRow(a);
  const bOverdue = isOverdueRow(b);
  if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
  const dueCmp = String(a.dueDate ?? '').localeCompare(String(b.dueDate ?? ''));
  if (dueCmp !== 0) return dueCmp;
  return String(a.billDate ?? '').localeCompare(String(b.billDate ?? ''));
}

function sumOutstanding(rows) {
  return rows.reduce((s, r) => s + (Number(r.outstandingAmount) || 0), 0);
}

export default function CustomerPendingBillsPanel({
  customer,
  payments = [],
  loading = false,
}) {
  const [tab, setTab] = useState('remaining');
  const [bills, setBills] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [billsLoading, setBillsLoading] = useState(true);
  const [detailRow, setDetailRow] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBillsLoading(true);
      try {
        const [billsRes, promoRes] = await Promise.all([
          authFetch(`${apiBase}/api/bills`),
          authFetch(`${apiBase}/api/promotions`),
        ]);
        const data = await billsRes.json().catch(() => []);
        const promoData = await promoRes.json().catch(() => []);
        if (!cancelled) {
          setBills(Array.isArray(data) ? data : []);
          setPromotions(Array.isArray(promoData) ? promoData : []);
        }
      } catch {
        if (!cancelled) {
          setBills([]);
          setPromotions([]);
        }
      } finally {
        if (!cancelled) setBillsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customer?.id]);

  const todayYmd = useMemo(() => todayYmdLocal(), []);

  const allRows = useMemo(() => {
    if (!customer?.id) return [];
    return buildCustomerOutstandingBills([customer], bills, payments, customer.id, { promotions })
      .map((row) => enrichPendingRow(row, todayYmd))
      .sort(comparePendingRows);
  }, [customer, bills, payments, promotions, todayYmd]);

  const counts = useMemo(() => {
    let overdue = 0;
    let within = 0;
    for (const row of allRows) {
      if (billStatusBucket(row) === 'overdue') overdue += 1;
      else within += 1;
    }
    return { remaining: allRows.length, overdue, within };
  }, [allRows]);

  const rows = useMemo(() => {
    if (tab === 'overdue') return allRows.filter((r) => billStatusBucket(r) === 'overdue');
    if (tab === 'within') return allRows.filter((r) => billStatusBucket(r) === 'within');
    return allRows;
  }, [allRows, tab]);

  const remainingTotal = useMemo(() => sumOutstanding(allRows), [allRows]);
  const overdueTotal = useMemo(
    () => sumOutstanding(allRows.filter((r) => billStatusBucket(r) === 'overdue')),
    [allRows],
  );
  const visibleTotal = useMemo(() => sumOutstanding(rows), [rows]);

  const busy = loading || billsLoading;
  const settlementDays = customer?.overdueDays ?? 14;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-bold text-slate-900">Pending bills</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Unpaid opening balance and credit bills for this customer — remaining balance after payments,
          including overdue bills past the {settlementDays}-day window.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-2">
        <div className="rounded-2xl bg-white px-3.5 py-3 ring-1 ring-slate-200">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">All remaining</p>
          <p className="mt-0.5 text-lg font-bold tabular-nums tracking-tight text-slate-900">
            {busy ? '—' : money(remainingTotal)}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {busy ? '…' : `${counts.remaining} bill${counts.remaining === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="rounded-2xl bg-white px-3.5 py-3 ring-1 ring-rose-100">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-700">Overdue</p>
          <p className="mt-0.5 text-lg font-bold tabular-nums tracking-tight text-rose-800">
            {busy ? '—' : money(overdueTotal)}
          </p>
          <p className="mt-0.5 text-xs text-rose-700/80">
            {busy ? '…' : `${counts.overdue} bill${counts.overdue === 1 ? '' : 's'} past due`}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {BILL_TABS.map((opt) => {
          const active = tab === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setTab(opt.id)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                active
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {opt.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
                  active ? 'bg-indigo-500/40 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {counts[opt.id] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      <div className="space-y-3">
        <div className={mobileCardList}>
          {busy ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              <LoadingSpinner label="Loading pending bills…" />
            </p>
          ) : rows.length === 0 ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              {allRows.length === 0
                ? 'No remaining bills for this customer.'
                : tab === 'overdue'
                  ? 'No overdue bills — remaining bills are still within payment terms.'
                  : 'No bills within payment terms.'}
            </p>
          ) : (
            rows.map((row) => {
              const overdue = isOverdueRow(row);
              return (
                <MobileRowCard
                  key={row.id}
                  title={formatDisplayDate(row.billDate)}
                  subtitle={row.isOpeningBalance ? 'Opening balance' : row.details || undefined}
                  badge={
                    overdue ? (
                      <span className="inline-flex items-center rounded-lg bg-rose-50 px-2 py-1 text-xs font-semibold tabular-nums text-rose-700 ring-1 ring-rose-100">
                        {row.daysOverdue}d overdue
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold tabular-nums text-amber-800 ring-1 ring-amber-100">
                        {row.daysLeftUntilDue}d left
                      </span>
                    )
                  }
                  onClick={() => setDetailRow(row)}
                  fields={[
                    { label: 'Due date', value: formatDisplayDate(row.dueDate) },
                    { label: 'Bill total', value: money(row.billTotal) },
                    { label: 'Remaining', value: money(row.outstandingAmount) },
                  ]}
                />
              );
            })
          )}
        </div>

        <div className={`hidden sm:block ${scrollTableWrap}`}>
          {busy ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              <LoadingSpinner label="Loading pending bills…" />
            </p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              {allRows.length === 0
                ? 'No remaining bills for this customer.'
                : tab === 'overdue'
                  ? 'No overdue bills — remaining bills are still within payment terms.'
                  : 'No bills within payment terms.'}
            </p>
          ) : (
            <table className="w-full min-w-[720px] data-table border-separate border-spacing-0 text-left text-sm">
              <thead className={stickyThead}>
                <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className={`px-4 py-3 ${stickyFirstTh}`}>Bill date</th>
                  <th className="px-3 py-3">Details</th>
                  <th className="px-3 py-3">Due date</th>
                  <th className="px-3 py-3 text-right">Bill total</th>
                  <th className="px-3 py-3 text-right">Remaining</th>
                  <th className="px-3 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {rows.map((row) => {
                  const overdue = isOverdueRow(row);
                  return (
                    <tr
                      key={row.id}
                      {...detailRowAttrs(
                        () => setDetailRow(row),
                        overdue
                          ? 'group bg-rose-50/40 hover:bg-rose-50/70'
                          : 'group hover:bg-slate-50/60',
                      )}
                    >
                      <td
                        className={`whitespace-nowrap px-4 py-2.5 font-medium ${
                          overdue
                            ? 'sticky left-0 z-[11] bg-rose-50/40 shadow-[2px_0_4px_-2px_rgba(15,23,42,0.06)] group-hover:bg-rose-50/70'
                            : stickyFirstTd
                        }`}
                      >
                        {formatDisplayDate(row.billDate)}
                        {row.isOpeningBalance ? (
                          <span className="ml-2 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                            Opening
                          </span>
                        ) : null}
                        <span className="mt-0.5 block text-xs font-normal text-slate-500">
                          {row.daysFromBillDate != null ? `${row.daysFromBillDate}d from bill` : '—'}
                        </span>
                      </td>
                      <td className="max-w-[240px] px-3 py-2.5 text-xs leading-snug text-slate-600 sm:text-sm">
                        <span className="line-clamp-3">{row.details || '—'}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-700">
                        {formatDisplayDate(row.dueDate)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-600">
                        {money(row.billTotal)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                        {money(row.outstandingAmount)}
                      </td>
                      <td className="px-3 py-2.5">
                        {overdue ? (
                          <span className="inline-flex rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-800 ring-1 ring-rose-100">
                            {row.daysOverdue}d overdue
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900 ring-1 ring-amber-100">
                            {row.daysLeftUntilDue}d left
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50/80 text-sm font-semibold text-slate-800">
                  <td className={`px-4 py-2.5 ${stickyFirstTd}`} colSpan={4}>
                    {tab === 'remaining' ? 'Total remaining' : tab === 'overdue' ? 'Total overdue' : 'Total within terms'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{money(visibleTotal)}</td>
                  <td className="px-3 py-2.5 text-xs font-medium text-slate-500">
                    {rows.length} bill{rows.length === 1 ? '' : 's'}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      <RowDetailModal
        open={!!detailRow}
        row={detailRow}
        variant="pendingBill"
        onClose={() => setDetailRow(null)}
      />
    </section>
  );
}
