import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { getApiBase } from '../apiBase';
import { authFetch, isAdmin } from '../auth';
import {
  LoadingSpinner,
  MobileRowCard,
  mobileCardList,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
} from './tableToolbar';
import {
  EMPTY_PRINTER_SETTINGS,
  PRINTER_ROLE_OPTIONS,
  PRINTER_SCENARIOS,
  notifyPrinterSettingsChanged,
} from '../printer/printerSettings';

const apiBase = getApiBase();

const inputClass =
  'mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30';

function formatBackupAt(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatEmails(emails) {
  return Array.isArray(emails) && emails.length > 0 ? emails.join(', ') : '—';
}

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
  const [backupEmails, setBackupEmails] = useState('');
  const [backupScheduleEnabled, setBackupScheduleEnabled] = useState(false);
  const [backupScheduleTime, setBackupScheduleTime] = useState('22:00');
  const [backupStatus, setBackupStatus] = useState({ smtpConfigured: false, shopName: '' });
  const [backupHistory, setBackupHistory] = useState([]);
  const [backupSaving, setBackupSaving] = useState(false);
  const [backupSending, setBackupSending] = useState(false);
  const [backupError, setBackupError] = useState(null);
  const [backupOk, setBackupOk] = useState(null);

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

  const loadBackupStatus = useCallback(async () => {
    try {
      const res = await authFetch(`${apiBase}/api/backup/status`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setBackupStatus({
        smtpConfigured: Boolean(data.smtpConfigured),
        shopName: String(data.shopName || '').trim(),
      });
      const savedEmails = Array.isArray(data.settings?.emails) ? data.settings.emails : [];
      setBackupEmails(
        savedEmails.length > 0 ? savedEmails.join(', ') : String(data.defaultEmail || '').trim(),
      );
      setBackupScheduleEnabled(Boolean(data.settings?.scheduleEnabled));
      setBackupScheduleTime(data.settings?.scheduleTime || '22:00');
      setBackupHistory(Array.isArray(data.history) ? data.history.slice(0, 10) : []);
    } catch {
      /* ignore — send will surface SMTP / network errors */
    }
  }, []);

  useEffect(() => {
    load();
    loadBackupStatus();
  }, [load, loadBackupStatus]);

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

  const handleSaveBackupSettings = async (e) => {
    e.preventDefault();
    setBackupSaving(true);
    setBackupError(null);
    setBackupOk(null);
    try {
      const res = await authFetch(`${apiBase}/api/backup/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emails: backupEmails,
          scheduleEnabled: backupScheduleEnabled,
          scheduleTime: backupScheduleTime,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBackupError(data.error || 'Could not save backup settings');
        return;
      }
      const savedEmails = Array.isArray(data.settings?.emails) ? data.settings.emails : [];
      setBackupEmails(savedEmails.join(', '));
      setBackupScheduleEnabled(Boolean(data.settings?.scheduleEnabled));
      setBackupScheduleTime(data.settings?.scheduleTime || backupScheduleTime);
      setBackupOk({ saved: true });
    } catch {
      setBackupError('Could not reach the server');
    } finally {
      setBackupSaving(false);
    }
  };

  const handleBackupNow = async () => {
    setBackupSending(true);
    setBackupError(null);
    setBackupOk(null);
    try {
      const res = await authFetch(`${apiBase}/api/backup/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: backupEmails }),
      });
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.history)) {
        setBackupHistory(data.history.slice(0, 10));
      }
      if (!res.ok) {
        setBackupError(data.error || 'Could not send backup email');
        return;
      }
      if (Array.isArray(data.emails) && data.emails.length > 0) {
        setBackupEmails(data.emails.join(', '));
      }
      setBackupOk(data);
    } catch {
      setBackupError('Could not reach the server');
    } finally {
      setBackupSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Admin-only controls for the 80mm Bluetooth XPrinter and for emailing a zip backup of all JSON files in the data folder.
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
              When enabled, allowed users see a Bluetooth printer indicator next to WhatsApp. The last printer this browser used reconnects automatically when the app is open.
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
                  Allow pairing with an 80mm XPrinter over Bluetooth from this browser. After the first scan, that printer reconnects automatically when the system and this app are on.
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

      <form onSubmit={handleSaveBackupSettings} className="space-y-4">
        <section className="rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-6">
          <h2 className="text-sm font-bold text-slate-900">Backup</h2>
          <p className="mt-1 text-sm text-slate-500">
            Zip every JSON file in <span className="font-medium text-slate-700">backend/data</span> and email it as{' '}
            <span className="font-medium text-slate-700">
              {backupStatus.shopName ? `${backupStatus.shopName.replace(/[^\w]+/g, '-')}-` : 'shopname-'}
              date-time.zip
            </span>
            . SMTP is read from the backend <span className="font-medium text-slate-700">.env</span> file.
          </p>

          {!backupStatus.smtpConfigured ? (
            <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-100">
              Add SMTP_HOST, SMTP_USER, and SMTP_PASS to backend/.env, then restart the server.
            </p>
          ) : null}

          {backupError ? (
            <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
              {backupError}
            </p>
          ) : null}
          {backupOk?.saved ? (
            <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-100">
              Backup schedule saved
              {backupScheduleEnabled ? ` — daily at ${backupScheduleTime}.` : '.'}
            </p>
          ) : null}
          {backupOk && !backupOk.saved ? (
            <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-100">
              Backup sent to {formatEmails(backupOk.emails || backupOk.to)}
              {backupOk.filename ? ` as ${backupOk.filename}` : ''}.
              {backupOk.fileCount != null
                ? ` ${backupOk.fileCount} file${backupOk.fileCount === 1 ? '' : 's'} included.`
                : ''}
            </p>
          ) : null}

          <label className="mt-4 block text-sm font-medium text-slate-600">
            Email IDs
            <textarea
              rows={3}
              className={`${inputClass} resize-y`}
              value={backupEmails}
              onChange={(e) => {
                setBackupOk(null);
                setBackupError(null);
                setBackupEmails(e.target.value);
              }}
              placeholder="backup@example.com, owner@example.com"
            />
            <span className="mt-1 block text-xs font-normal text-slate-500">
              Separate multiple addresses with commas.
            </span>
          </label>

          <div className="mt-5 rounded-xl bg-slate-50/90 p-4 ring-1 ring-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">Daily schedule</h3>
            <p className="mt-1 text-sm text-slate-500">
              When enabled, the same zip is emailed every day at this time to the addresses above, while the server is running.
            </p>
            <label className="mt-3 flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/35"
                checked={backupScheduleEnabled}
                onChange={(e) => {
                  setBackupOk(null);
                  setBackupError(null);
                  setBackupScheduleEnabled(e.target.checked);
                }}
              />
              <span className="text-sm font-semibold text-slate-900">Enable daily backup</span>
            </label>
            <label className="mt-3 block text-sm font-medium text-slate-600 sm:max-w-[12rem]">
              Time
              <input
                type="time"
                className={inputClass}
                value={backupScheduleTime}
                onChange={(e) => {
                  setBackupOk(null);
                  setBackupError(null);
                  setBackupScheduleTime(e.target.value);
                }}
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={backupSending || backupSaving || !backupEmails.trim()}
              onClick={handleBackupNow}
              className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-slate-800 disabled:opacity-60"
            >
              {backupSending ? 'Sending…' : 'Backup now'}
            </button>
            <button
              type="submit"
              disabled={backupSaving || backupSending}
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-indigo-700 disabled:opacity-60"
            >
              {backupSaving ? 'Saving…' : 'Save schedule'}
            </button>
          </div>
        </section>
      </form>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Backup history</h2>
          <p className="mt-1 text-sm text-slate-500">Last 10 backups with send status.</p>
        </div>

        <div className={mobileCardList}>
          {backupHistory.length === 0 ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              No backups yet. Use Backup now or wait for the daily schedule.
            </p>
          ) : (
            backupHistory.map((row) => {
              const failed = row.status === 'failed';
              return (
                <MobileRowCard
                  key={row.id}
                  title={formatBackupAt(row.sentAt)}
                  subtitle={row.filename || row.error || '—'}
                  badge={
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${
                        failed
                          ? 'bg-rose-50 text-rose-800 ring-rose-100'
                          : 'bg-emerald-50 text-emerald-800 ring-emerald-100'
                      }`}
                    >
                      {failed ? 'Failed' : 'Sent'}
                    </span>
                  }
                  fields={[
                    { label: 'Type', value: row.trigger === 'scheduled' ? 'Scheduled' : 'Manual' },
                    { label: 'To', value: formatEmails(row.emails) },
                    { label: 'Files', value: row.fileCount || '—' },
                  ]}
                />
              );
            })
          )}
        </div>

        <div className={`hidden sm:block ${scrollTableWrap}`}>
          <table className="data-table w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className={`px-4 py-3 ${stickyFirstTh}`}>Sent</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">To</th>
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">Files</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {backupHistory.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    No backups yet. Use Backup now or wait for the daily schedule.
                  </td>
                </tr>
              ) : (
                backupHistory.map((row) => {
                  const failed = row.status === 'failed';
                  return (
                    <tr key={row.id} className="hover:bg-slate-50/80">
                      <td className={`whitespace-nowrap px-4 py-3 tabular-nums text-slate-600 ${stickyFirstTd}`}>
                        {formatBackupAt(row.sentAt)}
                      </td>
                      <td className="px-4 py-3">
                        {row.trigger === 'scheduled' ? 'Scheduled' : 'Manual'}
                      </td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-indigo-700" title={formatEmails(row.emails)}>
                        {formatEmails(row.emails)}
                      </td>
                      <td
                        className="max-w-[220px] truncate px-4 py-3 text-slate-700"
                        title={failed ? row.error || '' : row.filename || ''}
                      >
                        {failed ? row.error || '—' : row.filename || '—'}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{row.fileCount || '—'}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${
                            failed
                              ? 'bg-rose-50 text-rose-800 ring-rose-100'
                              : 'bg-emerald-50 text-emerald-800 ring-emerald-100'
                          }`}
                          title={failed ? row.error || 'Failed' : 'Sent'}
                        >
                          {failed ? 'Failed' : 'Sent'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
