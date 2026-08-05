import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getApiBase } from '../apiBase';
import { authFetch, getUsername, isManagerOrAdmin } from '../auth';
import { buildChequeTableRows } from './paymentCheques';
import CashBookExpenseModal from './CashBookExpenseModal';
import CashBookChequeDepositModal from './CashBookChequeDepositModal';
import CashBookCompanyChequeModal from './CashBookCompanyChequeModal';
import CashBookOwnerShareModal from './CashBookOwnerShareModal';
import CashBookBankGuaranteeModal from './CashBookBankGuaranteeModal';
import { summarizeGuaranteesByDistributor } from './guaranteeStatus';
import BankAccountMultiSelect, { formatBankAccountsLabel } from './BankAccountMultiSelect';
import {
  CASHIER_EXPENSE_ACTIONS,
  cashBookEntryDetail,
  bankDepositTypeLabel,
  bankGuaranteeTypeLabel,
  BANK_GUARANTEE_TYPE_OPTIONS,
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

const SHOW_DEPOSITED_CUSTOMER_CHEQUES_SECTION = false;

const TABS = [
  { id: 'cashier', label: 'Cashier' },
  { id: 'bank', label: 'Bank' },
  { id: 'bank_guarantee', label: 'Bank guarantee' },
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

const GUARANTEE_TYPE_BADGE = {
  fixed_deposit: 'bg-teal-50 text-teal-900 ring-teal-100',
  property: 'bg-amber-50 text-amber-900 ring-amber-100',
  other: 'bg-slate-50 text-slate-700 ring-slate-100',
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

function buildBankTransactionRows(deposits, payments, purchaseOrders, companyCheques, bankAccounts) {
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
    if (!flat.chequeDeposited) return null;
    const bankAccountId = String(c.chequeDepositedBankAccountId ?? '').trim();
    const snap = c.chequeDepositedBankAccount;
    const accountLabel =
      snap && typeof snap === 'object'
        ? String(snap.nickName ?? '').trim() || String(snap.bank ?? '').trim() || bankAccountId
        : bankAccountLabel(bankAccountId, bankAccounts);
    const futureDated = isFutureChequeDate(flat.chequeDate);
    const kind = 'paid_cheque';
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
        chequeReturnedAt: c.chequeReturnedAt,
        chequeReturnedBy: c.chequeReturnedBy,
        customerName: String(p.customerName ?? '').trim() || '—',
        billNumber: p.billNumber != null ? String(p.billNumber) : '—',
        paymentDate: String(p.date ?? '').slice(0, 10) || '—',
      },
    });
    return null;
  });

  for (const e of Array.isArray(companyCheques) ? companyCheques : []) {
    const chequeDate = String(e.chequeDate ?? e.date ?? '').slice(0, 10);
    const amount = Math.max(0, Number(e.amount) || 0);
    if (amount <= 0) continue;
    const chequeNumber = String(e.chequeNumber ?? '').trim() || '—';
    const bankAccountId = String(e.chequeDepositedBankAccountId ?? '').trim();
    const snap = e.chequeDepositedBankAccount;
    const accountLabel =
      snap && typeof snap === 'object'
        ? String(snap.nickName ?? '').trim() || String(snap.bank ?? '').trim() || bankAccountId
        : bankAccountLabel(bankAccountId, bankAccounts);
    const futureDated = isFutureChequeDate(chequeDate);
    const deposited = !!e.chequeDeposited;
    const kind = deposited && !futureDated ? 'paid_cheque' : 'pending_cheque';
    if (kind === 'pending_cheque') continue;
    const note = String(e.description ?? '').trim() || (chequeNumber !== '—' ? `#${chequeNumber}` : 'Company cheque');
    rows.push({
      id: `cc:${e.id}`,
      kind,
      direction: 'in',
      date: chequeDate || '—',
      amount,
      bankAccountIds: kind === 'paid_cheque' && bankAccountId ? [bankAccountId] : [],
      accountLabel: kind === 'paid_cheque' ? accountLabel || '—' : '—',
      note,
      subLabel: futureDated
        ? 'Company cheque · future dated'
        : kind === 'paid_cheque'
          ? 'Company cheque deposited'
          : 'Company cheque',
      recordedBy: String(e.chequeDepositedBy ?? e.recordedBy ?? '').trim() || '—',
      sortAt: e.chequeDepositedAt || e.createdAt || `${chequeDate}T12:00:00`,
      detailVariant: 'companyCheque',
      detailPayload: {
        id: e.id,
        chequeDate,
        amount,
        chequeNumber,
        chequeDeposited: deposited,
        chequeDepositedAt: String(e.chequeDepositedAt ?? '').trim(),
        chequeDepositedBy: String(e.chequeDepositedBy ?? '').trim(),
        receivedDate: String(e.date ?? '').slice(0, 10) || '—',
        description: String(e.description ?? '').trim() || '—',
      },
    });
  }

  for (const c of collectPoOutgoingCheques(purchaseOrders)) {
    const futureDated = isFutureChequeDate(c.chequeDate);
    if (futureDated) continue;
    const kind = 'withdrawal';
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
      const ids = Array.isArray(r.bankAccountIds) ? r.bankAccountIds : [];
      if (ids.length === 0) return true;
      return ids.some((id) => pick.has(id));
    });
  }
  if (!search.trim()) return list;
  return list.filter((r) => rowMatchesQuery(search, bankTransactionSearchFields(r)));
}

