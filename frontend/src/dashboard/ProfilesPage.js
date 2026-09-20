import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getApiBase } from '../apiBase';
import { getUsername } from '../auth';
import { CASH_BOOK_CATEGORY_LABELS } from './cashBookCategories';
import {
  LoadingSpinner,
  MobileRowCard,
  ModalBackdrop,
  TableFiltersBar,
  TablePaginationBar,
  filterControl,
  filterLabel,
  filterLabelNarrow,
  inDateRange,
  mobileCardList,
  modalPanelClassMd,
  rowMatchesQuery,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
  useTablePagination,
} from './tableToolbar';

const apiBase = getApiBase();

const GROUPS = [
  { id: 'users', label: 'Users' },
  { id: 'drivers', label: 'Drivers' },
  { id: 'lorries', label: 'Lorries' },
];

const PERSON_EXPENSE_TYPES = [
  { category: 'salary', label: 'Salary payment' },
  { category: 'other', label: 'Other expense' },
];

const LORRY_EXPENSE_TYPES = [
  { category: 'fuel', label: 'Fuel cost' },
  { category: 'maintenance', label: 'Maintenance' },
];

const EXPENSE_TYPES = [...PERSON_EXPENSE_TYPES, ...LORRY_EXPENSE_TYPES];

const CATEGORY_BADGE = {
  salary: 'bg-indigo-50 text-indigo-800 ring-indigo-100',
  other: 'bg-slate-100 text-slate-700 ring-slate-200',
  fuel: 'bg-amber-50 text-amber-800 ring-amber-100',
  maintenance: 'bg-sky-50 text-sky-800 ring-sky-100',
};

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

function isDriverRole(role) {
  return String(role ?? '').trim() === 'Driver';
}

function normalizeGroup(group) {
  if (group === 'drivers' || group === 'lorries') return group;
  return 'users';
}

function groupFromPerson(person) {
  return isDriverRole(person?.role) ? 'drivers' : 'users';
}

function groupPath(group, profileId = '') {
  const g = normalizeGroup(group);
  const base = profileId
    ? `/dashboard/profiles/${encodeURIComponent(profileId)}`
    : '/dashboard/profiles';
  return `${base}?group=${g}`;
}

function groupNoun(group) {
  if (group === 'drivers') return 'drivers';
  if (group === 'lorries') return 'lorries';
  return 'users';
}

function personInitial(name) {
  const text = String(name || '').trim();
  return text ? text.charAt(0).toUpperCase() : '?';
}

function isActiveExpense(entry) {
  return entry && !entry.cancelled;
}

function expenseTotal(entries) {
  return entries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}

