import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import { authFetch, isCollector } from '../auth';
import { formatReportItemLabel } from './brandTheme';
import { useBagProducts } from './BagProductsContext';
import { buildBillSettledDateLookup } from './pendingBills';
import {
  LoadingSpinner,
  MobileRowCard,
  mobileCardList,
  TableFiltersBar,
  TablePaginationBar,
  filterControl,
  filterLabel,
  rowMatchesQuery,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
  useTablePagination,
} from './tableToolbar';

const apiRoot = getApiBase() || '';

function localYmd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysFromYmdToToday(fromYmd, toYmd = localYmd()) {
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

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function brandLineFromBill(bill, brandKey) {
  if (!brandKey) return Number(bill.totalAmount) || 0;
  const line = Number(bill[`${brandKey}Line`]);
  if (line > 0) return line;
  const bags = Number(bill[`${brandKey}Bags`]) || 0;
  const price = Number(bill[`${brandKey}UnitPrice`]) || 0;
  return Math.round(bags * price * 100) / 100;
}

/**
 * Same line shape as Reports “Bills by month”, limited to bills with no settled date.
 */
function buildPendingMonthlyBillRows(bills, settledByBillId, brands) {
  const rows = [];
  for (const bill of Array.isArray(bills) ? bills : []) {
    const date = String(bill.date ?? '').slice(0, 10);
    const shop = String(bill.customerName ?? '').trim() || '—';
    const settledDate = bill.id ? settledByBillId.get(bill.id) || '' : '';
    if (settledDate) continue;
    const spendDays = daysFromYmdToToday(date);

    let anyBrand = false;
    for (const brand of brands) {
      const bagCount = Number(bill[brand.bagsField]) || 0;
      if (bagCount <= 0) continue;
      anyBrand = true;
      rows.push({
        rowKey: `${bill.id || date}-${brand.key}`,
        date,
        shop,
        bagType: formatReportItemLabel(brand) || brand.label,
        brandKey: brand.key,
        bagCount,
        amount: brandLineFromBill(bill, brand.key),
        settledDate: '',
        daysToSettle: null,
        spendDays,
      });
    }

    if (!anyBrand) {
      rows.push({
        rowKey: `${bill.id || date}-total`,
        date,
        shop,
        bagType: '—',
        brandKey: '',
        bagCount: 0,
        amount: Number(bill.totalAmount) || 0,
        settledDate: '',
        daysToSettle: null,
        spendDays,
      });
    }
  }

  rows.sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    const byShop = a.shop.localeCompare(b.shop);
    if (byShop !== 0) return byShop;
    return a.bagType.localeCompare(b.bagType);
  });
  return rows;
}