function isReturnableCustomerChequeRow(r) {
  return r?.detailVariant === 'bankCheque' && r?.detailPayload && !r.detailPayload.chequeReturned;
}

function buildDepositedCustomerChequeRows(payments, bankAccounts) {
  return buildChequeTableRows(payments, (p, c, flat) => {
    if (!c.chequeDeposited || c.chequeReturned) return null;
    const bankAccountId = String(c.chequeDepositedBankAccountId ?? '').trim();
    const snap = c.chequeDepositedBankAccount;
    const bankLabel =
      snap && typeof snap === 'object'
        ? String(snap.nickName ?? '').trim() || String(snap.bank ?? '').trim() || bankAccountId
        : bankAccountLabel(bankAccountId, bankAccounts);
    return {
      rowKey: `${p.id}::${c.id}`,
      paymentId: p.id,
      chequeId: c.id,
      customerName: String(p.customerName ?? '').trim() || '—',
      billNumber: p.billNumber != null ? String(p.billNumber) : '—',
      chequeNumber: flat.chequeNumber,
      chequeDate: flat.chequeDate,
      amount: flat.amount,
      bankLabel: bankLabel || '—',
      depositedAt: String(c.chequeDepositedAt ?? '').trim(),
      depositedBy: String(c.chequeDepositedBy ?? '').trim(),
      detailPayload: {
        id: p.id,
        chequeId: c.id,
        chequeDate: flat.chequeDate,
        amount: flat.amount,
        chequeNumber: flat.chequeNumber,
        chequeDeposited: true,
        chequeDepositedAt: c.chequeDepositedAt,
        chequeDepositedBy: c.chequeDepositedBy,
        chequeReturned: false,
        customerName: String(p.customerName ?? '').trim() || '—',
        billNumber: p.billNumber != null ? String(p.billNumber) : '—',
        paymentDate: String(p.date ?? '').slice(0, 10) || '—',
      },
    };
  }).sort((a, b) => {
    const d = String(b.depositedAt || b.chequeDate || '').localeCompare(String(a.depositedAt || a.chequeDate || ''));
    if (d !== 0) return d;
    return a.rowKey.localeCompare(b.rowKey);
  });
}

