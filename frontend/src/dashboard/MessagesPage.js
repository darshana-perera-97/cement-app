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

const WHATSAPP_STATE_LABELS = {
  idle: 'Not started',
  initializing: 'Starting…',
  qr: 'Scan QR code',
  authenticated: 'Connecting…',
  ready: 'Connected',
  disconnected: 'Disconnected',
  auth_failure: 'Authentication failed',
};

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
  const [whatsappStatus, setWhatsappStatus] = useState({ state: 'idle', connected: false, qrDataUrl: null });
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
      setWhatsappStatus(settings.whatsappStatus ?? { state: 'idle', connected: false, qrDataUrl: null });
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
  }, [apiBase, whatsappForm.enabled]);

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
      setWhatsappStatus(data.whatsappStatus ?? { state: 'idle', connected: false, qrDataUrl: null });
    } catch {
      setWhatsappSaveError('Could not reach the server.');
    } finally {
      setWhatsappSaving(false);
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

        <SettingsCard
          title="WhatsApp notifications"
          description="Uses whatsapp-web.js on the server. Scan the QR code with WhatsApp on your phone to connect."
          onSave={saveWhatsAppConfig}
          saving={whatsappSaving}
          saveError={whatsappSaveError}
        >
          <label className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
            <input
              type="checkbox"
              checked={whatsappForm.enabled}
              onChange={(e) => setWhatsappForm((f) => ({ ...f, enabled: e.target.checked }))}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              disabled={loading}
            />
            <span className="text-sm font-medium text-slate-700">Enable customer WhatsApp notifications</span>
          </label>
          <div className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Connection status</p>
            <p className="mt-1 text-sm font-medium text-slate-800">
              {WHATSAPP_STATE_LABELS[whatsappStatus.state] || whatsappStatus.state || 'Unknown'}
            </p>
            {whatsappForm.enabled && whatsappStatus.state === 'qr' && whatsappStatus.qrDataUrl ? (
              <div className="mt-4 flex flex-col items-center gap-2">
                <img
                  src={whatsappStatus.qrDataUrl}
                  alt="WhatsApp QR code"
                  className="h-48 w-48 rounded-lg bg-white p-2 ring-1 ring-slate-200"
                />
                <p className="text-center text-xs text-slate-500">
                  Open WhatsApp → Linked devices → Link a device, then scan this code.
                </p>
              </div>
            ) : null}
            {whatsappForm.enabled && whatsappStatus.connected ? (
              <p className="mt-2 text-sm text-emerald-700">Ready to send messages to customers with contact numbers.</p>
            ) : null}
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
              No WhatsApp messages sent yet. Enable WhatsApp, scan the QR code, and record a bill, payment, or
              promotion for a customer with a contact number.
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
                    No WhatsApp messages sent yet. Enable WhatsApp, scan the QR code, and record a bill, payment, or
                    promotion for a customer with a contact number.
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
