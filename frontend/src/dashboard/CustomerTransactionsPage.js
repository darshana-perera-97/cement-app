import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { getApiBase } from '../apiBase';
import { getUsername } from '../auth';
import {
  LoadingSpinner,
  TableFiltersBar,
  TablePaginationBar,
  filterControl,
  filterLabel,
  mobileCardList,
  MobileRowCard,
  modalPanelClass,
  rowMatchesQuery,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
  useTablePagination,
} from './tableToolbar';
import RowDetailModal, { detailRowAttrs } from './RowDetailModal';

const apiBase = getApiBase();

const KIND_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'opening', label: 'Opening' },
  { value: 'bill', label: 'Sales' },
  { value: 'payment', label: 'Payments' },
];

const DEFAULT_OVERDUE_DAYS = 14;

const emptyCustomerForm = () => ({
  name: '',
  location: '',
  contactNumber: '',
  email: '',
  dueDate: '',
  pastBill: '',
  overdueDays: String(DEFAULT_OVERDUE_DAYS),
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
    dueDate: c.dueDate ?? '',
    pastBill: c.pastBill === 0 || c.pastBill ? String(c.pastBill) : '',
    overdueDays,
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
  const counts = { all: transactions.length, opening: 0, bill: 0, payment: 0 };
  for (const tx of transactions) {
    const amt = Number(tx.amount) || 0;
    if (tx.kind && counts[tx.kind] != null) counts[tx.kind] += 1;
    if (tx.direction === 'credit') totalPaid += amt;
    else totalCharged += amt;
  }
  return { totalCharged, totalPaid, counts };
}

function SummaryStat({ label, amount, hint, highlight = false, valueClassName = '', action = null }) {
  return (
    <div
      className={`px-4 py-3.5 sm:px-5 ${
        highlight ? 'bg-indigo-50/90 ring-1 ring-inset ring-indigo-100' : 'bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {label}
          <span className="ml-1.5 text-[10px] font-semibold normal-case text-slate-400">LKR</span>
        </p>
        {action}
      </div>
      <p className={`mt-1 text-lg font-bold tabular-nums text-slate-900 sm:text-xl ${valueClassName}`}>
        {formatAmount(amount)}
      </p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function CustomerHeaderSkeleton() {
  return (
    <div className="animate-pulse overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
      <div className="h-28 bg-slate-100" />
      <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 bg-white px-5 py-4">
            <div className="h-3 w-16 rounded bg-slate-100" />
            <div className="mt-3 h-6 w-24 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CustomerTransactionsPage() {
  const { customerId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [customer, setCustomer] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [detailTx, setDetailTx] = useState(null);
  const [customerEditOpen, setCustomerEditOpen] = useState(false);
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);
  const [customerSaveError, setCustomerSaveError] = useState(null);
  const [customerSaving, setCustomerSaving] = useState(false);

  const today = useMemo(() => todayYmdLocal(), []);

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
      const res = await fetch(`${apiBase}/api/customers/${encodeURIComponent(customerId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: customerForm.name.trim(),
          location: customerForm.location.trim(),
          contactNumber: customerForm.contactNumber.trim(),
          email: customerForm.email.trim(),
          dueDate: customerForm.dueDate.trim(),
          pastBill: customerForm.pastBill,
          overdueDays: customerForm.overdueDays,
          updatedBy: username,
        }),
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
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/api/customers/${encodeURIComponent(customerId)}/transactions`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load transactions');
      }
      setCustomer(data.customer || null);
      setTransactions(Array.isArray(data.transactions) ? data.transactions : []);
    } catch (e) {
      setError(e.message || 'Could not load data');
      setCustomer(null);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (searchParams.get('edit') !== '1' || !customer || customerEditOpen) return;
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

  const recordPaymentHref = customerId
    ? `/dashboard/payments?customerId=${encodeURIComponent(customerId)}&record=1`
    : '/dashboard/payments';

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
              {[customer.location, customer.contactNumber, customer.email].some(Boolean) ? (
                <p className="mt-1 truncate text-sm text-slate-600">
                  {[customer.location, customer.contactNumber, customer.email].filter(Boolean).join(' · ')}
                </p>
              ) : null}
            </>
          ) : (
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Customer account</h1>
          )}
          <p className="mt-1 text-sm text-slate-500">Opening credit, sales, and payments for this account.</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading || !customerId}
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
          >
            Refresh
          </button>
          {customer ? (
            <>
              <button
                type="button"
                onClick={openCustomerEdit}
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800"
              >
                Edit details
              </button>
              <Link
                to={recordPaymentHref}
                className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03]"
              >
                Record payment
              </Link>
            </>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      {loading && !customer ? <CustomerHeaderSkeleton /> : null}

      {customer ? (
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="border-b border-slate-100 bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 px-5 py-5 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={openCustomerEdit}
                  className="float-right ml-2 rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-indigo-600 shadow-sm hover:bg-indigo-50 sm:hidden"
                >
                  Edit
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  {overdue ? (
                    <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-rose-800">
                      Overdue
                    </span>
                  ) : allPaid ? (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-emerald-800">
                      Settled
                    </span>
                  ) : amountToPay > 0 ? (
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-amber-900">
                      Balance due
                    </span>
                  ) : null}
                  {overpayment > 0 ? (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-emerald-800 ring-1 ring-emerald-100">
                      Credit balance
                    </span>
                  ) : null}
                </div>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  {customer.location ? (
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Location</dt>
                      <dd className="mt-0.5 font-medium text-slate-800">{customer.location}</dd>
                    </div>
                  ) : null}
                  {customer.contactNumber ? (
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Contact</dt>
                      <dd className="mt-0.5 font-medium text-slate-800">
                        <a href={`tel:${customer.contactNumber}`} className="text-indigo-700 hover:text-indigo-900">
                          {customer.contactNumber}
                        </a>
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Email</dt>
                    <dd className="mt-0.5 font-medium text-slate-800">
                      {customer.email ? (
                        <a href={`mailto:${customer.email}`} className="text-indigo-700 hover:text-indigo-900">
                          {customer.email}
                        </a>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </dd>
                  </div>
                  {customer.dueDate ? (
                    <div className="sm:col-span-2">
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Payment due</dt>
                      <dd
                        className={`mt-0.5 font-medium ${
                          dueHint?.tone === 'overdue' ? 'text-rose-800' : 'text-slate-800'
                        }`}
                      >
                        {dueHint?.text || formatDisplayDate(customer.dueDate)}
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Bill overdue days</dt>
                    <dd className="mt-0.5 font-medium text-slate-800">
                      {customer.overdueDays ?? DEFAULT_OVERDUE_DAYS} day
                      {(customer.overdueDays ?? DEFAULT_OVERDUE_DAYS) === 1 ? '' : 's'} after bill date
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>

          <div
            className={`grid gap-px bg-slate-100 ${
              overpayment > 0 ? 'sm:grid-cols-2 lg:grid-cols-5' : 'sm:grid-cols-2 lg:grid-cols-4'
            }`}
          >
            <SummaryStat
              label="Amount to pay"
              amount={amountToPay}
              highlight
              valueClassName={overdue && amountToPay > 0 ? 'text-rose-800' : ''}
              hint={overdue && amountToPay > 0 ? 'Collect as soon as possible' : null}
            />
            {overpayment > 0 ? (
              <SummaryStat
                label="Overpayment"
                amount={overpayment}
                valueClassName="text-emerald-800"
                hint="Customer paid more than owed"
              />
            ) : null}
            <SummaryStat
              label="Opening balance"
              amount={customer.pastBill}
              hint={
                customer.pastBillUpdatedAt
                  ? `Updated ${formatDisplayDate(String(customer.pastBillUpdatedAt).slice(0, 10))}${
                      customer.pastBillUpdatedBy ? ` by ${customer.pastBillUpdatedBy}` : ''
                    }`
                  : 'Starting amount'
              }
            />
            <SummaryStat
              label="Total charged"
              amount={summary.totalCharged}
              hint="Opening + credit sales"
            />
            <SummaryStat
              label="Total paid"
              amount={summary.totalPaid}
              valueClassName="text-emerald-800"
              hint="All recorded payments"
            />
          </div>
        </section>
      ) : null}

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
          <div className={mobileCardList}>
            {loading ? (
              <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
                <LoadingSpinner label="Loading activity…" />
              </p>
            ) : transactions.length === 0 ? (
              <div className="rounded-2xl bg-white px-4 py-8 text-center ring-1 ring-slate-100">
                <p className="font-medium text-slate-700">No activity yet</p>
                <p className="mt-1 text-sm text-slate-500">
                  Credit sales and payments will show up here once recorded.
                </p>
                {customer ? (
                  <Link
                    to={recordPaymentHref}
                    className="mt-4 inline-flex text-sm font-semibold text-indigo-600 hover:text-indigo-800"
                  >
                    Record a payment →
                  </Link>
                ) : null}
              </div>
            ) : filteredTransactions.length === 0 ? (
              <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
                Nothing matches your search or filter. Try clearing filters above.
              </p>
            ) : (
              pagedTransactions.map((tx) => {
                const meta = txKindMeta(tx.kind);
                const isCredit = tx.direction === 'credit';
                return (
                  <MobileRowCard
                    key={`${tx.kind}-${tx.id}`}
                    title={formatDisplayDate(tx.date)}
                    subtitle={tx.type || meta.short}
                    badge={
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${meta.badge}`}
                      >
                        {meta.short}
                      </span>
                    }
                    onClick={() => setDetailTx(tx)}
                    fields={[
                      {
                        label: 'Amount',
                        value: isCredit ? `−${money(tx.amount)}` : `+${money(tx.amount)}`,
                      },
                      { label: 'Details', value: tx.details || '—' },
                    ]}
                  />
                );
              })
            )}
          </div>
          <div className={`hidden sm:block ${scrollTableWrap}`}>
            {loading ? (
              <p className="px-4 py-12 text-center text-sm text-slate-500"><LoadingSpinner label="Loading activity…" /></p>
            ) : (
              <table className="w-full min-w-[520px] border-separate border-spacing-0 text-left text-sm">
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
                        {customer ? (
                          <Link
                            to={recordPaymentHref}
                            className="mt-4 inline-flex text-sm font-semibold text-indigo-600 hover:text-indigo-800"
                          >
                            Record a payment →
                          </Link>
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
                            <span className="mt-1 block text-xs text-slate-500 sm:hidden">{tx.type}</span>
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

      <RowDetailModal open={!!detailTx} row={detailTx} variant="transaction" onClose={() => setDetailTx(null)} />

      {customerEditOpen ? (
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
              Updates contact info, payment due date, bill overdue window, and opening balance. Logged in as{' '}
              {getUsername() || '—'}.
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
    </div>
  );
}
