import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { getApiBase } from '../apiBase';
import { authFetch, isAdmin } from '../auth';
import { LoadingSpinner } from './tableToolbar';
import {
  EMPTY_PRINTER_SETTINGS,
  PRINTER_ROLE_OPTIONS,
  PRINTER_SCENARIOS,
  notifyPrinterSettingsChanged,
} from '../printer/printerSettings';

const apiBase = getApiBase();

const inputClass =
  'mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30';

function formFromSettings(data) {
  const src = data && typeof data === 'object' ? data : {};
  const scenarios = {};
  for (const item of PRINTER_SCENARIOS) {
    const row = src.scenarios?.[item.key] || {};
    scenarios[item.key] = {
      enabled: Boolean(row.enabled),
      copies: String(Math.max(1, Math.min(9, Number(row.copies) || 1))),
    };
  }
  return {
    enabled: Boolean(src.enabled),
    allowedRoles: Array.isArray(src.allowedRoles) && src.allowedRoles.length > 0 ? [...src.allowedRoles] : ['all'],
    scenarios,
  };
}

export default function SettingsPage() {
  const [form, setForm] = useState(() => formFromSettings(EMPTY_PRINTER_SETTINGS));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saveOk, setSaveOk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/printer-settings`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Failed to load printer settings');
        return;
      }
      setForm(formFromSettings(data));
    } catch {
      setError('Could not reach the server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!isAdmin()) {
    return <Navigate to="/dashboard/analytics" replace />;
  }

  const allRoles = form.allowedRoles.includes('all');

  const toggleRole = (key) => {
    setSaveOk(false);
    setForm((f) => {
      if (key === 'all') {
        return { ...f, allowedRoles: f.allowedRoles.includes('all') ? [] : ['all'] };
      }
      const withoutAll = f.allowedRoles.filter((r) => r !== 'all');
      const next = withoutAll.includes(key)
        ? withoutAll.filter((r) => r !== key)
        : [...withoutAll, key];
      return { ...f, allowedRoles: next };
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      const scenarios = {};
      for (const item of PRINTER_SCENARIOS) {
        const row = form.scenarios[item.key];
        scenarios[item.key] = {
          enabled: Boolean(row.enabled),
          copies: Math.max(1, Math.min(9, parseInt(row.copies, 10) || 1)),
        };
      }
      const res = await authFetch(`${apiBase}/api/printer-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: Boolean(form.enabled),
          allowedRoles: form.allowedRoles,
          scenarios,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || 'Could not save printer settings');
        return;
      }
      setForm(formFromSettings(data));
      notifyPrinterSettingsChanged();
      setSaveOk(true);
    } catch {
      setSaveError('Could not reach the server');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Admin-only controls for the 80mm Bluetooth XPrinter. Enable connection for selected roles, then choose what prints automatically after unload, cash collection, and bill generate.
      </p>

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
        <form onSubmit={handleSave} className="space-y-6">
          {saveError ? (
            <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
              {saveError}
            </p>
          ) : null}
          {saveOk ? (
            <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-100">
              Printer settings saved.
            </p>
          ) : null}

          <section className="rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-6">
            <h2 className="text-sm font-bold text-slate-900">Printer connection</h2>
            <p className="mt-1 text-sm text-slate-500">
              When enabled, allowed users see a Bluetooth printer indicator next to WhatsApp and can scan nearby printers.
            </p>
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50/90 p-4 ring-1 ring-slate-100">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/35"
                checked={form.enabled}
                onChange={(e) => {
                  setSaveOk(false);
                  setForm((f) => ({ ...f, enabled: e.target.checked }));
                }}
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900">Enable Bluetooth printer</span>
                <span className="mt-1 block text-sm leading-relaxed text-slate-600">
                  Allow pairing with an 80mm XPrinter over Bluetooth from this browser. Printing only happens when a printer is connected.
                </span>
              </span>
            </label>
          </section>

          <section className="rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-6">
            <h2 className="text-sm font-bold text-slate-900">Who can use the printer</h2>
            <p className="mt-1 text-sm text-slate-500">
              Choose collectors, drivers, managers, or all users. Admin can always connect when the printer is enabled.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {PRINTER_ROLE_OPTIONS.map((opt) => {
                const checked = form.allowedRoles.includes(opt.key);
                const disabled = opt.key !== 'all' && allRoles;
                return (
                  <label
                    key={opt.key}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl p-3 ring-1 ${
                      disabled ? 'bg-slate-50 text-slate-400 ring-slate-100' : 'bg-slate-50/90 ring-slate-100'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/35"
                      checked={checked || (opt.key !== 'all' && allRoles)}
                      disabled={disabled}
                      onChange={() => toggleRole(opt.key)}
                    />
                    <span className="text-sm font-semibold text-slate-900">{opt.label}</span>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-6">
            <h2 className="text-sm font-bold text-slate-900">Automatic printing</h2>
            <p className="mt-1 text-sm text-slate-500">
              For each scenario, turn printing on and set how many copies to ask for. Each copy waits for the user to confirm before it is sent.
            </p>
            <div className="mt-4 space-y-3">
              {PRINTER_SCENARIOS.map((item) => {
                const row = form.scenarios[item.key];
                return (
                  <div key={item.key} className="rounded-xl bg-slate-50/90 p-4 ring-1 ring-slate-100">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/35"
                        checked={row.enabled}
                        onChange={(e) => {
                          setSaveOk(false);
                          setForm((f) => ({
                            ...f,
                            scenarios: {
                              ...f.scenarios,
                              [item.key]: { ...f.scenarios[item.key], enabled: e.target.checked },
                            },
                          }));
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-slate-900">{item.label}</span>
                        <span className="mt-1 block text-sm leading-relaxed text-slate-600">{item.description}</span>
                      </span>
                    </label>
                    <label className="mt-3 block text-sm font-medium text-slate-600 sm:max-w-[12rem]">
                      Copies
                      <input
                        type="number"
                        min={1}
                        max={9}
                        className={inputClass}
                        disabled={!row.enabled}
                        value={row.copies}
                        onChange={(e) => {
                          setSaveOk(false);
                          setForm((f) => ({
                            ...f,
                            scenarios: {
                              ...f.scenarios,
                              [item.key]: { ...f.scenarios[item.key], copies: e.target.value },
                            },
                          }));
                        }}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
