import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getApiBase } from '../apiBase';
import { authFetch } from '../auth';
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
import RecordPaymentModal from './RecordPaymentModal';
import CollectorSeparateBillSettlementModal from './CollectorSeparateBillSettlementModal';
import { useSeparateBillSettlementFlow } from './useShopCollectorSettings';
import { getPaymentCheques } from './paymentCheques';

const apiBase = getApiBase();

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

export default function PaymentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const appliedCustomerPrefill = useRef(false);
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editPayment, setEditPayment] = useState(null);
  const [modalCustomerId, setModalCustomerId] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [detailPayment, setDetailPayment] = useState(null);
  const [separateBillModalOpen, setSeparateBillModalOpen] = useState(false);
  const { useSeparateBillSettlement, loading: collectorSettingsLoading } = useSeparateBillSettlementFlow();

  const loadCustomers = useCallback(async () => {
    try {
      const res = await authFetch(`${apiBase}/api/customers`);
      if (!res.ok) throw new Error('Failed to load customers');
      const data = await res.json();
      setCustomers(Array.isArray(data) ? data : []);
    } catch {
      setCustomers([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${apiBase}/api/payments`);
      if (!res.ok) throw new Error('Failed to load payments');
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || 'Could not load data');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  useEffect(() => {
    if (appliedCustomerPrefill.current || collectorSettingsLoading) return;
    const customerId = searchParams.get('customerId')?.trim();
    if (!customerId) return;
    appliedCustomerPrefill.current = true;
    setCustomerFilter(customerId);
    if (searchParams.get('record') === '1') {
      setEditPayment(null);
      setModalCustomerId(customerId);
      if (useSeparateBillSettlement) {
        setSeparateBillModalOpen(true);
      } else {
        setModalOpen(true);
      }
    }
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, useSeparateBillSettlement, collectorSettingsLoading]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (!inDateRange(r.date, dateFrom, dateTo)) return false;
      if (customerFilter && r.customerId !== customerFilter) return false;
      if (
        !rowMatchesQuery(search, [
          r.date,
          r.billNumber,
          r.customerName,
          r.note,
          r.recordedBy,
          String(r.amount),
          ...getPaymentCheques(r).flatMap((c) => [c.chequeDate, c.chequeNumber]),
        ])
      ) {
        return false;
      }
      return true;
    });
  }, [rows, search, dateFrom, dateTo, customerFilter]);

  const pagination = useTablePagination(filteredRows.length, [
    search,
    dateFrom,
    dateTo,
    customerFilter,
  ]);
  const pagedRows = useMemo(
    () => filteredRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filteredRows, pagination.offset, pagination.pageSize]
  );

  const openModal = (prefillCustomerId = '') => {
    setEditPayment(null);
    setModalCustomerId(prefillCustomerId || '');
    if (useSeparateBillSettlement) {
      setSeparateBillModalOpen(true);
    } else {
      setModalOpen(true);
    }
  };

  const closeSeparateBillModal = () => {
    setSeparateBillModalOpen(false);
    setModalCustomerId('');
  };

  const openPaymentEdit = (payment) => {
    if (!payment?.id) return;
    setEditPayment(payment);
    setModalCustomerId(payment.customerId || '');
    setDetailPayment(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditPayment(null);
    setModalCustomerId('');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">
          {useSeparateBillSettlement
            ? 'Record cash or cheque payments, then allocate across pending invoices.'
            : 'Record cash and cheque payments against customer balances.'}
        </p>
        <button
          type="button"
          onClick={() => openModal()}
          disabled={collectorSettingsLoading}
          className="inline-flex w-full shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03] disabled:opacity-60 sm:w-auto"
        >
          Record payment
        </button>
      </div>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      <TableFiltersBar
        hint={
          !loading && rows.length > 0
            ? `Showing ${filteredRows.length} of ${rows.length} payment${rows.length === 1 ? '' : 's'}`
            : null
        }
      >
        <label className={filterLabel}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Customer, bill #, note, amount…"
            className={filterControl}
          />
        </label>
        <label className={filterLabelNarrow}>
          From date
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className={filterControl}
          />
        </label>
        <label className={filterLabelNarrow}>
          To date
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className={filterControl}
          />
        </label>
        <label className={filterLabel}>
          Customer
          <select
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
            className={filterControl}
          >
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </TableFiltersBar>

      <div className="space-y-3">
      <div className={mobileCardList}>
        {loading ? (
          <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
            <LoadingSpinner />
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
            No payments yet. Record one to update customer balances.
          </p>
        ) : filteredRows.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
            No payments match your search or filters.
          </p>
        ) : (
          pagedRows.map((r) => (
            <MobileRowCard
              key={r.id}
              title={r.customerName || '—'}
              subtitle={`${r.date || '—'} · Bill #${r.billNumber || '—'}`}
              fields={[
                { label: 'Amount', value: `−${money(r.amount)}` },
                { label: 'Recorded by', value: r.recordedBy || '—' },
              ]}
              actions={
                <>
                  <button
                    type="button"
                    onClick={() => setDetailPayment(r)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                  >
                    Details
                  </button>
                  {r.customerId ? (
                    <Link
                      to={`/dashboard/customers/${encodeURIComponent(r.customerId)}`}
                      className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                    >
                      Customer
                    </Link>
                  ) : null}
                </>
              }
            />
          ))
        )}
      </div>
      <div className={`hidden sm:block ${scrollTableWrap}`}>
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
          <thead className={stickyThead}>
            <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
              <th className="whitespace-nowrap px-4 py-3 font-mono">Bill #</th>
              <th className="px-4 py-3">Customer</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
              <th className="whitespace-nowrap px-4 py-3">Recorded by</th>
              <th className="whitespace-nowrap px-4 py-3 text-center"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  <LoadingSpinner />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  No payments yet. Record one to update customer balances.
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  No payments match your search or filters.
                </td>
              </tr>
            ) : (
              pagedRows.map((r) => (
                <tr
                  key={r.id}
                  {...detailRowAttrs(() => setDetailPayment(r), 'hover:bg-slate-50/80')}
                  aria-label={`Payment ${r.billNumber || r.id || ''}`}
                >
                  <td className={`whitespace-nowrap px-4 py-3 tabular-nums ${stickyFirstTd}`}>{r.date}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-sm font-semibold tabular-nums text-slate-800">
                    {r.billNumber || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{r.customerName || '—'}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-emerald-700">
                    −{money(r.amount)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.recordedBy || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <Link
                      to={`/dashboard/customers/${encodeURIComponent(r.customerId)}`}
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Customer
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {!loading && rows.length > 0 ? (
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

      <RecordPaymentModal
        open={modalOpen}
        onClose={closeModal}
        onSaved={load}
        prefillCustomerId={modalCustomerId}
        editPayment={editPayment}
      />

      <CollectorSeparateBillSettlementModal
        open={separateBillModalOpen}
        onClose={closeSeparateBillModal}
        onSaved={load}
        prefillCustomerId={modalCustomerId}
      />

      <RowDetailModal
        open={!!detailPayment}
        row={detailPayment}
        variant="payment"
        onClose={() => setDetailPayment(null)}
        actions={
          <button
            type="button"
            onClick={() => openPaymentEdit(detailPayment)}
            className="mt-4 w-full rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-800 ring-1 ring-indigo-100 hover:bg-indigo-100"
          >
            Edit payment
          </button>
        }
      />
    </div>
  );
}
