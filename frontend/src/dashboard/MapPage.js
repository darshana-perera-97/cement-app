import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Navigate } from 'react-router-dom';
import { getApiBase } from '../apiBase';
import { authFetch, canAccessMap, getFirstAllowedDashboardPath, getUsername, isAdmin, isCollector, isDsr } from '../auth';
import { useStockUpdateEnabled } from '../stockUpdateSettings';
import SriLankaMap, { isInSriLanka } from './SriLankaMap';
import { parseGoogleMapsLocation } from './parseGoogleMapsLocation';
import UpdateStoresModal, { ShopStockViewModal } from './UpdateStoresModal';
import { LoadingSpinner, ModalBackdrop, modalPanelClassMd } from './tableToolbar';

const apiBase = getApiBase();

const fieldClass =
  'mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35';

function shopsSignature(list) {
  return JSON.stringify(
    (Array.isArray(list) ? list : [])
      .map((s) => ({
        id: s.id,
        customerId: s.customerId || '',
        name: s.name,
        lat: s.lat,
        lng: s.lng,
        location: s.location || '',
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
  );
}

function coordKey(lat, lng) {
  return `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
}

function duplicateShopError(list, shop, ignoreId = '') {
  const customerId = String(shop.customerId ?? '').trim();
  const key = coordKey(shop.lat, shop.lng);
  for (const row of list) {
    if (ignoreId && row.id === ignoreId) continue;
    if (customerId && String(row.customerId ?? '').trim() === customerId) {
      return 'This customer already has a map location.';
    }
    if (coordKey(row.lat, row.lng) === key) {
      return 'A shop is already pinned at this location.';
    }
  }
  return null;
}

async function saveMapShops(nextShops) {
  const updatedBy = getUsername().trim();
  if (!updatedBy) {
    throw new Error('Sign in to save map changes.');
  }
  const res = await authFetch(`${apiBase}/api/map-shops`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shops: nextShops, updatedBy }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Could not save shops');
  }
  return Array.isArray(data) ? data : nextShops;
}

const LOCATION_MODES = [
  { id: 'link', label: 'Map link' },
  { id: 'manual', label: 'Enter coords' },
  { id: 'map', label: 'Select on map' },
];

function ShopFormModal({ open, customers, existingShops, initialPoint, onClose, onAdd, onPickMap }) {
  const [customerId, setCustomerId] = useState('');
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState('link');
  const [mapsLink, setMapsLink] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [formError, setFormError] = useState(null);

  const takenIds = useMemo(() => {
    const set = new Set();
    for (const s of existingShops || []) {
      const id = String(s.customerId ?? s.id ?? '').trim();
      if (id) set.add(id);
    }
    return set;
  }, [existingShops]);

  const available = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (customers || []).filter((c) => {
      if (takenIds.has(c.id)) return false;
      if (!q) return true;
      return [c.id, c.name, c.location].some((p) => String(p ?? '').toLowerCase().includes(q));
    });
  }, [customers, takenIds, search]);

  useEffect(() => {
    if (!open) return;
    setCustomerId('');
    setSearch('');
    setFormError(null);
    setMapsLink('');
    if (initialPoint && isInSriLanka(initialPoint.lat, initialPoint.lng)) {
      setMode('manual');
      setLat(Number(initialPoint.lat).toFixed(6));
      setLng(Number(initialPoint.lng).toFixed(6));
    } else {
      setMode('link');
      setLat('');
      setLng('');
    }
  }, [open, initialPoint?.lat, initialPoint?.lng]);

  if (!open) return null;

  const selectedCustomer = (customers || []).find((c) => c.id === customerId) || null;
  const parsedLink = mode === 'link' ? parseGoogleMapsLocation(mapsLink) : null;

  const addAtCoords = (nextLat, nextLng, emptyMessage) => {
    if (!isInSriLanka(nextLat, nextLng)) {
      setFormError(emptyMessage);
      return;
    }
    const shop = {
      id: selectedCustomer.id,
      customerId: selectedCustomer.id,
      name: selectedCustomer.name,
      location: String(selectedCustomer.location ?? '').trim(),
      lat: nextLat,
      lng: nextLng,
      createdAt: new Date().toISOString(),
    };
    const dup = duplicateShopError(existingShops, shop);
    if (dup) {
      setFormError(dup);
      return;
    }
    onAdd(shop);
  };

  const submit = (e) => {
    e.preventDefault();
    setFormError(null);
    if (!selectedCustomer) {
      setFormError('Select a shop from the customer list.');
      return;
    }
    if (mode === 'map') {
      onPickMap({
        customerId: selectedCustomer.id,
        name: selectedCustomer.name,
        location: String(selectedCustomer.location ?? '').trim(),
      });
      return;
    }
    if (mode === 'link') {
      if (!parsedLink) {
        setFormError(
          'Paste a Google Maps link that includes coordinates, like https://maps.google.com/?q=7.492831,79.916214',
        );
        return;
      }
      addAtCoords(
        parsedLink.lat,
        parsedLink.lng,
        'That pin is outside Sri Lanka. Use a location on the island.',
      );
      return;
    }
    addAtCoords(Number(lat), Number(lng), 'Enter a latitude and longitude inside Sri Lanka.');
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[2000] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="map-shop-title"
    >
      <ModalBackdrop onClose={onClose} />
      <div className={`${modalPanelClassMd} z-[2001]`}>
        <h2 id="map-shop-title" className="text-lg font-bold text-slate-900">
          Add a shop
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {initialPoint
            ? 'This pin is already set from the map. Choose the customer shop and save.'
            : 'Choose a customer shop, then paste a Google Maps link, enter coordinates, or pick the pin on the map.'}
        </p>
        <form className="mt-5 space-y-4" onSubmit={submit}>
          {formError ? (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{formError}</p>
          ) : null}
          <label className="block text-sm font-medium text-slate-600">
            Search customers
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={fieldClass}
              placeholder="Name, ID, area…"
            />
          </label>
          <label className="block text-sm font-medium text-slate-600">
            Shop
            <select
              required
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className={fieldClass}
            >
              <option value="">{available.length === 0 ? 'No unused shops left' : 'Select a customer shop…'}</option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.location ? ` — ${c.location}` : ''}
                </option>
              ))}
            </select>
          </label>
          <div>
            <p className="text-sm font-medium text-slate-600">Location</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {LOCATION_MODES.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMode(opt.id)}
                  className={`rounded-xl px-2 py-2.5 text-xs font-semibold sm:text-sm ${
                    mode === opt.id
                      ? 'bg-indigo-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          {mode === 'link' ? (
            <label className="block text-sm font-medium text-slate-600">
              Google Maps link
              <input
                type="text"
                required={mode === 'link'}
                value={mapsLink}
                onChange={(e) => {
                  setMapsLink(e.target.value);
                  setFormError(null);
                }}
                className={fieldClass}
                placeholder="https://maps.google.com/?q=7.492831,79.916214"
                autoComplete="off"
                inputMode="url"
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                {parsedLink
                  ? isInSriLanka(parsedLink.lat, parsedLink.lng)
                    ? `Pin: ${parsedLink.lat.toFixed(6)}, ${parsedLink.lng.toFixed(6)}`
                    : 'That pin is outside Sri Lanka. Use a location on the island.'
                  : 'Paste a maps.google.com link with coordinates. Short goo.gl links need the full ?q=lat,lng URL.'}
              </span>
            </label>
          ) : mode === 'manual' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-600">
                Latitude
                <input
                  required={mode === 'manual'}
                  inputMode="decimal"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  className={`${fieldClass} tabular-nums`}
                  placeholder="7.8731"
                />
              </label>
              <label className="block text-sm font-medium text-slate-600">
                Longitude
                <input
                  required={mode === 'manual'}
                  inputMode="decimal"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  className={`${fieldClass} tabular-nums`}
                  placeholder="80.7718"
                />
              </label>
            </div>
          ) : (
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-100">
              After Continue, tap the Sri Lanka map to drop this shop’s pin.
            </p>
          )}
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
              disabled={available.length === 0}
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {mode === 'map' ? 'Continue' : 'Add shop'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function MapEditor({ shops, customers, onClose, onSaved }) {
  const [drafts, setDrafts] = useState(shops);
  const [selectedId, setSelectedId] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [clickedPoint, setClickedPoint] = useState(null);
  const [pendingShop, setPendingShop] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveNote, setSaveNote] = useState(null);

  const placingLockRef = useRef(0); // ignore the click that closes Add a shop

  useEffect(() => {
    setDrafts(shops);
  }, [shops]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (formOpen) {
        setFormOpen(false);
        return;
      }
      if (pendingShop) {
        setPendingShop(null);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, formOpen, pendingShop]);

  const dirty = shopsSignature(drafts) !== shopsSignature(shops);
  const selected = drafts.find((s) => s.id === selectedId) || null;
  const placing = Boolean(pendingShop);

  const persistShops = useCallback(
    async (nextShops) => {
      setSaving(true);
      setSaveError(null);
      setSaveNote(null);
      try {
        const saved = await saveMapShops(nextShops);
        setDrafts(saved);
        onSaved?.(saved);
        setSaveNote('Saved to shopLocations.json');
        window.setTimeout(() => setSaveNote(null), 2500);
        return true;
      } catch (e) {
        setSaveError(e.message || 'Could not reach server');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [onSaved],
  );

  const handleMapClick = useCallback(
    (point) => {
      if (formOpen) return;
      if (Date.now() < placingLockRef.current) return;
      const lat = Number(point?.lat);
      const lng = Number(point?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      if (!isInSriLanka(lat, lng)) {
        setSaveError('That pin is outside Sri Lanka. Tap on the island.');
        return;
      }
      if (pendingShop) {
        const shop = {
          id: pendingShop.customerId,
          customerId: pendingShop.customerId,
          name: pendingShop.name,
          location: pendingShop.location,
          lat,
          lng,
          createdAt: new Date().toISOString(),
        };
        const dup = duplicateShopError(drafts, shop);
        if (dup) {
          setSaveError(dup);
          return;
        }
        const next = [...drafts, shop];
        setDrafts(next);
        setPendingShop(null);
        setSelectedId(shop.id);
        persistShops(next);
        return;
      }
      const coordDup = duplicateShopError(drafts, { lat, lng, customerId: '' });
      if (coordDup) {
        setSaveError(coordDup);
        return;
      }
      setSelectedId('');
      setSaveError(null);
      setClickedPoint({ lat, lng });
      setFormOpen(true);
    },
    [pendingShop, drafts, formOpen, persistShops],
  );

  return (
    <div className="fixed inset-0 z-[110] flex flex-col bg-slate-950">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 py-3 sm:px-4">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
        >
          Close
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-white sm:text-base">Edit map</h2>
          <p className="text-[11px] text-slate-400 sm:text-xs">
            Paste a Google Maps link, enter coordinates, or tap the map
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setClickedPoint(null);
            setFormOpen(true);
            setPendingShop(null);
            setSelectedId('');
            setSaveError(null);
          }}
          className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-100 shadow-sm hover:bg-slate-700"
        >
          Add a shop
        </button>
        <button
          type="button"
          onClick={() => persistShops(drafts)}
          disabled={saving || !dirty}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      {placing ? (
        <p className="shrink-0 bg-teal-950 px-4 py-2 text-sm text-teal-100">
          Tap the map to place {pendingShop?.name || 'the shop'}. Stay inside Sri Lanka.
        </p>
      ) : null}
      {saveError ? (
        <p className="shrink-0 bg-red-950 px-4 py-2 text-sm text-red-100" role="alert">
          {saveError}
        </p>
      ) : saveNote ? (
        <p className="shrink-0 bg-emerald-950 px-4 py-2 text-sm text-emerald-100">{saveNote}</p>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden bg-slate-200">
        <SriLankaMap
          shops={drafts}
          selectedId={selectedId}
          placing={!formOpen}
          layoutKey={`${formOpen ? 'form' : 'map'}-${placing ? '1' : '0'}-${saveError ? '1' : '0'}`}
          onSelect={(shop) => {
            setSelectedId(shop.id);
          }}
          onMapClick={handleMapClick}
        />
        {selected && !placing && !formOpen ? (
          <div className="absolute bottom-4 left-4 right-4 z-[500] rounded-2xl bg-white p-4 shadow-xl ring-1 ring-slate-200 sm:left-auto sm:w-80">
            <p className="font-semibold text-slate-900">{selected.name}</p>
            <p className="mt-1 text-sm text-slate-500">{selected.location || 'Sri Lanka'}</p>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                if (!window.confirm(`Remove ${selected.name} from the map?`)) return;
                const next = drafts.filter((s) => s.id !== selected.id);
                setDrafts(next);
                setSelectedId('');
                persistShops(next);
              }}
              className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              Remove shop
            </button>
          </div>
        ) : null}
      </div>

      <ShopFormModal
        open={formOpen}
        customers={customers}
        existingShops={drafts}
        initialPoint={clickedPoint}
        onClose={() => {
          setFormOpen(false);
          setClickedPoint(null);
        }}
        onAdd={(shop) => {
          const next = [...drafts, shop];
          setDrafts(next);
          setFormOpen(false);
          setClickedPoint(null);
          setPendingShop(null);
          setSelectedId(shop.id);
          persistShops(next);
        }}
        onPickMap={(details) => {
          setFormOpen(false);
          setClickedPoint(null);
          setSaveError(null);
          placingLockRef.current = Date.now() + 400;
          window.setTimeout(() => {
            setPendingShop(details);
          }, 50);
        }}
      />
    </div>
  );
}

export default function MapPage() {
  const [shops, setShops] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [removingId, setRemovingId] = useState('');
  const [removeError, setRemoveError] = useState(null);
  const { enabled: stockUpdateEnabled, staleDays, lowStockAlerts, ready: stockUpdateReady } = useStockUpdateEnabled();
  const canEditMap = isAdmin();
  const canViewMap = isAdmin() || (stockUpdateEnabled && canAccessMap());
  const canUpdateStores = !canEditMap && stockUpdateEnabled && (isCollector() || isDsr());
  const [updateOpen, setUpdateOpen] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [locationError, setLocationError] = useState('');
  const [followUser, setFollowUser] = useState(false);
  const [shopStocks, setShopStocks] = useState([]);
  const [allowedShopIds, setAllowedShopIds] = useState(null);
  const [adminStockOpen, setAdminStockOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const shopRes = await fetch(`${apiBase}/api/map-shops`);
      if (!shopRes.ok) throw new Error('Failed to load shop locations');
      const shopData = await shopRes.json();
      setShops(Array.isArray(shopData) ? shopData : []);
      if (isAdmin()) {
        const custRes = await authFetch(`${apiBase}/api/customers`);
        if (custRes.ok) {
          const custData = await custRes.json();
          setCustomers(Array.isArray(custData) ? custData : []);
        } else {
          setCustomers([]);
        }
      } else {
        setCustomers([]);
      }
    } catch (e) {
      setError(e.message || 'Could not load shops');
      setShops([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadShopStocks = useCallback(async () => {
    try {
      const res = await authFetch(`${apiBase}/api/shop-stocks`);
      if (!res.ok) {
        setShopStocks([]);
        setAllowedShopIds(null);
        return;
      }
      const data = await res.json();
      setShopStocks(Array.isArray(data.stocks) ? data.stocks : []);
      setAllowedShopIds(Array.isArray(data.allowedShopIds) ? data.allowedShopIds : null);
    } catch {
      setShopStocks([]);
      setAllowedShopIds(null);
    }
  }, []);

  useEffect(() => {
    if (!canViewMap) return;
    loadShopStocks();
  }, [canViewMap, loadShopStocks]);

  useEffect(() => {
    if (!canUpdateStores || typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationError(canUpdateStores ? 'Location is not available in this browser.' : '');
      return undefined;
    }
    setLocationError('');
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude);
        const lng = Number(pos.coords.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        setUserLocation((prev) => {
          if (!prev) setFollowUser(true);
          return {
            lat,
            lng,
            accuracy: Number(pos.coords.accuracy) || 0,
          };
        });
        setLocationError('');
      },
      (err) => {
        setLocationError(err?.message || 'Allow location access to update shop stock.');
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [canUpdateStores]);

  useEffect(() => {
    if (!userLocation || !followUser) return undefined;
    const t = window.setTimeout(() => setFollowUser(false), 1200);
    return () => window.clearTimeout(t);
  }, [userLocation, followUser]);

  const stockByShopId = useMemo(() => {
    const map = {};
    for (const row of shopStocks) {
      if (row?.shopId) map[row.shopId] = row;
    }
    return map;
  }, [shopStocks]);

  const selected = useMemo(
    () => shops.find((s) => s.id === selectedId) || null,
    [shops, selectedId],
  );

  const handleRemoveShop = useCallback(
    async (shop) => {
      if (!shop?.id) return;
      if (!window.confirm(`Remove ${shop.name} from the map? This cannot be undone.`)) return;
      const next = shops.filter((s) => s.id !== shop.id);
      setRemovingId(shop.id);
      setRemoveError(null);
      try {
        const saved = await saveMapShops(next);
        setShops(saved);
        if (selectedId === shop.id) setSelectedId('');
      } catch (e) {
        setRemoveError(e.message || 'Could not remove shop');
      } finally {
        setRemovingId('');
      }
    },
    [shops, selectedId],
  );

  if (!isAdmin() && !stockUpdateReady) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!canViewMap) {
    return <Navigate to={getFirstAllowedDashboardPath()} replace />;
  }

  if (editing && canEditMap) {
    return (
        <MapEditor
          shops={shops}
          customers={customers}
          onClose={() => setEditing(false)}
        onSaved={(next) => {
          setShops(next);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-500">
          {canEditMap
            ? 'Sri Lanka map of your shops. Hover a pin to see the last stock update, or select a shop for details.'
            : 'Sri Lanka map of your shops. Your location is shown on the map. Use Update Stores to record shop stock.'}
        </p>
        {canEditMap ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
          >
            Edit
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-[20px] bg-white shadow-lg shadow-slate-200/40 ring-1 ring-slate-100">
        <div className="relative h-[min(70vh,36rem)] min-h-[22rem] w-full overflow-hidden bg-slate-200">
          <SriLankaMap
            shops={shops}
            selectedId={selectedId}
            onSelect={(shop) => {
              setSelectedId(shop.id);
              if (canEditMap) setAdminStockOpen(true);
            }}
            userLocation={canUpdateStores ? userLocation : null}
            followUser={canUpdateStores && followUser}
            stockByShopId={stockByShopId}
            showStockHover={canEditMap}
            staleDays={staleDays}
            lowStockAlerts={lowStockAlerts}
          />
          {loading ? (
            <div className="absolute right-3 top-3 z-[500] rounded-xl bg-white/90 px-3 py-2 shadow-sm ring-1 ring-slate-200">
              <LoadingSpinner size="sm" label="Loading shops…" />
            </div>
          ) : null}
          {canUpdateStores ? (
            <button
              type="button"
              onClick={() => setUpdateOpen(true)}
              className="absolute bottom-4 right-4 z-[500] rounded-full bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 hover:bg-indigo-500"
            >
              Update Stores
            </button>
          ) : null}
        </div>
      </section>
      {canEditMap ? (
        <ShopStockViewModal
          open={adminStockOpen}
          shop={selected}
          stockRow={selected ? stockByShopId[selected.id] : null}
          onClose={() => setAdminStockOpen(false)}
        />
      ) : null}
      {canUpdateStores ? (
        <UpdateStoresModal
          open={updateOpen}
          shops={shops}
          allowedShopIds={allowedShopIds}
          userLocation={userLocation}
          locationError={locationError}
          onClose={() => setUpdateOpen(false)}
          onSaved={(saved) => {
            if (!saved?.shopId) {
              loadShopStocks();
              return;
            }
            setShopStocks((prev) => {
              const next = prev.filter((row) => row.shopId !== saved.shopId);
              next.push({
                shopId: saved.shopId,
                customerId: saved.customerId,
                name: saved.name,
                items: saved.items,
                updatedAt: saved.updatedAt,
              });
              return next;
            });
          }}
        />
      ) : null}

      {canEditMap ? (
      <section className="rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-6">
        <h2 className="text-sm font-bold text-slate-900">Shops on the map</h2>
        {removeError ? (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100" role="alert">
            {removeError}
          </p>
        ) : null}
        {shops.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No shops pinned yet. Tap Edit, then Add a shop.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {shops.map((shop) => {
              const active = shop.id === selectedId;
              const removing = removingId === shop.id;
              return (
                <li key={shop.id} className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(shop.id);
                      setAdminStockOpen(true);
                    }}
                    className={`flex min-w-0 flex-1 items-start justify-between gap-3 px-1 py-3 text-left ${
                      active ? 'text-indigo-700' : 'text-slate-700'
                    }`}
                  >
                    <span>
                      <span className="block font-semibold text-slate-900">{shop.name}</span>
                      <span className="mt-0.5 block text-sm text-slate-500">{shop.location || 'Sri Lanka'}</span>
                    </span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-slate-400">
                      {Number(shop.lat).toFixed(3)}, {Number(shop.lng).toFixed(3)}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(removingId)}
                    onClick={() => handleRemoveShop(shop)}
                    className="mt-2 shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                  >
                    {removing ? 'Removing…' : 'Remove'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {selected ? (
          <p className="mt-2 text-xs text-slate-400">Selected: {selected.name}</p>
        ) : null}
      </section>
      ) : null}
    </div>
  );
}
