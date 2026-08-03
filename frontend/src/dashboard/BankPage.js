import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getApiBase } from '../apiBase';
import { authFetch, getUsername, isManagerOrAdmin } from '../auth';
import { buildChequeTableRows } from './paymentCheques';
import CashBookExpenseModal from './CashBookExpenseModal';
import CashBookChequeDepositModal from './CashBookChequeDepositModal';
import BankAccountMultiSelect, { formatBankAccountsLabel } from './BankAccountMultiSelect';
import {
  CASHIER_EXPENSE_ACTIONS,
  cashBookEntryDetail,
  bankDepositTypeLabel,
} from './cashBookCategories';
import {
  LoadingSpinner,
  TableFiltersBar,
  TablePaginationBar,
  filterControl,
  filterLabel,
  filterLabelNarrow,
  inDateRange,
  mobileCardList,
  MobileRowCard,
  rowMatchesQuery,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
  useTablePagination,
} from './tableToolbar';
import RowDetailModal, { detailRowAttrs } from './RowDetailModal';
import { formatPoChequeWithBank } from './poChequeDisplay';
import {
  buildCashBookLedgerRows,
  buildCashBookSourceEntries,
  summarizeCashBookLedger,
} from './cashBookLedger';

const apiBase = getApiBase();

const TABS = [
  { id: 'cashier', label: 'Cashier' },
  { id: 'bank', label: 'Bank' },
];

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function formatCashierCardAmount(n) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

