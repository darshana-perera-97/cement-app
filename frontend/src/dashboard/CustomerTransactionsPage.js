import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { getApiBase } from '../apiBase';
import { authFetch, canEditDetails, getUsername, isAdmin, isCollector, isManagerOrAdmin } from '../auth';
import PaymentReceiptPdfButton from './PaymentReceiptPdfButton';
import {
  LoadingSpinner,
  TableFiltersBar,
  TablePaginationBar,
  filterControl,
  filterLabel,
  modalPanelClass,
  rowMatchesQuery,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
  useTablePagination,
} from './tableToolbar';
import RowDetailModal, { detailRowAttrs } from './RowDetailModal';
import CustomerProfilePanel from './CustomerProfilePanel';
import CustomerChequesPanel from './CustomerChequesPanel';
import CustomerPendingBillsPanel from './CustomerPendingBillsPanel';
import CustomerInvoicesModal from './CustomerInvoicesModal';
import CustomerLedgerModal from './CustomerLedgerModal';
import CustomerTaxModal from './CustomerTaxModal';
import RecordPaymentModal from './RecordPaymentModal';
import CollectorSeparateBillSettlementModal from './CollectorSeparateBillSettlementModal';
import { useSeparateBillSettlementFlow } from './useShopCollectorSettings';
import { CollectorSelectField, useCollectors } from './useCollectors';
import { usePrinter } from '../printer/PrinterProvider';
import { useCollectorCollectionClosed } from './collectionDayClose';

const apiBase = getApiBase();

const KIND_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'opening', label: 'Opening' },
  { value: 'bill', label: 'Sales' },
  { value: 'payment', label: 'Payments' },
  { value: 'cheque_return', label: 'Returned cheques' },
];

const PROFILE_SECTIONS = [
  { id: 'activity', label: 'Activity' },
  { id: 'cheques', label: 'Cheques' },
  { id: 'pending-bills', label: 'Pending Bills' },
];

const DEFAULT_OVERDUE_DAYS = 14;

const WEEKDAY_OPTIONS = [
  { value: '', label: 'Use default (Messages settings)' },
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
];

const emptyCustomerForm = () => ({
  name: '',
  location: '',
  contactNumber: '',
  email: '',
  ownerName: '',
  ownerBirthday: '',
  dueDate: '',
  pastBill: '',
  overdueDays: String(DEFAULT_OVERDUE_DAYS),
  monthlyTargetBags: '',
  collectorUserId: '',
  overdueNotifyEnabled: true,
  overdueNotifyWeekday: '',
  overdueNotifyTime: '',
});

