import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_DEV_API_URL, getApiBase } from './apiBase';
import {
  authFetch,
  canAccessUnloadsPortal,
  clearAuth,
  getDisplayName,
  isDriverAuthed,
  setDriverAuth,
} from './auth';
import { beginLoginPrinterConnect } from './printer/bluetoothPrinter';
import { shopNameInitials, useShopName } from './shopConfig';
import { formatBrandLabel } from './dashboard/brandTheme';
import { useBagProducts } from './dashboard/BagProductsContext';
import { LoadingSpinner, rowMatchesQuery } from './dashboard/tableToolbar';
import { PrinterStatusButton, usePrinter } from './printer/PrinterProvider';

const apiBase = getApiBase();
const SEARCH_PRODUCT_THRESHOLD = 8;
const SCROLL_LIST_THRESHOLD = 10;
const RECENT_BRAND_PREVIEW = 4;
const LAST_PRINT_COUNT = 2;

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

function brandDisplayName(brand) {
  return formatBrandLabel(brand) || brand.label || brand.key;
}

function brandShortName(brand) {
  const code = String(brand?.code ?? '').trim();
  if (code) return code;
  return String(brand?.label ?? brand?.key ?? '').trim();
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
      issues.push(`${brandDisplayName(b)} is out of stock — you cannot unload it.`);
    } else if (requested > available) {
      issues.push(
        `${brandDisplayName(b)}: only ${available.toLocaleString()} bag${available === 1 ? '' : 's'} in stock (you entered ${requested.toLocaleString()}).`,
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

function mergeFormWithBrands(form, bagBrands) {
  const next = { ...form };
  for (const b of bagBrands) {
    const field = `${b.key}Bags`;
    if (next[field] === undefined) next[field] = '';
  }
  return next;
}

function selectedLinesFromForm(form, bagBrands) {
  return bagBrands
    .map((brand) => ({ brand, qty: requestedBags(form[`${brand.key}Bags`]) }))
    .filter((line) => line.qty > 0);
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
      beginLoginPrinterConnect();
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

function StockStrip({ summaryBrands, bagBrands, loading, onRefresh, onJumpToBrand }) {
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

  const inStockBrands = useMemo(
    () => bagBrands.filter((b) => (totals[b.key] ?? 0) > 0),
    [bagBrands, totals],
  );
  const inStockCount = inStockBrands.length;
  const outCount = bagBrands.length - inStockCount;
  const totalAvailable = useMemo(
    () => bagBrands.reduce((s, b) => s + (totals[b.key] ?? 0), 0),
    [bagBrands, totals],
  );
  const manyProducts = bagBrands.length >= SEARCH_PRODUCT_THRESHOLD;
  const chipBrands = manyProducts ? inStockBrands : bagBrands;

  return (
    <section className="sticky top-0 z-20 border-b border-slate-200/80 bg-slate-50/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-slate-50/80 sm:px-6 sm:py-2.5 lg:px-8">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <h2 className="text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:text-xs">
            Available to unload
          </h2>
          <p className="mt-0.5 truncate text-[13px] font-semibold tabular-nums text-slate-900 sm:text-sm">
            {loading ? '…' : `${totalAvailable.toLocaleString()} bags`}
            <span className="ml-1 font-medium text-slate-500 sm:ml-1.5">
              {loading
                ? ''
                : `· ${inStockCount} in stock${outCount > 0 ? ` · ${outCount} out` : ''}`}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex min-h-11 min-w-11 shrink-0 touch-manipulation items-center justify-center rounded-xl px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
        >
          Refresh
        </button>
      </div>
      {chipBrands.length > 0 ? (
        <div className="mx-auto mt-2 max-w-6xl snap-x snap-mandatory overflow-x-auto overscroll-x-contain pb-0.5 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max gap-2 pr-3 sm:gap-1.5">
            {chipBrands.map((b) => {
              const qty = totals[b.key] ?? 0;
              const outOfStock = !loading && qty <= 0;
              return (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => onJumpToBrand?.(b.key)}
                  title={brandDisplayName(b)}
                  className={`inline-flex min-h-10 max-w-[12rem] shrink-0 snap-start touch-manipulation items-center gap-1.5 rounded-full bg-white px-3 py-2 text-left shadow-sm ring-1 sm:min-h-0 sm:px-2.5 sm:py-1.5 ${b.ring} ${
                    outOfStock ? 'opacity-55' : ''
                  }`}
                >
                  <span className={`truncate text-xs font-bold sm:text-[11px] ${b.iconBg.split(' ')[1]}`}>
                    {brandShortName(b)}
                  </span>
                  <span className="tabular-nums text-xs font-semibold text-slate-800">
                    {loading ? '—' : qty.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

const QtyControl = memo(function QtyControl({ value, available, disabled, label, onChange }) {
  const n = requestedBags(value);
  const setQty = (next) => {
    const clamped = Math.max(0, Math.min(available, next));
    onChange(clamped === 0 ? '' : String(clamped));
  };

  return (
    <div className="flex shrink-0 items-center justify-start gap-1.5 sm:justify-end sm:gap-1">
      <button
        type="button"
        disabled={disabled || n <= 0}
        aria-label={`Decrease ${label}`}
        onClick={() => setQty(n - 1)}
        className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-xl border border-slate-200 bg-white text-xl font-semibold leading-none text-slate-700 hover:bg-slate-50 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        enterKeyHint="done"
        autoComplete="off"
        placeholder="0"
        disabled={disabled}
        aria-label={`${label} bags`}
        value={value}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d]/g, '');
          if (raw === '') {
            onChange('');
            return;
          }
          setQty(requestedBags(raw));
        }}
        className="h-11 w-14 rounded-xl border border-slate-200 px-1 text-center text-base tabular-nums text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 sm:w-16"
      />
      <button
        type="button"
        disabled={disabled || n >= available}
        aria-label={`Increase ${label}`}
        onClick={() => setQty(n + 1)}
        className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-xl border border-slate-200 bg-white text-xl font-semibold leading-none text-slate-700 hover:bg-slate-50 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
});

const ProductQtyRow = memo(function ProductQtyRow({
  brand,
  available,
  value,
  loading,
  onQtyChange,
}) {
  const qty = requestedBags(value);
  const outOfStock = !loading && available <= 0;
  const selected = qty > 0;
  const name = brandDisplayName(brand);

  return (
    <div
      id={`unload-product-${brand.key}`}
      className={`flex scroll-mb-28 scroll-mt-28 flex-col gap-2 rounded-xl px-3 py-2.5 ring-1 sm:flex-row sm:items-center sm:gap-3 md:scroll-mt-32 ${
        selected
          ? 'bg-emerald-50/80 ring-emerald-200'
          : outOfStock
            ? 'bg-slate-50 ring-slate-100 opacity-75'
            : `bg-white ${brand.ring}`
      }`}
    >
      <div className="min-w-0 w-full flex-1">
        <p className={`break-words text-sm font-semibold leading-snug ${selected ? 'text-emerald-950' : 'text-slate-900'}`}>
          {name}
        </p>
        <p className="mt-0.5 text-[11px] font-medium text-slate-500">
          {loading ? '…' : outOfStock ? 'Out of stock' : `${available.toLocaleString()} in stock`}
          {selected ? ` · unloading ${qty.toLocaleString()}` : ''}
        </p>
      </div>
      <QtyControl
        value={value}
        available={available}
        disabled={outOfStock}
        label={name}
        onChange={(next) => onQtyChange(brand.key, next)}
      />
    </div>
  );
});

function brandLines(row, bagBrands) {
  return bagBrands
    .filter((b) => (Number(row[`${b.key}Bags`]) || 0) > 0)
    .map((b) => ({
      key: b.key,
      code: String(b.code ?? '').trim(),
      name: String(b.label ?? '').trim() || b.key,
      label: brandShortName(b),
      full: brandDisplayName(b),
      qty: Number(row[`${b.key}Bags`]),
    }));
}

function ReviewUnloadModal({
  open,
  editing,
  onEdit,
  onCancel,
  onConfirm,
  saving,
  error,
  shopLabel,
  date,
  driverSession,
  note,
  selectedLines,
  selectedBagTotal,
  customers,
  form,
  setForm,
  setBrandQty,
  stockByBrand,
  stockLoading,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !saving) onCancel();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, saving, onCancel]);

  if (!open) return null;

  const sortedShops = [...customers].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || '')),
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center p-3 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unload-review-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        aria-label="Close review"
        disabled={saving}
        onClick={() => {
          if (!saving) onCancel();
        }}
      />
      <div className="relative z-10 flex max-h-[min(90dvh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 sm:max-h-[min(88dvh,42rem)]">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Review</p>
          <h2 id="unload-review-title" className="mt-0.5 text-lg font-bold text-slate-900">
            {editing ? 'Edit request' : 'Confirm unload'}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {editing
              ? 'Change the shop, bags, or note, then confirm.'
              : 'Check these details before sending the request.'}
          </p>

          <div className="mt-4 space-y-3">
            <div className="rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Shop</p>
              {editing ? (
                <select
                  value={form.customerId}
                  onChange={(e) => setForm((f) => ({ ...f, customerId: e.target.value }))}
                  className="mt-1.5 w-full min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                >
                  <option value="">Select shop…</option>
                  {sortedShops.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="mt-1 break-words text-sm font-semibold text-slate-900">{shopLabel || '—'}</p>
              )}
            </div>

            <div className="rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Date</p>
              {editing && !driverSession ? (
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  className="mt-1.5 w-full min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              ) : (
                <p className="mt-1 text-sm font-semibold tabular-nums text-slate-900">{date || '—'}</p>
              )}
            </div>

            <div className="rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Bags</p>
                <p className="text-xs font-semibold tabular-nums text-emerald-700">
                  {selectedLines.length} product{selectedLines.length === 1 ? '' : 's'} · {selectedBagTotal.toLocaleString()} bags
                </p>
              </div>
              {selectedLines.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No bags entered.</p>
              ) : (
                <ul className="mt-2 divide-y divide-slate-200/80">
                  {selectedLines.map(({ brand, qty }) => (
                    <li
                      key={brand.key}
                      className="flex flex-col gap-2 py-2 first:pt-1 last:pb-0 sm:flex-row sm:items-center sm:gap-2"
                    >
                      <div className="min-w-0 w-full flex-1">
                        <p className="break-words text-sm font-semibold text-slate-900">{brandDisplayName(brand)}</p>
                        {!editing ? (
                          <p className="text-[11px] font-medium tabular-nums text-slate-500">{qty.toLocaleString()} bags</p>
                        ) : null}
                      </div>
                      {editing ? (
                        <QtyControl
                          value={form[`${brand.key}Bags`] ?? ''}
                          available={stockByBrand[brand.key] ?? 0}
                          disabled={stockLoading || (stockByBrand[brand.key] ?? 0) <= 0}
                          label={brandDisplayName(brand)}
                          onChange={(next) => setBrandQty(brand.key, next)}
                        />
                      ) : (
                        <p className="shrink-0 text-sm font-bold tabular-nums text-slate-900 sm:text-right">
                          {qty.toLocaleString()}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Note</p>
              {editing ? (
                <input
                  type="text"
                  value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="Vehicle, lorry, etc."
                  className="mt-1.5 w-full min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              ) : (
                <p className="mt-1 break-words text-sm text-slate-800">{note?.trim() ? note : '—'}</p>
              )}
            </div>
          </div>

          {error ? (
            <p className="mt-3 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-800 ring-1 ring-red-100" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-slate-100 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={onCancel}
              className="inline-flex min-h-11 touch-manipulation items-center justify-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            {!editing ? (
              <button
                type="button"
                disabled={saving}
                onClick={onEdit}
                className="inline-flex min-h-11 touch-manipulation items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
              >
                Edit
              </button>
            ) : null}
            <button
              type="button"
              disabled={saving}
              onClick={onConfirm}
              className="inline-flex min-h-11 touch-manipulation items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-md shadow-emerald-600/25 hover:bg-emerald-700 disabled:opacity-60"
            >
              {saving ? 'Submitting…' : editing ? 'Save & submit' : 'Confirm submit'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RecentUnloadsList({ recent, recentLoading, bagBrands, canPrint, onPrintBill }) {
  if (recentLoading) {
    return (
      <div className="mt-4 flex justify-center py-8">
        <LoadingSpinner labelHidden />
      </div>
    );
  }
  if (recent.length === 0) {
    return <p className="mt-3 text-sm text-slate-500">No unloads recorded yet.</p>;
  }
  return (
    <ul className="mt-3 divide-y divide-slate-100">
      {recent.map((row) => {
        const lines = brandLines(row, bagBrands);
        const extra = Math.max(0, lines.length - RECENT_BRAND_PREVIEW);
        const preview = lines.slice(0, RECENT_BRAND_PREVIEW);
        return (
          <li key={row.id} className="py-3 first:pt-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900 break-words">{row.customerName}</p>
                <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">
                  {row.date} · {totalBags(row, bagBrands).toLocaleString()} bags
                  {row.invoiceNumber ? (
                    <span className="ml-1 tabular-nums text-slate-400">· {row.invoiceNumber}</span>
                  ) : null}
                  {row.status ? <span className="ml-1 capitalize text-slate-400">· {row.status}</span> : null}
                  {row.driverName ? (
                    <>
                      <span className="hidden sm:inline"> · </span>
                      <span className="block sm:inline">{row.driverName}</span>
                    </>
                  ) : null}
                </p>
                {preview.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {preview.map((line) => (
                      <span
                        key={line.key}
                        title={line.full}
                        className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700"
                      >
                        <span className="truncate">{line.label}</span>
                        <span className="tabular-nums text-slate-500">{line.qty}</span>
                      </span>
                    ))}
                    {extra > 0 ? (
                      <span className="inline-flex items-center rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
                        +{extra} more
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {canPrint ? (
                <button
                  type="button"
                  onClick={() => onPrintBill(row)}
                  className="inline-flex min-h-9 shrink-0 touch-manipulation items-center rounded-lg border border-sky-200 bg-sky-50 px-2.5 text-[11px] font-semibold text-sky-800 hover:bg-sky-100"
                >
                  Print bill
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function UnloadPrintPreview({ row, bagBrands, index, total }) {
  const lines = brandLines(row, bagBrands);
  const bags = totalBags(row, bagBrands);
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Unloading invoice {index + 1} of {total}
        </p>
        <p className="mt-0.5 break-words text-sm font-semibold text-slate-900">{row.customerName || '—'}</p>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {row.date || '—'}
        {row.invoiceNumber ? <span className="ml-1 tabular-nums">· {row.invoiceNumber}</span> : null}
        {row.status ? <span className="ml-1 capitalize">· {row.status}</span> : null}
      </p>
      {lines.length > 0 ? (
        <div className="mt-2 overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
          <table className="w-full table-fixed text-left text-[11px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="w-[4.5rem] px-2 py-1.5 font-semibold">Code</th>
                <th className="px-2 py-1.5 font-semibold">Item name</th>
                <th className="w-14 px-2 py-1.5 text-right font-semibold">Items</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {lines.map((line) => (
                <tr key={line.key}>
                  <td className="truncate px-2 py-1.5 font-medium tabular-nums">{line.code || '—'}</td>
                  <td className="px-2 py-1.5">
                    <span className="line-clamp-2 break-words" title={line.full}>
                      {line.name}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{line.qty.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-900">
                <td className="px-2 py-1.5" colSpan={2}>
                  Total bags
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{bags.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-500">No items</p>
      )}
    </div>
  );
}

function PrintLastUnloadsModal({ open, rows, bagBrands, onCancel, onPrintOne, onPrintAll }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onCancel]);

  if (!open) return null;

  const count = rows.length;
  const title = count === 1 ? 'Print last unloading invoice' : `Print last ${count} unloading invoices`;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center p-3 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="print-last-unloads-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        aria-label="Close print last unloads"
        onClick={onCancel}
      />
      <div className="relative z-10 flex max-h-[min(90dvh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">Recent unloads</p>
          <h2 id="print-last-unloads-title" className="mt-0.5 text-lg font-bold text-slate-900">
            {title}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {count === 1
              ? 'Print the latest unloading invoice on the 80mm printer.'
              : 'Print the latest two unloading invoices, one after the other. Confirm each copy on the printer prompt.'}
          </p>
          <div className="mt-4 space-y-2.5">
            {rows.map((row, index) => (
              <div key={row.id || index} className="space-y-2">
                <UnloadPrintPreview row={row} bagBrands={bagBrands} index={index} total={count} />
                <button
                  type="button"
                  onClick={() => onPrintOne(row)}
                  className="inline-flex min-h-11 w-full touch-manipulation items-center justify-center rounded-xl border border-sky-200 bg-sky-50 px-4 text-sm font-semibold text-sky-800 hover:bg-sky-100"
                >
                  Print this unloading invoice
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="shrink-0 border-t border-slate-100 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex min-h-11 touch-manipulation items-center justify-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            {count > 1 ? (
              <button
                type="button"
                onClick={onPrintAll}
                className="inline-flex min-h-11 touch-manipulation items-center justify-center rounded-xl bg-sky-600 px-4 text-sm font-semibold text-white shadow-md shadow-sky-600/25 hover:bg-sky-700"
              >
                Print both invoices
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function UnloadsWorkspace() {
  const { brands: bagBrands } = useBagProducts();
  const shopName = useShopName();
  const { requestAutoPrint, requestPrint, showIndicator } = usePrinter();
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
  const [productQuery, setProductQuery] = useState('');
  const [productFilter, setProductFilter] = useState('in-stock');
  const [shopQuery, setShopQuery] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewEditing, setReviewEditing] = useState(false);
  const [reviewBrandKeys, setReviewBrandKeys] = useState([]);
  const [printLastOpen, setPrintLastOpen] = useState(false);

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

  useEffect(() => {
    if (!bagBrands.length) return;
    setForm((f) => mergeFormWithBrands(f, bagBrands));
  }, [bagBrands]);

  useEffect(() => {
    const onFocusIn = (e) => {
      const el = e.target;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) {
        setKeyboardOpen(true);
      }
    };
    const onFocusOut = () => {
      window.setTimeout(() => {
        const el = document.activeElement;
        if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'SELECT' && el.tagName !== 'TEXTAREA')) {
          setKeyboardOpen(false);
        }
      }, 0);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

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

  const selectedLines = useMemo(() => selectedLinesFromForm(form, bagBrands), [form, bagBrands]);
  const selectedBagTotal = useMemo(
    () => selectedLines.reduce((s, line) => s + line.qty, 0),
    [selectedLines],
  );
  const manyProducts = bagBrands.length >= SEARCH_PRODUCT_THRESHOLD;
  const manyShops = customers.length >= SEARCH_PRODUCT_THRESHOLD;

  const visibleBrands = useMemo(() => {
    const q = productQuery;
    const ranked = bagBrands.filter((b) => {
      const qty = requestedBags(form[`${b.key}Bags`]);
      const available = stockByBrand[b.key] ?? 0;
      if (productFilter === 'in-stock' && available <= 0 && qty <= 0) return false;
      if (productFilter === 'selected' && qty <= 0) return false;
      return rowMatchesQuery(q, [b.label, b.code, b.key, brandDisplayName(b), brandShortName(b)]);
    });
    return [...ranked].sort((a, b) => {
      const qa = requestedBags(form[`${a.key}Bags`]);
      const qb = requestedBags(form[`${b.key}Bags`]);
      if ((qa > 0) !== (qb > 0)) return qa > 0 ? -1 : 1;
      const sa = (stockByBrand[a.key] ?? 0) > 0 ? 1 : 0;
      const sb = (stockByBrand[b.key] ?? 0) > 0 ? 1 : 0;
      if (sa !== sb) return sb - sa;
      return 0;
    });
  }, [bagBrands, form, productFilter, productQuery, stockByBrand]);

  const setBrandQty = useCallback(
    (key, next) => {
      setForm((f) => {
        const available = stockByBrand[key] ?? 0;
        if (next === '') return { ...f, [`${key}Bags`]: '' };
        let n = requestedBags(next);
        if (n > available) n = available;
        return { ...f, [`${key}Bags`]: n === 0 ? '' : String(n) };
      });
    },
    [stockByBrand],
  );

  const jumpToBrand = useCallback((key) => {
    setProductFilter('all');
    setProductQuery('');
    window.setTimeout(() => {
      const el = document.getElementById(`unload-product-${key}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }, []);

  const handleSignOut = () => {
    clearAuth();
    window.location.reload();
  };

  const closeReview = useCallback(() => {
    if (saving) return;
    setReviewOpen(false);
    setReviewEditing(false);
    setReviewBrandKeys([]);
  }, [saving]);

  const lastPrintRows = useMemo(() => recent.slice(0, LAST_PRINT_COUNT), [recent]);

  const closePrintLast = useCallback(() => {
    setPrintLastOpen(false);
  }, []);

  const handlePrintUnloadBill = useCallback(
    (row) => {
      setPrintLastOpen(false);
      requestPrint('unload', row);
    },
    [requestPrint],
  );

  const handlePrintLastUnloads = useCallback(async () => {
    const rows = recent.slice(0, LAST_PRINT_COUNT);
    setPrintLastOpen(false);
    for (const row of rows) {
      await requestPrint('unload', row);
    }
  }, [recent, requestPrint]);

  const handleOpenReview = (e) => {
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

    setReviewBrandKeys(selectedLines.map((line) => line.brand.key));
    setReviewEditing(false);
    setReviewOpen(true);
  };

  const handleConfirmSubmit = async () => {
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
      setReviewOpen(false);
      setReviewEditing(false);
      setReviewBrandKeys([]);
      setSaveSuccess(
        `Request submitted (${totalBags(data, bagBrands).toLocaleString()} bag${totalBags(data, bagBrands) === 1 ? '' : 's'} for ${data.customerName || 'shop'}). The shop is notified if delivery messages are enabled. Waiting for manager approval — stock updates when approved.`,
      );
      setForm(emptyUnloadForm(bagBrands));
      setProductQuery('');
      setProductFilter('in-stock');
      await Promise.all([loadStock(), loadRecent()]);
      if (showIndicator) requestPrint('unload', data);
      else requestAutoPrint('unload', data);
    } catch {
      setSaveError('Network error. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const sortedCustomers = useMemo(() => {
    const list = [...customers].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    if (!manyShops || !shopQuery.trim()) return list;
    return list.filter((c) =>
      rowMatchesQuery(shopQuery, [c.name, c.id, c.phone, c.contact, c.address]),
    );
  }, [customers, manyShops, shopQuery]);

  const driverSession = isDriverAuthed();
  const displayDate = driverSession ? todayYmdLocal() : form.date;
  const selectedShop = customers.find((c) => c.id === form.customerId);

  const inputClass =
    'mt-1.5 w-full min-h-11 rounded-xl border border-slate-200 px-3 py-2.5 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20';

  const filterBtn = (id, label, count) => {
    const active = productFilter === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => setProductFilter(id)}
        className={`inline-flex min-h-11 flex-1 touch-manipulation items-center justify-center rounded-xl px-2 text-xs font-semibold ring-1 transition sm:flex-none sm:rounded-full sm:px-3 ${
          active
            ? 'bg-emerald-600 text-white ring-emerald-600'
            : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
        }`}
      >
        {label}
        {count != null ? <span className="ml-1 tabular-nums opacity-80">{count}</span> : null}
      </button>
    );
  };

  const inStockCount = bagBrands.filter((b) => (stockByBrand[b.key] ?? 0) > 0).length;

  const reviewLines = useMemo(() => {
    if (!reviewOpen || reviewBrandKeys.length === 0) return selectedLines;
    const keySet = new Set(reviewBrandKeys);
    return bagBrands
      .filter((b) => keySet.has(b.key))
      .map((brand) => ({ brand, qty: requestedBags(form[`${brand.key}Bags`]) }));
  }, [reviewOpen, reviewBrandKeys, selectedLines, bagBrands, form]);

  const reviewBagTotal = useMemo(
    () => reviewLines.reduce((s, line) => s + line.qty, 0),
    [reviewLines],
  );

  return (
    <div className="mx-auto flex min-h-0 min-w-0 w-full max-w-6xl flex-1 flex-col bg-slate-50">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-6 sm:py-3 lg:px-8">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 sm:text-xs">Unloads</p>
          <h1 className="truncate text-[15px] font-bold text-slate-900 sm:text-lg">{shopName}</h1>
          {isDriverAuthed() ? (
            <p className="truncate text-[11px] text-slate-500 sm:text-sm">Signed in as {driverLabel}</p>
          ) : (
            <p className="truncate text-[11px] text-slate-500 sm:text-sm">Admin session</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PrinterStatusButton />
          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex min-h-11 shrink-0 touch-manipulation items-center rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 active:scale-[0.98] sm:px-4"
          >
            Sign out
          </button>
        </div>
      </header>

      <StockStrip
        summaryBrands={summaryBrands}
        bagBrands={bagBrands}
        loading={stockLoading}
        onRefresh={loadStock}
        onJumpToBrand={jumpToBrand}
      />

      <div className="flex-1 px-3 py-4 pb-4 sm:px-6 sm:py-5 lg:px-8 lg:py-8">
        <div className="grid gap-4 md:gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start lg:gap-8">
          <form
            onSubmit={handleOpenReview}
            className="space-y-4 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-slate-100 sm:space-y-5 sm:p-6"
          >
            <div>
              <h2 className="text-base font-bold text-slate-900 sm:text-lg">Record unload</h2>
              <p className="mt-1 hidden text-sm leading-relaxed text-slate-500 sm:block">
                Choose the shop and enter bags unloaded. Your request goes to the manager for approval; stock and the credit bill are created after approval.
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 sm:hidden">
                Pick a shop, enter bags, then submit for manager approval.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
              <div className="block min-w-0">
                <label className="text-sm font-medium text-slate-700" htmlFor="unload-shop">
                  Shop
                </label>
                {manyShops ? (
                  <input
                    type="search"
                    value={shopQuery}
                    onChange={(e) => setShopQuery(e.target.value)}
                    placeholder="Search shops…"
                    className={`${inputClass} mb-2`}
                    aria-label="Search shops"
                  />
                ) : null}
                <select
                  id="unload-shop"
                  value={form.customerId}
                  onChange={(e) => setForm((f) => ({ ...f, customerId: e.target.value }))}
                  className={inputClass}
                  required
                >
                  <option value="">Select shop…</option>
                  {form.customerId && selectedShop && !sortedCustomers.some((c) => c.id === form.customerId) ? (
                    <option value={selectedShop.id}>{selectedShop.name}</option>
                  ) : null}
                  {sortedCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <label className="block min-w-0">
                <span className="text-sm font-medium text-slate-700">Date</span>
                {driverSession ? (
                  <p
                    className="mt-1.5 flex min-h-11 items-center rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-base tabular-nums text-slate-700"
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
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-slate-700">Bags by product</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {bagBrands.length.toLocaleString()} product{bagBrands.length === 1 ? '' : 's'}
                    {manyProducts ? ' — search or tap a stock chip to jump.' : '. Only in-stock items can be unloaded.'}
                  </p>
                </div>
                {selectedBagTotal > 0 ? (
                  <p className="text-xs font-semibold tabular-nums text-emerald-700">
                    {selectedLines.length} selected · {selectedBagTotal.toLocaleString()} bags
                  </p>
                ) : null}
              </div>

              {selectedLines.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selectedLines.map(({ brand, qty }) => (
                    <span
                      key={brand.key}
                      className="inline-flex max-w-full items-center gap-0.5 rounded-full bg-emerald-50 pl-2.5 pr-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200"
                    >
                      <button
                        type="button"
                        onClick={() => jumpToBrand(brand.key)}
                        className="inline-flex min-h-9 min-w-0 touch-manipulation items-center gap-1"
                        title={brandDisplayName(brand)}
                      >
                        <span className="truncate">{brandShortName(brand)}</span>
                        <span className="tabular-nums">{qty.toLocaleString()}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setBrandQty(brand.key, '')}
                        className="inline-flex h-9 w-9 touch-manipulation items-center justify-center rounded-full text-base text-emerald-700 hover:bg-emerald-100"
                        aria-label={`Clear ${brandDisplayName(brand)}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              {!stockLoading && !anyStockAvailable ? (
                <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-100" role="status">
                  No bags in stock right now.
                </p>
              ) : null}

              {manyProducts || bagBrands.length > 4 ? (
                <div className="mt-3 flex flex-col gap-2">
                  <input
                    type="search"
                    value={productQuery}
                    onChange={(e) => setProductQuery(e.target.value)}
                    placeholder="Search product or code…"
                    enterKeyHint="search"
                    className="min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    aria-label="Search products"
                  />
                  <div className="flex gap-1.5 sm:flex-wrap">
                    {filterBtn('in-stock', 'In stock', inStockCount)}
                    {filterBtn('selected', 'Selected', selectedLines.length)}
                    {filterBtn('all', 'All', bagBrands.length)}
                  </div>
                </div>
              ) : null}

              <div
                className={`mt-2 grid grid-cols-1 gap-1.5 md:grid-cols-2 lg:grid-cols-1 ${
                  bagBrands.length >= SCROLL_LIST_THRESHOLD
                    ? 'md:max-h-[min(32rem,56dvh)] md:overflow-y-auto md:overscroll-contain md:rounded-xl md:pr-0.5'
                    : ''
                }`}
              >
                {visibleBrands.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500 ring-1 ring-slate-100 md:col-span-2 lg:col-span-1">
                    {productFilter === 'selected'
                      ? 'No products selected yet.'
                      : productQuery.trim()
                        ? 'No products match that search.'
                        : 'No products to show.'}
                  </p>
                ) : (
                  visibleBrands.map((b) => (
                    <ProductQtyRow
                      key={b.key}
                      brand={b}
                      available={stockByBrand[b.key] ?? 0}
                      value={form[`${b.key}Bags`] ?? ''}
                      loading={stockLoading}
                      onQtyChange={setBrandQty}
                    />
                  ))
                )}
              </div>
              {manyProducts && visibleBrands.length > 0 ? (
                <p className="mt-1.5 text-[11px] tabular-nums text-slate-400">
                  Showing {visibleBrands.length} of {bagBrands.length}
                </p>
              ) : null}
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

            {saveError && !reviewOpen ? (
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

            <div className={`lg:hidden ${keyboardOpen ? 'h-2' : 'h-[5.5rem]'}`} aria-hidden />
            <div
              className={`border-t border-slate-200 bg-white/95 px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-white/90 lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none ${
                keyboardOpen
                  ? 'static'
                  : 'fixed inset-x-0 bottom-0 z-30'
              }`}
            >
              <button
                type="submit"
                disabled={saving || stockLoading || !anyStockAvailable}
                className="inline-flex min-h-12 w-full touch-manipulation items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-md shadow-emerald-600/25 hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
              >
                {saving
                  ? 'Saving…'
                  : selectedBagTotal > 0
                    ? `Submit request · ${selectedBagTotal.toLocaleString()} bags`
                    : 'Submit request'}
              </button>
            </div>
          </form>

          <details className="rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-slate-100 open:pb-4 lg:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none touch-manipulation items-center justify-between gap-3 text-base font-bold text-slate-900 [&::-webkit-details-marker]:hidden">
              Recent unloads
              <span className="text-xs font-semibold text-slate-400">
                {recentLoading ? '…' : `${recent.length}`}
              </span>
            </summary>
            {lastPrintRows.length > 0 ? (
              <button
                type="button"
                onClick={() => setPrintLastOpen(true)}
                className="mt-3 inline-flex min-h-11 w-full touch-manipulation items-center justify-center rounded-xl border border-sky-200 bg-sky-50 px-4 text-sm font-semibold text-sky-800 hover:bg-sky-100"
              >
                {lastPrintRows.length === 1 ? 'Print last bill' : 'Print last 2'}
              </button>
            ) : null}
            <RecentUnloadsList
              recent={recent}
              recentLoading={recentLoading}
              bagBrands={bagBrands}
              canPrint={showIndicator}
              onPrintBill={handlePrintUnloadBill}
            />
          </details>

          <section className="hidden rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100 sm:p-6 lg:block lg:sticky lg:top-[8.5rem] lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-bold text-slate-900 sm:text-lg">Recent unloads</h2>
              {lastPrintRows.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setPrintLastOpen(true)}
                  className="inline-flex min-h-10 shrink-0 touch-manipulation items-center rounded-xl border border-sky-200 bg-sky-50 px-3 text-xs font-semibold text-sky-800 hover:bg-sky-100"
                >
                  {lastPrintRows.length === 1 ? 'Print last bill' : 'Print last 2'}
                </button>
              ) : null}
            </div>
            <RecentUnloadsList
              recent={recent}
              recentLoading={recentLoading}
              bagBrands={bagBrands}
              canPrint={showIndicator}
              onPrintBill={handlePrintUnloadBill}
            />
          </section>
        </div>
      </div>

      <ReviewUnloadModal
        open={reviewOpen}
        editing={reviewEditing}
        onEdit={() => setReviewEditing(true)}
        onCancel={closeReview}
        onConfirm={handleConfirmSubmit}
        saving={saving}
        error={saveError}
        shopLabel={selectedShop?.name || ''}
        date={displayDate}
        driverSession={driverSession}
        note={form.note}
        selectedLines={reviewLines}
        selectedBagTotal={reviewBagTotal}
        customers={customers}
        form={form}
        setForm={setForm}
        setBrandQty={setBrandQty}
        stockByBrand={stockByBrand}
        stockLoading={stockLoading}
      />

      <PrintLastUnloadsModal
        open={printLastOpen}
        rows={lastPrintRows}
        bagBrands={bagBrands}
        onCancel={closePrintLast}
        onPrintOne={handlePrintUnloadBill}
        onPrintAll={handlePrintLastUnloads}
      />
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
