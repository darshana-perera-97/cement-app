import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getApiBase } from '../apiBase';
import { depositQueueRowKey } from './paymentCheques';
import { useBagProducts } from './BagProductsContext';
import {
  LoadingSpinner,
  TableFiltersBar,
  TablePaginationBar,
  filterControl,
  filterLabel,
  mobileCardList,
  MobileRowCard,
  pageSizeOptionsWith,
  rowMatchesQuery,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
  useTablePagination,
} from './tableToolbar';
import { downloadOverdueBillsPdf, downloadSalesPersonOverduePdf } from './overdueBillsPdf';
import { buildPendingBillRows } from './pendingBills';
import RowDetailModal, { detailRowAttrs } from './RowDetailModal';
import { Link } from 'react-router-dom';
import {
  buildCashBookSourceEntries,
  buildCashBookLedgerRows,
  summarizeCashBookLedger,
} from './cashBookLedger';
import {
  computeGuaranteeStatus,
  computeGuaranteeStatusByDistributor,
  formatGuaranteeExpiryHint,
  GUARANTEE_RENEWAL_WARN_DAYS,
} from './guaranteeStatus';

/** Bar fills aligned with bag products — same hues as light theme, higher chroma for readability */
const BRAND_BAR_COLORS = {
  tokyo: '#a78bfa',
  samudra: '#38bdf8',
  atlas: '#fbbf24',
  nippon: '#f472b6',
};

/** [0] pending · [1] payments — stronger tints for Pending vs collected donut */
const DONUT_COLORS = ['#a78bfa', '#34d399'];

/** Offer “View all” when there are more overdue bills than this count. */
const OVERDUE_VIEW_ALL_THRESHOLD = 10;