function customerToForm(c) {
  if (!c) return emptyCustomerForm();
  const overdueDays =
    c.overdueDays === 0 || c.overdueDays ? String(c.overdueDays) : String(DEFAULT_OVERDUE_DAYS);
  return {
    name: c.name ?? '',
    location: c.location ?? '',
    contactNumber: c.contactNumber ?? '',
    email: c.email ?? '',
    ownerName: c.ownerName ?? '',
    ownerBirthday: c.ownerBirthday ?? '',
    dueDate: c.dueDate ?? '',
    pastBill: c.pastBill === 0 || c.pastBill ? String(c.pastBill) : '',
    overdueDays,
    monthlyTargetBags:
      c.monthlyTargetBags === 0 || c.monthlyTargetBags ? String(c.monthlyTargetBags) : '',
    collectorUserId: c.collectorUserId ?? '',
    overdueNotifyEnabled: c.overdueNotifyEnabled !== false,
    overdueNotifyWeekday:
      c.overdueNotifyWeekday === 0 || c.overdueNotifyWeekday ? String(c.overdueNotifyWeekday) : '',
    overdueNotifyTime: c.overdueNotifyTime ?? '',
  };
}

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function formatAmount(n) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function todayYmdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDisplayDate(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '—';
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function dueDateHint(dueDate, today) {
  if (!dueDate) return null;
  if (dueDate < today) return { tone: 'overdue', text: `Was due ${formatDisplayDate(dueDate)}` };
  if (dueDate === today) return { tone: 'today', text: 'Due today' };
  const due = new Date(`${dueDate}T12:00:00`);
  const now = new Date(`${today}T12:00:00`);
  const days = Math.round((due - now) / (24 * 60 * 60 * 1000));
  return { tone: 'ok', text: `Due ${formatDisplayDate(dueDate)} · ${days} day${days === 1 ? '' : 's'} left` };
}

function txKindMeta(kind) {
  switch (kind) {
    case 'opening':
      return { short: 'Opening', badge: 'bg-slate-100 text-slate-700 ring-slate-200/80' };
    case 'bill':
      return { short: 'Sale', badge: 'bg-amber-50 text-amber-900 ring-amber-100' };
    case 'payment':
      return { short: 'Payment', badge: 'bg-emerald-50 text-emerald-800 ring-emerald-100' };
    case 'cheque_return':
      return { short: 'Returned', badge: 'bg-rose-50 text-rose-800 ring-rose-100' };
    default:
      return { short: 'Other', badge: 'bg-slate-100 text-slate-600 ring-slate-200/80' };
  }
}

function compareTransactionsByDateDesc(a, b) {
  const dateCmp = String(b.date || '').localeCompare(String(a.date || ''));
  if (dateCmp !== 0) return dateCmp;
  const aSort = a.sortAt || `${a.date || ''}T12:00:00`;
  const bSort = b.sortAt || `${b.date || ''}T12:00:00`;
  return new Date(bSort).getTime() - new Date(aSort).getTime();
}

function summarizeTransactions(transactions) {
  let totalCharged = 0;
  let totalPaid = 0;
  const counts = { all: transactions.length, opening: 0, bill: 0, payment: 0, cheque_return: 0 };
  for (const tx of transactions) {
    const amt = Number(tx.amount) || 0;
    if (tx.kind && counts[tx.kind] != null) counts[tx.kind] += 1;
    if (tx.direction === 'credit') totalPaid += amt;
    else totalCharged += amt;
  }
  return { totalCharged, totalPaid, counts };
}

function CustomerHeaderSkeleton() {
  return (
    <div className="animate-pulse overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
      <div className="h-12 bg-slate-100" />
      <div className="h-24 bg-white px-4 py-3" />
      <div className="grid grid-cols-2 gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2.5 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded-lg bg-white ring-1 ring-slate-100" />
        ))}
      </div>
    </div>
  );
}

