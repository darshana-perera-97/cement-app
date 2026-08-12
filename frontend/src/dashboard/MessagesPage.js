import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import {
  LoadingSpinner,
  TableFiltersBar,
  TablePaginationBar,
  filterControl,
  filterLabel,
  mobileCardList,
  MobileRowCard,
  rowMatchesQuery,
  scrollTableWrap,
  stickyFirstTd,
  stickyFirstTh,
  stickyThead,
  useTablePagination,
} from './tableToolbar';

const apiBase = getApiBase();

const TYPE_META = {
  bill: { label: 'Bill', badge: 'bg-indigo-50 text-indigo-800 ring-indigo-100' },
  payment: { label: 'Payment', badge: 'bg-emerald-50 text-emerald-800 ring-emerald-100' },
  promotion: { label: 'Free bags', badge: 'bg-violet-50 text-violet-800 ring-violet-100' },
  unload: { label: 'Unload', badge: 'bg-sky-50 text-sky-800 ring-sky-100' },
  cheque_return: { label: 'Cheque returned', badge: 'bg-rose-50 text-rose-800 ring-rose-100' },
  overdue_balance: { label: 'Balance reminder', badge: 'bg-orange-50 text-orange-800 ring-orange-100' },
};

const emptyCompanyForm = () => ({
  distributor: '',
  company: '',
});

const emptyEmailForm = () => ({
  enabled: false,
  host: '',
  port: '587',
  secure: false,
  user: '',
  pass: '',
  from: '',
  fromName: '',
  passConfigured: false,
});

const emptyWhatsAppForm = () => ({
  enabled: false,
});

const emptyNotificationForm = () => ({
  notifyBill: true,
  notifyPayment: true,
  notifyPromotion: true,
  notifyUnload: true,
  notifyChequeReturn: true,
  hideFinancialDetails: false,
  notifyOverdueBalance: false,
  overdueBalanceShareMode: 'both',
  overdueReminderWeekday: '1',
  overdueReminderTime: '09:00',
});

const WEEKDAY_OPTIONS = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
];

const OVERDUE_SHARE_MODE_OPTIONS = [
  {
    value: 'overdue_only',
    label: 'Overdue bills only',
    description:
      'List overdue bills with the amount still owed on each, plus a total. Skips customers with no overdue bills.',
  },
  {
    value: 'pending_only',
    label: 'Pending balance only',
    description:
      'Send the total amount still owed. Overdue bills are also listed with amounts when any exist.',
  },
  {
    value: 'both',
    label: 'Both',
    description:
      'List overdue bills with amounts, total overdue, and the total pending balance.',
  },
];

const NOTIFICATION_STAGE_OPTIONS = [
  {
    key: 'notifyBill',
    label: 'Credit sale (bill)',
    description:
      'When a credit bill is recorded. On unload approval, sent when prices are shown to customers.',
  },
  {
    key: 'notifyPayment',
    label: 'Payment received',
    description: 'When a customer payment is saved.',
  },
  {
    key: 'notifyPromotion',
    label: 'Free bags',
    description: 'When free bags are recorded on a promotion.',
  },
  {
    key: 'notifyUnload',
    label: 'Delivery unloaded',
    description:
      'When bags are unloaded at a shop (/unloads), sends the customer a delivery confirmation with bag type and bag count only.',
  },
  {
    key: 'notifyChequeReturn',
    label: 'Cheque returned',
    description: 'When a customer cheque is marked as returned.',
  },
];

const WHATSAPP_STATE_LABELS = {
  idle: 'Not started',
  initializing: 'Starting…',
  qr: 'Scan QR code',
  authenticated: 'Connecting…',
  ready: 'Connected',
  disconnected: 'Disconnected',
  auth_failure: 'Authentication failed',
};

const WHATSAPP_STATE_TONE = {
  idle: 'bg-slate-100 text-slate-700 ring-slate-200',
  initializing: 'bg-amber-50 text-amber-800 ring-amber-200',
  qr: 'bg-amber-50 text-amber-800 ring-amber-200',
  authenticated: 'bg-sky-50 text-sky-800 ring-sky-200',
  ready: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  disconnected: 'bg-rose-50 text-rose-800 ring-rose-200',
  auth_failure: 'bg-rose-50 text-rose-800 ring-rose-200',
};