export default function PendingBillsPage() {
  const { brands } = useBagProducts();
  const collectorView = isCollector();
  const [bills, setBills] = useState([]);
  const [payments, setPayments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [shopFilter, setShopFilter] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [billsRes, paymentsRes, customersRes] = await Promise.all([
        authFetch(`${apiRoot}/api/bills`),
        authFetch(`${apiRoot}/api/payments`),
        authFetch(`${apiRoot}/api/customers`),
      ]);
      if (!billsRes.ok) throw new Error('Failed to load bills');
      if (!paymentsRes.ok) throw new Error('Failed to load payments');
      if (!customersRes.ok) throw new Error('Failed to load customers');
      const [billsData, paymentsData, customersData] = await Promise.all([
        billsRes.json(),
        paymentsRes.json(),
        customersRes.json(),
      ]);
      setBills(Array.isArray(billsData) ? billsData : []);
      setPayments(Array.isArray(paymentsData) ? paymentsData : []);
      setCustomers(Array.isArray(customersData) ? customersData : []);
    } catch (e) {
      setError(e.message || 'Could not load data');
      setBills([]);
      setPayments([]);
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const settledByBillId = useMemo(
    () => buildBillSettledDateLookup(customers, bills, payments),
    [customers, bills, payments],
  );

  const pendingRows = useMemo(
    () => buildPendingMonthlyBillRows(bills, settledByBillId, brands),
    [bills, settledByBillId, brands],
  );

  const shopOptions = useMemo(() => {
    const shops = new Set();
    for (const row of pendingRows) {
      const shop = String(row.shop ?? '').trim();
      if (shop && shop !== '—') shops.add(shop);
    }
    if (shopFilter && shopFilter !== '—') shops.add(shopFilter);
    return [...shops].sort((a, b) => a.localeCompare(b));
  }, [pendingRows, shopFilter]);

  const filteredRows = useMemo(() => {
    const shop = shopFilter.trim();
    return pendingRows.filter((r) => {
      if (shop && r.shop !== shop) return false;
      return rowMatchesQuery(search, [
        r.date,
        r.shop,
        r.bagType,
        r.bagCount,
        r.bagCount.toLocaleString(),
        r.amount,
        money(r.amount),
        r.spendDays,
      ]);
    });
  }, [pendingRows, shopFilter, search]);

  const totals = useMemo(
    () =>
      filteredRows.reduce(
        (acc, r) => ({
          bagCount: acc.bagCount + r.bagCount,
          amount: acc.amount + r.amount,
        }),
        { bagCount: 0, amount: 0 },
      ),
    [filteredRows],
  );

  const pagination = useTablePagination(filteredRows.length, [shopFilter, search]);
  const pagedRows = useMemo(
    () => filteredRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filteredRows, pagination.offset, pagination.pageSize],
  );

  const emptyMessage =
    shopFilter || search.trim()
      ? 'No pending bills match your shop or search.'
      : 'No pending bills.';

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        {collectorView
          ? 'Unsettled credit bills for your assigned shops. Same columns as Bills by month.'
          : 'Unsettled credit bills. Same columns as Bills by month.'}
      </p>

      <div className="rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-6">
        <h2 className="text-sm font-bold text-slate-900">Pending bills</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Credit bills with no settled date, oldest first. Spend days count from the bill date.
        </p>

        <div className="mt-4">
          <TableFiltersBar
            hint={
              !loading && pendingRows.length > 0
                ? `Showing ${filteredRows.length} of ${pendingRows.length} line${
                    pendingRows.length === 1 ? '' : 's'
                  }`
                : null
            }
          >
            <label className={filterLabel}>
              Shop
              <select
                value={shopFilter}
                onChange={(e) => setShopFilter(e.target.value)}
                className={filterControl}
              >
                <option value="">All shops</option>
                {shopOptions.map((shop) => (
                  <option key={shop} value={shop}>
                    {shop}
                  </option>
                ))}
              </select>
            </label>
            <label className={filterLabel}>
              Search
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Shop, bag type, date, amount…"
                className={filterControl}
              />
            </label>
          </TableFiltersBar>

          {error ? (
            <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
              {error}
            </p>
          ) : null}

          <div className={`mt-5 ${mobileCardList}`}>
            {loading ? (
              <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
                <LoadingSpinner />
              </p>
            ) : filteredRows.length === 0 ? (
              <p className="rounded-[20px] bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-md ring-1 ring-slate-100">
                {emptyMessage}
              </p>
            ) : (
              <>
                {pagedRows.map((r) => (
                  <MobileRowCard
                    key={r.rowKey}
                    title={r.shop}
                    subtitle={r.date}
                    badge={r.bagType !== '—' ? r.bagType : null}
                    fields={[
                      { label: 'Bags', value: r.bagCount.toLocaleString() },
                      { label: 'Amount', value: money(r.amount) },
                      { label: 'Spend days', value: r.spendDays != null ? r.spendDays : '—' },
                      { label: 'Settled', value: r.settledDate || '—' },
                      { label: 'Days', value: r.daysToSettle != null ? r.daysToSettle : '—' },
                    ]}
                  />
                ))}
                <div className="flex items-center justify-between gap-3 rounded-2xl bg-indigo-50 px-4 py-3 text-sm font-semibold text-slate-900 ring-1 ring-indigo-100">
                  <span>
                    Total ({filteredRows.length} line
                    {filteredRows.length === 1 ? '' : 's'})
                  </span>
                  <span className="tabular-nums text-indigo-900">
                    {totals.bagCount.toLocaleString()} bags · {money(totals.amount)}
                  </span>
                </div>
              </>
            )}
          </div>

          <div className={`mt-5 hidden sm:block ${scrollTableWrap}`}>
            <table className="w-full min-w-[900px] data-table border-separate border-spacing-0 text-left text-sm">
              <thead className={stickyThead}>
                <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
                  <th className="whitespace-nowrap px-4 py-3">Shop name</th>
                  <th className="whitespace-nowrap px-4 py-3">Bag type</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Bag count</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Spend days</th>
                  <th className="whitespace-nowrap px-4 py-3">Bill settled date</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Days to settle</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                      <LoadingSpinner />
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                      {emptyMessage}
                    </td>
                  </tr>
                ) : (
                  pagedRows.map((r) => {
                    const brand = brands.find((b) => b.key === r.brandKey);
                    return (
                      <tr key={r.rowKey} className="border-t border-slate-100 hover:bg-slate-50/80">
                        <td className={`whitespace-nowrap px-4 py-3 tabular-nums text-slate-600 ${stickyFirstTd}`}>
                          {r.date}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">{r.shop}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {r.bagType !== '—' ? (
                            <span
                              className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${
                                brand?.iconBg || 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {r.bagType}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-800">
                          {r.bagCount.toLocaleString()}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                          {money(r.amount)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">
                          {r.spendDays != null ? r.spendDays : '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">
                          {r.settledDate || '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">
                          {r.daysToSettle != null ? r.daysToSettle : '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {!loading && filteredRows.length > 0 ? (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-indigo-50/60 font-semibold text-slate-900">
                    <td className="px-4 py-3" colSpan={3}>
                      Total ({filteredRows.length} line{filteredRows.length === 1 ? '' : 's'})
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {totals.bagCount.toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-indigo-900">
                      {money(totals.amount)}
                    </td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3" colSpan={2} />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
          {!loading && filteredRows.length > 0 ? (
            <TablePaginationBar
              className="mt-4"
              page={pagination.page}
              totalPages={pagination.totalPages}
              pageSize={pagination.pageSize}
              totalCount={filteredRows.length}
              onPageChange={pagination.setPage}
              onPageSizeChange={pagination.setPageSize}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