function formatLkrCompact(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

function formatLkrExact(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function formatRelativeTime(iso) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return 'Just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function todayYmdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysFromYmdToToday(fromYmd, toYmd = todayYmdLocal()) {
  if (!fromYmd || !toYmd || fromYmd.length < 10 || toYmd.length < 10) return null;
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

function enrichOverdueBillRow(row) {
  if (row == null || typeof row !== 'object') return row;
  if (row.daysFromBillDate != null && row.daysFromBillDate !== '') return row;
  const days = daysFromYmdToToday(row.billDate);
  return days == null ? row : { ...row, daysFromBillDate: days };
}

function overdueDaysFromBillDate(row) {
  if (row?.daysFromBillDate != null && row.daysFromBillDate !== '') return row.daysFromBillDate;
  return daysFromYmdToToday(row?.billDate);
}

function DashboardStatAmount({ value, loading, valueClassName = 'text-slate-900', compact = false }) {
  if (loading) {
    return (
      <p
        className={`font-bold tabular-nums text-slate-400 ${compact ? 'mt-0.5 text-base' : 'mt-1 text-xl'}`}
      >
        —
      </p>
    );
  }
  return (
    <p
      className={`font-bold tabular-nums tracking-tight ${compact ? 'mt-0.5 text-base sm:text-lg' : 'mt-1 text-xl'} ${valueClassName}`}
    >
      {formatLkrCompact(value)}
    </p>
  );
}

function DashboardStatStripCell({ label, value, valueClassName, hint, tone = 'slate', loading = false }) {
  const toneClass =
    tone === 'sky'
      ? 'bg-sky-50/80'
      : tone === 'amber'
        ? 'bg-amber-50/80'
        : tone === 'indigo'
          ? 'bg-indigo-50/80'
          : 'bg-slate-50/80';
  return (
    <div className={`min-w-0 px-3 py-3 sm:px-4 sm:py-3.5 ${toneClass}`}>
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <DashboardStatAmount
        loading={loading}
        value={value}
        valueClassName={valueClassName}
        compact
      />
      {hint ? <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-500">{hint}</p> : null}
    </div>
  );
}

function GuaranteeUtilizationBar({ pct, overLimit }) {
  return (
    <div className="flex min-w-[5.5rem] items-center gap-2">
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-all ${overLimit ? 'bg-rose-500' : 'bg-teal-500'}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-600">{pct}%</span>
    </div>
  );
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

function GuaranteeExpiryBadge({ expiryInfo }) {
  if (!expiryInfo || expiryInfo.status === 'none' || expiryInfo.status === 'ok') return null;
  const isExpired = expiryInfo.status === 'expired';
  return (
    <span
      className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
        isExpired ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-900'
      }`}
    >
      {isExpired ? 'Expired' : 'Renew soon'}
    </span>
  );
}

function guaranteeAvailableToneClass(value) {
  const n = Number(value) || 0;
  if (n < 0) return 'text-rose-700';
  if (n > 0) return 'text-emerald-800';
  return 'text-slate-600';
}

function Card({ title, subtitle, children, className = '', headerExtra = null }) {
  return (
    <div
      className={`min-w-0 rounded-[20px] bg-white p-4 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-6 ${className}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        {headerExtra ? (
          <div className="w-full min-w-0 sm:w-auto sm:shrink-0 sm:pt-0.5">{headerExtra}</div>
        ) : null}
      </div>
      <div className="mt-4 min-w-0">{children}</div>
    </div>
  );
}

export function OverdueBillsTable({ rows, totalLoadedCount, defaultPageSize = 10, resetKey = '' }) {
  const [detailRow, setDetailRow] = useState(null);
  const pagination = useTablePagination(rows.length, [resetKey, rows.length], defaultPageSize);
  const pagedRows = useMemo(
    () => rows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [rows, pagination.offset, pagination.pageSize],
  );

  return (
    <div className="space-y-3">
      <div className={mobileCardList}>
        {rows.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
            {totalLoadedCount === 0 ? 'No overdue bills.' : 'No rows match your search.'}
          </p>
        ) : (
          pagedRows.map((row) => (
            <MobileRowCard
              key={row.id}
              title={row.customerName || '—'}
              subtitle={row.details || undefined}
              badge={
                <span className="inline-flex items-center rounded-lg bg-rose-50 px-2 py-1 text-xs font-semibold tabular-nums text-rose-700 ring-1 ring-rose-100">
                  {row.daysOverdue ?? '—'}d overdue
                </span>
              }
              onClick={() => setDetailRow(row)}
              fields={[
                { label: 'Bill date', value: row.billDate || '—' },
                { label: 'Due date', value: row.dueDate || '—' },
                {
                  label: 'Days from bill',
                  value: overdueDaysFromBillDate(row) ?? '—',
                },
                { label: 'Outstanding', value: formatLkrExact(row.outstandingAmount) },
              ]}
            />
          ))
        )}
      </div>
      <div className={`-mx-1 hidden sm:block ${scrollTableWrap}`}>
        <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-sm">
          <thead className={stickyThead}>
            <tr className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              <th className={`pb-3 pl-1 pr-3 ${stickyFirstTh}`}>Customer</th>
              <th className="pb-3 pr-3">Bill details</th>
              <th className="pb-3 pr-3">Bill date</th>
              <th className="pb-3 pr-3 text-right">Days from bill date</th>
              <th className="pb-3 pr-3">Due date</th>
              <th className="pb-3 pr-3 text-right">Days overdue</th>
              <th className="pb-3 pr-1 text-right">Outstanding</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-slate-500">
                  {totalLoadedCount === 0 ? 'No overdue bills.' : 'No rows match your search.'}
                </td>
              </tr>
            ) : (
              pagedRows.map((row) => (
              <tr
                key={row.id}
                {...detailRowAttrs(() => setDetailRow(row), 'text-slate-700')}
                aria-label={`Overdue row ${row.customerName || ''}`}
              >
                <td className={`max-w-[140px] py-3.5 pl-1 pr-3 font-semibold text-slate-900 ${stickyFirstTd}`}>
                  <span className="line-clamp-2">{row.customerName}</span>
                </td>
                <td className="max-w-[260px] py-3.5 pr-3 text-xs leading-snug text-slate-600 sm:text-sm">
                  <span className="line-clamp-3">{row.details}</span>
                </td>
                <td className="whitespace-nowrap py-3.5 pr-3 tabular-nums text-slate-600">{row.billDate}</td>
                <td className="py-3.5 pr-3 text-right tabular-nums text-slate-700">
                  {overdueDaysFromBillDate(row) ?? '—'}
                </td>
                <td className="whitespace-nowrap py-3.5 pr-3 tabular-nums text-slate-600">{row.dueDate}</td>
                <td className="py-3.5 pr-3 text-right">
                  <span className="inline-flex min-w-[2rem] justify-end font-semibold tabular-nums text-rose-600">
                    {row.daysOverdue}
                  </span>
                </td>
                <td className="py-3.5 pr-1 text-right font-semibold tabular-nums text-slate-900">
                  {formatLkrExact(row.outstandingAmount)}
                </td>
              </tr>
            ))
            )}
          </tbody>
        </table>
      </div>
      {totalLoadedCount > 0 ? (
        <TablePaginationBar
          page={pagination.page}
          totalPages={pagination.totalPages}
          pageSize={pagination.pageSize}
          totalCount={rows.length}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
          pageSizeOptions={pageSizeOptionsWith(defaultPageSize)}
        />
      ) : null}
      <RowDetailModal open={!!detailRow} row={detailRow} variant="overdueBill" onClose={() => setDetailRow(null)} />
    </div>
  );
}