function lorryNumberKey(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function expensesForLorry(lorry, entries) {
  const id = String(lorry?.id ?? '').trim();
  const number = lorryNumberKey(lorry?.number);
  return entries.filter((e) => {
    const lid = String(e.lorryId ?? '').trim();
    if (id && lid === id) return true;
    if (!lid && number && lorryNumberKey(e.vehicleNumber) === number) return true;
    return false;
  });
}

function lastMeterReading(entries) {
  const fuel = entries.filter((e) => e.category === 'fuel' && e.meterReading != null);
  fuel.sort((a, b) => {
    const d = String(b.date || '').localeCompare(String(a.date || ''));
    if (d !== 0) return d;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
  return fuel[0]?.meterReading ?? null;
}

function expenseDescription(entry) {
  if (entry.category === 'fuel') {
    const meter = entry.meterReading != null ? `Meter ${entry.meterReading}` : '';
    const desc = String(entry.description ?? '').trim();
    return [meter, desc].filter(Boolean).join(' — ') || 'Fuel';
  }
  return String(entry.description ?? '').trim() || '—';
}

const fieldClass =
  'mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35';

function ProfileExpenseModal({ open, category, person, lorry, lastMeter, onClose, onSaved }) {
  const [form, setForm] = useState({
    date: todayYmdLocal(),
    amount: '',
    description: '',
    meterReading: '',
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (!open || !category) return;
    setForm({
      date: todayYmdLocal(),
      amount: '',
      description: '',
      meterReading: '',
    });
    setSaveError(null);
  }, [open, category, person?.id, lorry?.id]);

  if (!open || !category || (!person && !lorry)) return null;

  const title = EXPENSE_TYPES.find((t) => t.category === category)?.label || 'Record expense';
  const subjectName = person ? person.name : lorry.number;
  const subjectMeta = person ? person.role || 'Staff' : lorry.note || 'Lorry';
  const needsDescription = category !== 'fuel';
  const needsMeter = category === 'fuel';

  const handleSubmit = async (e) => {
    e.preventDefault();
    const recordedBy = getUsername().trim();
    if (!recordedBy) {
      setSaveError('Sign in with a username to record expenses.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const body = {
        category,
        date: form.date,
        amount: form.amount,
        description: form.description,
        recordedBy,
      };
      if (person) body.staffUserId = person.id;
      if (lorry) body.lorryId = lorry.id;
      if (needsMeter) body.meterReading = form.meterReading;
      const res = await fetch(`${apiBase}/api/cash-book-entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || 'Could not save');
        return;
      }
      onSaved?.(data);
      onClose();
    } catch {
      setSaveError('Could not reach server');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-expense-title"
    >
      <ModalBackdrop onClose={onClose} />
      <div className={modalPanelClassMd}>
        <h2 id="profile-expense-title" className="text-lg font-bold text-slate-900">
          {title}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Recorded as cash out from the cashier for {subjectName}.
        </p>
        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          {saveError ? (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{saveError}</p>
          ) : null}
          <div className="rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {lorry ? 'Lorry' : 'Person'}
            </p>
            <p className="mt-0.5 text-sm font-semibold text-slate-900">{subjectName}</p>
            <p className="text-xs text-slate-500">{subjectMeta}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-600">
              Date
              <input
                type="date"
                required
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className={fieldClass}
                disabled={saving}
              />
            </label>
            <label className="block text-sm font-medium text-slate-600">
              Amount (LKR)
              <input
                type="number"
                required
                min="0.01"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className={`${fieldClass} tabular-nums`}
                placeholder="0.00"
                disabled={saving}
              />
            </label>
          </div>
          {needsMeter ? (
            <label className="block text-sm font-medium text-slate-600">
              Current meter reading
              <input
                type="number"
                required
                min="0"
                step="0.01"
                value={form.meterReading}
                onChange={(e) => setForm((f) => ({ ...f, meterReading: e.target.value }))}
                className={`${fieldClass} tabular-nums`}
                placeholder="Odometer / meter value"
                disabled={saving}
              />
              {lastMeter != null ? (
                <p className="mt-1 text-xs text-slate-500">Last recorded meter: {lastMeter}</p>
              ) : null}
            </label>
          ) : null}
          {needsDescription ? (
            <label className="block text-sm font-medium text-slate-600">
              Description
              <textarea
                required
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className={fieldClass}
                placeholder={
                  category === 'salary'
                    ? 'e.g. March salary, advance…'
                    : category === 'maintenance'
                      ? 'What was repaired or serviced?'
                      : 'What was this expense for?'
                }
                disabled={saving}
              />
            </label>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function countNoun(group, count) {
  if (group === 'lorries') return count === 1 ? 'lorry' : 'lorries';
  if (group === 'drivers') return count === 1 ? 'driver' : 'drivers';
  return count === 1 ? 'user' : 'users';
}

function ProfileList({
  group,
  rows,
  expensesById,
  search,
  setSearch,
  emptyNone,
  searchPlaceholder,
}) {
  const navigate = useNavigate();

  const filtered = useMemo(
    () => rows.filter((row) => rowMatchesQuery(search, row.searchParts)),
    [rows, search],
  );

  const pagination = useTablePagination(filtered.length, [search, group]);
  const paged = useMemo(
    () => filtered.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filtered, pagination.offset, pagination.pageSize],
  );

  const emptyLabel = rows.length === 0 ? emptyNone : 'No matches.';
  const openProfile = (row) => navigate(groupPath(group, row.id));

  return (
    <div className="space-y-4">
      <TableFiltersBar
        hint={
          rows.length > 0
            ? `Showing ${filtered.length} of ${rows.length} ${countNoun(group, rows.length)}`
            : null
        }
      >
        <label className={filterLabel}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className={filterControl}
          />
        </label>
      </TableFiltersBar>

      <div className={mobileCardList}>
        {paged.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
            {emptyLabel}
          </p>
        ) : (
          paged.map((row) => {
            const entries = expensesById.get(row.id) || [];
            return (
              <MobileRowCard
                key={row.id}
                title={row.title}
                subtitle={row.subtitle || undefined}
                onClick={() => openProfile(row)}
                fields={[
                  { label: row.metaLabel, value: row.metaValue || '—' },
                  { label: 'Expenses', value: String(entries.length) },
                  { label: 'Total', value: money(expenseTotal(entries)) },
                ]}
              />
            );
          })
        )}
      </div>

      <div className="hidden gap-3 sm:grid sm:grid-cols-2 xl:grid-cols-3">
        {paged.length === 0 ? (
          <p className="col-span-full rounded-2xl bg-white px-4 py-10 text-center text-sm text-slate-500 ring-1 ring-slate-100">
            {emptyLabel}
          </p>
        ) : (
          paged.map((row) => {
            const entries = expensesById.get(row.id) || [];
            const total = expenseTotal(entries);
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => openProfile(row)}
                className="rounded-[20px] bg-white p-4 text-left shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 transition hover:ring-indigo-200"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-sm font-bold text-indigo-700">
                    {personInitial(row.title)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900">{row.title}</p>
                    <p className="mt-0.5 text-xs font-medium text-slate-500">{row.subtitle || '—'}</p>
                    {row.metaValue ? (
                      <p className="mt-1 truncate text-xs tabular-nums text-slate-500">{row.metaValue}</p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Entries</p>
                    <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-900">{entries.length}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Total</p>
                    <p className="mt-0.5 truncate text-sm font-bold tabular-nums text-slate-900">{money(total)}</p>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {rows.length > 0 ? (
        <TablePaginationBar
          page={pagination.page}
          totalPages={pagination.totalPages}
          pageSize={pagination.pageSize}
          totalCount={filtered.length}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
        />
      ) : null}
    </div>
  );
}

function ExpenseHistory({ expenses, typeOptions, personId }) {
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [category, setCategory] = useState('');

  const filtered = useMemo(
    () =>
      expenses.filter((e) => {
        if (!inDateRange(e.date, dateFrom, dateTo)) return false;
        if (category && e.category !== category) return false;
        return rowMatchesQuery(search, [
          e.date,
          e.category,
          CASH_BOOK_CATEGORY_LABELS[e.category] || e.category,
          expenseDescription(e),
          e.recordedBy,
          e.amount,
          e.meterReading,
        ]);
      }),
    [expenses, search, dateFrom, dateTo, category],
  );

  const pagination = useTablePagination(filtered.length, [search, dateFrom, dateTo, category, personId]);
  const paged = useMemo(
    () => filtered.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filtered, pagination.offset, pagination.pageSize],
  );

  const total = expenseTotal(filtered);

  return (
    <>
      <TableFiltersBar
        hint={expenses.length > 0 ? `Showing ${filtered.length} of ${expenses.length} · ${money(total)}` : null}
      >
        <label className={filterLabel}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Description, amount…"
            className={filterControl}
          />
        </label>
        <label className={filterLabelNarrow}>
          From
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className={filterControl}
          />
        </label>
        <label className={filterLabelNarrow}>
          To
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className={filterControl}
          />
        </label>
        <label className={filterLabelNarrow}>
          Type
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={filterControl}>
            <option value="">All</option>
            {typeOptions.map((t) => (
              <option key={t.category} value={t.category}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </TableFiltersBar>

      <div className={mobileCardList}>
        {paged.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
            {expenses.length === 0 ? 'No expenses on this profile yet.' : 'No matches.'}
          </p>
        ) : (
          paged.map((e) => (
            <MobileRowCard
              key={e.id}
              title={formatDisplayDate(e.date)}
              subtitle={expenseDescription(e)}
              badge={
                <span
                  className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${
                    CATEGORY_BADGE[e.category] || 'bg-slate-50 text-slate-700 ring-slate-100'
                  }`}
                >
                  {CASH_BOOK_CATEGORY_LABELS[e.category] || e.category}
                </span>
              }
              fields={[
                { label: 'Amount', value: money(e.amount) },
                { label: 'Recorded by', value: e.recordedBy || '—' },
              ]}
            />
          ))
        )}
      </div>

      <div className={`hidden sm:block ${scrollTableWrap}`}>
        <table className="w-full min-w-[640px] data-table border-separate border-spacing-0 text-left text-sm">
          <thead className={stickyThead}>
            <tr className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              <th className={`py-3 pl-4 pr-3 ${stickyFirstTh}`}>Date</th>
              <th className="py-3 pr-3">Type</th>
              <th className="py-3 pr-3">Description</th>
              <th className="py-3 pr-3">Recorded by</th>
              <th className="py-3 pr-4 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {paged.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                  {expenses.length === 0 ? 'No expenses on this profile yet.' : 'No matches.'}
                </td>
              </tr>
            ) : (
              paged.map((e) => (
                <tr key={e.id} className="text-slate-700">
                  <td className={`py-3.5 pl-4 pr-3 font-semibold text-slate-900 ${stickyFirstTd}`}>
                    {formatDisplayDate(e.date)}
                  </td>
                  <td className="py-3.5 pr-3">
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${
                        CATEGORY_BADGE[e.category] || 'bg-slate-50 text-slate-700 ring-slate-100'
                      }`}
                    >
                      {CASH_BOOK_CATEGORY_LABELS[e.category] || e.category}
                    </span>
                  </td>
                  <td className="py-3.5 pr-3 text-slate-600">{expenseDescription(e)}</td>
                  <td className="py-3.5 pr-3 text-slate-500">{e.recordedBy || '—'}</td>
                  <td className="py-3.5 pr-4 text-right font-semibold tabular-nums text-slate-900">
                    {money(e.amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {expenses.length > 0 ? (
        <TablePaginationBar
          page={pagination.page}
          totalPages={pagination.totalPages}
          pageSize={pagination.pageSize}
          totalCount={filtered.length}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
        />
      ) : null}
    </>
  );
}

function ProfileDetail({ title, subtitle, facts, expenses, group, typeOptions, actions, profileId, onBack, onAddExpense }) {
  const allTotal = expenseTotal(expenses);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="text-sm font-semibold text-indigo-700 hover:text-indigo-900"
          >
            ← Back to {groupNoun(group)}
          </button>
          <div className="mt-3 flex items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-base font-bold text-indigo-700">
              {personInitial(title)}
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-900">{title}</h2>
              <p className="text-sm text-slate-500">{subtitle}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {actions.map((action) =>
            action.primary ? (
              <button
                key={action.category}
                type="button"
                onClick={() => onAddExpense(action.category)}
                className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/25 transition hover:bg-indigo-700"
              >
                {action.label}
              </button>
            ) : (
              <button
                key={action.category}
                type="button"
                onClick={() => onAddExpense(action.category)}
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-100 transition hover:bg-slate-50"
              >
                {action.label}
              </button>
            ),
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {facts.map((fact) => (
          <div
            key={fact.label}
            className="rounded-[20px] bg-white p-4 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{fact.label}</p>
            <p className="mt-1 text-sm font-semibold tabular-nums text-slate-900">{fact.value}</p>
            {fact.hint ? <p className="text-xs text-slate-500">{fact.hint}</p> : null}
          </div>
        ))}
        <div className="rounded-[20px] bg-white p-4 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">All expenses</p>
          <p className="mt-1 text-sm font-bold tabular-nums text-slate-900">{money(allTotal)}</p>
          <p className="text-xs text-slate-500">
            {expenses.length} entr{expenses.length === 1 ? 'y' : 'ies'}
          </p>
        </div>
      </div>

      <ExpenseHistory expenses={expenses} typeOptions={typeOptions} personId={profileId} />
    </div>
  );
}

export default function ProfilesPage() {
  const { staffId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [staff, setStaff] = useState([]);
  const [lorries, setLorries] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [expenseModal, setExpenseModal] = useState(null);

  const requestedGroup = normalizeGroup(searchParams.get('group'));
  const profileId = String(staffId ?? '').trim();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [staffRes, entriesRes, lorryRes] = await Promise.all([
        fetch(`${apiBase}/api/staff`),
        fetch(`${apiBase}/api/cash-book-entries`),
        fetch(`${apiBase}/api/lorries`),
      ]);
      if (!staffRes.ok) throw new Error('Failed to load staff');
      if (!entriesRes.ok) throw new Error('Failed to load expenses');
      if (!lorryRes.ok) throw new Error('Failed to load lorries');
      const staffData = await staffRes.json();
      const entriesData = await entriesRes.json();
      const lorryData = await lorryRes.json();
      setStaff(Array.isArray(staffData) ? staffData : []);
      setEntries(Array.isArray(entriesData) ? entriesData.filter(isActiveExpense) : []);
      setLorries(Array.isArray(lorryData) ? lorryData : []);
    } catch (e) {
      setError(e.message || 'Could not load data');
      setStaff([]);
      setEntries([]);
      setLorries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const expensesByStaff = useMemo(() => {
    const map = new Map();
    for (const e of entries) {
      const id = String(e.staffUserId ?? '').trim();
      if (!id) continue;
      const list = map.get(id) || [];
      list.push(e);
      map.set(id, list);
    }
    return map;
  }, [entries]);

  const expensesByLorry = useMemo(() => {
    const map = new Map();
    for (const lorry of lorries) {
      map.set(lorry.id, expensesForLorry(lorry, entries));
    }
    return map;
  }, [lorries, entries]);

  const selectedPerson = useMemo(
    () => staff.find((p) => p.id === profileId) || null,
    [staff, profileId],
  );
  const selectedLorry = useMemo(
    () => lorries.find((l) => l.id === profileId) || null,
    [lorries, profileId],
  );

  const group = selectedPerson
    ? groupFromPerson(selectedPerson)
    : selectedLorry
      ? 'lorries'
      : requestedGroup;

  const userCount = staff.filter((p) => !isDriverRole(p.role)).length;
  const driverCount = staff.filter((p) => isDriverRole(p.role)).length;
  const lorryCount = lorries.length;

  const listRows = useMemo(() => {
    if (requestedGroup === 'lorries') {
      return lorries.map((l) => ({
        id: l.id,
        title: l.number,
        subtitle: 'Lorry',
        metaLabel: 'Note',
        metaValue: l.note || '',
        searchParts: [l.number, l.note, l.id],
      }));
    }
    const people = staff.filter((p) =>
      requestedGroup === 'drivers' ? isDriverRole(p.role) : !isDriverRole(p.role),
    );
    return people.map((p) => ({
      id: p.id,
      title: p.name,
      subtitle: p.role || 'Staff',
      metaLabel: 'Contact',
      metaValue: p.contact || '',
      searchParts: [p.name, p.role, p.contact, p.nic, p.driverLicense, p.id],
    }));
  }, [requestedGroup, staff, lorries]);

  const personExpenses = selectedPerson ? expensesByStaff.get(selectedPerson.id) || [] : [];
  const lorryExpenses = selectedLorry ? expensesByLorry.get(selectedLorry.id) || [] : [];
  const lastMeter = selectedLorry ? lastMeterReading(lorryExpenses) : null;

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">
        Expense profiles for dashboard users, drivers, and lorries. Salary and other costs for people, and
        fuel and maintenance for lorries, are recorded as cash-out entries in the Cash Book.
      </p>

      {!profileId ? (
        <div
          className="rounded-[20px] bg-white p-2 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-2.5"
          role="tablist"
          aria-label="Profile groups"
        >
          <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
            {GROUPS.map(({ id, label }) => {
              const active = requestedGroup === id;
              const count = id === 'drivers' ? driverCount : id === 'lorries' ? lorryCount : userCount;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setSearch('');
                    navigate(groupPath(id), { replace: true });
                  }}
                  className={`rounded-xl px-1 py-3.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 sm:px-2 sm:py-4 sm:text-base ${
                    active
                      ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  {label}
                  <span className={`ml-1.5 text-[11px] font-semibold sm:ml-2 sm:text-xs ${active ? 'text-indigo-500' : 'text-slate-400'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner size="lg" />
        </div>
      ) : profileId && !selectedPerson && !selectedLorry ? (
        <div className="rounded-2xl bg-white px-6 py-12 text-center ring-1 ring-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">Profile not found</h2>
          <p className="mt-2 text-sm text-slate-500">This profile is missing or no longer on the list.</p>
          <button
            type="button"
            onClick={() => navigate(groupPath(requestedGroup))}
            className="mt-4 text-sm font-semibold text-indigo-700 hover:text-indigo-900"
          >
            Back to profiles
          </button>
        </div>
      ) : selectedPerson ? (
        <ProfileDetail
          title={selectedPerson.name}
          subtitle={selectedPerson.role || 'Staff'}
          facts={[
            { label: 'Contact', value: selectedPerson.contact || '—' },
            {
              label: group === 'drivers' ? 'License' : 'NIC',
              value: group === 'drivers' ? selectedPerson.driverLicense || '—' : selectedPerson.nic || '—',
            },
          ]}
          expenses={personExpenses}
          group={group}
          typeOptions={PERSON_EXPENSE_TYPES}
          actions={[
            { category: 'other', label: 'Add expense' },
            { category: 'salary', label: 'Add salary', primary: true },
          ]}
          profileId={selectedPerson.id}
          onBack={() => navigate(groupPath(group))}
          onAddExpense={(category) => setExpenseModal(category)}
        />
      ) : selectedLorry ? (
        <ProfileDetail
          title={selectedLorry.number}
          subtitle={selectedLorry.note || 'Lorry'}
          facts={[
            { label: 'Note', value: selectedLorry.note || '—' },
            { label: 'Last meter', value: lastMeter != null ? String(lastMeter) : '—' },
          ]}
          expenses={lorryExpenses}
          group="lorries"
          typeOptions={LORRY_EXPENSE_TYPES}
          actions={[
            { category: 'maintenance', label: 'Add maintenance' },
            { category: 'fuel', label: 'Add fuel', primary: true },
          ]}
          profileId={selectedLorry.id}
          onBack={() => navigate(groupPath('lorries'))}
          onAddExpense={(category) => setExpenseModal(category)}
        />
      ) : (
        <ProfileList
          group={requestedGroup}
          rows={listRows}
          expensesById={requestedGroup === 'lorries' ? expensesByLorry : expensesByStaff}
          search={search}
          setSearch={setSearch}
          emptyNone={
            requestedGroup === 'lorries'
              ? 'No lorries yet. Add lorries under Shop → Lorries.'
              : requestedGroup === 'drivers'
                ? 'No drivers yet. Add driver accounts on the Users page.'
                : 'No users yet. Add manager or collector accounts on the Users page.'
          }
          searchPlaceholder={
            requestedGroup === 'lorries'
              ? 'Number, note…'
              : requestedGroup === 'drivers'
                ? 'Name, license, contact…'
                : 'Name, role, contact…'
          }
        />
      )}

      <ProfileExpenseModal
        open={Boolean(expenseModal && (selectedPerson || selectedLorry))}
        category={expenseModal}
        person={selectedPerson}
        lorry={selectedLorry}
        lastMeter={lastMeter}
        onClose={() => setExpenseModal(null)}
        onSaved={() => load()}
      />
    </div>
  );
}