function CashierStatAmount({ value, loading, valueClassName = 'text-slate-900' }) {
  if (loading) {
    return <p className="mt-1 text-2xl font-bold tabular-nums text-slate-400">—</p>;
  }
  return (
    <p
      className={`mt-1 flex min-w-0 items-baseline gap-x-1.5 font-bold tabular-nums leading-none ${valueClassName}`}
    >
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500">LKR</span>
      <span className="min-w-0 max-w-full break-all text-[clamp(1.125rem,4.5vw,1.875rem)] tracking-tight">
        {formatCashierCardAmount(value)}
      </span>
    </p>
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

const BANK_TX_KIND_FILTERS = [
  { value: 'paid_cheque', label: 'Paid cheques' },
  { value: 'pending_cheque', label: 'Pending cheques' },
  { value: 'deposit', label: 'Deposits' },
  { value: 'withdrawal', label: 'Withdrawals' },
];

const TX_KIND_BADGE = {
  paid_cheque: 'bg-emerald-50 text-emerald-900 ring-emerald-100',
  pending_cheque: 'bg-amber-50 text-amber-900 ring-amber-100',
  deposit: 'bg-sky-50 text-sky-900 ring-sky-100',
  withdrawal: 'bg-rose-50 text-rose-900 ring-rose-100',
};

const TX_KIND_LABEL = {
  paid_cheque: 'Paid cheque',
  pending_cheque: 'Pending cheque',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
};

function bankAccountLabel(accountId, bankAccounts) {
  const id = String(accountId ?? '').trim();
  if (!id) return '—';
  const a = (bankAccounts || []).find((x) => x.id === id);
  if (!a) return id;
  return String(a.nickName ?? '').trim() || String(a.bank ?? '').trim() || id;
}

function todayYmdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Cheque is pending until its cheque / converting date (local calendar day). */
function isFutureChequeDate(chequeDate, asOf = todayYmdLocal()) {
  const cd = String(chequeDate ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cd)) return false;
  return cd > asOf;
}

/** PO outgoing cheques — deduped like backend bank balance. */
function collectPoOutgoingCheques(purchaseOrders) {
  const seen = new Set();
  const rows = [];
  for (const po of Array.isArray(purchaseOrders) ? purchaseOrders : []) {
    const cheques = Array.isArray(po.cheques) ? po.cheques : [];
    const mode = String(po.chequeMode ?? '').trim();
    const batchId = String(po.batchId ?? '').trim();
    const poId = String(po.id ?? '').trim();
    for (let i = 0; i < cheques.length; i++) {
      const c = cheques[i];
      if (!c || typeof c !== 'object') continue;
      if (c.cancelled) continue;
      if (c.chequeReturned) continue;
      const bankAccountId = String(c.bankAccountId ?? '').trim();
      const amount = Math.max(0, Number(c.amount) || 0);
      if (!bankAccountId || amount <= 0) continue;
      const chequeNumber = String(c.chequeNumber ?? '').trim();
      const chequeDate = String(c.chequeDate ?? '').trim().slice(0, 10);
      const dedupeKey =
        mode === 'shared' && batchId
          ? `shared:${batchId}:${chequeNumber}:${chequeDate}:${amount}:${bankAccountId}`
          : `po:${poId}:${i}:${chequeNumber}:${chequeDate}:${amount}:${bankAccountId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      rows.push({
        bankAccountId,
        amount,
        chequeNumber,
        chequeDate,
        bankAccount: c.bankAccount,
        poId,
        product: String(po.product ?? '').trim() || '—',
        sortAt: po.createdAt || `${chequeDate}T12:00:00`,
      });
    }
  }
  return rows;
}

function buildBankTransactionRows(deposits, payments, purchaseOrders, bankAccounts) {
  const rows = [];

  for (const d of Array.isArray(deposits) ? deposits : []) {
    const date = String(d.date ?? '').slice(0, 10);
    rows.push({
      id: `dep:${d.id}`,
      kind: 'deposit',
      direction: 'in',
      date: date || '—',
      amount: Math.max(0, Number(d.amount) || 0),
      bankAccountIds: Array.isArray(d.bankAccountIds) ? d.bankAccountIds.filter(Boolean) : [],
      accountLabel: formatBankAccountsLabel(d) || '—',
      note: String(d.description ?? '').trim() || cashBookEntryDetail(d),
      subLabel: bankDepositTypeLabel(d),
      recordedBy: String(d.recordedBy ?? '').trim() || '—',
      sortAt: d.createdAt || `${date}T12:00:00`,
      detailVariant: null,
      detailPayload: d,
    });
  }

  buildChequeTableRows(payments, (p, c, flat) => {
    if (flat.chequeReturned) return null;
    const bankAccountId = String(c.chequeDepositedBankAccountId ?? '').trim();
    const snap = c.chequeDepositedBankAccount;
    const accountLabel =
      snap && typeof snap === 'object'
        ? String(snap.nickName ?? '').trim() || String(snap.bank ?? '').trim() || bankAccountId
        : bankAccountLabel(bankAccountId, bankAccounts);
    const futureDated = isFutureChequeDate(flat.chequeDate);
    const kind = flat.chequeDeposited && !futureDated ? 'paid_cheque' : 'pending_cheque';
    rows.push({
      id: `chq:${flat.rowKey}`,
      kind,
      direction: 'in',
      date: flat.chequeDate || '—',
      amount: flat.amount,
      bankAccountIds: kind === 'paid_cheque' && bankAccountId ? [bankAccountId] : [],
      accountLabel: kind === 'paid_cheque' ? accountLabel || '—' : '—',
      note: [
        flat.chequeNumber && flat.chequeNumber !== '—' ? `#${flat.chequeNumber}` : '',
        String(p.customerName ?? '').trim(),
        p.billNumber != null ? `Bill ${p.billNumber}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      subLabel: futureDated
        ? 'Customer cheque · future dated'
        : kind === 'paid_cheque'
          ? 'Customer cheque deposited'
          : 'Customer cheque',
      recordedBy: flat.chequeDepositedBy || String(p.recordedBy ?? '').trim() || '—',
      sortAt: flat.chequeDepositedAt || p.createdAt || `${flat.chequeDate}T12:00:00`,
      detailVariant: 'bankCheque',
      detailPayload: {
        id: p.id,
        chequeId: c.id,
        chequeDate: flat.chequeDate,
        amount: flat.amount,
        chequeNumber: flat.chequeNumber,
        chequeDeposited: flat.chequeDeposited,
        chequeDepositedAt: flat.chequeDepositedAt,
        chequeDepositedBy: flat.chequeDepositedBy,
        chequeReturned: flat.chequeReturned,
        customerName: String(p.customerName ?? '').trim() || '—',
        billNumber: p.billNumber != null ? String(p.billNumber) : '—',
        paymentDate: String(p.date ?? '').slice(0, 10) || '—',
      },
    });
    return null;
  });

  for (const c of collectPoOutgoingCheques(purchaseOrders)) {
    const futureDated = isFutureChequeDate(c.chequeDate);
    const kind = futureDated ? 'pending_cheque' : 'withdrawal';
    rows.push({
      id: `po:${c.poId}:${c.chequeNumber}:${c.chequeDate}:${c.bankAccountId}`,
      source: 'po',
      poId: c.poId,
      chequeNumber: c.chequeNumber,
      bankAccountId: c.bankAccountId,
      kind,
      direction: 'out',
      date: c.chequeDate || '—',
      amount: c.amount,
      bankAccountIds: [c.bankAccountId],
      accountLabel: bankAccountLabel(c.bankAccountId, bankAccounts),
      note: [
        c.chequeNumber ? formatPoChequeWithBank(c, bankAccounts) : '',
        c.product !== '—' ? c.product : '',
      ]
        .filter(Boolean)
        .join(' · '),
      subLabel: futureDated ? 'PO cheque · future converting date' : 'Purchase order cheque',
      recordedBy: '—',
      sortAt: c.sortAt,
      detailVariant: 'poCheque',
      detailPayload: {
        poId: c.poId,
        product: c.product,
        chequeNumber: c.chequeNumber,
        chequeDate: c.chequeDate,
        bankAccountId: c.bankAccountId,
        amount: c.amount,
        accountLabel: bankAccountLabel(c.bankAccountId, bankAccounts),
        futureDated,
      },
    });
  }

  rows.sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    if (byDate !== 0) return byDate;
    return String(b.sortAt).localeCompare(String(a.sortAt));
  });
  return rows;
}

function bankTransactionSearchFields(r) {
  return [
    r.date,
    r.kind,
    TX_KIND_LABEL[r.kind],
    r.accountLabel,
    r.note,
    r.subLabel,
    r.recordedBy,
    String(r.amount),
  ];
}

function filterBankTransactionRows(rows, { dateFrom, dateTo, search, accountIds }) {
  let list = rows.filter((r) => inDateRange(r.date, dateFrom, dateTo));
  if (Array.isArray(accountIds) && accountIds.length > 0) {
    const pick = new Set(accountIds);
    list = list.filter((r) => {
      if (r.kind === 'pending_cheque') {
        const ids = Array.isArray(r.bankAccountIds) ? r.bankAccountIds : [];
        if (ids.length === 0) return true;
        return ids.some((id) => pick.has(id));
      }
      const ids = Array.isArray(r.bankAccountIds) ? r.bankAccountIds : [];
      if (ids.length === 0) return true;
      return ids.some((id) => pick.has(id));
    });
  }
  if (!search.trim()) return list;
  return list.filter((r) => rowMatchesQuery(search, bankTransactionSearchFields(r)));
}

function KindBadge({ kind }) {
  const label = TX_KIND_LABEL[kind] || kind;
  const cls = TX_KIND_BADGE[kind] || 'bg-slate-50 text-slate-700 ring-slate-100';
  return (
    <span className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ${cls}`}>{label}</span>
  );
}

function CashierPanel({ refreshToken, onBooksChanged }) {
  const [payments, setPayments] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [staff, setStaff] = useState([]);
  const [lorries, setLorries] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [ledgerDetail, setLedgerDetail] = useState(null);
  const [expenseModalCategory, setExpenseModalCategory] = useState(null);
  const [chequeDepositOpen, setChequeDepositOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [payRes, expRes, staffRes, lorryRes, shopRes] = await Promise.all([
        fetch(`${apiBase}/api/payments`),
        fetch(`${apiBase}/api/cash-book-entries`),
        fetch(`${apiBase}/api/staff`),
        fetch(`${apiBase}/api/lorries`),
        fetch(`${apiBase}/api/shop`),
      ]);
      if (!payRes.ok) throw new Error('Failed to load payments');
      const payData = await payRes.json();
      setPayments(Array.isArray(payData) ? payData : []);

      if (expRes.ok) {
        const expData = await expRes.json();
        setExpenses(Array.isArray(expData) ? expData : []);
      } else {
        setExpenses([]);
      }
      if (staffRes.ok) {
        const staffData = await staffRes.json();
        setStaff(Array.isArray(staffData) ? staffData : []);
      } else {
        setStaff([]);
      }
      if (lorryRes.ok) {
        const lorryData = await lorryRes.json();
        setLorries(Array.isArray(lorryData) ? lorryData : []);
      } else {
        setLorries([]);
      }
      if (shopRes.ok) {
        const shopData = await shopRes.json();
        setBankAccounts(Array.isArray(shopData.bankAccounts) ? shopData.bankAccounts : []);
      } else {
        setBankAccounts([]);
      }
    } catch (e) {
      setError(e.message || 'Could not load cashier data');
      setPayments([]);
      setExpenses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  const sourceEntries = useMemo(
    () => buildCashBookSourceEntries(payments, expenses),
    [payments, expenses],
  );

  const ledgerRows = useMemo(
    () => buildCashBookLedgerRows(sourceEntries, { dateFrom, dateTo }),
    [sourceEntries, dateFrom, dateTo],
  );

  const filteredLedgerRows = useMemo(() => {
    if (!search.trim()) return ledgerRows;
    return ledgerRows.filter((r) =>
      rowMatchesQuery(search, [
        r.date,
        r.type,
        r.details,
        r.recordedBy,
        r.debit != null ? String(r.debit) : '',
        r.credit != null ? String(r.credit) : '',
        r.balance != null ? String(r.balance) : '',
      ]),
    );
  }, [ledgerRows, search]);

  const ledgerSummary = useMemo(() => summarizeCashBookLedger(ledgerRows), [ledgerRows]);

  const ledgerPagination = useTablePagination(filteredLedgerRows.length, [dateFrom, dateTo, search]);
  const pagedLedgerRows = useMemo(
    () =>
      filteredLedgerRows.slice(ledgerPagination.offset, ledgerPagination.offset + ledgerPagination.pageSize),
    [filteredLedgerRows, ledgerPagination.offset, ledgerPagination.pageSize],
  );

  const handleExpenseSaved = () => {
    onBooksChanged?.();
  };

  const openCashierExpense = useCallback(async (category) => {
    if (category === 'bank_deposit') {
      try {
        const res = await fetch(`${apiBase}/api/shop`);
        if (res.ok) {
          const shop = await res.json();
          setBankAccounts(Array.isArray(shop.bankAccounts) ? shop.bankAccounts : []);
        }
      } catch {
        /* keep cached list */
      }
    }
    setExpenseModalCategory(category);
  }, []);

  const openChequeDeposit = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/shop`);
      if (res.ok) {
        const shop = await res.json();
        setBankAccounts(Array.isArray(shop.bankAccounts) ? shop.bankAccounts : []);
      }
    } catch {
      /* keep cached list */
    }
    setChequeDepositOpen(true);
  }, []);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0 rounded-[20px] bg-white p-4 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cash in</p>
          <CashierStatAmount loading={loading} value={ledgerSummary.debit} valueClassName="text-emerald-800" />
          <p className="mt-1 text-sm text-slate-500">Debit · customer cash</p>
        </div>
        <div className="min-w-0 rounded-[20px] bg-white p-4 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cash out</p>
          <CashierStatAmount loading={loading} value={ledgerSummary.credit} valueClassName="text-rose-800" />
          <p className="mt-1 text-sm text-slate-500">Credit · expenses & bank deposits</p>
        </div>
        <div className="min-w-0 rounded-[20px] bg-white p-4 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Net movement</p>
          <CashierStatAmount loading={loading} value={ledgerSummary.netInPeriod} valueClassName="text-slate-900" />
          <p className="mt-1 text-sm text-slate-500">In selected period</p>
        </div>
        <div className="min-w-0 rounded-[20px] bg-white p-4 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Closing balance</p>
          <CashierStatAmount loading={loading} value={ledgerSummary.closing} valueClassName="text-indigo-900" />
          <p className="mt-1 text-sm text-slate-500">Cash on hand at period end</p>
        </div>
      </div>

      <div className="rounded-[20px] bg-white p-3 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-4">
        <p className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Record</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {CASHIER_EXPENSE_ACTIONS.map(({ category, label }) => (
            <button
              key={category}
              type="button"
              onClick={() => openCashierExpense(category)}
              className={
                category === 'bank_deposit'
                  ? 'inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-sky-500/20 transition hover:brightness-[1.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40'
                  : 'inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm ring-1 ring-slate-100 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40'
              }
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={openChequeDeposit}
            className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-violet-500/20 transition hover:brightness-[1.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
          >
            Cheque deposits
          </button>
        </div>
      </div>

      <TableFiltersBar
        hint={
          !loading && filteredLedgerRows.length > 0
            ? `${ledgerSummary.count} entr${ledgerSummary.count === 1 ? 'y' : 'ies'} · closing ${money(ledgerSummary.closing)}${dateFrom ? ' · starting balance included' : ''}`
            : null
        }
      >
        <label className={filterLabelNarrow}>
          From date
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={filterControl} />
        </label>
        <label className={filterLabelNarrow}>
          To date
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={filterControl} />
        </label>
        <label className={filterLabel}>
          Search ledger
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Date, type, details, amount…"
            className={filterControl}
          />
        </label>
      </TableFiltersBar>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Cash ledger</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Oldest first. Debits are customer cash; credits are expenses and cash sent to the bank (also listed under
            Bank).
          </p>
        </div>
        <div className={mobileCardList}>
          {loading ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              <LoadingSpinner />
            </p>
          ) : filteredLedgerRows.length === 0 ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              {sourceEntries.length === 0
                ? 'No cashier activity yet. Record customer payments (cash) or expenses above.'
                : 'No ledger entries match this range or search.'}
            </p>
          ) : (
            pagedLedgerRows.map((r) => (
              <MobileRowCard
                key={r.id}
                title={r.kind === 'starting' ? 'Starting balance' : formatDisplayDate(r.date)}
                subtitle={r.type}
                badge={
                  r.kind === 'starting' ? (
                    <span className="rounded-md bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-900">
                      Opening
                    </span>
                  ) : r.kind === 'cash_in' ? (
                    <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-900">
                      Cash in
                    </span>
                  ) : r.kind === 'bank_deposit' ? (
                    <span className="rounded-md bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-900">
                      To bank
                    </span>
                  ) : (
                    <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-900">
                      Cash out
                    </span>
                  )
                }
                onClick={
                  r.detailRow
                    ? () => setLedgerDetail({ kind: r.detailKind, row: r.detailRow })
                    : undefined
                }
                fields={[
                  { label: 'Details', value: r.details || '—' },
                  {
                    label: 'Debit',
                    value: r.debit != null && r.debit > 0 ? money(r.debit) : '—',
                  },
                  {
                    label: 'Credit',
                    value: r.credit != null && r.credit > 0 ? money(r.credit) : '—',
                  },
                  { label: 'Balance', value: money(r.balance) },
                ]}
              />
            ))
          )}
        </div>
        <div className={`hidden sm:block ${scrollTableWrap}`}>
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Details</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Debit</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Credit</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Balance</th>
                <th className="whitespace-nowrap px-4 py-3">Recorded by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : filteredLedgerRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    {sourceEntries.length === 0
                      ? 'No cashier activity yet.'
                      : 'No ledger entries match this range or search.'}
                  </td>
                </tr>
              ) : (
                pagedLedgerRows.map((r) => (
                  <tr
                    key={r.id}
                    {...(r.detailRow
                      ? detailRowAttrs(
                          () => setLedgerDetail({ kind: r.detailKind, row: r.detailRow }),
                          r.kind === 'starting' ? 'bg-indigo-50/50 font-medium' : 'hover:bg-slate-50/80',
                        )
                      : { className: r.kind === 'starting' ? 'bg-indigo-50/50 font-medium' : undefined })}
                    aria-label={r.type}
                  >
                    <td className={`whitespace-nowrap px-4 py-3 tabular-nums ${stickyFirstTd}`}>
                      {formatDisplayDate(r.date)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">{r.type}</td>
                    <td className="max-w-xs px-4 py-3 text-slate-700">{r.details || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-emerald-800">
                      {r.debit != null && r.debit > 0 ? money(r.debit) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-rose-800">
                      {r.credit != null && r.credit > 0 ? money(r.credit) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-bold tabular-nums text-slate-900">
                      {money(r.balance)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.recordedBy || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && filteredLedgerRows.length > 0 ? (
          <TablePaginationBar
            page={ledgerPagination.page}
            totalPages={ledgerPagination.totalPages}
            pageSize={ledgerPagination.pageSize}
            totalCount={filteredLedgerRows.length}
            onPageChange={ledgerPagination.setPage}
            onPageSizeChange={ledgerPagination.setPageSize}
          />
        ) : null}
      </section>

      <RowDetailModal
        open={ledgerDetail?.kind === 'cash_in'}
        row={ledgerDetail?.row}
        onClose={() => setLedgerDetail(null)}
      />
      <RowDetailModal
        open={ledgerDetail?.kind === 'expense'}
        row={ledgerDetail?.row}
        onClose={() => setLedgerDetail(null)}
      />

      <CashBookExpenseModal
        open={expenseModalCategory != null}
        category={expenseModalCategory}
        onClose={() => setExpenseModalCategory(null)}
        onSaved={handleExpenseSaved}
        staff={staff}
        lorries={lorries}
        bankAccounts={bankAccounts}
      />
      <CashBookChequeDepositModal
        open={chequeDepositOpen}
        onClose={() => setChequeDepositOpen(false)}
        onSaved={handleExpenseSaved}
        bankAccounts={bankAccounts}
      />
    </>
  );
}

function BankPanel({ refreshToken }) {
  const [deposits, setDeposits] = useState([]);
  const [payments, setPayments] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [txKindFilter, setTxKindFilter] = useState('all');
  const [detailRow, setDetailRow] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelErr, setCancelErr] = useState(null);
  const [balanceByAccountId, setBalanceByAccountId] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setAccountsLoading(true);
    setError(null);
    try {
      const [depRes, payRes, poRes, shopRes, balRes] = await Promise.all([
        fetch(`${apiBase}/api/cash-book-entries?category=bank_deposit`),
        fetch(`${apiBase}/api/payments`),
        fetch(`${apiBase}/api/purchase-orders`),
        fetch(`${apiBase}/api/shop`),
        fetch(`${apiBase}/api/bank-account-balances`),
      ]);
      if (!depRes.ok) throw new Error('Failed to load bank transactions');
      const depData = await depRes.json();
      setDeposits(Array.isArray(depData) ? depData : []);

      if (payRes.ok) {
        const payData = await payRes.json();
        setPayments(Array.isArray(payData) ? payData : []);
      } else {
        setPayments([]);
      }

      if (poRes.ok) {
        const poData = await poRes.json();
        setPurchaseOrders(Array.isArray(poData) ? poData : []);
      } else {
        setPurchaseOrders([]);
      }

      if (shopRes.ok) {
        const shopData = await shopRes.json();
        setBankAccounts(Array.isArray(shopData.bankAccounts) ? shopData.bankAccounts : []);
      } else {
        setBankAccounts([]);
      }

      if (balRes.ok) {
        const balData = await balRes.json();
        setBalanceByAccountId(balData?.byAccountId && typeof balData.byAccountId === 'object' ? balData.byAccountId : {});
      } else {
        setBalanceByAccountId({});
      }
    } catch (e) {
      setError(e.message || 'Could not load bank transactions');
      setDeposits([]);
      setPayments([]);
      setPurchaseOrders([]);
      setBankAccounts([]);
      setBalanceByAccountId({});
    } finally {
      setLoading(false);
      setAccountsLoading(false);
    }
  }, []);

  const openTxDetail = useCallback((r) => {
    setCancelErr(null);
    setDetailRow({
      variant: r.detailVariant,
      payload: r.detailPayload,
      txRow: r.source === 'po' ? r : null,
    });
  }, []);

  const handleCancelPoCheque = useCallback(async () => {
    const tx = detailRow?.txRow;
    if (!tx || tx.source !== 'po') return;
    const username = getUsername();
    if (!username) {
      setCancelErr('Sign in with your username to cancel cheques.');
      return;
    }
    const label = tx.chequeNumber ? `#${tx.chequeNumber}` : 'this cheque';
    if (
      !window.confirm(
        `Cancel issued cheque ${label} (${money(tx.amount)})? It will be removed from bank balances and this list.`,
      )
    ) {
      return;
    }
    setCancelBusy(true);
    setCancelErr(null);
    try {
      const res = await authFetch(
        `${apiBase}/api/purchase-orders/${encodeURIComponent(tx.poId)}/cancel-cheque`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cancelledBy: username,
            chequeNumber: tx.chequeNumber,
            chequeDate: tx.date,
            bankAccountId: tx.bankAccountId,
            amount: tx.amount,
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCancelErr(data.error || 'Could not cancel cheque');
        return;
      }
      setDetailRow(null);
      await load();
    } catch {
      setCancelErr('Could not reach server');
    } finally {
      setCancelBusy(false);
    }
  }, [detailRow, load]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  useEffect(() => {
    if (bankAccounts.length === 0) return;
    const allIds = bankAccounts.map((a) => a.id).filter(Boolean);
    setSelectedAccountIds((prev) => {
      if (prev.length > 0) {
        const valid = new Set(allIds);
        const kept = prev.filter((id) => valid.has(id));
        return kept.length > 0 ? kept : allIds;
      }
      return allIds;
    });
  }, [bankAccounts]);

  const accountBalanceTotals = useMemo(() => {
    const totals = {};
    for (const a of bankAccounts) {
      if (a.id) totals[a.id] = balanceByAccountId[a.id]?.balance ?? 0;
    }
    return totals;
  }, [bankAccounts, balanceByAccountId]);

  const accountPendingOutgoing = useMemo(() => {
    const totals = {};
    for (const a of bankAccounts) {
      if (a.id) totals[a.id] = balanceByAccountId[a.id]?.pendingOutgoing ?? 0;
    }
    return totals;
  }, [bankAccounts, balanceByAccountId]);

  const allTransactions = useMemo(
    () => buildBankTransactionRows(deposits, payments, purchaseOrders, bankAccounts),
    [deposits, payments, purchaseOrders, bankAccounts],
  );

  const scopedRows = useMemo(
    () =>
      filterBankTransactionRows(allTransactions, {
        dateFrom,
        dateTo,
        search,
        accountIds: selectedAccountIds,
      }),
    [allTransactions, dateFrom, dateTo, search, selectedAccountIds],
  );

  const kindCounts = useMemo(() => {
    const counts = { paid_cheque: 0, pending_cheque: 0, deposit: 0, withdrawal: 0 };
    for (const r of scopedRows) {
      if (counts[r.kind] != null) counts[r.kind] += 1;
    }
    return counts;
  }, [scopedRows]);

  const filteredRows = useMemo(() => {
    if (txKindFilter === 'all') return scopedRows;
    return scopedRows.filter((r) => r.kind === txKindFilter);
  }, [scopedRows, txKindFilter]);

  const total = useMemo(
    () =>
      filteredRows.reduce((s, r) => {
        if (r.kind === 'pending_cheque') return s;
        const amt = Number(r.amount) || 0;
        return s + (r.direction === 'out' ? -amt : amt);
      }, 0),
    [filteredRows],
  );

  const pagination = useTablePagination(filteredRows.length, [dateFrom, dateTo, search, txKindFilter]);
  const pagedRows = useMemo(
    () => filteredRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filteredRows, pagination.offset, pagination.pageSize],
  );

  return (
    <>
      <section className="rounded-[20px] bg-white p-4 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Bank accounts</h2>
            <p className="mt-1 text-sm text-slate-500">
              Balance includes deposits and deposited customer cheques, minus PO cheques whose converting date
              has passed. Pending PO cheques show until their converting date. Balance may go negative.
            </p>
          </div>
          <Link
            to="/dashboard/shop"
            className="shrink-0 text-sm font-semibold text-indigo-700 hover:text-indigo-900"
          >
            Manage in Shop →
          </Link>
        </div>
        <div className="mt-4">
          {accountsLoading ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner />
            </div>
          ) : (
            <BankAccountMultiSelect
              accounts={bankAccounts}
              selectedIds={selectedAccountIds}
              onChange={setSelectedAccountIds}
              accountAmounts={accountBalanceTotals}
              accountPendingAmounts={accountPendingOutgoing}
              formatAmount={money}
              amountsLoading={loading}
            />
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Transaction history</h2>
          <p className="mt-0.5 text-sm text-slate-500">Deposits, customer cheques, and PO cheque withdrawals.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {BANK_TX_KIND_FILTERS.map(({ value, label }) => {
            const count = kindCounts[value] ?? 0;
            const active = txKindFilter === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setTxKindFilter((prev) => (prev === value ? 'all' : value))}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                  active
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                    : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                {label}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
                    active ? 'bg-indigo-500/40 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {loading ? '—' : count}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <TableFiltersBar
        hint={
          !loading && filteredRows.length > 0
            ? `${filteredRows.length} transaction${filteredRows.length === 1 ? '' : 's'}`
            : null
        }
      >
        <label className={filterLabelNarrow}>
          From date
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={filterControl} />
        </label>
        <label className={filterLabelNarrow}>
          To date
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={filterControl} />
        </label>
        <label className={filterLabel}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Date, note, cheque #, amount…"
            className={filterControl}
          />
        </label>
      </TableFiltersBar>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      <div className="space-y-3">
        <div className={mobileCardList}>
          {loading ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              <LoadingSpinner />
            </p>
          ) : filteredRows.length === 0 ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              {scopedRows.length === 0
                ? 'No transactions yet for the selected accounts and date range.'
                : txKindFilter !== 'all'
                  ? `No ${TX_KIND_LABEL[txKindFilter]?.toLowerCase() || 'matching'} items in this range.`
                  : 'No transactions match your filters.'}
            </p>
          ) : (
            pagedRows.map((r) => (
              <MobileRowCard
                key={r.id}
                title={r.date}
                subtitle={r.note || r.subLabel}
                badge={<KindBadge kind={r.kind} />}
                onClick={() => openTxDetail(r)}
                fields={[
                  { label: 'Account', value: r.accountLabel },
                  {
                    label: 'Amount',
                    value:
                      r.kind === 'withdrawal'
                        ? `−${money(r.amount)}`
                        : r.kind === 'pending_cheque' && r.direction === 'out'
                          ? money(r.amount)
                          : money(r.amount),
                  },
                  { label: 'Recorded by', value: r.recordedBy },
                ]}
              />
            ))
          )}
        </div>
        <div className={`hidden sm:block ${scrollTableWrap}`}>
          <table className="w-full min-w-[800px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
                <th className="whitespace-nowrap px-4 py-3">Category</th>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Details</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
                <th className="whitespace-nowrap px-4 py-3">Recorded by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    {scopedRows.length === 0
                      ? 'No transactions yet for the selected accounts and date range.'
                      : txKindFilter !== 'all'
                        ? `No ${TX_KIND_LABEL[txKindFilter]?.toLowerCase() || 'matching'} items in this range.`
                        : 'No transactions match your filters.'}
                  </td>
                </tr>
              ) : (
                pagedRows.map((r) => (
                  <tr
                    key={r.id}
                    {...detailRowAttrs(() => openTxDetail(r), 'hover:bg-slate-50/80')}
                    aria-label={`${TX_KIND_LABEL[r.kind] || r.kind} ${r.date}`}
                  >
                    <td className={`whitespace-nowrap px-4 py-3 tabular-nums ${stickyFirstTd}`}>{r.date}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <KindBadge kind={r.kind} />
                    </td>
                    <td className="max-w-[12rem] px-4 py-3 text-sm font-medium text-slate-800">{r.accountLabel}</td>
                    <td className="max-w-xs px-4 py-3 text-slate-700">
                      <span className="block text-slate-800">{r.note || '—'}</span>
                      {r.subLabel ? <span className="mt-0.5 block text-xs text-slate-500">{r.subLabel}</span> : null}
                    </td>
                    <td
                      className={`whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums ${
                        r.kind === 'withdrawal'
                          ? 'text-rose-800'
                          : r.kind === 'pending_cheque' && r.direction === 'out'
                            ? 'text-amber-800'
                            : 'text-emerald-800'
                      }`}
                    >
                      {r.kind === 'withdrawal'
                        ? '−'
                        : r.kind === 'pending_cheque' && r.direction === 'out'
                          ? ''
                          : '+'}
                      {money(r.amount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.recordedBy}</td>
                  </tr>
                ))
              )}
            </tbody>
            {!loading && filteredRows.length > 0 ? (
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50/90 text-sm font-semibold text-slate-900">
                  <td className="px-4 py-3" colSpan={4}>
                    Total ({filteredRows.length})
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-900">{money(total)}</td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        {!loading && filteredRows.length > 0 ? (
          <TablePaginationBar
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            totalCount={filteredRows.length}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        ) : null}
      </div>

      <RowDetailModal
        open={detailRow != null}
        variant={detailRow?.variant}
        row={detailRow?.payload}
        onClose={() => {
          setDetailRow(null);
          setCancelErr(null);
        }}
        actions={
          isManagerOrAdmin() && detailRow?.txRow?.source === 'po' ? (
            <div className="flex w-full min-w-[12rem] flex-col gap-2">
              {cancelErr ? (
                <p className="text-sm text-red-700" role="alert">
                  {cancelErr}
                </p>
              ) : null}
              <button
                type="button"
                disabled={cancelBusy}
                onClick={handleCancelPoCheque}
                className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cancelBusy ? 'Cancelling…' : 'Cancel issued cheque'}
              </button>
            </div>
          ) : null
        }
      />
    </>
  );
}

export default function BankPage() {
  const [tab, setTab] = useState('cashier');
  const [refreshToken, setRefreshToken] = useState(0);

  const bumpRefresh = useCallback(() => setRefreshToken((t) => t + 1), []);

  return (
    <div className="space-y-5">
      <div
        className="rounded-[20px] bg-white p-2 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-2.5"
        role="tablist"
        aria-label="Cash book sections"
      >
        <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
          {TABS.map(({ id, label }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(id)}
                className={`rounded-xl py-3.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 sm:py-4 sm:text-base ${
                  active
                    ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'cashier' ? <CashierPanel refreshToken={refreshToken} onBooksChanged={bumpRefresh} /> : null}
      {tab === 'bank' ? <BankPanel refreshToken={refreshToken} /> : null}
    </div>
  );
}
