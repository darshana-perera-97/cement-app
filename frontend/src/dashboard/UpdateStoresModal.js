import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getApiBase } from '../apiBase';
import { authFetch } from '../auth';
import { distanceMeters, formatDistance, MAX_SHOP_UPDATE_DISTANCE_M } from './geoDistance';
import { LoadingSpinner, ModalBackdrop, modalPanelClassMd } from './tableToolbar';

const apiBase = getApiBase();

const fieldClass =
  'mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35';

export default function UpdateStoresModal({
  open,
  shops = [],
  allowedShopIds = null,
  userLocation = null,
  locationError = '',
  onClose,
  onSaved,
}) {
  const [shopId, setShopId] = useState('');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(null);
  const [stockDraft, setStockDraft] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const visibleShops = useMemo(() => {
    const allowed = allowedShopIds ? new Set(allowedShopIds) : null;
    const q = search.trim().toLowerCase();
    return (shops || []).filter((shop) => {
      if (allowed && !allowed.has(shop.id)) return false;
      if (!q) return true;
      return [shop.name, shop.location, shop.customerId].some((p) =>
        String(p ?? '')
          .toLowerCase()
          .includes(q),
      );
    });
  }, [shops, allowedShopIds, search]);

  const selectedShop = useMemo(
    () => (shops || []).find((s) => s.id === shopId) || null,
    [shops, shopId],
  );

  const distanceM = useMemo(() => {
    if (!selectedShop || !userLocation) return Infinity;
    return distanceMeters(userLocation.lat, userLocation.lng, selectedShop.lat, selectedShop.lng);
  }, [selectedShop, userLocation]);

  const tooFar = !userLocation || distanceM > MAX_SHOP_UPDATE_DISTANCE_M;
  const items = Array.isArray(detail?.items) ? detail.items : [];

  useEffect(() => {
    if (!open) return;
    setShopId('');
    setSearch('');
    setDetail(null);
    setStockDraft({});
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open || !shopId) {
      setDetail(null);
      setStockDraft({});
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    authFetch(`${apiBase}/api/shop-stocks/${encodeURIComponent(shopId)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not load shop stock');
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        const next = {};
        for (const item of data.items || []) {
          next[item.key] = '';
        }
        setStockDraft(next);
      })
      .catch((e) => {
        if (!cancelled) {
          setDetail(null);
          setError(e.message || 'Could not load shop stock');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, shopId]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!shopId || !selectedShop) {
      setError('Select a shop.');
      return;
    }
    if (!userLocation) {
      setError(locationError || 'Turn on location to update shop stock.');
      return;
    }
    if (tooFar) {
      setError(`You must be within ${MAX_SHOP_UPDATE_DISTANCE_M} m of the shop to update stock.`);
      return;
    }
    if (items.length === 0) {
      setError('This shop has no last unloaded items to update.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const stock = {};
      for (const item of items) {
        stock[item.key] = Math.max(0, parseInt(stockDraft[item.key], 10) || 0);
      }
      const res = await authFetch(`${apiBase}/api/shop-stocks/${encodeURIComponent(shopId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stock,
          lat: userLocation.lat,
          lng: userLocation.lng,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not save shop stock');
        return;
      }
      onSaved?.(data);
      onClose();
    } catch {
      setError('Could not reach the server');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[2000] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-stores-title"
    >
      <ModalBackdrop onClose={onClose} />
      <div className={`${modalPanelClassMd} z-[2001]`}>
        <h2 id="update-stores-title" className="text-lg font-bold text-slate-900">
          Update Stores
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Choose a shop, then set the current bags left from the last unload. You must be within{' '}
          {MAX_SHOP_UPDATE_DISTANCE_M} m of the shop.
        </p>
        <form className="mt-5 space-y-4" onSubmit={submit}>
          {error ? (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{error}</p>
          ) : null}
          {!userLocation ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-100">
              {locationError || 'Waiting for your current location…'}
            </p>
          ) : null}
          <label className="block text-sm font-medium text-slate-600">
            Search shops
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={fieldClass}
              placeholder="Name or area…"
            />
          </label>
          <label className="block text-sm font-medium text-slate-600">
            Shop
            <select
              required
              value={shopId}
              onChange={(e) => setShopId(e.target.value)}
              className={fieldClass}
            >
              <option value="">{visibleShops.length === 0 ? 'No shops available' : 'Select a shop…'}</option>
              {visibleShops.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name}
                  {shop.location ? ` — ${shop.location}` : ''}
                </option>
              ))}
            </select>
          </label>
          {selectedShop ? (
            <p className={`text-sm ${tooFar ? 'text-rose-700' : 'text-emerald-700'}`}>
              Distance: {userLocation ? formatDistance(distanceM) : '—'}
              {tooFar ? ` · must be within ${MAX_SHOP_UPDATE_DISTANCE_M} m` : ' · close enough to update'}
            </p>
          ) : null}
          {loading ? (
            <div className="flex justify-center py-4">
              <LoadingSpinner size="sm" label="Loading last unload…" />
            </div>
          ) : shopId && items.length === 0 ? (
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-100">
              No last unloaded items for this shop yet.
            </p>
          ) : items.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-700">
                Last unload
                {detail?.lastUnloadDate ? ` · ${detail.lastUnloadDate}` : ''}
              </p>
              {items.map((item) => (
                <label key={item.key} className="block text-sm font-medium text-slate-600">
                  {item.label}
                  <input
                    type="number"
                    min={0}
                    step={1}
                    disabled={tooFar || saving}
                    className={`${fieldClass} tabular-nums`}
                    value={stockDraft[item.key] ?? ''}
                    placeholder="Current stock"
                    onChange={(e) => {
                      const value = e.target.value;
                      setStockDraft((prev) => ({ ...prev, [item.key]: value }));
                    }}
                  />
                </label>
              ))}
            </div>
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
              disabled={saving || tooFar || items.length === 0 || !shopId}
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Update stock'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function formatUpdatedAt(iso) {
  if (!iso) return 'Not updated yet';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return 'Not updated yet';
  return dt.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ShopStockViewModal({ open, shop, stockRow = null, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !shop?.id) {
      setDetail(null);
      setError(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    authFetch(`${apiBase}/api/shop-stocks/${encodeURIComponent(shop.id)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not load shop stock');
        return data;
      })
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || 'Could not load shop stock');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, shop?.id]);

  if (!open || !shop) return null;

  const updatedAt = detail?.updatedAt || stockRow?.updatedAt || '';
  const rawItems = Array.isArray(detail?.items)
    ? detail.items
    : Array.isArray(stockRow?.items)
      ? stockRow.items
      : [];
  const items = updatedAt ? rawItems : [];

  return createPortal(
    <div
      className="fixed inset-0 z-[2000] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shop-stock-view-title"
    >
      <ModalBackdrop onClose={onClose} />
      <div className={`${modalPanelClassMd} z-[2001]`}>
        <h2 id="shop-stock-view-title" className="text-lg font-bold text-slate-900">
          {shop.name}
        </h2>
        <p className="mt-1 text-sm text-slate-500">{shop.location || 'Sri Lanka'}</p>
        <p className="mt-2 text-sm text-slate-600">
          Updated: <span className="font-semibold text-slate-900">{formatUpdatedAt(updatedAt)}</span>
        </p>
        {error ? (
          <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{error}</p>
        ) : null}
        {loading ? (
          <div className="mt-5 flex justify-center py-4">
            <LoadingSpinner size="sm" label="Loading stock…" />
          </div>
        ) : items.length === 0 ? (
          <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-100">
            No current stock recorded for this shop.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 rounded-xl bg-slate-50 px-3 ring-1 ring-slate-100">
            {items.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="font-medium text-slate-700">{item.label || item.key}</span>
                <span className="tabular-nums font-semibold text-slate-900">{Number(item.bags) || 0}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
