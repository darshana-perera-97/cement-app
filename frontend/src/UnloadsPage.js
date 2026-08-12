import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_DEV_API_URL, getApiBase } from './apiBase';
import {
  authFetch,
  canAccessUnloadsPortal,
  clearAuth,
  getDisplayName,
  isDriverAuthed,
  setDriverAuth,
} from './auth';
import { shopNameInitials, useShopName } from './shopConfig';
import { useBagProducts } from './dashboard/BagProductsContext';
import { LoadingSpinner } from './dashboard/tableToolbar';

const apiBase = getApiBase();

function totalBags(row, bagBrands) {
  return bagBrands.reduce((s, b) => s + (Number(row[`${b.key}Bags`]) || 0), 0);
}

function todayYmdLocal() {
  const dt = new Date();
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function requestedBags(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** @returns {string[]} user-facing errors; empty if valid */
function validateUnloadAgainstStock(form, stockByBrand, bagBrands) {
  const issues = [];
  let anyRequested = false;

  for (const b of bagBrands) {
    const requested = requestedBags(form[`${b.key}Bags`]);
    if (requested <= 0) continue;
    anyRequested = true;
    const available = stockByBrand[b.key] ?? 0;
    if (available <= 0) {
      issues.push(`${b.label} is out of stock — you cannot unload it.`);
    } else if (requested > available) {
      issues.push(
        `${b.label}: only ${available.toLocaleString()} bag${available === 1 ? '' : 's'} in stock (you entered ${requested.toLocaleString()}).`,
      );
    }
  }

  if (!anyRequested) {
    const anyInStock = bagBrands.some((b) => (stockByBrand[b.key] ?? 0) > 0);
    if (!anyInStock) {
      issues.push('No bags in stock right now — nothing can be unloaded.');
    } else {
      issues.push('Enter at least one bag to unload (only brands that are in stock).');
    }
  }

  return issues;
}

function emptyUnloadForm(bagBrands) {
  const f = {
    date: todayYmdLocal(),
    customerId: '',
    note: '',
  };
  for (const b of bagBrands) {
    f[`${b.key}Bags`] = '';
  }
  return f;
}

function DriverLogin({ onSuccess }) {
  const shopName = useShopName();
  const [nic, setNic] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const url = `${apiBase}/api/driver/login`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: nic, password }),
      });
      let data = {};
      try {
        data = await res.json();
      } catch {
        /* ignore */
      }
      if (!res.ok) {
        setError(data.error || `Sign-in failed (${res.status})`);
        return;
      }
      if (!data?.ok || !data.token) {
        setError('Unexpected response from server.');
        return;
      }
      const resolvedUser =
        data.username != null && String(data.username).trim() ? data.username : nic;
      setDriverAuth(resolvedUser, data.token, data.name);
      onSuccess();
    } catch {
      setError(`Could not reach the server. Is the backend running at ${DEFAULT_DEV_API_URL}?`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] min-w-0 flex-1 flex-col items-center justify-center overflow-x-hidden bg-slate-50 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-5 sm:py-12">
      <main className="w-full max-w-[420px] sm:max-w-md">
        <div className="max-h-[min(92dvh,calc(100dvh-2rem))] overflow-y-auto overscroll-contain rounded-3xl bg-white px-5 py-8 shadow-xl shadow-slate-200/60 ring-1 ring-slate-100 sm:px-10 sm:py-10">
          <div className="mb-6 flex items-center gap-3 sm:mb-8">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 text-sm font-bold tracking-tight text-white shadow-lg shadow-emerald-500/30 sm:h-12 sm:w-12"
              aria-hidden
            >
              {shopNameInitials(shopName)}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Driver</p>
              <h1 className="truncate text-lg font-bold text-slate-900 sm:text-xl">{shopName || 'Unloads'}</h1>
            </div>
          </div>
          <p className="mb-6 text-sm leading-relaxed text-slate-600 sm:text-[15px]">
            Sign in with your NIC and password to record shop unloads.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">NIC</span>
              <input
                type="text"
                autoComplete="username"
                value={nic}
                onChange={(e) => setNic(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-base text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:py-2.5 sm:text-sm"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-base text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:py-2.5 sm:text-sm"
                required
              />
            </label>
            {error ? (
              <p className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-800 ring-1 ring-red-100" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-emerald-600 px-4 py-3.5 text-sm font-semibold text-white shadow-md shadow-emerald-600/25 transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60 sm:py-3"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

function StockStrip({ summaryBrands, bagBrands, loading, onRefresh }) {
  const totals = useMemo(() => {
    const t = {};
    for (const b of bagBrands) {
      const found = summaryBrands?.find((x) => x.key === b.key);
      const available = found?.availableForRequest;
      const bags = found ? Number(found.bags) || 0 : 0;
      t[b.key] = Math.max(0, Math.floor(Number(available != null ? available : bags) || 0));
    }
    return t;
  }, [summaryBrands, bagBrands]);

  return (
    <section className="sticky top-0 z-20 border-b border-slate-200/80 bg-slate-50/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-slate-50/80 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 sm:text-[13px]">Available to unload</h2>
        <button
          type="button"
          onClick={onRefresh}
          className="min-h-[44px] min-w-[44px] rounded-lg px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 sm:min-h-0 sm:min-w-0"
        >
          Refresh
        </button>
      </div>
      <div className="mx-auto mt-2 grid max-w-6xl grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
        {bagBrands.map((b) => (
          <div
            key={b.key}
            className={`min-w-0 rounded-xl bg-white px-3 py-2.5 shadow-sm ring-1 sm:px-4 sm:py-3 ${b.ring}`}
          >
            <p className={`truncate text-[10px] font-bold uppercase tracking-wide sm:text-xs ${b.iconBg.split(' ')[1]}`}>
              {b.label}
            </p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900 sm:text-xl md:text-2xl">
              {loading ? '—' : totals[b.key].toLocaleString()}
            </p>
            <p className="mt-0.5 hidden text-[10px] font-medium text-slate-400 sm:block">bags</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function brandSummaryLine(row, bagBrands) {
  return bagBrands.filter((b) => (Number(row[`${b.key}Bags`]) || 0) > 0)
    .map((b) => `${b.label} ${Number(row[`${b.key}Bags`])}`)
    .join(' · ');
}

function UnloadsWorkspace() {
  const { brands: bagBrands } = useBagProducts();
  const shopName = useShopName();
  const driverLabel = getDisplayName();
  const [summaryBrands, setSummaryBrands] = useState([]);
  const [stockLoading, setStockLoading] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [recent, setRecent] = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [form, setForm] = useState(() => emptyUnloadForm([]));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(null);

  const loadStock = useCallback(async () => {
    setStockLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/stocks/summary`);
      if (res.ok) {
        const data = await res.json();
        setSummaryBrands(Array.isArray(data.brands) ? data.brands : []);
      }
    } catch {
      setSummaryBrands([]);
    } finally {
      setStockLoading(false);
    }
  }, []);

  const loadCustomers = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/customers`);
      if (res.ok) {
        const data = await res.json();
        setCustomers(Array.isArray(data) ? data : []);
      }
    } catch {
      setCustomers([]);
    }
  }, []);

  const loadRecent = useCallback(async () => {
    setRecentLoading(true);
    try {
      const res = await authFetch(`${apiBase}/api/unloads`);
      if (res.ok) {
        const data = await res.json();
        setRecent(Array.isArray(data) ? data.slice(0, 15) : []);
      } else {
        setRecent([]);
      }
    } catch {
      setRecent([]);
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStock();
    loadCustomers();
    loadRecent();
    const stockInterval = window.setInterval(loadStock, 5000);
    return () => window.clearInterval(stockInterval);
  }, [loadStock, loadCustomers, loadRecent]);

  const stockByBrand = useMemo(() => {
    const map = {};
    for (const b of bagBrands) {
      const found = summaryBrands.find((x) => x.key === b.key);
      const available = found?.availableForRequest;
      const bags = Math.max(0, Math.floor(Number(found?.bags) || 0));
      map[b.key] = Math.max(
        0,
        Math.floor(Number(available != null ? available : bags) || 0),
      );
    }
    return map;
  }, [summaryBrands, bagBrands]);

  const anyStockAvailable = useMemo(
    () => bagBrands.some((b) => (stockByBrand[b.key] ?? 0) > 0),
    [stockByBrand, bagBrands],
  );

  const handleSignOut = () => {
    clearAuth();
    window.location.reload();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaveError(null);
    setSaveSuccess(null);
    if (!form.customerId) {
      setSaveError('Select a shop.');
      return;
    }

    const stockIssues = validateUnloadAgainstStock(form, stockByBrand, bagBrands);
    if (stockIssues.length > 0) {
      setSaveError(stockIssues.join(' '));
      return;
    }

    const unloadDate = isDriverAuthed() ? todayYmdLocal() : form.date;
    const payload = {
      date: unloadDate,
      customerId: form.customerId,
      note: form.note,
    };
    for (const b of bagBrands) {
      payload[`${b.key}Bags`] = form[`${b.key}Bags`];
    }
    setSaving(true);
    try {
      const res = await authFetch(`${apiBase}/api/unloads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || 'Could not save unload');
        return;
      }
      setSaveSuccess(
        `Request submitted (${totalBags(data, bagBrands).toLocaleString()} bag${totalBags(data, bagBrands) === 1 ? '' : 's'} for ${data.customerName || 'shop'}). The shop is notified if delivery messages are enabled. Waiting for manager approval — stock updates when approved.`,
      );
      setForm(emptyUnloadForm(bagBrands));
      await Promise.all([loadStock(), loadRecent()]);
    } catch {
      setSaveError('Network error. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const sortedCustomers = useMemo(
    () => [...customers].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [customers]
  );

  const driverSession = isDriverAuthed();
  const displayDate = driverSession ? todayYmdLocal() : form.date;

  const inputClass =
    'mt-1.5 w-full min-h-[44px] rounded-xl border border-slate-200 px-3 py-2.5 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:min-h-0 sm:text-sm';

  return (
    <div className="mx-auto flex min-h-[100dvh] min-w-0 w-full max-w-6xl flex-1 flex-col bg-slate-50">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:items-center sm:px-6 lg:px-8">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Unloads</p>
          <h1 className="truncate text-base font-bold text-slate-900 sm:text-lg">{shopName}</h1>
          {isDriverAuthed() ? (
            <p className="truncate text-xs text-slate-500 sm:text-sm">Signed in as {driverLabel}</p>
          ) : (
            <p className="text-xs text-slate-500 sm:text-sm">Admin session</p>
          )}
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="min-h-[44px] shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 active:scale-[0.98] sm:min-h-0"
        >
          Sign out
        </button>
      </header>

      <StockStrip summaryBrands={summaryBrands} bagBrands={bagBrands} loading={stockLoading} onRefresh={loadStock} />

      <div className="flex-1 px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:py-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start lg:gap-8">
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100 sm:space-y-5 sm:p-6"
          >
            <div>
              <h2 className="text-base font-bold text-slate-900 sm:text-lg">Record unload</h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">
                Choose the shop and enter bags unloaded. Your request goes to the manager for approval; stock and the credit bill are created after approval.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2 md:col-span-1">
                <span className="text-sm font-medium text-slate-700">Shop</span>
                <select
                  value={form.customerId}
                  onChange={(e) => setForm((f) => ({ ...f, customerId: e.target.value }))}
                  className={inputClass}
                  required
                >
                  <option value="">Select shop…</option>
                  {sortedCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block md:col-span-1">
                <span className="text-sm font-medium text-slate-700">Date</span>
                {driverSession ? (
                  <p
                    className="mt-1.5 flex min-h-[44px] items-center rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-base tabular-nums text-slate-700 sm:min-h-0 sm:text-sm"
                    aria-readonly="true"
                  >
                    {displayDate}
                    <span className="sr-only"> (today, cannot be changed)</span>
                  </p>
                ) : (
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                    className={inputClass}
                    required
                  />
                )}
              </label>
            </div>

            <div>
              <p className="text-sm font-medium text-slate-700">Bags by brand</p>
              <p className="mt-0.5 text-xs text-slate-500">You can unload only brands that are in stock.</p>
              {!stockLoading && !anyStockAvailable ? (
                <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-100" role="status">
                  No bags in stock right now.
                </p>
              ) : null}
              <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {bagBrands.map((b) => {
                  const available = stockByBrand[b.key] ?? 0;
                  const outOfStock = !stockLoading && available <= 0;
                  return (
                    <label
                      key={b.key}
                      className={`block rounded-xl p-3 ring-1 ${b.ring} ${outOfStock ? 'bg-slate-50 opacity-75' : 'bg-white'}`}
                    >
                      <span className={`text-xs font-bold uppercase tracking-wide ${b.iconBg.split(' ')[1]}`}>
                        {b.label}
                      </span>
                      <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                        {stockLoading ? '…' : outOfStock ? 'Out of stock' : `${available.toLocaleString()} in stock`}
                      </p>
                      <input
                        type="number"
                        min="0"
                        max={available > 0 ? available : undefined}
                        step="1"
                        inputMode="numeric"
                        placeholder="0"
                        disabled={outOfStock}
                        aria-label={`${b.label} bags`}
                        value={form[`${b.key}Bags`]}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === '') {
                            setForm((f) => ({ ...f, [`${b.key}Bags`]: '' }));
                            return;
                          }
                          let n = requestedBags(raw);
                          if (n > available) n = available;
                          setForm((f) => ({ ...f, [`${b.key}Bags`]: n === 0 ? '' : String(n) }));
                        }}
                        className="mt-2 w-full min-h-[44px] rounded-lg border border-slate-200 px-3 py-2 text-base tabular-nums text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 sm:min-h-0 sm:text-sm"
                      />
                    </label>
                  );
                })}
              </div>
            </div>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">Note (optional)</span>
              <input
                type="text"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="Vehicle, lorry, etc."
                className={inputClass}
              />
            </label>

            {saveError ? (
              <p className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-800 ring-1 ring-red-100" role="alert">
                {saveError}
              </p>
            ) : null}
            {saveSuccess ? (
              <p
                className="rounded-xl bg-emerald-50 px-3 py-2.5 text-sm leading-relaxed text-emerald-900 ring-1 ring-emerald-100"
                role="status"
              >
                {saveSuccess}
              </p>
            ) : null}

            <div className="sticky bottom-0 -mx-4 border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
              <button
                type="submit"
                disabled={saving || stockLoading || !anyStockAvailable}
                className="w-full rounded-xl bg-emerald-600 px-4 py-3.5 text-sm font-semibold text-white shadow-md shadow-emerald-600/25 hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60 sm:py-3"
              >
                {saving ? 'Saving…' : 'Submit request'}
              </button>
            </div>
          </form>

          <section className="hidden rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100 sm:p-6 lg:block lg:sticky lg:top-[11.5rem] lg:max-h-[calc(100dvh-13rem)] lg:overflow-y-auto">
            <h2 className="text-base font-bold text-slate-900 sm:text-lg">Recent unloads</h2>
            {recentLoading ? (
              <div className="mt-4 flex justify-center py-8">
                <LoadingSpinner labelHidden />
              </div>
            ) : recent.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No unloads recorded yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {recent.map((row) => {
                  const brands = brandSummaryLine(row, bagBrands);
                  return (
                    <li key={row.id} className="py-3 first:pt-0">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 break-words">{row.customerName}</p>
                          <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">
                            {row.date} · {totalBags(row, bagBrands).toLocaleString()} bags
                            {row.status ? (
                              <span className="ml-1 capitalize text-slate-400">· {row.status}</span>
                            ) : null}
                            {row.driverName ? (
                              <>
                                <span className="hidden sm:inline"> · </span>
                                <span className="block sm:inline">{row.driverName}</span>
                              </>
                            ) : null}
                          </p>
                          {brands ? (
                            <p className="mt-1 text-xs text-slate-400 break-words">{brands}</p>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export default function UnloadsPage() {
  const [portalReady, setPortalReady] = useState(() => canAccessUnloadsPortal());

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden">
      {!portalReady ? (
        <DriverLogin onSuccess={() => setPortalReady(true)} />
      ) : (
        <UnloadsWorkspace />
      )}
    </div>
  );
}