export default function CustomerTransactionsPage() {
  const { customerId } = useParams();
  const { requestAutoPrint, requestPrint } = usePrinter();
  const [searchParams, setSearchParams] = useSearchParams();
  const [customer, setCustomer] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [profileSection, setProfileSection] = useState('activity');
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [detailTx, setDetailTx] = useState(null);
  const [customerEditOpen, setCustomerEditOpen] = useState(false);
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);
  const [customerSaveError, setCustomerSaveError] = useState(null);
  const [customerSaving, setCustomerSaving] = useState(false);
  const [invoicesOpen, setInvoicesOpen] = useState(false);
  const [taxOpen, setTaxOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const [separateBillModalOpen, setSeparateBillModalOpen] = useState(false);
  const { useSeparateBillSettlement, loading: collectorSettingsLoading } = useSeparateBillSettlementFlow();
  const { collectors, loading: collectorsLoading } = useCollectors();
  const today = useMemo(() => todayYmdLocal(), []);
  const { closed: collectionClosed } = useCollectorCollectionClosed(today);
  const paymentsLocked = isCollector() && collectionClosed;

  const openCustomerEdit = () => {
    setCustomerForm(customerToForm(customer));
    setCustomerSaveError(null);
    setCustomerEditOpen(true);
  };

  const closeCustomerEdit = () => {
    setCustomerEditOpen(false);
    setCustomerSaveError(null);
  };

  const handleCustomerFormChange = (field, value) => {
    setCustomerForm((f) => ({ ...f, [field]: value }));
  };

  const saveCustomerDetails = async (e) => {
    e.preventDefault();
    const username = getUsername();
    if (!username) {
      setCustomerSaveError('You need to be signed in with a username.');
      return;
    }
    if (!customerId) return;
    setCustomerSaving(true);
    setCustomerSaveError(null);
    try {
      const payload = {
        name: customerForm.name.trim(),
        location: customerForm.location.trim(),
        contactNumber: customerForm.contactNumber.trim(),
        email: customerForm.email.trim(),
        ownerName: customerForm.ownerName.trim(),
        ownerBirthday: customerForm.ownerBirthday.trim(),
        dueDate: customerForm.dueDate.trim(),
        pastBill: customerForm.pastBill,
        overdueDays: customerForm.overdueDays,
        updatedBy: username,
      };
      if (canEditDetails()) {
        payload.monthlyTargetBags = customerForm.monthlyTargetBags;
        payload.collectorUserId = customerForm.collectorUserId.trim();
        payload.overdueNotifyEnabled = Boolean(customerForm.overdueNotifyEnabled);
        payload.overdueNotifyWeekday = customerForm.overdueNotifyWeekday;
        payload.overdueNotifyTime = customerForm.overdueNotifyTime.trim();
      }
      const res = await authFetch(`${apiBase}/api/customers/${encodeURIComponent(customerId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCustomerSaveError(data.error || 'Update failed');
        return;
      }
      closeCustomerEdit();
      await load();
    } catch {
      setCustomerSaveError('Could not reach the server.');
    } finally {
      setCustomerSaving(false);
    }
  };

  const customerNameChanged =
    customerEditOpen &&
    customer &&
    customerForm.name.trim().toLowerCase() !== String(customer.name ?? '').trim().toLowerCase();

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setPaymentsLoading(true);
    setError(null);
    try {
      const [txRes, payRes] = await Promise.all([
        authFetch(`${apiBase}/api/customers/${encodeURIComponent(customerId)}/transactions`),
        authFetch(`${apiBase}/api/payments`),
      ]);
      const data = await txRes.json().catch(() => ({}));
      if (!txRes.ok) {
        throw new Error(data.error || 'Failed to load transactions');
      }
      setCustomer(data.customer || null);
      setTransactions(Array.isArray(data.transactions) ? data.transactions : []);

      if (payRes.ok) {
        const payData = await payRes.json().catch(() => []);
        setPayments(Array.isArray(payData) ? payData : []);
      } else {
        setPayments([]);
      }
    } catch (e) {
      setError(e.message || 'Could not load data');
      setCustomer(null);
      setTransactions([]);
      setPayments([]);
    } finally {
      setLoading(false);
      setPaymentsLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (searchParams.get('edit') !== '1' || !customer || customerEditOpen || !canEditDetails()) return;
    setCustomerForm(customerToForm(customer));
    setCustomerSaveError(null);
    setCustomerEditOpen(true);
    setSearchParams({}, { replace: true });
  }, [customer, searchParams, setSearchParams, customerEditOpen]);

  const summary = useMemo(() => summarizeTransactions(transactions), [transactions]);

  const overdue = Boolean(customer?.dueDate && customer.dueDate < today);
  const overpayment = Math.max(0, Number(customer?.overpaymentAmount) || 0);
  const amountToPay = Math.max(0, Number(customer?.remainingAmount) || 0);
  const dueHint = customer?.dueDate ? dueDateHint(customer.dueDate, today) : null;
  const allPaid = amountToPay === 0 && overpayment === 0;

  const filteredTransactions = useMemo(() => {
    return transactions
      .filter((tx) => {
        if (kindFilter !== 'all' && tx.kind !== kindFilter) return false;
        return rowMatchesQuery(search, [tx.date, tx.type, tx.details, String(tx.amount)]);
      })
      .sort(compareTransactionsByDateDesc);
  }, [transactions, search, kindFilter]);

  const pagination = useTablePagination(filteredTransactions.length, [customerId, search, kindFilter]);
  const pagedTransactions = useMemo(
    () => filteredTransactions.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filteredTransactions, pagination.offset, pagination.pageSize]
  );

  const detailPaymentForPrint =
    (isCollector() || isManagerOrAdmin()) && detailTx?.kind === 'payment'
      ? payments.find((p) => p.id === detailTx.id) || null
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link
            to="/dashboard/customers"
            className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-600 hover:text-indigo-800"
          >
            <span aria-hidden>←</span> Customers
          </Link>
          {customer ? (
            <>
              <h1 className="mt-2 truncate text-2xl font-bold tracking-tight text-slate-900">{customer.name}</h1>
            </>
          ) : (
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Customer account</h1>
          )}
          <p className="mt-1 text-sm text-slate-500">Credit sales, payments, and account summary.</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {customer ? (
            <>
              {canEditDetails() ? (
                <button
                  type="button"
                  onClick={openCustomerEdit}
                  className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800"
                >
                  Edit details
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setInvoicesOpen(true)}
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-800"
              >
                Invoices
              </button>
              <button
                type="button"
                onClick={() => setTaxOpen(true)}
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-teal-200 hover:bg-teal-50 hover:text-teal-800"
              >
                Tax
              </button>
              <button
                type="button"
                onClick={() => setLedgerOpen(true)}
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-900"
              >
                Ledger
              </button>
              <button
                type="button"
                onClick={() =>
                  useSeparateBillSettlement ? setSeparateBillModalOpen(true) : setRecordPaymentOpen(true)
                }
                disabled={collectorSettingsLoading || paymentsLocked}
                title={paymentsLocked ? 'Collection for today is over. You cannot add more payments.' : undefined}
                className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03] disabled:opacity-60"
              >
                Record payment
              </button>
            </>
          ) : null}
        </div>
      </div>

      {paymentsLocked ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-950 ring-1 ring-amber-100" role="status">
          Collection for today is over. You cannot add more payments.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      {loading && !customer ? <CustomerHeaderSkeleton /> : null}

      {customer ? (
        <CustomerProfilePanel
          customer={customer}
          amountToPay={amountToPay}
          overpayment={overpayment}
          overdue={overdue}
          allPaid={allPaid}
          dueHint={dueHint}
          summary={summary}
          formatMoney={money}
          formatDisplayDate={formatDisplayDate}
          defaultOverdueDays={DEFAULT_OVERDUE_DAYS}
          onEditTarget={canEditDetails() ? openCustomerEdit : null}
        />
      ) : null}

      {customer ? (
        <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-1">
          {PROFILE_SECTIONS.map((sec) => {
            const active = profileSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => setProfileSection(sec.id)}
                className={`rounded-t-lg px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? 'bg-white text-indigo-700 ring-1 ring-slate-200 ring-b-white'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                {sec.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {customer && profileSection === 'cheques' ? (
        <CustomerChequesPanel
          customerId={customerId}
          payments={payments}
          loading={paymentsLoading}
          canMarkReturn={canEditDetails()}
          onUpdated={load}
        />
      ) : null}

      {customer && profileSection === 'pending-bills' ? (
        <CustomerPendingBillsPanel
          customer={customer}
          payments={payments}
          loading={paymentsLoading}
        />
      ) : null}

      {profileSection === 'activity' ? (
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Activity</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Newest first. Tap a row for full details.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {KIND_FILTERS.map((opt) => {
            const count = summary.counts[opt.value] ?? 0;
            const active = kindFilter === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setKindFilter(opt.value)}
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
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <TableFiltersBar
          hint={
            !loading && transactions.length > 0
              ? `Showing ${filteredTransactions.length} of ${transactions.length} item${transactions.length === 1 ? '' : 's'}`
              : null
          }
        >
          <label className={filterLabel}>
            Search activity
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Date, type, details, amount…"
              className={filterControl}
            />
          </label>
        </TableFiltersBar>

        <div className="space-y-3">
          <div className={scrollTableWrap}>
            {loading ? (
              <p className="px-4 py-12 text-center text-sm text-slate-500"><LoadingSpinner label="Loading activity…" /></p>
            ) : (
              <table className="w-full min-w-[520px] data-table border-separate border-spacing-0 text-left text-sm">
                <thead className={stickyThead}>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Details</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-12 text-center">
                        <p className="font-medium text-slate-700">No activity yet</p>
                        <p className="mt-1 text-sm text-slate-500">
                          Credit sales and payments will show up here once recorded.
                        </p>
                        {customer && !paymentsLocked ? (
                          <button
                            type="button"
                            onClick={() =>
                              useSeparateBillSettlement
                                ? setSeparateBillModalOpen(true)
                                : setRecordPaymentOpen(true)
                            }
                            className="mt-4 inline-flex text-sm font-semibold text-indigo-600 hover:text-indigo-800"
                          >
                            Record a payment →
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ) : filteredTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                        Nothing matches your search or filter. Try clearing filters above.
                      </td>
                    </tr>
                  ) : (
                    pagedTransactions.map((tx) => {
                      const meta = txKindMeta(tx.kind);
                      const isCredit = tx.direction === 'credit';
                      return (
                        <tr
                          key={`${tx.kind}-${tx.id}`}
                          {...detailRowAttrs(() => setDetailTx(tx), 'hover:bg-slate-50/80')}
                          aria-label={`${tx.type || 'Transaction'} ${tx.date || ''}`}
                        >
                          <td className={`whitespace-nowrap px-4 py-3 tabular-nums text-slate-700 ${stickyFirstTd}`}>
                            {formatDisplayDate(tx.date)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${meta.badge}`}
                            >
                              {meta.short}
                            </span>
                          </td>
                          <td className="max-w-md px-4 py-3 text-slate-600">
                            <span className="line-clamp-2">{tx.details || '—'}</span>
                          </td>
                          <td
                            className={`whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums ${
                              isCredit ? 'text-emerald-700' : 'text-slate-900'
                            }`}
                          >
                            {isCredit ? `−${money(tx.amount)}` : `+${money(tx.amount)}`}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>
          {!loading && transactions.length > 0 ? (
            <TablePaginationBar
              page={pagination.page}
              totalPages={pagination.totalPages}
              pageSize={pagination.pageSize}
              totalCount={filteredTransactions.length}
              onPageChange={pagination.setPage}
              onPageSizeChange={pagination.setPageSize}
            />
          ) : null}
        </div>
      </section>
      ) : null}

      <RowDetailModal
        open={!!detailTx}
        row={detailTx}
        variant="transaction"
        onClose={() => setDetailTx(null)}
        actions={
          detailPaymentForPrint ? (
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => requestPrint('cashCollection', detailPaymentForPrint)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-semibold text-sky-800 ring-1 ring-sky-100 hover:bg-sky-100"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M7 3.75A.75.75 0 017.75 3h8.5a.75.75 0 01.75.75V7h.75A2.25 2.25 0 0120 9.25v6.5A2.25 2.25 0 0117.75 18H17v2.25a.75.75 0 01-.75.75h-8.5a.75.75 0 01-.75-.75V18H6.25A2.25 2.25 0 014 15.75v-6.5A2.25 2.25 0 016.25 7H7V3.75zM8.5 4.5v2.5h7V4.5h-7zM6.25 8.5a.75.75 0 00-.75.75v6.5c0 .414.336.75.75.75H7v-1.25a.75.75 0 01.75-.75h8.5a.75.75 0 01.75.75V16.5h.75a.75.75 0 00.75-.75v-6.5a.75.75 0 00-.75-.75H6.25zM9 16.5v3h6v-3H9zM8 11.25a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5a.75.75 0 01-.75-.75z" />
                </svg>
                Print bill
              </button>
              {isAdmin() ? <PaymentReceiptPdfButton payment={detailPaymentForPrint} /> : null}
            </div>
          ) : null
        }
      />

      {customerEditOpen && canEditDetails() ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="customer-edit-modal-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            aria-label="Close"
            onClick={closeCustomerEdit}
          />
          <div className={modalPanelClass}>
            <h2 id="customer-edit-modal-title" className="text-lg font-bold text-slate-900">
              Edit customer details
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Updates contact info, shop owner details, payment due date, bill overdue window, and opening
              balance. Logged in as {getUsername() || '—'}.
            </p>
            <form className="mt-5 space-y-4" onSubmit={saveCustomerDetails}>
              {customerSaveError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">
                  {customerSaveError}
                </p>
              ) : null}
              {customerNameChanged ? (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-100">
                  Renaming updates linked credit sales, payments, and promotions to the new name so
                  balances stay correct.
                </p>
              ) : null}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-600 sm:col-span-2">
                Customer name
                <input
                  type="text"
                  required
                  autoFocus
                  value={customerForm.name}
                  onChange={(e) => handleCustomerFormChange('name', e.target.value)}
                  className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                  placeholder="e.g. Perera Hardware"
                  autoComplete="organization"
                />
              </label>
              <label className="block text-sm font-medium text-slate-600">
                Location
                <input
                  type="text"
                  required
                  value={customerForm.location}
                  onChange={(e) => handleCustomerFormChange('location', e.target.value)}
                  className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                  placeholder="Town or address"
                  autoComplete="street-address"
                />
              </label>
              <label className="block text-sm font-medium text-slate-600">
                Contact number
                <input
                  type="tel"
                  required
                  value={customerForm.contactNumber}
                  onChange={(e) => handleCustomerFormChange('contactNumber', e.target.value)}
                  className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                  placeholder="e.g. 077 123 4567"
                  autoComplete="tel"
                />
              </label>
              <label className="block text-sm font-medium text-slate-600 sm:col-span-2">
                Email
                <input
                  type="email"
                  value={customerForm.email}
                  onChange={(e) => handleCustomerFormChange('email', e.target.value)}
                  className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                  placeholder="e.g. shop@example.com"
                  autoComplete="email"
                />
              </label>
              <label className="block text-sm font-medium text-slate-600">
                Shop owner name
                <input
                  type="text"
                  value={customerForm.ownerName}
                  onChange={(e) => handleCustomerFormChange('ownerName', e.target.value)}
                  className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                  placeholder="e.g. Sunil Perera"
                  autoComplete="name"
                />
              </label>
              <label className="block text-sm font-medium text-slate-600">
                Owner birthday
                <input
                  type="date"
                  value={customerForm.ownerBirthday}
                  onChange={(e) => handleCustomerFormChange('ownerBirthday', e.target.value)}
                  max={today}
                  className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Shown on Analytics when the birthday is today or in the next 3 days.
                </span>
              </label>
              <label className="block text-sm font-medium text-slate-600">
                Payment due date
                <input
                  type="date"
                  required
                  value={customerForm.dueDate}
                  onChange={(e) => handleCustomerFormChange('dueDate', e.target.value)}
                  className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                />
              </label>
              <label className="block text-sm font-medium text-slate-600">
                Bill overdue days
                <input
                  type="number"
                  min={1}
                  max={365}
                  step={1}
                  required
                  value={customerForm.overdueDays}
                  onChange={(e) => handleCustomerFormChange('overdueDays', e.target.value)}
                  className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm tabular-nums ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Days after each bill date before unpaid credit sales appear as overdue (default {DEFAULT_OVERDUE_DAYS}).
                </span>
              </label>
              <label className="block text-sm font-medium text-slate-600 sm:col-span-2">
                Opening balance (LKR)
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  required
                  value={customerForm.pastBill}
                  onChange={(e) => handleCustomerFormChange('pastBill', e.target.value)}
                  className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm tabular-nums ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                  placeholder="0.00"
                />
              </label>
              {canEditDetails() ? (
                <CollectorSelectField
                  id="edit-customer-collector"
                  value={customerForm.collectorUserId}
                  onChange={(v) => handleCustomerFormChange('collectorUserId', v)}
                  disabled={customerSaving}
                  collectors={collectors}
                  loading={collectorsLoading}
                />
              ) : null}
              {canEditDetails() ? (
                <label className="block text-sm font-medium text-slate-600 sm:col-span-2">
                  Monthly target bags
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={customerForm.monthlyTargetBags}
                    onChange={(e) => handleCustomerFormChange('monthlyTargetBags', e.target.value)}
                    className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm tabular-nums ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                    placeholder="e.g. 500 (leave empty or 0 for no target)"
                  />
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    Credit sales bags this calendar month vs this target (admin only).
                  </span>
                </label>
              ) : null}
              {canEditDetails() ? (
                <div className="sm:col-span-2 space-y-3 rounded-xl bg-orange-50/50 px-3 py-3 ring-1 ring-orange-100">
                  <p className="text-sm font-semibold text-slate-800">Balance reminder schedule</p>
                  <p className="text-xs text-slate-500">
                    Weekly WhatsApp/email balance reminder for this customer. Leave weekday/time empty to use the
                    default from Messages settings.
                  </p>
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={Boolean(customerForm.overdueNotifyEnabled)}
                      onChange={(e) => handleCustomerFormChange('overdueNotifyEnabled', e.target.checked)}
                      disabled={customerSaving}
                      className="h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500/35"
                    />
                    <span className="text-sm font-medium text-slate-700">Send balance reminders to this customer</span>
                  </label>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="block text-sm font-medium text-slate-600">
                      Reminder weekday
                      <select
                        value={customerForm.overdueNotifyWeekday}
                        onChange={(e) => handleCustomerFormChange('overdueNotifyWeekday', e.target.value)}
                        disabled={customerSaving}
                        className="mt-1 w-full rounded-xl border-0 bg-white px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                      >
                        {WEEKDAY_OPTIONS.map((opt) => (
                          <option key={opt.value || 'default'} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm font-medium text-slate-600">
                      Reminder time
                      <input
                        type="time"
                        value={customerForm.overdueNotifyTime}
                        onChange={(e) => handleCustomerFormChange('overdueNotifyTime', e.target.value)}
                        disabled={customerSaving}
                        className="mt-1 w-full rounded-xl border-0 bg-white px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                      />
                      <span className="mt-1 block text-xs font-normal text-slate-500">Leave blank for default time.</span>
                    </label>
                  </div>
                </div>
              ) : null}
              </div>
              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeCustomerEdit}
                  disabled={customerSaving}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={customerSaving}
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md disabled:opacity-60"
                >
                  {customerSaving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <CustomerInvoicesModal open={invoicesOpen} customer={customer} onClose={() => setInvoicesOpen(false)} />

      <CustomerTaxModal
        open={taxOpen}
        customer={customer}
        customerId={customerId}
        onClose={() => setTaxOpen(false)}
        onSaved={load}
      />

      <CustomerLedgerModal
        open={ledgerOpen}
        customer={customer}
        transactions={transactions}
        loading={loading}
        onClose={() => setLedgerOpen(false)}
      />

      <RecordPaymentModal
        open={recordPaymentOpen}
        onClose={() => setRecordPaymentOpen(false)}
        onSaved={async (row) => {
          await load();
          requestAutoPrint('cashCollection', row);
        }}
        prefillCustomerId={customerId || ''}
        lockCustomer
        customerName={customer?.name || ''}
      />

      <CollectorSeparateBillSettlementModal
        open={separateBillModalOpen}
        onClose={() => setSeparateBillModalOpen(false)}
        onSaved={async (row) => {
          await load();
          requestAutoPrint('cashCollection', row);
        }}
        prefillCustomerId={customerId || ''}
        lockCustomer
        customerName={customer?.name || ''}
      />
    </div>
  );
}