export default function AnalyticsPage() {
  const apiRoot = getApiBase() || '';
  const { brands } = useBagProducts();
  const [cashSummary, setCashSummary] = useState(null);
  const [cashFlow, setCashFlow] = useState([]);
  const [bagSalesByDay, setBagSalesByDay] = useState([]);
  const [recentTransfers, setRecentTransfers] = useState([]);
  const [overdueBills, setOverdueBills] = useState([]);
  const [pendingBills, setPendingBills] = useState([]);
  const [cashDashLoading, setCashDashLoading] = useState(true);
  const [chequeDepositQueue, setChequeDepositQueue] = useState({
    asOfDate: '',
    throughDate: '',
    items: [],
  });
  const [chequeDepositErr, setChequeDepositErr] = useState(null);
  const [payments, setPayments] = useState([]);
  const [cashBookEntries, setCashBookEntries] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [bankGuarantees, setBankGuarantees] = useState([]);
  const [bankBalancePayload, setBankBalancePayload] = useState(null);
  const [overdueSearch, setOverdueSearch] = useState('');
  const [overdueListView, setOverdueListView] = useState('preview');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sumRes, flowRes, bagsRes, xferRes, overdueRes, custRes, billsRes, payRes, chequeRes, cbeRes, bgRes, balRes, promoRes] =
          await Promise.all([
            fetch(`${apiRoot}/api/cash-summary`),
            fetch(`${apiRoot}/api/cash-flow?days=7`),
            fetch(`${apiRoot}/api/bag-sales-by-day?days=7`),
            fetch(`${apiRoot}/api/recent-transfers?limit=5`),
            fetch(`${apiRoot}/api/overdue-bills`),
            fetch(`${apiRoot}/api/customers`),
            fetch(`${apiRoot}/api/bills`),
            fetch(`${apiRoot}/api/payments`),
            fetch(`${apiRoot}/api/cheque-deposit-queue?days=3`),
            fetch(`${apiRoot}/api/cash-book-entries`),
            fetch(`${apiRoot}/api/bank-guarantees`),
            fetch(`${apiRoot}/api/bank-account-balances`),
            fetch(`${apiRoot}/api/promotions`),
          ]);
        if (!cancelled) {
          if (sumRes.ok) setCashSummary(await sumRes.json());
          else setCashSummary(null);
          if (flowRes.ok) {
            const rows = await flowRes.json();
            setCashFlow(Array.isArray(rows) ? rows : []);
          } else {
            setCashFlow([]);
          }
          if (bagsRes.ok) {
            const rows = await bagsRes.json();
            setBagSalesByDay(Array.isArray(rows) ? rows : []);
          } else {
            setBagSalesByDay([]);
          }
          if (xferRes.ok) {
            const rows = await xferRes.json();
            setRecentTransfers(Array.isArray(rows) ? rows : []);
          } else {
            setRecentTransfers([]);
          }
          if (overdueRes.ok) {
            const rows = await overdueRes.json();
            setOverdueBills(Array.isArray(rows) ? rows.map(enrichOverdueBillRow) : []);
          } else {
            setOverdueBills([]);
          }
          // Build pending bills client-side (works without /api/pending-bills on remote).
          const customers = custRes.ok ? await custRes.json() : [];
          const bills = billsRes.ok ? await billsRes.json() : [];
          const paymentsData = payRes.ok ? await payRes.json() : [];
          const paymentsList = Array.isArray(paymentsData) ? paymentsData : [];
          setPayments(paymentsList);
          if (promoRes.ok) {
            const promoData = await promoRes.json();
            setPromotions(Array.isArray(promoData) ? promoData : []);
          } else {
            setPromotions([]);
          }
          setPendingBills(
            buildPendingBillRows(
              Array.isArray(customers) ? customers : [],
              Array.isArray(bills) ? bills : [],
              paymentsList,
            ).map(enrichOverdueBillRow),
          );
          if (cbeRes.ok) {
            const cbeData = await cbeRes.json();
            setCashBookEntries(Array.isArray(cbeData) ? cbeData : []);
          } else {
            setCashBookEntries([]);
          }
          if (bgRes.ok) {
            const bgData = await bgRes.json();
            setBankGuarantees(Array.isArray(bgData) ? bgData : []);
          } else {
            setBankGuarantees([]);
          }
          if (balRes.ok) {
            setBankBalancePayload(await balRes.json());
          } else {
            setBankBalancePayload(null);
          }
          if (chequeRes.ok) {
            const cd = await chequeRes.json();
            setChequeDepositErr(null);
            setChequeDepositQueue({
              asOfDate: String(cd.asOfDate ?? ''),
              throughDate: String(cd.throughDate ?? cd.asOfDate ?? ''),
              items: Array.isArray(cd.items) ? cd.items : [],
            });
          } else {
            setChequeDepositQueue({ asOfDate: '', throughDate: '', items: [] });
            const errJson = await chequeRes.json().catch(() => ({}));
            setChequeDepositErr(errJson.error || 'Could not load cheque deposit list');
          }
        }
      } catch {
        if (!cancelled) {
          setCashSummary(null);
          setCashFlow([]);
          setBagSalesByDay([]);
          setRecentTransfers([]);
          setOverdueBills([]);
          setPendingBills([]);
          setPayments([]);
          setCashBookEntries([]);
          setBankGuarantees([]);
          setBankBalancePayload(null);
          setChequeDepositQueue({ asOfDate: '', throughDate: '', items: [] });
          setChequeDepositErr('Could not load dashboard data');
        }
      } finally {
        if (!cancelled) setCashDashLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiRoot]);

  const donutModel = useMemo(() => {
    const pending = Number(cashSummary?.pendingFromCustomers) || 0;
    const paid = Number(cashSummary?.cashReceivedFromCustomers) || 0;
    const whole = pending + paid;
    if (whole <= 0) {
      return {
        slices: [],
        pendingPercent: 0,
        whole,
        pending,
        paid,
        hasData: false,
      };
    }
    const pendingPercent = Math.round((pending / whole) * 1000) / 10;
    return {
      slices: [
        { name: 'Still pending', value: pending },
        { name: 'Payments recorded', value: paid },
      ],
      pendingPercent,
      whole,
      pending,
      paid,
      hasData: true,
    };
  }, [cashSummary]);

  const filteredOverdueBills = useMemo(() => {
    return overdueBills.filter((row) =>
      rowMatchesQuery(overdueSearch, [
        row.customerName,
        row.details,
        row.billDate,
        row.dueDate,
        row.daysOverdue,
        row.daysFromBillDate,
        row.outstandingAmount,
        row.billTotal,
      ]),
    );
  }, [overdueBills, overdueSearch]);

  const showOverdueViewAll = overdueBills.length > OVERDUE_VIEW_ALL_THRESHOLD;

  const cashierSummary = useMemo(() => {
    const sourceEntries = buildCashBookSourceEntries(payments, cashBookEntries, promotions);
    const ledgerRows = buildCashBookLedgerRows(sourceEntries);
    return summarizeCashBookLedger(ledgerRows);
  }, [payments, cashBookEntries, promotions]);

  const bankSummary = useMemo(() => {
    const byAccountId =
      bankBalancePayload?.byAccountId && typeof bankBalancePayload.byAccountId === 'object'
        ? bankBalancePayload.byAccountId
        : {};
    let totalBalance = 0;
    let totalPendingOutgoing = 0;
    for (const entry of Object.values(byAccountId)) {
      totalBalance += Number(entry?.balance) || 0;
      totalPendingOutgoing += Number(entry?.pendingOutgoing) || 0;
    }
    return { totalBalance, totalPendingOutgoing, accountCount: Object.keys(byAccountId).length };
  }, [bankBalancePayload]);

  const poPendingMetrics = useMemo(() => {
    const asOf = String(bankBalancePayload?.asOfDate ?? '').slice(0, 10) || todayYmdLocal();
    const outgoing = Array.isArray(bankBalancePayload?.outgoingCheques)
      ? bankBalancePayload.outgoingCheques
      : [];
    let total = 0;
    let count = 0;
    for (const row of outgoing) {
      const converting = String(row.chequeDate ?? '').slice(0, 10);
      if (converting && converting <= asOf) continue;
      const amount = Math.max(0, Number(row.amount) || 0);
      if (amount <= 0) continue;
      total += amount;
      count += 1;
    }
    return { total, count };
  }, [bankBalancePayload]);

  const guaranteeStatus = useMemo(() => {
    const asOf = String(bankBalancePayload?.asOfDate ?? '').slice(0, 10) || todayYmdLocal();
    return computeGuaranteeStatus(bankGuarantees, payments, {
      poPendingOutgoing: poPendingMetrics.total,
      poPendingCount: poPendingMetrics.count,
      asOfDate: asOf,
    });
  }, [bankGuarantees, payments, poPendingMetrics, bankBalancePayload]);

  const distributorGuaranteeStatuses = useMemo(() => {
    const asOf = String(bankBalancePayload?.asOfDate ?? '').slice(0, 10) || todayYmdLocal();
    const outgoing = Array.isArray(bankBalancePayload?.outgoingCheques)
      ? bankBalancePayload.outgoingCheques
      : [];
    return computeGuaranteeStatusByDistributor(bankGuarantees, { outgoingCheques: outgoing, asOfDate: asOf });
  }, [bankGuarantees, bankBalancePayload]);

  const overdueSearchInput = (
    <label className={filterLabel}>
      Search
      <input
        type="search"
        value={overdueSearch}
        onChange={(e) => setOverdueSearch(e.target.value)}
        placeholder="Customer, stock, dates, amount…"
        className={filterControl}
      />
    </label>
  );

  const backButtonClass =
    'inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-100 transition hover:bg-slate-50 sm:w-auto sm:justify-start';

  const viewAllButtonClass =
    'inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/25 transition hover:bg-indigo-700 sm:w-auto sm:py-2';

  const downloadPdfButtonClass =
    'inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-100 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-4 sm:py-2';

  const handleDownloadOverduePdf = useCallback(() => {
    downloadOverdueBillsPdf(overdueBills);
  }, [overdueBills]);

  const handleDownloadSalesPersonPdf = useCallback(() => {
    downloadSalesPersonOverduePdf(pendingBills);
  }, [pendingBills]);

  const overdueDownloadButtons = (
    <>
      <button
        type="button"
        className={downloadPdfButtonClass}
        disabled={cashDashLoading || pendingBills.length === 0}
        onClick={handleDownloadSalesPersonPdf}
      >
        Sales Person Download
      </button>
      <button
        type="button"
        className={downloadPdfButtonClass}
        disabled={cashDashLoading || overdueBills.length === 0}
        onClick={handleDownloadOverduePdf}
      >
        Download Overdue Bills
      </button>
    </>
  );

  const overdueActionsClass =
    'flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end';

  if (overdueListView === 'full') {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            className={backButtonClass}
            onClick={() => {
              setOverdueListView('preview');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            <span aria-hidden>←</span> Back to analytics
          </button>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">All overdue bills</h1>
        </div>
        <Card
          title={`Overdue bills (${overdueBills.length})`}
          subtitle="Full list — same per-customer overdue rules as the dashboard summary."
          headerExtra={<div className={overdueActionsClass}>{overdueDownloadButtons}</div>}
        >
          <TableFiltersBar
            className="!bg-slate-50/90 shadow-none"
            hint={
              cashDashLoading
                ? null
                : overdueBills.length === 0
                  ? 'No overdue bills — all are within payment terms or fully allocated by payments.'
                  : filteredOverdueBills.length === overdueBills.length
                    ? `${overdueBills.length} overdue bill${overdueBills.length === 1 ? '' : 's'}.`
                    : `Showing ${filteredOverdueBills.length} of ${overdueBills.length} matching search.`
            }
          >
            {overdueSearchInput}
          </TableFiltersBar>
          {cashDashLoading ? (
            <div className="mt-4 py-10 text-center text-sm text-slate-500"><LoadingSpinner /></div>
          ) : (
            <div className="mt-4">
              <OverdueBillsTable rows={filteredOverdueBills} totalLoadedCount={overdueBills.length} resetKey={overdueSearch} />
            </div>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          title="Bag sales by brand"
          subtitle="Last 7 days · Stacked bags per day from credit bills (Tokyo, Samudra, Atlas, Nippon)"
          className="lg:col-span-2"
        >
          {cashDashLoading ? (
            <div className="flex h-[240px] items-center justify-center text-sm text-slate-500"><LoadingSpinner /></div>
          ) : (
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bagSalesByDay} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    formatter={(value) => `${Math.round(Number(value) || 0)} bags`}
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.date ? String(payload[0].payload.date) : ''
                    }
                    contentStyle={{
                      borderRadius: 12,
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 10px 40px -10px rgb(0 0 0 / 0.15)',
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {brands.map((b) => (
                    <Bar
                      key={b.key}
                      dataKey={b.key}
                      stackId="bags"
                      name={b.label}
                      fill={BRAND_BAR_COLORS[b.key]}
                      maxBarSize={40}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card
          title="Pending vs collected"
          subtitle="Customer money still owed versus payments recorded (same totals as Your card)"
        >
          {cashDashLoading ? (
            <div className="flex h-[240px] items-center justify-center text-sm text-slate-500"><LoadingSpinner /></div>
          ) : !donutModel.hasData ? (
            <div className="flex h-[240px] flex-col items-center justify-center px-3 text-center text-sm text-slate-500">
              <p>No data yet.</p>
              <p className="mt-2 text-xs leading-relaxed">
                When you have customer balances and/or recorded payments, this chart shows what share is still
                pending versus already collected.
              </p>
            </div>
          ) : (
            <div className="relative h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutModel.slices}
                    cx="50%"
                    cy="50%"
                    innerRadius={62}
                    outerRadius={86}
                    paddingAngle={2}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {donutModel.slices.map((entry, index) => (
                      <Cell key={entry.name} fill={DONUT_COLORS[index % DONUT_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => formatLkrCompact(value)}
                    contentStyle={{
                      borderRadius: 12,
                      border: '1px solid #e2e8f0',
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <span className="block text-3xl font-bold tabular-nums text-slate-900">
                    {donutModel.pendingPercent}%
                  </span>
                  <span className="mt-0.5 block text-[11px] font-medium leading-snug text-slate-500">
                    pending
                    <br />
                    of total
                  </span>
                </div>
              </div>
            </div>
          )}
          {!cashDashLoading && donutModel.hasData ? (
            <p className="mt-2 text-center text-[11px] text-slate-500">
              <span className="font-semibold text-violet-700">{formatLkrCompact(donutModel.pending)}</span> pending
              <span className="mx-1 text-slate-300">·</span>
              <span className="font-semibold text-emerald-600">{formatLkrCompact(donutModel.paid)}</span> paid
              <span className="mx-1 text-slate-300">·</span>
              <span className="tabular-nums">{formatLkrCompact(donutModel.whole)}</span> combined
            </p>
          ) : null}
        </Card>
      </div>

      <div className="space-y-6">
        <Card
          title="Bank & cashier"
          subtitle="Live cash on hand and bank positions — same totals as Cash Book"
          headerExtra={
            <Link
              to="/dashboard/bank"
              className="inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-indigo-700 shadow-sm ring-1 ring-slate-100 transition hover:bg-indigo-50 sm:w-auto"
            >
              Open Cash Book →
            </Link>
          }
        >
          {cashDashLoading ? (
            <div className="flex min-h-[88px] items-center justify-center text-sm text-slate-500">
              <LoadingSpinner />
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl ring-1 ring-slate-100">
              <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 sm:grid-cols-4 sm:divide-y-0">
                <DashboardStatStripCell
                  label="Cashier · closing"
                  value={cashierSummary.closing}
                  valueClassName="text-indigo-900"
                  hint={`In ${formatLkrCompact(cashierSummary.debit)} · out ${formatLkrCompact(cashierSummary.credit)}`}
                  tone="indigo"
                />
                <DashboardStatStripCell
                  label="Cashier · net movement"
                  value={cashierSummary.netInPeriod}
                  valueClassName={cashierSummary.netInPeriod >= 0 ? 'text-emerald-800' : 'text-rose-800'}
                  hint="All-time ledger through today"
                />
                <DashboardStatStripCell
                  label="Bank · total balance"
                  value={bankSummary.totalBalance}
                  valueClassName="text-sky-900"
                  hint={`${bankSummary.accountCount} account${bankSummary.accountCount === 1 ? '' : 's'} · cleared PO cheques deducted`}
                  tone="sky"
                />
                <DashboardStatStripCell
                  label="Bank · pending outgoing"
                  value={bankSummary.totalPendingOutgoing}
                  valueClassName="text-amber-900"
                  hint="PO cheques before converting date"
                  tone="amber"
                />
              </div>
            </div>
          )}
        </Card>

        <Card
          title="Bank guarantee status"
          subtitle="Per distributor — PO cheques not yet converted vs collateral recorded for that distributor"
          headerExtra={
            <Link
              to="/dashboard/bank"
              className="inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-teal-700 shadow-sm ring-1 ring-slate-100 transition hover:bg-teal-50 sm:w-auto"
            >
              Manage in Cash Book →
            </Link>
          }
        >
          {cashDashLoading ? (
            <div className="flex min-h-[88px] items-center justify-center text-sm text-slate-500">
              <LoadingSpinner />
            </div>
          ) : distributorGuaranteeStatuses.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                No bank guarantees recorded yet. Add guarantees in Cash Book — one per distributor — to track PO
                cheque exposure against collateral.
              </p>
              <div className="overflow-hidden rounded-2xl ring-1 ring-slate-100">
                <div className="grid grid-cols-2 divide-x divide-slate-100">
                  <DashboardStatStripCell
                    label="Incoming cheques"
                    value={guaranteeStatus.incomingPendingTotal}
                    valueClassName="text-violet-900"
                    hint="Customer cheques not deposited"
                    tone="indigo"
                  />
                  <DashboardStatStripCell
                    label="PO pending"
                    value={guaranteeStatus.poPendingOutgoingTotal}
                    valueClassName="text-amber-900"
                    hint="All distributors combined"
                    tone="amber"
                  />
                </div>
              </div>
              <Link
                to="/dashboard/bank"
                className="inline-flex items-center justify-center rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700"
              >
                Add guarantee in Cash Book
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {guaranteeStatus.hasExpiryWarning ? (
                <div
                  className={`rounded-xl px-3 py-2.5 text-sm ring-1 ${
                    guaranteeStatus.expiredCount > 0
                      ? 'bg-rose-50 text-rose-900 ring-rose-100'
                      : 'bg-amber-50 text-amber-900 ring-amber-100'
                  }`}
                  role="status"
                >
                  <p className="font-semibold">
                    {guaranteeStatus.expiredCount > 0
                      ? `${guaranteeStatus.expiredCount} guarantee${guaranteeStatus.expiredCount === 1 ? '' : 's'} expired`
                      : `${guaranteeStatus.expiringSoonCount} guarantee${guaranteeStatus.expiringSoonCount === 1 ? '' : 's'} due for renewal`}
                  </p>
                  <p className="mt-0.5 text-xs opacity-90">
                    {guaranteeStatus.expiredCount > 0 && guaranteeStatus.expiringSoonCount > guaranteeStatus.expiredCount
                      ? `Also ${guaranteeStatus.expiringSoonCount - guaranteeStatus.expiredCount} expiring within ${GUARANTEE_RENEWAL_WARN_DAYS} days. `
                      : ''}
                    Renew in Cash Book before collateral lapses.
                  </p>
                </div>
              ) : null}
              <div className={mobileCardList}>
                {distributorGuaranteeStatuses.map((dist) => (
                  <MobileRowCard
                    key={dist.distributorId}
                    title={dist.distributorName}
                    subtitle={
                      dist.nearestExpiry?.status === 'near' || dist.nearestExpiry?.status === 'expired'
                        ? formatGuaranteeExpiryHint(dist.nearestExpiry)
                        : dist.poPendingCount > 0
                          ? `${dist.poPendingCount} PO cheque${dist.poPendingCount === 1 ? '' : 's'} pending`
                          : dist.nearestExpiry?.status === 'ok'
                            ? `Expires ${formatDisplayDate(dist.nearestExpiry.expireDate)}`
                            : 'No pending PO cheques'
                    }
                    badge={
                      <span className="inline-flex flex-wrap items-center gap-1">
                        <GuaranteeExpiryBadge expiryInfo={dist.nearestExpiry} />
                        {dist.overLimit ? (
                          <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-800">
                            Over limit
                          </span>
                        ) : dist.hasGuarantee ? (
                          <span className="rounded-md bg-teal-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal-900">
                            {dist.utilizationPct}%
                          </span>
                        ) : (
                          <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                            No guarantee
                          </span>
                        )}
                      </span>
                    }
                    fields={[
                      { label: 'Guarantee', value: formatLkrCompact(dist.totalGuarantee) },
                      { label: 'PO pending', value: formatLkrCompact(dist.pendingTotal) },
                      {
                        label: 'Available',
                        value: (
                          <span className={guaranteeAvailableToneClass(dist.available)}>
                            {formatLkrCompact(dist.available)}
                          </span>
                        ),
                      },
                      ...(dist.nearestExpiry?.status && dist.nearestExpiry.status !== 'none'
                        ? [
                            {
                              label: 'Expiry',
                              value:
                                dist.nearestExpiry.status === 'near' || dist.nearestExpiry.status === 'expired'
                                  ? formatGuaranteeExpiryHint(dist.nearestExpiry)
                                  : formatDisplayDate(dist.nearestExpiry.expireDate),
                            },
                          ]
                        : []),
                    ]}
                  />
                ))}
              </div>

              <div className={`hidden sm:block ${scrollTableWrap}`}>
                <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
                  <thead className={stickyThead}>
                    <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className={`px-4 py-2.5 ${stickyFirstTh}`}>Distributor</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right">Guarantee</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right">PO pending</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right">Available</th>
                      <th className="whitespace-nowrap px-3 py-2.5">Expiry</th>
                      <th className="min-w-[8rem] px-3 py-2.5">Utilization</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-800">
                    {distributorGuaranteeStatuses.map((dist) => (
                      <tr key={dist.distributorId} className="hover:bg-slate-50/70">
                        <td className={`max-w-[12rem] px-4 py-2.5 ${stickyFirstTd}`}>
                          <span className="block font-medium text-slate-900">{dist.distributorName}</span>
                          <span className="mt-0.5 block text-xs text-slate-500">
                            {dist.poPendingCount > 0
                              ? `${dist.poPendingCount} PO cheque${dist.poPendingCount === 1 ? '' : 's'} pending`
                              : dist.hasGuarantee
                                ? 'No pending PO cheques'
                                : 'No guarantee recorded'}
                          </span>
                          <span className="mt-1 inline-flex flex-wrap gap-1">
                            <GuaranteeExpiryBadge expiryInfo={dist.nearestExpiry} />
                            {dist.overLimit ? (
                              <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-800">
                                Over limit
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                          {formatLkrCompact(dist.totalGuarantee)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-violet-900">
                          {formatLkrCompact(dist.pendingTotal)}
                        </td>
                        <td
                          className={`whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums ${guaranteeAvailableToneClass(dist.available)}`}
                        >
                          {formatLkrCompact(dist.available)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-xs">
                          {dist.nearestExpiry?.status && dist.nearestExpiry.status !== 'none' ? (
                            <span
                              className={
                                dist.nearestExpiry.status === 'expired'
                                  ? 'font-semibold text-rose-700'
                                  : dist.nearestExpiry.status === 'near'
                                    ? 'font-semibold text-amber-800'
                                    : 'text-slate-600'
                              }
                            >
                              {dist.nearestExpiry.status === 'ok'
                                ? formatDisplayDate(dist.nearestExpiry.expireDate)
                                : formatGuaranteeExpiryHint(dist.nearestExpiry)}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {dist.hasGuarantee ? (
                            <GuaranteeUtilizationBar pct={dist.utilizationPct} overLimit={dist.overLimit} />
                          ) : (
                            <span className="text-xs text-amber-800">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-3 py-2.5 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                <p>
                  <span className="font-semibold text-slate-700">Incoming cheques (all customers)</span>
                  <span className="mx-1.5 text-slate-300">·</span>
                  <span className="tabular-nums">{formatLkrCompact(guaranteeStatus.incomingPendingTotal)} pending</span>
                  <span className="hidden text-slate-500 sm:inline"> — not tied to a distributor</span>
                </p>
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card
          title="Cash in vs stock spend"
          subtitle="Last 7 days · Daily customer payments compared to stock load purchase totals"
          className="lg:col-span-3"
        >
          {cashDashLoading ? (
            <div className="flex h-[260px] items-center justify-center text-sm text-slate-500"><LoadingSpinner /></div>
          ) : (
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cashFlow} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => (Number(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                  />
                  <Tooltip
                    formatter={(value) => formatLkrCompact(value)}
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.date ? String(payload[0].payload.date) : ''
                    }
                    contentStyle={{
                      borderRadius: 12,
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 10px 40px -10px rgb(0 0 0 / 0.15)',
                      fontSize: 12,
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 12 }}
                    formatter={(value) => <span className="text-slate-600">{value}</span>}
                  />
                  <Line
                    type="monotone"
                    dataKey="cashIn"
                    name="Customer payments"
                    stroke="#059669"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#059669', strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="cashOut"
                    name="Stock purchases"
                    stroke="#dc2626"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#dc2626', strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card
          title="Your transfers"
          subtitle="Last 5: customer payments in and stock purchases (loads)"
          className="lg:col-span-2"
        >
          {cashDashLoading ? (
            <div className="flex min-h-[200px] items-center justify-center text-sm text-slate-500"><LoadingSpinner /></div>
          ) : recentTransfers.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              No payments or stock purchases yet. They will appear here in chronological order.
            </p>
          ) : (
            <ul className="space-y-4">
              {recentTransfers.map((t) => {
                const isOut = t.kind === 'stock_purchase';
                const label = String(t.title || '').trim() || (isOut ? 'Stock' : 'Payment');
                const chip = label.slice(0, 1).toUpperCase();
                const when = formatRelativeTime(t.at);
                const sub = String(t.subtitle || '').trim();
                return (
                  <li key={t.id} className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                      {chip}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{label}</p>
                      <p className="truncate text-xs text-slate-500">
                        {when}
                        {sub ? ` · ${sub}` : ''}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-sm font-semibold tabular-nums ${isOut ? 'text-rose-500' : 'text-emerald-600'}`}
                    >
                      {isOut ? '-' : '+'}
                      {formatLkrCompact(t.amount)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Cheques to deposit today"
        subtitle={
          chequeDepositQueue.asOfDate
            ? chequeDepositQueue.throughDate && chequeDepositQueue.throughDate !== chequeDepositQueue.asOfDate
              ? `Cheques dated ${chequeDepositQueue.asOfDate} through ${chequeDepositQueue.throughDate} (server clock) that are not yet marked as deposited at the bank.`
              : `Cheques dated ${chequeDepositQueue.asOfDate} (server clock) that are not yet marked as deposited at the bank.`
            : 'Uses the server’s calendar date for “today” plus the next 2 days.'
        }
      >
        {chequeDepositErr ? (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-100" role="alert">
            {chequeDepositErr}
          </p>
        ) : null}
        {cashDashLoading ? (
          <div className="py-8 text-center text-sm text-slate-500"><LoadingSpinner /></div>
        ) : chequeDepositQueue.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            Nothing due for the bank run — either no cheques dated today or in the next 2 days, or they are already
            marked as deposited.
          </p>
        ) : (
          <>
          <div className={mobileCardList}>
            {chequeDepositQueue.items.map((row) => (
                <MobileRowCard
                  key={depositQueueRowKey(row)}
                  title={row.customerName || '—'}
                  subtitle={`Bill #${row.billNumber || '—'} · Cheque #${row.chequeNumber || '—'}`}
                  fields={[
                    {
                      label: 'Cheque date',
                      value: String(row.chequeDate || '').slice(0, 10) || '—',
                    },
                    { label: 'Amount', value: formatLkrExact(Number(row.chequeAmount) || 0) },
                  ]}
                />
              ))}
          </div>
          <div className={`hidden sm:block ${scrollTableWrap}`}>
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm">
              <thead className={stickyThead}>
                <tr className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className={`px-3 py-3 ${stickyFirstTh}`}>Customer</th>
                  <th className="whitespace-nowrap px-3 py-3 font-mono">Bill #</th>
                  <th className="whitespace-nowrap px-3 py-3 font-mono">Cheque #</th>
                  <th className="whitespace-nowrap px-3 py-3">Cheque date</th>
                  <th className="whitespace-nowrap px-3 py-3 text-right">Cheque amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {chequeDepositQueue.items.map((row) => (
                  <tr key={depositQueueRowKey(row)} className="hover:bg-slate-50/80">
                    <td className={`max-w-[180px] px-3 py-3 font-medium text-slate-900 ${stickyFirstTd}`}>
                      <span className="line-clamp-2">{row.customerName || '—'}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-xs tabular-nums">{row.billNumber || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-xs">{row.chequeNumber || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-600">
                      {String(row.chequeDate || '').slice(0, 10) || '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-violet-800">
                      {formatLkrExact(Number(row.chequeAmount) || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>

      <Card
        title="Overdue bills"
        headerExtra={
          <div className={overdueActionsClass}>
            {overdueDownloadButtons}
            {showOverdueViewAll ? (
              <button
                type="button"
                className={viewAllButtonClass}
                onClick={() => {
                  setOverdueListView('full');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                View all
              </button>
            ) : null}
          </div>
        }
      >
        <TableFiltersBar
          className="!bg-slate-50/90 shadow-none"
          hint={
            cashDashLoading
              ? null
              : overdueBills.length === 0
                ? 'No overdue bills — all are within payment terms or fully allocated by payments.'
                : `Showing ${filteredOverdueBills.length} of ${overdueBills.length} overdue bill${
                    overdueBills.length === 1 ? '' : 's'
                  }${overdueSearch.trim() ? ' (search)' : ''}. Use pagination below.`
          }
        >
          {overdueSearchInput}
        </TableFiltersBar>
        {cashDashLoading ? (
          <div className="mt-4 py-10 text-center text-sm text-slate-500"><LoadingSpinner /></div>
        ) : (
          <div className="mt-4">
            <OverdueBillsTable rows={filteredOverdueBills} totalLoadedCount={overdueBills.length} resetKey={overdueSearch} />
          </div>
        )}
      </Card>
    </div>
  );
}
