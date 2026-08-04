import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import { authFetch } from '../auth';
import { buildChequeTableRows, depositQueueRowKey } from './paymentCheques';
import { buildPendingPoOutgoingRows } from './poChequeDisplay';
import {
  LoadingSpinner,
  TableFiltersBar,
  filterControl,
  filterLabel,
  mobileCardList,
  MobileRowCard,
  rowMatchesQuery,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
} from './tableToolbar';

const apiRoot = getApiBase() || '';

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function buildIncomingPendingRows(payments) {
  return buildChequeTableRows(payments, (p, c, flat) => {
    if (c.chequeDeposited || c.chequeReturned) return null;
    return {
      rowKey: depositQueueRowKey({ id: p.id, chequeId: c.id }),
      customerName: String(p.customerName ?? '').trim() || '—',
      billNumber: p.billNumber != null ? String(p.billNumber) : '—',
      chequeNumber: flat.chequeNumber,
      chequeDate: flat.chequeDate,
      amount: flat.amount,
    };
  }).sort((a, b) => {
    const d = a.chequeDate.localeCompare(b.chequeDate);
    if (d !== 0) return d;
    return a.rowKey.localeCompare(b.rowKey);
  });
}

function SectionSummary({ label, total, count, countLabel, tone }) {
  const isAmber = tone === 'amber';
  return (
    <div
      className={`rounded-xl p-4 ring-1 ${isAmber ? 'bg-amber-50 ring-amber-100' : 'bg-violet-50 ring-violet-100'}`}
    >
      <p
        className={`text-xs font-semibold uppercase tracking-wide ${isAmber ? 'text-amber-800' : 'text-violet-700'}`}
      >
        {label}
      </p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${isAmber ? 'text-amber-900' : 'text-violet-900'}`}>
        {money(total)}
      </p>
      <p className={`mt-0.5 text-xs ${isAmber ? 'text-amber-700' : 'text-violet-600'}`}>
        {count} {countLabel}
      </p>
    </div>
  );
}

function IncomingChequeSection({ rows, search }) {
  const filteredRows = useMemo(
    () =>
      rows.filter((row) =>
        rowMatchesQuery(search, [
          row.customerName,
          row.billNumber,
          row.chequeNumber,
          row.chequeDate,
          row.amount,
        ]),
      ),
    [rows, search],
  );

  const totalAmount = useMemo(
    () => filteredRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
    [filteredRows],
  );

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-slate-900">Cheques to deposit</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Customer cheques received and not yet marked as deposited at the bank.
        </p>
      </div>

      <SectionSummary
        label="Pending deposit total"
        total={totalAmount}
        count={filteredRows.length}
        countLabel={`cheque${filteredRows.length === 1 ? '' : 's'} awaiting bank deposit`}
        tone="violet"
      />

      <div className={mobileCardList}>
        {filteredRows.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
            {rows.length === 0 ? 'No cheques pending deposit.' : 'No matches.'}
          </p>
        ) : (
          filteredRows.map((row) => (
            <MobileRowCard
              key={row.rowKey}
              title={row.customerName}
              subtitle={`Bill #${row.billNumber} · Cheque #${row.chequeNumber}`}
              fields={[
                { label: 'Cheque date', value: row.chequeDate || '—' },
                { label: 'Amount', value: money(row.amount) },
              ]}
            />
          ))
        )}
      </div>
      <div className={`hidden sm:block ${scrollTableWrap}`}>
        <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm">
          <thead className={stickyThead}>
            <tr className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              <th className={`px-3 py-3 ${stickyFirstTh}`}>Customer</th>
              <th className="px-3 py-3 font-mono">Bill #</th>
              <th className="px-3 py-3 font-mono">Cheque #</th>
              <th className="px-3 py-3">Cheque date</th>
              <th className="px-3 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-sm text-slate-500">
                  {rows.length === 0 ? 'No cheques pending deposit.' : 'No matches.'}
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => (
                <tr key={row.rowKey} className="hover:bg-slate-50/80">
                  <td className={`max-w-[180px] px-3 py-3 font-medium text-slate-900 ${stickyFirstTd}`}>
                    <span className="line-clamp-2">{row.customerName}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-xs tabular-nums">
                    {row.billNumber}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-xs">{row.chequeNumber}</td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-600">
                    {row.chequeDate || '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-violet-800">
                    {money(row.amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OutgoingPoChequeSection({ rows, search }) {
  const filteredRows = useMemo(
    () =>
      rows.filter((row) =>
        rowMatchesQuery(search, [
          row.product,
          row.distributorName,
          row.chequeNumber,
          row.bankLabel,
          row.chequeDate,
          row.amount,
        ]),
      ),
    [rows, search],
  );

  const totalAmount = useMemo(
    () => filteredRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
    [filteredRows],
  );

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-slate-900">Cheques issued for purchases</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Purchase order cheques before their converting date — money going out when they clear.
        </p>
      </div>

      <SectionSummary
        label="Pending outgoing total"
        total={totalAmount}
        count={filteredRows.length}
        countLabel={`PO cheque${filteredRows.length === 1 ? '' : 's'} not yet converted`}
        tone="amber"
      />

      <div className={mobileCardList}>
        {filteredRows.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
            {rows.length === 0 ? 'No pending PO cheques.' : 'No matches.'}
          </p>
        ) : (
          filteredRows.map((row) => (
            <MobileRowCard
              key={row.rowKey}
              title={row.product}
              subtitle={`${row.distributorName} · ${row.bankLabel}`}
              fields={[
                { label: 'Converting date', value: row.chequeDate || '—' },
                { label: 'Cheque #', value: row.chequeNumber },
                { label: 'Amount', value: money(row.amount) },
              ]}
            />
          ))
        )}
      </div>
      <div className={`hidden sm:block ${scrollTableWrap}`}>
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
          <thead className={stickyThead}>
            <tr className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              <th className={`px-3 py-3 ${stickyFirstTh}`}>Product</th>
              <th className="px-3 py-3">Distributor</th>
              <th className="px-3 py-3">Bank · Cheque #</th>
              <th className="px-3 py-3">Converting date</th>
              <th className="px-3 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-sm text-slate-500">
                  {rows.length === 0 ? 'No pending PO cheques.' : 'No matches.'}
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => (
                <tr key={row.rowKey} className="hover:bg-slate-50/80">
                  <td className={`max-w-[160px] px-3 py-3 font-medium text-slate-900 ${stickyFirstTd}`}>
                    <span className="line-clamp-2">{row.product}</span>
                  </td>
                  <td className="max-w-[160px] px-3 py-3 text-slate-700">
                    <span className="line-clamp-2">{row.distributorName}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-xs">{row.bankLabel}</td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-600">
                    {row.chequeDate || '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-amber-900">
                    {money(row.amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function PendingChequesPage() {
  const [incomingRows, setIncomingRows] = useState([]);
  const [outgoingRows, setOutgoingRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [payRes, poRes, shopRes] = await Promise.all([
        authFetch(`${apiRoot}/api/payments`),
        authFetch(`${apiRoot}/api/purchase-orders`),
        authFetch(`${apiRoot}/api/shop`),
      ]);
      if (!payRes.ok) throw new Error('Failed to load payments');
      const payments = await payRes.json();
      setIncomingRows(buildIncomingPendingRows(Array.isArray(payments) ? payments : []));

      const purchaseOrders = poRes.ok ? await poRes.json() : [];
      const shopData = shopRes.ok ? await shopRes.json() : {};
      const bankAccounts = Array.isArray(shopData.bankAccounts) ? shopData.bankAccounts : [];
      setOutgoingRows(
        buildPendingPoOutgoingRows(
          Array.isArray(purchaseOrders) ? purchaseOrders : [],
          bankAccounts,
        ),
      );
    } catch (e) {
      setError(e.message || 'Could not load data');
      setIncomingRows([]);
      setOutgoingRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalCount = incomingRows.length + outgoingRows.length;
  const filteredIncomingCount = useMemo(() => {
    if (!search.trim()) return incomingRows.length;
    return incomingRows.filter((row) =>
      rowMatchesQuery(search, [
        row.customerName,
        row.billNumber,
        row.chequeNumber,
        row.chequeDate,
        row.amount,
      ]),
    ).length;
  }, [incomingRows, search]);
  const filteredOutgoingCount = useMemo(() => {
    if (!search.trim()) return outgoingRows.length;
    return outgoingRows.filter((row) =>
      rowMatchesQuery(search, [
        row.product,
        row.distributorName,
        row.chequeNumber,
        row.bankLabel,
        row.chequeDate,
        row.amount,
      ]),
    ).length;
  }, [outgoingRows, search]);
  const filteredTotalCount = filteredIncomingCount + filteredOutgoingCount;

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Incoming cheques waiting to be deposited at the bank, and outgoing PO cheques issued to buy stock
        that have not yet converted.
      </p>

      <TableFiltersBar
        hint={
          !loading && totalCount > 0
            ? `${filteredTotalCount} pending cheque${filteredTotalCount === 1 ? '' : 's'} · ${filteredIncomingCount} to deposit · ${filteredOutgoingCount} PO`
            : null
        }
      >
        <label className={filterLabel}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Customer, product, cheque #, bank…"
            className={filterControl}
          />
        </label>
      </TableFiltersBar>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <div className="space-y-10">
          <IncomingChequeSection rows={incomingRows} search={search} />
          <OutgoingPoChequeSection rows={outgoingRows} search={search} />
        </div>
      )}
    </div>
  );
}