function formatConnectionTime(iso) {
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

function WhatsAppConnectionSection({
  enabled,
  onEnabledChange,
  status,
  loading,
  saving,
  saveError,
  reconnecting,
  resettingSession,
  onSave,
  onReconnect,
  onResetSession,
}) {
  const state = status.state || 'idle';
  const stateLabel = WHATSAPP_STATE_LABELS[state] || state || 'Unknown';
  const stateTone = WHATSAPP_STATE_TONE[state] || WHATSAPP_STATE_TONE.idle;
  const activeConnection = status.connected ? status.connection : null;
  const rememberedConnection = status.lastConnection || null;
  const displayConnection =
    resettingSession || state === 'qr' ? null : activeConnection || rememberedConnection;
  const showConnectedPanel = Boolean(status.connected && activeConnection && !resettingSession);
  const showQrPanel = state === 'qr' && status.qrDataUrl;

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">WhatsApp connection</h2>
            <p className="mt-1 text-sm text-slate-500">
              Link a WhatsApp account on the server to send bill, payment, promotion, and unload notifications to customers.
            </p>
          </div>
          <span className={`inline-flex shrink-0 items-center gap-2 self-start rounded-full px-3 py-1 text-xs font-semibold ring-1 ${stateTone}`}>
            <span
              className={`h-2 w-2 rounded-full ${
                status.connected ? 'bg-emerald-500' : state === 'qr' || state === 'initializing' || state === 'authenticated' ? 'bg-amber-500' : 'bg-slate-400'
              }`}
              aria-hidden
            />
            {stateLabel}
          </span>
        </div>
      </div>

      <div className="grid gap-6 px-5 py-5 lg:grid-cols-2 lg:px-6">
        <div className="space-y-4">
          <label className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onEnabledChange(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              disabled={loading || saving}
            />
            <span className="text-sm font-medium text-slate-700">Enable WhatsApp notifications</span>
          </label>

          <p className="text-sm text-slate-500">
            When enabled, the server keeps this account linked and reconnects automatically after a restart or brief
            disconnect using the saved session.
          </p>

          {saveError ? (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{saveError}</p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={loading || saving}
              className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md disabled:opacity-60"
            >
              {saving ? 'Saving…' : enabled ? 'Save & connect' : 'Save'}
            </button>
            {enabled ? (
              <>
                <button
                  type="button"
                  onClick={onReconnect}
                  disabled={loading || saving || reconnecting || resettingSession}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {reconnecting ? 'Reconnecting…' : 'Reconnect now'}
                </button>
                <button
                  type="button"
                  onClick={onResetSession}
                  disabled={loading || saving || reconnecting || resettingSession}
                  className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
                >
                  {resettingSession ? 'Preparing QR…' : 'Link new account'}
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
          {!enabled ? (
            <p className="text-sm text-slate-500">Enable WhatsApp notifications, then save to show a QR code or restore the last linked account.</p>
          ) : showQrPanel ? (
            <div className="flex flex-col items-center gap-3">
              <p className="self-stretch text-sm font-medium text-slate-800">Scan to link this server</p>
              <img
                src={status.qrDataUrl}
                alt="WhatsApp QR code"
                className="h-52 w-52 rounded-xl bg-white p-3 ring-1 ring-slate-200"
              />
              <p className="text-center text-xs text-slate-500">
                On your phone: WhatsApp → Settings → Linked devices → Link a device, then scan this code.
              </p>
            </div>
          ) : showConnectedPanel ? (
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Connected account</p>
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Phone</dt>
                  <dd className="mt-0.5 font-semibold text-slate-900">{activeConnection.phone || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Display name</dt>
                  <dd className="mt-0.5 font-semibold text-slate-900">{activeConnection.pushname || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Device</dt>
                  <dd className="mt-0.5 text-slate-800">{activeConnection.platform || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Connected since</dt>
                  <dd className="mt-0.5 tabular-nums text-slate-800">{formatConnectionTime(activeConnection.connectedAt)}</dd>
                </div>
              </dl>
              <p className="text-sm text-emerald-700">Ready to send messages to customers with contact numbers.</p>
              <div className="border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={onResetSession}
                  disabled={loading || saving || reconnecting || resettingSession}
                  className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
                >
                  {resettingSession ? 'Preparing QR…' : 'Link new account'}
                </button>
                <p className="mt-2 text-xs text-slate-500">
                  Clears the saved session and shows a QR code to link a different WhatsApp number.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                {resettingSession
                  ? 'Clearing the saved session and preparing a new QR code…'
                  : state === 'initializing' || state === 'authenticated'
                    ? rememberedConnection
                      ? 'Restoring the saved WhatsApp session…'
                      : 'Starting the WhatsApp client…'
                    : state === 'disconnected' || state === 'auth_failure'
                      ? 'Connection lost. The server will retry automatically, or use Reconnect now.'
                      : 'Waiting for the WhatsApp client to start…'}
              </p>
              {status.lastError ? (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-100">
                  {status.lastError}
                </p>
              ) : null}
              {displayConnection ? (
                <div className="rounded-lg bg-white px-3 py-3 ring-1 ring-slate-200">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {activeConnection ? 'Connected account' : 'Last linked account'}
                  </p>
                  <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-slate-500">Phone</dt>
                      <dd className="font-medium text-slate-900">{displayConnection.phone || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Display name</dt>
                      <dd className="font-medium text-slate-900">{displayConnection.pushname || '—'}</dd>
                    </div>
                    {!activeConnection && displayConnection.connectedAt ? (
                      <div className="sm:col-span-2">
                        <dt className="text-xs text-slate-500">Last connected</dt>
                        <dd className="tabular-nums text-slate-700">{formatConnectionTime(displayConnection.connectedAt)}</dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
              ) : null}
              {(resettingSession || state === 'initializing' || state === 'authenticated' || state === 'disconnected') && (
                <div className="flex justify-center py-4">
                  <LoadingSpinner />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function formatSentAt(iso) {
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

function SettingsCard({ title, description, children, onSave, saving, saveError, saveLabel = 'Save' }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      <form
        className="space-y-4 px-5 py-5 sm:px-6"
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        {saveError ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{saveError}</p>
        ) : null}
        {children}
        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md disabled:opacity-60"
          >
            {saving ? 'Saving…' : saveLabel}
          </button>
        </div>
      </form>
    </section>
  );
}

function Field({ label, children, className = '' }) {
  return (
    <label className={`block text-sm font-medium text-slate-600 ${className}`}>
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputClass =
  'w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35';

export default function MessagesPage() {
  const [companyForm, setCompanyForm] = useState(emptyCompanyForm);
  const [emailForm, setEmailForm] = useState(emptyEmailForm);
  const [whatsappForm, setWhatsappForm] = useState(emptyWhatsAppForm);
  const [notificationForm, setNotificationForm] = useState(emptyNotificationForm);
  const [whatsappStatus, setWhatsappStatus] = useState({
    state: 'idle',
    connected: false,
    qrDataUrl: null,
    connection: null,
    lastConnection: null,
    lastError: null,
  });
  const [whatsappReconnecting, setWhatsappReconnecting] = useState(false);
  const [whatsappResettingSession, setWhatsappResettingSession] = useState(false);
  const [sentEmails, setSentEmails] = useState([]);
  const [sentWhatsapp, setSentWhatsapp] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [companySaving, setCompanySaving] = useState(false);
  const [companySaveError, setCompanySaveError] = useState(null);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailSaveError, setEmailSaveError] = useState(null);
  const [whatsappSaving, setWhatsappSaving] = useState(false);
  const [whatsappSaveError, setWhatsappSaveError] = useState(null);
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationSaveError, setNotificationSaveError] = useState(null);
  const [search, setSearch] = useState('');
  const [whatsappSearch, setWhatsappSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsRes, historyRes, whatsappHistoryRes] = await Promise.all([
        fetch(`${apiBase}/api/messages/settings`),
        fetch(`${apiBase}/api/messages/sent-emails`),
        fetch(`${apiBase}/api/messages/sent-whatsapp`),
      ]);
      if (!settingsRes.ok) throw new Error('Failed to load message settings');
      if (!historyRes.ok) throw new Error('Failed to load sent email history');
      if (!whatsappHistoryRes.ok) throw new Error('Failed to load sent WhatsApp history');
      const settings = await settingsRes.json();
      const history = await historyRes.json();
      const whatsappHistory = await whatsappHistoryRes.json();
      setCompanyForm({
        distributor: settings.companyData?.distributor ?? '',
        company: settings.companyData?.company ?? '',
      });
      setEmailForm({
        enabled: Boolean(settings.emailConfig?.enabled),
        host: settings.emailConfig?.host ?? '',
        port: String(settings.emailConfig?.port ?? 587),
        secure: Boolean(settings.emailConfig?.secure),
        user: settings.emailConfig?.user ?? '',
        pass: '',
        from: settings.emailConfig?.from ?? '',
        fromName: settings.emailConfig?.fromName ?? '',
        passConfigured: Boolean(settings.emailConfig?.passConfigured),
      });
      setWhatsappForm({
        enabled: Boolean(settings.whatsappConfig?.enabled),
      });
      setNotificationForm({
        notifyBill: settings.notificationSettings?.notifyBill !== false,
        notifyPayment: settings.notificationSettings?.notifyPayment !== false,
        notifyPromotion: settings.notificationSettings?.notifyPromotion !== false,
        notifyUnload: settings.notificationSettings?.notifyUnload !== false,
        notifyChequeReturn: settings.notificationSettings?.notifyChequeReturn !== false,
        hideFinancialDetails: Boolean(settings.notificationSettings?.hideFinancialDetails),
        notifyOverdueBalance: Boolean(settings.notificationSettings?.notifyOverdueBalance),
        overdueBalanceShareMode: settings.notificationSettings?.overdueBalanceShareMode ?? 'both',
        overdueReminderWeekday: String(settings.notificationSettings?.overdueReminderWeekday ?? 1),
        overdueReminderTime: settings.notificationSettings?.overdueReminderTime ?? '09:00',
      });
      setWhatsappStatus(
        settings.whatsappStatus ?? {
          state: 'idle',
          connected: false,
          qrDataUrl: null,
          connection: null,
          lastConnection: settings.whatsappConfig?.lastConnection ?? null,
          lastError: null,
        },
      );
      setSentEmails(Array.isArray(history) ? history : []);
      setSentWhatsapp(Array.isArray(whatsappHistory) ? whatsappHistory : []);
    } catch (e) {
      setError(e.message || 'Could not load data');
      setSentEmails([]);
      setSentWhatsapp([]);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!whatsappForm.enabled) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${apiBase}/api/messages/whatsapp-status`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) {
          setWhatsappStatus({
            state: data.state ?? 'idle',
            connected: Boolean(data.connected),
            qrDataUrl: data.qrDataUrl ?? null,
            connection: data.connection ?? null,
            lastConnection: whatsappResettingSession ? null : (data.lastConnection ?? null),
            lastError: data.lastError ?? null,
          });
        }
      } catch {
        // ignore polling errors
      }
    };
    poll();
    const id = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [apiBase, whatsappForm.enabled, whatsappResettingSession]);

  useEffect(() => {
    if (!whatsappResettingSession) return;
    if (whatsappStatus.state === 'qr' && whatsappStatus.qrDataUrl) {
      setWhatsappResettingSession(false);
      return;
    }
    if (whatsappStatus.lastError && (whatsappStatus.state === 'disconnected' || whatsappStatus.state === 'auth_failure')) {
      setWhatsappResettingSession(false);
    }
  }, [whatsappResettingSession, whatsappStatus]);

  const saveCompany = async () => {
    setCompanySaving(true);
    setCompanySaveError(null);
    try {
      const res = await fetch(`${apiBase}/api/messages/company-data`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          distributor: companyForm.distributor.trim(),
          company: companyForm.company.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCompanySaveError(data.error || 'Save failed');
        return;
      }
      setCompanyForm({
        distributor: data.distributor ?? '',
        company: data.company ?? '',
      });
    } catch {
      setCompanySaveError('Could not reach the server.');
    } finally {
      setCompanySaving(false);
    }
  };

  const saveEmailConfig = async () => {
    setEmailSaving(true);
    setEmailSaveError(null);
    try {
      const payload = {
        enabled: emailForm.enabled,
        host: emailForm.host.trim(),
        port: Number(emailForm.port) || 587,
        secure: emailForm.secure,
        user: emailForm.user.trim(),
        from: emailForm.from.trim(),
        fromName: emailForm.fromName.trim(),
      };
      if (emailForm.pass.trim()) {
        payload.pass = emailForm.pass.trim();
      }
      const res = await fetch(`${apiBase}/api/messages/email-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEmailSaveError(data.error || 'Save failed');
        return;
      }
      const cfg = data.emailConfig ?? {};
      setEmailForm((f) => ({
        ...f,
        enabled: Boolean(cfg.enabled),
        host: cfg.host ?? '',
        port: String(cfg.port ?? 587),
        secure: Boolean(cfg.secure),
        user: cfg.user ?? '',
        pass: '',
        from: cfg.from ?? '',
        fromName: cfg.fromName ?? '',
        passConfigured: Boolean(cfg.passConfigured),
      }));
    } catch {
      setEmailSaveError('Could not reach the server.');
    } finally {
      setEmailSaving(false);
    }
  };

  const saveNotificationSettings = async () => {
    setNotificationSaving(true);
    setNotificationSaveError(null);
    try {
      const res = await fetch(`${apiBase}/api/messages/notification-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notificationForm),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotificationSaveError(data.error || 'Save failed');
        return;
      }
      const ns = data.notificationSettings ?? {};
      setNotificationForm({
        notifyBill: ns.notifyBill !== false,
        notifyPayment: ns.notifyPayment !== false,
        notifyPromotion: ns.notifyPromotion !== false,
        notifyUnload: ns.notifyUnload !== false,
        notifyChequeReturn: ns.notifyChequeReturn !== false,
        hideFinancialDetails: Boolean(ns.hideFinancialDetails),
        notifyOverdueBalance: Boolean(ns.notifyOverdueBalance),
        overdueBalanceShareMode: ns.overdueBalanceShareMode ?? 'both',
        overdueReminderWeekday: String(ns.overdueReminderWeekday ?? 1),
        overdueReminderTime: ns.overdueReminderTime ?? '09:00',
      });
    } catch {
      setNotificationSaveError('Could not reach the server.');
    } finally {
      setNotificationSaving(false);
    }
  };

  const saveWhatsAppConfig = async () => {
    setWhatsappSaving(true);
    setWhatsappSaveError(null);
    try {
      const res = await fetch(`${apiBase}/api/messages/whatsapp-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: whatsappForm.enabled,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setWhatsappSaveError(data.error || 'Save failed');
        return;
      }
      setWhatsappForm({
        enabled: Boolean(data.whatsappConfig?.enabled),
      });
      setWhatsappStatus(
        data.whatsappStatus ?? {
          state: 'idle',
          connected: false,
          qrDataUrl: null,
          connection: null,
          lastConnection: data.whatsappConfig?.lastConnection ?? null,
          lastError: null,
        },
      );
    } catch {
      setWhatsappSaveError('Could not reach the server.');
    } finally {
      setWhatsappSaving(false);
    }
  };

  const reconnectWhatsApp = async () => {
    setWhatsappReconnecting(true);
    setWhatsappSaveError(null);
    try {
      const res = await fetch(`${apiBase}/api/messages/whatsapp/reconnect`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setWhatsappSaveError(data.error || 'Reconnect failed');
        return;
      }
      setWhatsappStatus(
        data.whatsappStatus ?? {
          state: 'initializing',
          connected: false,
          qrDataUrl: null,
          connection: null,
          lastConnection: whatsappStatus.lastConnection,
          lastError: null,
        },
      );
    } catch {
      setWhatsappSaveError('Could not reach the server.');
    } finally {
      setWhatsappReconnecting(false);
    }
  };

  const resetWhatsAppSession = async () => {
    if (!window.confirm('Clear the saved WhatsApp session and show a new QR code? You will need to scan again on your phone.')) {
      return;
    }
    setWhatsappResettingSession(true);
    setWhatsappSaveError(null);
    setWhatsappStatus((prev) => ({
      ...prev,
      state: 'initializing',
      connected: false,
      qrDataUrl: null,
      connection: null,
      lastConnection: null,
      lastError: null,
    }));
    try {
      const res = await fetch(`${apiBase}/api/messages/whatsapp/reset-session`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setWhatsappSaveError(data.error || 'Reset failed');
        setWhatsappResettingSession(false);
        return;
      }
      setWhatsappStatus({
        state: data.whatsappStatus?.state ?? 'initializing',
        connected: false,
        qrDataUrl: data.whatsappStatus?.qrDataUrl ?? null,
        connection: null,
        lastConnection: null,
        lastError: data.whatsappStatus?.lastError ?? null,
      });
    } catch {
      setWhatsappSaveError('Could not reach the server.');
      setWhatsappResettingSession(false);
    }
  };

  const filteredEmails = useMemo(() => {
    return sentEmails.filter((r) =>
      rowMatchesQuery(search, [
        r.type,
        r.to,
        r.customerName,
        r.subject,
        r.status,
        r.error,
        r.referenceId,
        formatSentAt(r.sentAt),
      ]),
    );
  }, [sentEmails, search]);

  const pagination = useTablePagination(filteredEmails.length, [search]);
  const pagedEmails = useMemo(
    () => filteredEmails.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filteredEmails, pagination.offset, pagination.pageSize],
  );

  const filteredWhatsapp = useMemo(() => {
    return sentWhatsapp.filter((r) =>
      rowMatchesQuery(whatsappSearch, [
        r.type,
        r.to,
        r.customerName,
        r.preview,
        r.status,
        r.error,
        r.referenceId,
        formatSentAt(r.sentAt),
      ]),
    );
  }, [sentWhatsapp, whatsappSearch]);

  const whatsappPagination = useTablePagination(filteredWhatsapp.length, [whatsappSearch]);
  const pagedWhatsapp = useMemo(
    () => filteredWhatsapp.slice(whatsappPagination.offset, whatsappPagination.offset + whatsappPagination.pageSize),
    [filteredWhatsapp, whatsappPagination.offset, whatsappPagination.pageSize],
  );

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">Configure email and WhatsApp notifications for customers.</p>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      <WhatsAppConnectionSection
        enabled={whatsappForm.enabled}
        onEnabledChange={(checked) => setWhatsappForm({ enabled: checked })}
        status={whatsappStatus}
        loading={loading}
        saving={whatsappSaving}
        saveError={whatsappSaveError}
        reconnecting={whatsappReconnecting}
        resettingSession={whatsappResettingSession}
        onSave={saveWhatsAppConfig}
        onReconnect={reconnectWhatsApp}
        onResetSession={resetWhatsAppSession}
      />

      <SettingsCard
        title="Customer notifications"
        description="Choose which messages are sent by email and WhatsApp. Unchecked stages are skipped even when a customer has contact details."
        onSave={saveNotificationSettings}
        saving={notificationSaving}
        saveError={notificationSaveError}
      >
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Send when</p>
          {NOTIFICATION_STAGE_OPTIONS.map((opt) => (
            <label
              key={opt.key}
              className="flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200/80"
            >
              <input
                type="checkbox"
                checked={Boolean(notificationForm[opt.key])}
                onChange={(e) =>
                  setNotificationForm((f) => ({ ...f, [opt.key]: e.target.checked }))
                }
                disabled={loading}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/35"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-800">{opt.label}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{opt.description}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="border-t border-slate-100 pt-4">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200/80">
            <input
              type="checkbox"
              checked={Boolean(notificationForm.hideFinancialDetails)}
              onChange={(e) =>
                setNotificationForm((f) => ({ ...f, hideFinancialDetails: e.target.checked }))
              }
              disabled={loading}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/35"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-800">
                Hide prices and balances from customers
              </span>
              <span className="mt-0.5 block text-xs text-slate-600">
                When ticked, new credit-sale messages hide per-bag prices, bill totals, and balance
                to pay. On unload approval, the credit-sale message is skipped when a delivery
                confirmation is sent instead. Payment receipts, cheque-return notices, and balance
                reminders always include amounts. When unticked, unload approval also sends the
                credit-sale message with prices. This does not change how prices are calculated in
                the app.
              </span>
            </span>
          </label>
        </div>
        <div className="border-t border-slate-100 pt-4 space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scheduled balance reminders</p>
            <p className="mt-1 text-xs text-slate-500">
              Send weekly reminders to each customer on their chosen day and time (server local time).
              Per-customer schedule can be set when editing a customer.
            </p>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-orange-50/60 px-3 py-3 ring-1 ring-orange-100">
            <input
              type="checkbox"
              checked={Boolean(notificationForm.notifyOverdueBalance)}
              onChange={(e) =>
                setNotificationForm((f) => ({ ...f, notifyOverdueBalance: e.target.checked }))
              }
              disabled={loading}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500/35"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-800">Enable weekly balance reminders</span>
              <span className="mt-0.5 block text-xs text-slate-600">
                Customers with a contact number or email receive a weekly reminder with amounts
                still owed. Overdue bills are always listed with the outstanding amount on each bill
                when any exist.
              </span>
            </span>
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Default weekday">
              <select
                value={notificationForm.overdueReminderWeekday}
                onChange={(e) =>
                  setNotificationForm((f) => ({ ...f, overdueReminderWeekday: e.target.value }))
                }
                disabled={loading}
                className={inputClass}
              >
                {WEEKDAY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Default time">
              <input
                type="time"
                value={notificationForm.overdueReminderTime}
                onChange={(e) =>
                  setNotificationForm((f) => ({ ...f, overdueReminderTime: e.target.value }))
                }
                disabled={loading}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Share with customer</p>
            {OVERDUE_SHARE_MODE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200/80"
              >
                <input
                  type="radio"
                  name="overdueBalanceShareMode"
                  value={opt.value}
                  checked={notificationForm.overdueBalanceShareMode === opt.value}
                  onChange={(e) =>
                    setNotificationForm((f) => ({ ...f, overdueBalanceShareMode: e.target.value }))
                  }
                  disabled={loading}
                  className="mt-0.5 h-4 w-4 border-slate-300 text-orange-600 focus:ring-orange-500/35"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-800">{opt.label}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{opt.description}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </SettingsCard>

      <div className="grid gap-6 xl:grid-cols-2">
        <SettingsCard
          title="Company details"
          description="Shown in email headers and footers sent to customers."
          onSave={saveCompany}
          saving={companySaving}
          saveError={companySaveError}
        >
          <Field label="Distributor">
            <input
              type="text"
              required
              value={companyForm.distributor}
              onChange={(e) => setCompanyForm((f) => ({ ...f, distributor: e.target.value }))}
              className={inputClass}
              placeholder="Chaminda Stores - Dummalasuriya"
              disabled={loading}
            />
          </Field>
          <Field label="Company">
            <input
              type="text"
              required
              value={companyForm.company}
              onChange={(e) => setCompanyForm((f) => ({ ...f, company: e.target.value }))}
              className={inputClass}
              placeholder="Yokyo Super Cement Distributor"
              disabled={loading}
            />
          </Field>
        </SettingsCard>

        <SettingsCard
          title="SMTP configuration"
          description="Stored in backend/data/emailConfigs.json. Password is never shown after saving."
          onSave={saveEmailConfig}
          saving={emailSaving}
          saveError={emailSaveError}
        >
          <label className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
            <input
              type="checkbox"
              checked={emailForm.enabled}
              onChange={(e) => setEmailForm((f) => ({ ...f, enabled: e.target.checked }))}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              disabled={loading}
            />
            <span className="text-sm font-medium text-slate-700">Enable customer email notifications</span>
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="SMTP host" className="sm:col-span-2">
              <input
                type="text"
                value={emailForm.host}
                onChange={(e) => setEmailForm((f) => ({ ...f, host: e.target.value }))}
                className={inputClass}
                placeholder="smtp.gmail.com"
                disabled={loading}
              />
            </Field>
            <Field label="Port">
              <input
                type="number"
                min={1}
                value={emailForm.port}
                onChange={(e) => setEmailForm((f) => ({ ...f, port: e.target.value }))}
                className={inputClass}
                disabled={loading}
              />
            </Field>
            <label className="flex items-end gap-3 pb-2 text-sm font-medium text-slate-600">
              <input
                type="checkbox"
                checked={emailForm.secure}
                onChange={(e) => setEmailForm((f) => ({ ...f, secure: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                disabled={loading}
              />
              Use SSL/TLS (port 465)
            </label>
            <Field label="Username">
              <input
                type="text"
                value={emailForm.user}
                onChange={(e) => setEmailForm((f) => ({ ...f, user: e.target.value }))}
                className={inputClass}
                autoComplete="username"
                disabled={loading}
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                value={emailForm.pass}
                onChange={(e) => setEmailForm((f) => ({ ...f, pass: e.target.value }))}
                className={inputClass}
                placeholder={emailForm.passConfigured ? 'Saved — enter to replace' : 'SMTP password'}
                autoComplete="new-password"
                disabled={loading}
              />
            </Field>
            <Field label="From email">
              <input
                type="email"
                value={emailForm.from}
                onChange={(e) => setEmailForm((f) => ({ ...f, from: e.target.value }))}
                className={inputClass}
                placeholder="noreply@example.com"
                disabled={loading}
              />
            </Field>
            <Field label="From name">
              <input
                type="text"
                value={emailForm.fromName}
                onChange={(e) => setEmailForm((f) => ({ ...f, fromName: e.target.value }))}
                className={inputClass}
                placeholder="Chaminda Stores"
                disabled={loading}
              />
            </Field>
          </div>
        </SettingsCard>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Sent email history</h2>
          <p className="mt-0.5 text-sm text-slate-500">Last 40 notifications stored in backend/data/sentEmails.json.</p>
        </div>

        <TableFiltersBar
          hint={
            !loading && sentEmails.length > 0
              ? `Showing ${filteredEmails.length} of ${sentEmails.length} email${sentEmails.length === 1 ? '' : 's'}`
              : null
          }
        >
          <label className={filterLabel}>
            Search
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Customer, email, type, status…"
              className={filterControl}
            />
          </label>
        </TableFiltersBar>

        <div className="space-y-3">
        <div className={mobileCardList}>
          {loading ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              <LoadingSpinner />
            </p>
          ) : sentEmails.length === 0 ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              No emails sent yet. Enable SMTP and record a bill, payment, or promotion for a customer with an email
              address.
            </p>
          ) : filteredEmails.length === 0 ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              No emails match your search.
            </p>
          ) : (
            pagedEmails.map((r) => {
              const meta = TYPE_META[r.type] || { label: r.type || '—', badge: 'bg-slate-100 text-slate-600' };
              const failed = r.status === 'failed';
              return (
                <MobileRowCard
                  key={r.id}
                  title={r.customerName || '—'}
                  subtitle={formatSentAt(r.sentAt)}
                  badge={
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${meta.badge}`}>
                      {meta.label}
                    </span>
                  }
                  fields={[
                    { label: 'To', value: r.to || '—' },
                    { label: 'Subject', value: r.subject || '—' },
                    {
                      label: 'Status',
                      value: (
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${
                            failed
                              ? 'bg-rose-50 text-rose-800 ring-rose-100'
                              : 'bg-emerald-50 text-emerald-800 ring-emerald-100'
                          }`}
                          title={failed ? r.error || 'Failed' : 'Sent'}
                        >
                          {failed ? 'Failed' : 'Sent'}
                        </span>
                      ),
                    },
                  ]}
                />
              );
            })
          )}
        </div>
        <div className={`hidden sm:block ${scrollTableWrap}`}>
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className={`px-4 py-3 ${stickyFirstTh}`}>Sent</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">To</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : sentEmails.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    No emails sent yet. Enable SMTP and record a bill, payment, or promotion for a customer with an
                    email address.
                  </td>
                </tr>
              ) : filteredEmails.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    No emails match your search.
                  </td>
                </tr>
              ) : (
                pagedEmails.map((r) => {
                  const meta = TYPE_META[r.type] || { label: r.type || '—', badge: 'bg-slate-100 text-slate-600' };
                  const failed = r.status === 'failed';
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/80">
                      <td className={`whitespace-nowrap px-4 py-3 tabular-nums text-slate-600 ${stickyFirstTd}`}>
                        {formatSentAt(r.sentAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${meta.badge}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">{r.customerName || '—'}</td>
                      <td className="px-4 py-3 text-indigo-700">{r.to || '—'}</td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-slate-700" title={r.subject || ''}>
                        {r.subject || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${
                            failed
                              ? 'bg-rose-50 text-rose-800 ring-rose-100'
                              : 'bg-emerald-50 text-emerald-800 ring-emerald-100'
                          }`}
                          title={failed ? r.error || 'Failed' : 'Sent'}
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
        </div>

        {!loading && sentEmails.length > 0 ? (
          <TablePaginationBar
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            totalCount={filteredEmails.length}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        ) : null}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Sent WhatsApp history</h2>
          <p className="mt-0.5 text-sm text-slate-500">Last 40 notifications stored in backend/data/sentWhatsapp.json.</p>
        </div>

        <TableFiltersBar
          hint={
            !loading && sentWhatsapp.length > 0
              ? `Showing ${filteredWhatsapp.length} of ${sentWhatsapp.length} message${sentWhatsapp.length === 1 ? '' : 's'}`
              : null
          }
        >
          <label className={filterLabel}>
            Search
            <input
              type="search"
              value={whatsappSearch}
              onChange={(e) => setWhatsappSearch(e.target.value)}
              placeholder="Customer, phone, type, status…"
              className={filterControl}
            />
          </label>
        </TableFiltersBar>

        <div className="space-y-3">
        <div className={mobileCardList}>
          {loading ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              <LoadingSpinner />
            </p>
          ) : sentWhatsapp.length === 0 ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              No WhatsApp messages sent yet. Enable WhatsApp, scan the QR code, and record a bill, payment,
              promotion, or approve an unload for a customer with a contact number.
            </p>
          ) : filteredWhatsapp.length === 0 ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              No messages match your search.
            </p>
          ) : (
            pagedWhatsapp.map((r) => {
              const meta = TYPE_META[r.type] || { label: r.type || '—', badge: 'bg-slate-100 text-slate-600' };
              const failed = r.status === 'failed';
              return (
                <MobileRowCard
                  key={r.id}
                  title={r.customerName || '—'}
                  subtitle={formatSentAt(r.sentAt)}
                  badge={
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${meta.badge}`}>
                      {meta.label}
                    </span>
                  }
                  fields={[
                    { label: 'To', value: r.to || '—' },
                    { label: 'Preview', value: r.preview || '—' },
                    {
                      label: 'Status',
                      value: (
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${
                            failed
                              ? 'bg-rose-50 text-rose-800 ring-rose-100'
                              : 'bg-emerald-50 text-emerald-800 ring-emerald-100'
                          }`}
                          title={failed ? r.error || 'Failed' : 'Sent'}
                        >
                          {failed ? 'Failed' : 'Sent'}
                        </span>
                      ),
                    },
                  ]}
                />
              );
            })
          )}
        </div>
        <div className={`hidden sm:block ${scrollTableWrap}`}>
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className={`px-4 py-3 ${stickyFirstTh}`}>Sent</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">To</th>
                <th className="px-4 py-3">Preview</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : sentWhatsapp.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    No WhatsApp messages sent yet. Enable WhatsApp, scan the QR code, and record a bill, payment,
                    promotion, or approve an unload for a customer with a contact number.
                  </td>
                </tr>
              ) : filteredWhatsapp.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    No messages match your search.
                  </td>
                </tr>
              ) : (
                pagedWhatsapp.map((r) => {
                  const meta = TYPE_META[r.type] || { label: r.type || '—', badge: 'bg-slate-100 text-slate-600' };
                  const failed = r.status === 'failed';
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/80">
                      <td className={`whitespace-nowrap px-4 py-3 tabular-nums text-slate-600 ${stickyFirstTd}`}>
                        {formatSentAt(r.sentAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${meta.badge}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">{r.customerName || '—'}</td>
                      <td className="px-4 py-3 text-emerald-700">{r.to || '—'}</td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-slate-700" title={r.preview || ''}>
                        {r.preview || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${
                            failed
                              ? 'bg-rose-50 text-rose-800 ring-rose-100'
                              : 'bg-emerald-50 text-emerald-800 ring-emerald-100'
                          }`}
                          title={failed ? r.error || 'Failed' : 'Sent'}
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
        </div>

        {!loading && sentWhatsapp.length > 0 ? (
          <TablePaginationBar
            page={whatsappPagination.page}
            totalPages={whatsappPagination.totalPages}
            pageSize={whatsappPagination.pageSize}
            totalCount={filteredWhatsapp.length}
            onPageChange={whatsappPagination.setPage}
            onPageSizeChange={whatsappPagination.setPageSize}
          />
        ) : null}
      </section>
    </div>
  );
}
