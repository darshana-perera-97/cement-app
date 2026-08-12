import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import { authFetch } from '../auth';
import { useBagProducts } from './BagProductsContext';
import {
  COLLECTION_DAY_BUCKETS,
  buildBillSettledDateLookup,
  buildSettledCollectionsRows,
  enrichRowsWithCommission,
  normalizeCollectorCommissionRates,
  summarizeCommissionByBucket,
} from './collectionsReport';
import { downloadCollectorCommissionPdf } from './collectorCommissionPdf';
import {
  LoadingSpinner,
  filterControl,
  filterLabelNarrow,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
} from './tableToolbar';

const apiBase = getApiBase();

function currentMonthValue(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthlyRangeFromMonthValue(monthValue) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthValue ?? '').trim());
  if (!match) {
    const today = currentMonthValue();
    return monthlyRangeFromMonthValue(today);
  }
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const from = `${match[1]}-${match[2]}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const to = `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

function monthDisplayLabel(monthValue) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthValue ?? '').trim());
  if (!match) return monthValue || '—';
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  return new Date(year, month, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

export default function CollectorCommissionSection({ shop, onShopUpdate }) {
  const { brands } = useBagProducts();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [bills, setBills] = useState([]);
  const [payments, setPayments] = useState([]);
  const [collectors, setCollectors] = useState([]);
  const [selectedCollectorId, setSelectedCollectorId] = useState('');
  const [commissionMonth, setCommissionMonth] = useState(() => currentMonthValue());
  const [ratesDraft, setRatesDraft] = useState(() =>
    normalizeCollectorCommissionRates(shop?.collectorCommissionRates),
  );
  const [ratesSaving, setRatesSaving] = useState(false);
  const [ratesError, setRatesError] = useState(null);

  useEffect(() => {
    setRatesDraft(normalizeCollectorCommissionRates(shop?.collectorCommissionRates));
  }, [shop?.collectorCommissionRates]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [billsRes, paymentsRes, customersRes, collectorsRes] = await Promise.all([
        fetch(`${apiBase}/api/bills`),
        fetch(`${apiBase}/api/payments`),
        fetch(`${apiBase}/api/customers`),
        authFetch(`${apiBase}/api/collectors`),
      ]);
      if (!billsRes.ok) throw new Error('Failed to load bills');
      if (!paymentsRes.ok) throw new Error('Failed to load payments');
      if (!customersRes.ok) throw new Error('Failed to load customers');
      if (!collectorsRes.ok) throw new Error('Failed to load collectors');
      const [billsData, paymentsData, customersData, collectorsData] = await Promise.all([
        billsRes.json(),
        paymentsRes.json(),
        customersRes.json(),
        collectorsRes.json(),
      ]);
      setBills(Array.isArray(billsData) ? billsData : []);
      setPayments(Array.isArray(paymentsData) ? paymentsData : []);
      setCustomers(Array.isArray(customersData) ? customersData : []);
      setCollectors(Array.isArray(collectorsData) ? collectorsData : []);
    } catch (e) {
      setError(e.message || 'Could not load commission data');
      setBills([]);
      setPayments([]);
      setCustomers([]);
      setCollectors([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const monthRange = useMemo(() => monthlyRangeFromMonthValue(commissionMonth), [commissionMonth]);
  const monthLabel = useMemo(() => monthDisplayLabel(commissionMonth), [commissionMonth]);

  const settledLookup = useMemo(
    () => buildBillSettledDateLookup(customers, bills, payments),
    [customers, bills, payments],
  );

  const baseRows = useMemo(
    () =>
      buildSettledCollectionsRows(customers, bills, settledLookup, payments, {
        from: monthRange.from,
        to: monthRange.to,
        collectorUserId: selectedCollectorId,
      }),
    [customers, bills, payments, settledLookup, monthRange, selectedCollectorId],
  );

  const commissionRows = useMemo(
    () => enrichRowsWithCommission(baseRows, ratesDraft),
    [baseRows, ratesDraft],
  );

  const bucketSummary = useMemo(() => summarizeCommissionByBucket(commissionRows), [commissionRows]);

  const totals = useMemo(
    () =>
      commissionRows.reduce(
        (acc, r) => ({
          collectionAmount: acc.collectionAmount + (Number(r.amount) || 0),
          commissionAmount: acc.commissionAmount + (Number(r.commissionAmount) || 0),
        }),
        { collectionAmount: 0, commissionAmount: 0 },
      ),
    [commissionRows],
  );

  const selectedCollectorName =
    collectors.find((c) => c.id === selectedCollectorId)?.name || '—';

  const ratesDirty = useMemo(() => {
    const saved = normalizeCollectorCommissionRates(shop?.collectorCommissionRates);
    return COLLECTION_DAY_BUCKETS.some((b) => ratesDraft[b.key] !== saved[b.key]);
  }, [ratesDraft, shop?.collectorCommissionRates]);

  const handleRateChange = (key, value) => {
    const n = Math.max(0, Number(value) || 0);
    setRatesDraft((prev) => ({ ...prev, [key]: Math.round(n * 100) / 100 }));
  };

  const handleSaveRates = async () => {
    setRatesSaving(true);
    setRatesError(null);
    try {
      const res = await fetch(`${apiBase}/api/shop`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...shop,
          collectorCommissionRates: ratesDraft,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRatesError(data.error || 'Could not save commission rates');
        return;
      }
      if (onShopUpdate) onShopUpdate(data);
    } catch {
      setRatesError('Could not reach the server');
    } finally {
      setRatesSaving(false);
    }
  };

  const handleDownloadPdf = () => {
    downloadCollectorCommissionPdf({
      collectorName: selectedCollectorId ? selectedCollectorName : 'All collectors',
      periodLabel: monthLabel,
      rows: commissionRows,
      bucketSummary,
      commissionRates: ratesDraft,
      totals,
      generatedAt: new Date(),
    });
  };

  return (
    <section className="rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Collector commission</h2>
          <p className="mt-1 text-sm text-slate-500">
            Commission is calculated on fully settled bills only — partial or open invoices are excluded.
          </p>
        </div>
        <button
          type="button"
          onClick={handleDownloadPdf}
          disabled={loading || !selectedCollectorId || commissionRows.length === 0}
          className="inline-flex shrink-0 items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Download PDF
        </button>
      </div>

      {error ? (
        <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}
      {ratesError ? (
        <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {ratesError}
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {COLLECTION_DAY_BUCKETS.map((bucket) => (
          <label key={bucket.key} className="block text-sm font-medium text-slate-600">
            {bucket.label} — commission %
            <input
              type="number"
              min={0}
              step={0.01}
              value={ratesDraft[bucket.key]}
              onChange={(e) => handleRateChange(bucket.key, e.target.value)}
              className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm tabular-nums ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={handleSaveRates}
          disabled={ratesSaving || !ratesDirty}
          className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-indigo-700 disabled:opacity-60"
        >
          {ratesSaving ? 'Saving…' : 'Save commission rates'}
        </button>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className={filterLabelNarrow}>
          Settled in month
          <input
            type="month"
            value={commissionMonth}
            onChange={(e) => setCommissionMonth(e.target.value || currentMonthValue())}
            className={filterControl}
          />
        </label>
        <label className={filterLabelNarrow}>
          Collector
          <select
            value={selectedCollectorId}
            onChange={(e) => setSelectedCollectorId(e.target.value)}
            className={filterControl}
          >
            <option value="">Select collector…</option>
            {collectors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!selectedCollectorId ? (
        <p className="mt-4 text-sm text-slate-500">Select a collector to view commission details.</p>
      ) : loading ? (
        <p className="mt-5 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          <LoadingSpinner />
        </p>
      ) : (
        <>
          <div className={`mt-5 ${scrollTableWrap}`}>
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
              <thead className={stickyThead}>
                <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Days bucket</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Commission %</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Collection amount</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Commission</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {COLLECTION_DAY_BUCKETS.map((bucket) => {
                  const s = bucketSummary[bucket.key] || {};
                  return (
                    <tr key={bucket.key} className="bg-white">
                      <td className={`whitespace-nowrap px-4 py-3 font-medium ${stickyFirstTd}`}>{bucket.label}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {(ratesDraft[bucket.key] || 0).toFixed(2)}%
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(s.collectionAmount || 0)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-semibold text-indigo-800">
                        {money(s.commissionAmount || 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-indigo-50/60 font-semibold text-indigo-950">
                  <td className="px-4 py-3">Total</td>
                  <td className="px-4 py-3" />
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(totals.collectionAmount)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(totals.commissionAmount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className={`mt-6 ${scrollTableWrap}`}>
            <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-left text-sm">
              <thead className={stickyThead}>
                <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className={`whitespace-nowrap px-4 py-3 ${stickyFirstTh}`}>Date</th>
                  <th className="whitespace-nowrap px-4 py-3">Invoice #</th>
                  <th className="whitespace-nowrap px-4 py-3">Shop</th>
                  <th className="whitespace-nowrap px-4 py-3">Bag type</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
                  <th className="whitespace-nowrap px-4 py-3">Bill date</th>
                  <th className="whitespace-nowrap px-4 py-3">Settled</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Days</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Bill amount</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Comm. %</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Commission</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {commissionRows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-slate-500">
                      No settled collections for {selectedCollectorName} in {monthLabel}.
                    </td>
                  </tr>
                ) : (
                  commissionRows.map((r) => {
                    const brand = brands.find((b) => b.key === r.brandKey);
                    return (
                      <tr key={r.rowKey} className="bg-white hover:bg-slate-50/80">
                        <td className={`whitespace-nowrap px-4 py-3 tabular-nums ${stickyFirstTd}`}>{r.date}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{r.invoiceNumber}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-medium">{r.shopName}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {r.bagType !== '—' ? (
                            <span
                              className={`inline-flex rounded-lg px-2 py-1 text-xs font-semibold ${
                                brand?.iconBg || 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {r.bagType}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(r.amount)}</td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{r.billDate}</td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{r.settledDate}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{r.daysToSettle}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(r.billAmount)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                          {Number(r.commissionPercent).toFixed(2)}%
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-semibold text-indigo-800">
                          {money(r.commissionAmount)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
