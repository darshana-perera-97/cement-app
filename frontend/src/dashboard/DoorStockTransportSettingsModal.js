import { useEffect, useState } from 'react';
import { getApiBase } from '../apiBase';
import {
  EMPTY_BRAND_DOOR_STOCK_SETTINGS,
  EMPTY_DOOR_STOCK_TRANSPORT_SETTINGS,
  normalizeDoorStockTransportSettings,
} from './doorStockTransportSettings';
import { LoadingSpinner, filterControl, modalPanelClass2xl, ModalBackdrop } from './tableToolbar';

const apiBase = getApiBase();

export { EMPTY_DOOR_STOCK_TRANSPORT_SETTINGS };

function settingsFromSource(source, brands) {
  return normalizeDoorStockTransportSettings(source, brands);
}

export default function DoorStockTransportSettingsModal({
  open,
  brands,
  settings,
  onClose,
  onSaved,
}) {
  const [form, setForm] = useState(() => settingsFromSource(settings, brands));
  const [activeBrandKey, setActiveBrandKey] = useState(() => brands[0]?.key || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      const next = settingsFromSource(settings, brands);
      setForm(next);
      setActiveBrandKey((prev) => {
        if (prev && brands.some((b) => b.key === prev)) return prev;
        return brands[0]?.key || '';
      });
      setError(null);
    }
  }, [open, settings, brands]);

  if (!open) return null;

  const activeBrand = brands.find((b) => b.key === activeBrandKey) || brands[0] || null;
  const activeSettings =
    (activeBrand && form.brandSettings?.[activeBrand.key]) || { ...EMPTY_BRAND_DOOR_STOCK_SETTINGS };

  const setBrandField = (brandKey, field, value) => {
    setForm((f) => ({
      ...f,
      brandSettings: {
        ...f.brandSettings,
        [brandKey]: {
          ...(f.brandSettings[brandKey] || { ...EMPTY_BRAND_DOOR_STOCK_SETTINGS }),
          [field]: value,
        },
      },
      brandLocations: {
        ...f.brandLocations,
        [brandKey]: {
          ...(f.brandLocations?.[brandKey] || { from: '', to: '' }),
          ...(field === 'from' || field === 'to' ? { [field]: value } : {}),
        },
      },
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = normalizeDoorStockTransportSettings(form, brands);
      const res = await fetch(`${apiBase}/api/shop/door-stock-transport-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Save failed');
        return;
      }
      onSaved?.(data);
      onClose();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <ModalBackdrop onClose={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="door-step-settings-title"
        className={`${modalPanelClass2xl} max-h-[92vh] overflow-y-auto`}
      >
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
          <h2 id="door-step-settings-title" className="text-lg font-semibold text-slate-900">
            Door step transport settings
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Configure letterhead, client, destinations, and bank details separately for each product.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-5 py-4 sm:px-6">
          {brands.length === 0 ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-100">
              No bag types configured under Shop yet.
            </p>
          ) : (
            <>
              <div
                className="rounded-[20px] bg-white p-2 ring-1 ring-slate-100"
                role="tablist"
                aria-label="Product settings"
              >
                <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                  {brands.map((b) => {
                    const active = activeBrand?.key === b.key;
                    return (
                      <button
                        key={b.key}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setActiveBrandKey(b.key)}
                        className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
                          active
                            ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100'
                            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                        }`}
                      >
                        {b.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {activeBrand ? (
                <div role="tabpanel" className="space-y-5">
                  <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
                    <h3 className="text-sm font-semibold text-slate-800">Transport company (letterhead)</h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="block text-sm sm:col-span-2">
                        <span className="font-medium text-slate-700">Company name</span>
                        <input
                          type="text"
                          value={activeSettings.companyName}
                          onChange={(e) => setBrandField(activeBrand.key, 'companyName', e.target.value)}
                          placeholder="e.g. ABC Transport Co."
                          className={`${filterControl} mt-1.5`}
                        />
                      </label>
                      <label className="block text-sm sm:col-span-2">
                        <span className="font-medium text-slate-700">Address</span>
                        <input
                          type="text"
                          value={activeSettings.companyAddress}
                          onChange={(e) => setBrandField(activeBrand.key, 'companyAddress', e.target.value)}
                          placeholder="e.g. 123 Main Street, City"
                          className={`${filterControl} mt-1.5`}
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="font-medium text-slate-700">Telephone</span>
                        <input
                          type="text"
                          value={activeSettings.companyTel}
                          onChange={(e) => setBrandField(activeBrand.key, 'companyTel', e.target.value)}
                          placeholder="e.g. 077 123 4567"
                          className={`${filterControl} mt-1.5`}
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="font-medium text-slate-700">Next invoice no. (export)</span>
                        <input
                          type="text"
                          value={activeSettings.nextInvoiceNumber}
                          onChange={(e) => setBrandField(activeBrand.key, 'nextInvoiceNumber', e.target.value)}
                          placeholder="e.g. 1001"
                          className={`${filterControl} mt-1.5`}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
                    <h3 className="text-sm font-semibold text-slate-800">Client (bill to)</h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="block text-sm sm:col-span-2">
                        <span className="font-medium text-slate-700">Client name</span>
                        <input
                          type="text"
                          value={activeSettings.clientName}
                          onChange={(e) => setBrandField(activeBrand.key, 'clientName', e.target.value)}
                          placeholder="e.g. Client Company (Pvt) Ltd"
                          className={`${filterControl} mt-1.5`}
                        />
                      </label>
                      <label className="block text-sm sm:col-span-2">
                        <span className="font-medium text-slate-700">Client address</span>
                        <textarea
                          rows={2}
                          value={activeSettings.clientAddress}
                          onChange={(e) => setBrandField(activeBrand.key, 'clientAddress', e.target.value)}
                          placeholder="e.g. P.O. Box 123, City"
                          className={`${filterControl} mt-1.5 resize-y`}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-indigo-50/50 p-4 ring-1 ring-indigo-100">
                    <h3 className="text-sm font-semibold text-indigo-900">Destinations</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Starting and end locations used on door step exports for {activeBrand.label}.
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="block text-sm">
                        <span className="font-medium text-slate-700">Starting</span>
                        <input
                          type="text"
                          value={activeSettings.from}
                          onChange={(e) => setBrandField(activeBrand.key, 'from', e.target.value)}
                          placeholder="e.g. Warehouse A"
                          className={`${filterControl} mt-1.5`}
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="font-medium text-slate-700">End</span>
                        <input
                          type="text"
                          value={activeSettings.to}
                          onChange={(e) => setBrandField(activeBrand.key, 'to', e.target.value)}
                          placeholder="e.g. Depot B"
                          className={`${filterControl} mt-1.5`}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
                    <h3 className="text-sm font-semibold text-slate-800">Bank account</h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="block text-sm">
                        <span className="font-medium text-slate-700">Account name</span>
                        <input
                          type="text"
                          value={activeSettings.bankAccountName}
                          onChange={(e) => setBrandField(activeBrand.key, 'bankAccountName', e.target.value)}
                          placeholder="e.g. ABC Transport Co."
                          className={`${filterControl} mt-1.5`}
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="font-medium text-slate-700">Account number</span>
                        <input
                          type="text"
                          value={activeSettings.bankAccountNumber}
                          onChange={(e) => setBrandField(activeBrand.key, 'bankAccountNumber', e.target.value)}
                          placeholder="e.g. 1234567890"
                          className={`${filterControl} mt-1.5`}
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="font-medium text-slate-700">Bank</span>
                        <input
                          type="text"
                          value={activeSettings.bankName}
                          onChange={(e) => setBrandField(activeBrand.key, 'bankName', e.target.value)}
                          placeholder="e.g. Sample Bank"
                          className={`${filterControl} mt-1.5`}
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="font-medium text-slate-700">Branch</span>
                        <input
                          type="text"
                          value={activeSettings.bankBranch}
                          onChange={(e) => setBrandField(activeBrand.key, 'bankBranch', e.target.value)}
                          placeholder="e.g. Main Branch"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          )}

          {error ? (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || brands.length === 0}
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03] disabled:opacity-60"
            >
              {saving ? <LoadingSpinner label="Saving…" size="sm" /> : 'Save settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