function KindBadge({ kind }) {
  const label = TX_KIND_LABEL[kind] || kind;
  const cls = TX_KIND_BADGE[kind] || 'bg-slate-50 text-slate-700 ring-slate-100';
  return (
    <span className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ${cls}`}>{label}</span>
  );
}

function GuaranteeTypeBadge({ guaranteeType }) {
  const found = BANK_GUARANTEE_TYPE_OPTIONS.find((o) => o.value === guaranteeType);
  const label = found?.label || guaranteeType || '—';
  const cls = GUARANTEE_TYPE_BADGE[guaranteeType] || GUARANTEE_TYPE_BADGE.other;
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
  const [companyChequeOpen, setCompanyChequeOpen] = useState(false);
  const [ownerShareOpen, setOwnerShareOpen] = useState(false);
  const [ownerName, setOwnerName] = useState('');

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
        setOwnerName(String(shopData.ownerName ?? '').trim());
      } else {
        setBankAccounts([]);
        setOwnerName('');
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
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-wrap gap-2">
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
            <button
              type="button"
              onClick={() => setCompanyChequeOpen(true)}
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition hover:brightness-[1.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
            >
              Company cheques
            </button>
          </div>
          <button
            type="button"
            onClick={() => setOwnerShareOpen(true)}
            className="inline-flex shrink-0 items-center justify-center self-end rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-500/20 transition hover:brightness-[1.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 sm:self-auto"
          >
            Owner share
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
            Oldest first. Debits are customer cash; pending cheques (any converting date, not yet deposited) are listed
            separately and do not change the cash balance; credits are expenses and cash sent to the bank.
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
                  ) : r.kind === 'cheque_in' ? (
                    <span className="rounded-md bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-900">
                      Cheque
                    </span>
                  ) : r.kind === 'owner_in' ? (
                    <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                      Owner in
                    </span>
                  ) : r.kind === 'owner_out' ? (
                    <span className="rounded-md bg-orange-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-900">
                      Owner out
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
                      {r.debit != null && r.debit > 0 ? (
                        r.kind === 'cheque_in' ? (
                          <span className="text-violet-800">{money(r.debit)}</span>
                        ) : (
                          money(r.debit)
                        )
                      ) : (
                        '—'
                      )}
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
        open={ledgerDetail != null}
        variant={
          ledgerDetail?.kind === 'bankCheque'
            ? 'bankCheque'
            : ledgerDetail?.kind === 'companyCheque'
              ? 'companyCheque'
              : ledgerDetail?.kind === 'ownerCheque'
                ? 'ownerCheque'
                : null
        }
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
      <CashBookCompanyChequeModal
        open={companyChequeOpen}
        onClose={() => setCompanyChequeOpen(false)}
        onSaved={handleExpenseSaved}
      />
      <CashBookOwnerShareModal
        open={ownerShareOpen}
        onClose={() => setOwnerShareOpen(false)}
        onSaved={handleExpenseSaved}
        ownerName={ownerName}
      />
    </>
  );
}

function BankPanel({ refreshToken, onBooksChanged }) {
  const [deposits, setDeposits] = useState([]);
  const [payments, setPayments] = useState([]);
  const [companyCheques, setCompanyCheques] = useState([]);
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
  const [returnBusyKey, setReturnBusyKey] = useState(null);
  const [returnErr, setReturnErr] = useState(null);
  const [balanceByAccountId, setBalanceByAccountId] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setAccountsLoading(true);
    setError(null);
    try {
      const [depRes, payRes, ccRes, poRes, shopRes, balRes] = await Promise.all([
        fetch(`${apiBase}/api/cash-book-entries?category=bank_deposit`),
        fetch(`${apiBase}/api/payments`),
        fetch(`${apiBase}/api/cash-book-entries?category=company_cheque`),
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

      if (ccRes.ok) {
        const ccData = await ccRes.json();
        setCompanyCheques(Array.isArray(ccData) ? ccData : []);
      } else {
        setCompanyCheques([]);
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
      setCompanyCheques([]);
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
    setReturnErr(null);
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

  const handleMarkChequeReturned = useCallback(
    async (payload, busyKey = 'modal') => {
      if (!payload?.id) return;
      const username = getUsername();
      if (!username) {
        setReturnErr('Sign in with your username to mark cheques as returned.');
        return;
      }
      const label =
        payload.chequeNumber && payload.chequeNumber !== '—' ? `#${payload.chequeNumber}` : 'this cheque';
      if (
        !window.confirm(
          `Mark cheque ${label} (${money(payload.amount)}) as returned? It will be removed from bank balances and a returned-cheque entry will be added to the customer ledger.`,
        )
      ) {
        return;
      }
      setReturnBusyKey(busyKey);
      setReturnErr(null);
      try {
        const res = await authFetch(
          `${apiBase}/api/payments/${encodeURIComponent(payload.id)}/cheque-returned`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recordedBy: username,
              chequeId: payload.chequeId && payload.chequeId !== '_legacy' ? payload.chequeId : undefined,
            }),
          },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setReturnErr(data.error || 'Could not mark cheque as returned');
          return;
        }
        setDetailRow(null);
        onBooksChanged?.();
        await load();
      } catch {
        setReturnErr('Could not reach server');
      } finally {
        setReturnBusyKey(null);
      }
    },
    [load, onBooksChanged],
  );

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
    () => buildBankTransactionRows(deposits, payments, purchaseOrders, companyCheques, bankAccounts),
    [deposits, payments, purchaseOrders, companyCheques, bankAccounts],
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
    const counts = { paid_cheque: 0, deposit: 0, withdrawal: 0 };
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

  const depositedCustomerCheques = useMemo(
    () => (SHOW_DEPOSITED_CUSTOMER_CHEQUES_SECTION ? buildDepositedCustomerChequeRows(payments, bankAccounts) : []),
    [payments, bankAccounts],
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

      {SHOW_DEPOSITED_CUSTOMER_CHEQUES_SECTION ? (
        <section className="rounded-[20px] bg-white p-4 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-5">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Deposited customer cheques</h2>
            <p className="mt-1 text-sm text-slate-500">
              When the bank dishonours a deposited customer cheque, mark it returned here. The amount is reversed on the
              customer ledger.
            </p>
          </div>
          {loading ? (
            <div className="mt-4 flex justify-center py-6">
              <LoadingSpinner />
            </div>
          ) : depositedCustomerCheques.length === 0 ? (
            <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-100">
              No customer cheques deposited yet. Open the <span className="font-semibold">Cashier</span> tab and use{' '}
              <span className="font-semibold">Cheque deposits</span> to record cheques at the bank first.
            </p>
          ) : (
            <div className={`mt-4 ${scrollTableWrap}`}>
              <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
                <thead className={stickyThead}>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className={`px-4 py-3 ${stickyFirstTh}`}>Customer</th>
                    <th className="px-3 py-3 font-mono">Cheque #</th>
                    <th className="px-3 py-3">Converting</th>
                    <th className="px-3 py-3">Bank account</th>
                    <th className="px-3 py-3 text-right">Amount</th>
                    <th className="px-3 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {depositedCustomerCheques.map((r) => (
                    <tr key={r.rowKey} className="hover:bg-slate-50/60">
                      <td className={`px-4 py-3 ${stickyFirstTd}`}>
                        <span className="block font-medium text-slate-900">{r.customerName}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          Bill #{r.billNumber}
                          {r.depositedBy ? ` · deposited by ${r.depositedBy}` : ''}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs">{r.chequeNumber}</td>
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatDisplayDate(r.chequeDate)}</td>
                      <td className="px-3 py-3 text-sm text-slate-700">{r.bankLabel}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-violet-800">
                        {money(r.amount)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right">
                        <button
                          type="button"
                          disabled={returnBusyKey != null}
                          onClick={() => handleMarkChequeReturned(r.detailPayload, r.rowKey)}
                          className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {returnBusyKey === r.rowKey ? 'Saving…' : 'Mark returned'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Transaction history</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Deposits, deposited customer cheques, and PO cheque withdrawals (after converting date). Use{' '}
            <span className="font-medium text-slate-700">Mark returned</span> on a deposited customer cheque when the
            bank dishonours it.
          </p>
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
      {returnErr ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {returnErr}
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
                    value: r.kind === 'withdrawal' ? `−${money(r.amount)}` : money(r.amount),
                  },
                  { label: 'Recorded by', value: r.recordedBy },
                ]}
                actions={
                  isReturnableCustomerChequeRow(r) ? (
                    <button
                      type="button"
                      disabled={returnBusyKey != null}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMarkChequeReturned(r.detailPayload, r.id);
                      }}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {returnBusyKey === r.id ? 'Saving…' : 'Mark returned'}
                    </button>
                  ) : null
                }
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
                <th className="whitespace-nowrap px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
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
                        r.kind === 'withdrawal' ? 'text-rose-800' : 'text-emerald-800'
                      }`}
                    >
                      {r.kind === 'withdrawal' ? '−' : '+'}
                      {money(r.amount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.recordedBy}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {isReturnableCustomerChequeRow(r) ? (
                        <button
                          type="button"
                          disabled={returnBusyKey != null}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMarkChequeReturned(r.detailPayload, r.id);
                          }}
                          className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {returnBusyKey === r.id ? 'Saving…' : 'Mark returned'}
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
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
                  <td className="px-4 py-3" colSpan={2} />
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
          setReturnErr(null);
        }}
        actions={
          isReturnableCustomerChequeRow({ detailVariant: detailRow?.variant, detailPayload: detailRow?.payload }) ? (
            <div className="flex w-full min-w-[12rem] flex-col gap-2">
              {returnErr ? (
                <p className="text-sm text-red-700" role="alert">
                  {returnErr}
                </p>
              ) : null}
              <button
                type="button"
                disabled={returnBusyKey != null}
                onClick={() => handleMarkChequeReturned(detailRow.payload, 'modal')}
                className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {returnBusyKey === 'modal' ? 'Saving…' : 'Mark cheque returned'}
              </button>
            </div>
          ) : isManagerOrAdmin() && detailRow?.txRow?.source === 'po' ? (
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

function BankGuaranteePanel({ refreshToken, onBooksChanged }) {
  const [guarantees, setGuarantees] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [distributors, setDistributors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [distributorFilter, setDistributorFilter] = useState('all');
  const [addOpen, setAddOpen] = useState(false);
  const [removeBusyId, setRemoveBusyId] = useState(null);
  const [removeErr, setRemoveErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [bgRes, shopRes, distRes] = await Promise.all([
        fetch(`${apiBase}/api/bank-guarantees`),
        fetch(`${apiBase}/api/shop`),
        fetch(`${apiBase}/api/distributors`),
      ]);
      if (!bgRes.ok) throw new Error('Failed to load bank guarantees');
      const bgData = await bgRes.json();
      setGuarantees(Array.isArray(bgData) ? bgData : []);

      if (shopRes.ok) {
        const shopData = await shopRes.json();
        setBankAccounts(Array.isArray(shopData.bankAccounts) ? shopData.bankAccounts : []);
      } else {
        setBankAccounts([]);
      }

      if (distRes.ok) {
        const distData = await distRes.json();
        setDistributors(Array.isArray(distData) ? distData : []);
      } else {
        setDistributors([]);
      }
    } catch (e) {
      setError(e.message || 'Could not load bank guarantees');
      setGuarantees([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  const filteredRows = useMemo(() => {
    let list = guarantees.filter((g) => inDateRange(g.date, dateFrom, dateTo));
    if (typeFilter !== 'all') {
      list = list.filter((g) => g.guaranteeType === typeFilter);
    }
    if (distributorFilter !== 'all') {
      if (distributorFilter === '__unassigned__') {
        list = list.filter((g) => !String(g.distributorId ?? '').trim());
      } else {
        list = list.filter((g) => g.distributorId === distributorFilter);
      }
    }
    if (!search.trim()) return list;
    return list.filter((g) =>
      rowMatchesQuery(search, [
        g.date,
        bankGuaranteeTypeLabel(g),
        g.description,
        g.recordedBy,
        g.distributorName,
        g.bankAccount?.nickName,
        g.bankAccount?.bank,
        String(g.amount),
      ]),
    );
  }, [guarantees, dateFrom, dateTo, typeFilter, distributorFilter, search]);

  const distributorSummaries = useMemo(
    () => summarizeGuaranteesByDistributor(guarantees.filter((row) => inDateRange(row.date, dateFrom, dateTo))),
    [guarantees, dateFrom, dateTo],
  );

  const totalAmount = useMemo(
    () => filteredRows.reduce((s, g) => s + Math.max(0, Number(g.amount) || 0), 0),
    [filteredRows],
  );

  const typeCounts = useMemo(() => {
    const counts = { fixed_deposit: 0, property: 0, other: 0 };
    for (const g of guarantees.filter((row) => inDateRange(row.date, dateFrom, dateTo))) {
      if (counts[g.guaranteeType] != null) counts[g.guaranteeType] += 1;
    }
    return counts;
  }, [guarantees, dateFrom, dateTo]);

  const pagination = useTablePagination(filteredRows.length, [dateFrom, dateTo, search, typeFilter, distributorFilter]);
  const pagedRows = useMemo(
    () => filteredRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filteredRows, pagination.offset, pagination.pageSize],
  );

  const handleRemove = useCallback(
    async (row) => {
      const typeLabel = bankGuaranteeTypeLabel(row);
      if (
        !window.confirm(
          `Remove bank guarantee (${typeLabel}, ${money(row.amount)})? This cannot be undone.`,
        )
      ) {
        return;
      }
      setRemoveBusyId(row.id);
      setRemoveErr(null);
      try {
        const res = await fetch(`${apiBase}/api/bank-guarantees/${encodeURIComponent(row.id)}`, {
          method: 'DELETE',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setRemoveErr(data.error || 'Could not remove bank guarantee');
          return;
        }
        onBooksChanged?.();
        await load();
      } catch {
        setRemoveErr('Could not reach server');
      } finally {
        setRemoveBusyId(null);
      }
    },
    [load, onBooksChanged],
  );

  const bankAccountLabelForRow = (g) => {
    const snap = g.bankAccount;
    if (snap && typeof snap === 'object') {
      return String(snap.nickName ?? '').trim() || String(snap.bank ?? '').trim() || '—';
    }
    const id = String(g.bankAccountId ?? '').trim();
    if (!id) return '—';
    const a = bankAccounts.find((x) => x.id === id);
    if (!a) return id;
    return String(a.nickName ?? '').trim() || String(a.bank ?? '').trim() || id;
  };

  const distributorLabelForRow = (g) => {
    const name = String(g.distributorName ?? '').trim();
    if (name) return name;
    const id = String(g.distributorId ?? '').trim();
    if (!id) return 'Unassigned';
    const d = distributors.find((x) => x.id === id);
    return d ? String(d.name ?? '').trim() || id : id;
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-[20px] bg-white p-4 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total guarantees</p>
          <CashierStatAmount loading={loading} value={totalAmount} valueClassName="text-teal-900" />
          <p className="mt-1 text-sm text-slate-500">
            {filteredRows.length} active guarantee{filteredRows.length === 1 ? '' : 's'} in view
          </p>
        </div>
        <div className="flex min-w-0 flex-col justify-center rounded-[20px] bg-white p-4 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Record</p>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="mt-3 inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-teal-500/20 transition hover:brightness-[1.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 sm:w-auto"
          >
            Add bank guarantee
          </button>
        </div>
      </div>

      {!loading && distributorSummaries.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">By distributor</h2>
            <p className="mt-0.5 text-sm text-slate-500">Total collateral recorded per distributor in the current date range.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {distributorSummaries.map((row) => (
              <button
                key={row.distributorId ?? '__unassigned__'}
                type="button"
                onClick={() =>
                  setDistributorFilter((prev) => {
                    const key = row.distributorId ?? '__unassigned__';
                    return prev === key ? 'all' : key;
                  })
                }
                className={`rounded-[20px] p-4 text-left shadow-lg shadow-slate-200/40 ring-1 transition hover:brightness-[1.01] sm:p-5 ${
                  distributorFilter === (row.distributorId ?? '__unassigned__')
                    ? 'bg-teal-50 ring-teal-200'
                    : 'bg-white ring-slate-100'
                }`}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{row.distributorName}</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-teal-900">{money(row.total)}</p>
                <p className="mt-1 text-sm text-slate-500">
                  {row.count} guarantee{row.count === 1 ? '' : 's'}
                </p>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Bank guarantees</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Collateral held at the bank — grouped by distributor, type, and date.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm font-medium text-slate-700">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Distributor</span>
            <select
              value={distributorFilter}
              onChange={(e) => setDistributorFilter(e.target.value)}
              className="rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/35"
            >
              <option value="all">All distributors</option>
              {distributorSummaries.map((row) => (
                <option key={row.distributorId ?? '__unassigned__'} value={row.distributorId ?? '__unassigned__'}>
                  {row.distributorName}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {BANK_GUARANTEE_TYPE_OPTIONS.map(({ value, label }) => {
            const count = typeCounts[value] ?? 0;
            const active = typeFilter === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setTypeFilter((prev) => (prev === value ? 'all' : value))}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                  active
                    ? 'bg-teal-600 text-white shadow-md shadow-teal-500/20'
                    : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                {label}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
                    active ? 'bg-teal-500/40 text-white' : 'bg-slate-100 text-slate-600'
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
            ? `${filteredRows.length} guarantee${filteredRows.length === 1 ? '' : 's'} · total ${money(totalAmount)}`
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
            placeholder="Distributor, type, notes, account, amount…"
            className={filterControl}
          />
        </label>
      </TableFiltersBar>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}
      {removeErr ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {removeErr}
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
              {guarantees.length === 0
                ? 'No bank guarantees yet. Use "Add bank guarantee" to record one.'
                : 'No guarantees match your filters.'}
            </p>
          ) : (
            pagedRows.map((g) => (
              <MobileRowCard
                key={g.id}
                title={formatDisplayDate(g.date)}
                subtitle={bankGuaranteeTypeLabel(g)}
                badge={<GuaranteeTypeBadge guaranteeType={g.guaranteeType} />}
                fields={[
                  { label: 'Distributor', value: distributorLabelForRow(g) },
                  { label: 'Amount', value: money(g.amount) },
                  { label: 'Bank account', value: bankAccountLabelForRow(g) },
                  { label: 'Notes', value: g.description || '—' },
                  { label: 'Recorded by', value: g.recordedBy || '—' },
                ]}
                actions={
                  <button
                    type="button"
                    disabled={removeBusyId === g.id}
                    onClick={() => handleRemove(g)}
                    className="rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-800 ring-1 ring-rose-100 transition hover:bg-rose-100 disabled:opacity-50"
                  >
                    {removeBusyId === g.id ? 'Removing…' : 'Remove'}
                  </button>
                }
              />
            ))
          )}
        </div>
        <div className={`hidden sm:block ${scrollTableWrap}`}>
          <table className="w-full min-w-[820px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
                <th className="whitespace-nowrap px-4 py-3">Distributor</th>
                <th className="whitespace-nowrap px-4 py-3">Type</th>
                <th className="px-4 py-3">Bank account</th>
                <th className="px-4 py-3">Notes</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
                <th className="whitespace-nowrap px-4 py-3">Recorded by</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    {guarantees.length === 0
                      ? 'No bank guarantees yet.'
                      : 'No guarantees match your filters.'}
                  </td>
                </tr>
              ) : (
                pagedRows.map((g) => (
                  <tr key={g.id} className="hover:bg-slate-50/80">
                    <td className={`whitespace-nowrap px-4 py-3 tabular-nums ${stickyFirstTd}`}>
                      {formatDisplayDate(g.date)}
                    </td>
                    <td className="max-w-[10rem] px-4 py-3 text-sm font-medium text-slate-800">
                      {distributorLabelForRow(g)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <GuaranteeTypeBadge guaranteeType={g.guaranteeType} />
                      {g.guaranteeType === 'other' && g.guaranteeTypeOther ? (
                        <span className="mt-1 block text-xs text-slate-500">{g.guaranteeTypeOther}</span>
                      ) : null}
                    </td>
                    <td className="max-w-[10rem] px-4 py-3 text-sm font-medium text-slate-800">
                      {bankAccountLabelForRow(g)}
                    </td>
                    <td className="max-w-xs px-4 py-3 text-slate-700">{g.description || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-teal-900">
                      {money(g.amount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{g.recordedBy || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        type="button"
                        disabled={removeBusyId === g.id}
                        onClick={() => handleRemove(g)}
                        className="rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-800 ring-1 ring-rose-100 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {removeBusyId === g.id ? 'Removing…' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {!loading && filteredRows.length > 0 ? (
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50/90 text-sm font-semibold text-slate-900">
                  <td className="px-4 py-3" colSpan={5}>
                    Total ({filteredRows.length})
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-teal-900">
                    {money(totalAmount)}
                  </td>
                  <td className="px-4 py-3" colSpan={2} />
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

      <CashBookBankGuaranteeModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={() => {
          onBooksChanged?.();
          load();
        }}
        bankAccounts={bankAccounts}
        distributors={distributors}
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
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
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
      {tab === 'bank' ? <BankPanel refreshToken={refreshToken} onBooksChanged={bumpRefresh} /> : null}
      {tab === 'bank_guarantee' ? (
        <BankGuaranteePanel refreshToken={refreshToken} onBooksChanged={bumpRefresh} />
      ) : null}
    </div>
  );
}
