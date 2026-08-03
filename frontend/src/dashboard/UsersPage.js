import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { getApiBase } from '../apiBase';
import { authFetch, getUsername, isAdmin } from '../auth';
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
  modalPanelClassMd,
  ModalBackdrop,
} from './tableToolbar';
import RowDetailModal, { detailRowAttrs } from './RowDetailModal';
import { ALL_MANAGER_ACCESS_KEYS, MANAGER_ACCESS_OPTIONS } from './navConfig';

const USER_ROLES = ['Admin', 'Manager', 'Driver', 'Collector'];

const emptyForm = () => ({
  role: 'Manager',
  name: '',
  contact: '',
  nic: '',
  driverLicense: '',
  password: '',
  access: [...ALL_MANAGER_ACCESS_KEYS],
});

const inputClass =
  'mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30';

export default function UsersPage() {
  const apiRoot = getApiBase() || '';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalMode, setModalMode] = useState(null); // 'create' | 'edit' | null
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [detailUser, setDetailUser] = useState(null);

  const load = useCallback(async () => {
    if (!isAdmin()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${apiRoot}/api/users`);
      if (res.status === 401) {
        setError('Sign in again as admin to manage users.');
        setRows([]);
        return;
      }
      if (res.status === 403) {
        setError('Only the admin can manage users.');
        setRows([]);
        return;
      }
      if (!res.ok) throw new Error('Failed to load users');
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || 'Could not load data');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [apiRoot]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) =>
      rowMatchesQuery(search, [
        r.name,
        r.username,
        r.contact,
        r.nic,
        r.driverLicense,
        r.role,
        r.id,
        r.createdBy,
        r.createdAt,
      ]),
    );
  }, [rows, search]);

  const pagination = useTablePagination(filteredRows.length, [search]);
  const pagedRows = useMemo(
    () => filteredRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filteredRows, pagination.offset, pagination.pageSize]
  );

  const openCreate = () => {
    setModalMode('create');
    setEditingId(null);
    setForm(emptyForm());
    setShowPassword(false);
    setSaveError(null);
  };

  const openEdit = (user) => {
    setModalMode('edit');
    setEditingId(user.id);
    setForm({
      role: USER_ROLES.includes(user.role) ? user.role : 'Manager',
      name: user.name || '',
      contact: user.contact || '',
      nic: user.nic || '',
      driverLicense: user.driverLicense || '',
      password: user.password || '',
      access: Array.isArray(user.access) ? [...user.access] : [...ALL_MANAGER_ACCESS_KEYS],
    });
    setShowPassword(false);
    setSaveError(null);
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingId(null);
    setSaveError(null);
    setShowPassword(false);
  };

  if (!isAdmin()) {
    return <Navigate to="/dashboard/analytics" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const isEdit = modalMode === 'edit';
      const payload = {
        role: form.role,
        name: form.name.trim(),
        contact: form.contact.trim(),
        nic: form.nic.trim(),
        driverLicense: form.role === 'Driver' ? form.driverLicense.trim() : '',
        password: form.password,
      };
      if (form.role === 'Manager') {
        payload.access = form.access;
      }

      const res = await authFetch(
        isEdit ? `${apiRoot}/api/users/${encodeURIComponent(editingId)}` : `${apiRoot}/api/users`,
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || 'Save failed');
        return;
      }
      closeModal();
      await load();
    } catch {
      setSaveError('Could not reach the server');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this user? They can no longer sign in.')) return;
    setDeletingId(id);
    try {
      const res = await authFetch(`${apiRoot}/api/users/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Delete failed');
        return;
      }
      await load();
    } catch {
      alert('Could not reach the server');
    } finally {
      setDeletingId(null);
    }
  };

  const selfName = (getUsername() || '').trim().toLowerCase();
  const isEdit = modalMode === 'edit';

  const toggleAccess = (key) => {
    setForm((f) => ({
      ...f,
      access: f.access.includes(key) ? f.access.filter((k) => k !== key) : [...f.access, key],
    }));
  };

  const renderRowActions = (r, { stopPropagation = false } = {}) => (
    <>
      <button
        type="button"
        onClick={(e) => {
          if (stopPropagation) e.stopPropagation();
          setDetailUser(r);
        }}
        className="rounded-lg px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50"
      >
        View
      </button>
      <button
        type="button"
        onClick={(e) => {
          if (stopPropagation) e.stopPropagation();
          openEdit(r);
        }}
        className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
      >
        Edit
      </button>
      <button
        type="button"
        disabled={deletingId === r.id}
        onClick={(e) => {
          if (stopPropagation) e.stopPropagation();
          handleDelete(r.id);
        }}
        className="rounded-lg px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
      >
        {deletingId === r.id ? 'Removing…' : 'Remove'}
      </button>
    </>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-sm text-slate-500">
          Add and manage admin and staff accounts for dashboard access.
        </p>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex w-full shrink-0 items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 sm:w-auto text-sm font-semibold text-white shadow-md shadow-indigo-500/25 transition hover:bg-indigo-700"
        >
          Add user
        </button>
      </div>

      <TableFiltersBar
        hint={
          rows.length > 0
            ? `Showing ${filteredRows.length} of ${rows.length} user${rows.length === 1 ? '' : 's'}`
            : null
        }
      >
        <label className={filterLabel}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, NIC, role, contact…"
            className={filterControl}
          />
        </label>
      </TableFiltersBar>

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
        <div className="space-y-3">
        <div className={mobileCardList}>
          {filteredRows.length === 0 ? (
            <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-100">
              {rows.length === 0 ? 'No users yet. Add one with the button above.' : 'No matches.'}
            </p>
          ) : (
            pagedRows.map((r) => {
              const isSelf = r.username === selfName || r.nic === selfName;
              return (
                <MobileRowCard
                  key={r.id}
                  title={r.name || r.username}
                  subtitle={isSelf ? 'You (if staff)' : r.role || undefined}
                  fields={[
                    { label: 'Role', value: r.role || '—' },
                    { label: 'Contact', value: r.contact || '—' },
                  ]}
                  actions={renderRowActions(r)}
                />
              );
            })
          )}
        </div>
        <div className={`hidden sm:block ${scrollTableWrap}`}>
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                <th className={`py-3 pl-4 pr-3 ${stickyFirstTh}`}>Name</th>
                <th className="py-3 pr-3">Role</th>
                <th className="py-3 pr-3">Contact</th>
                <th className="py-3 pr-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                    {rows.length === 0 ? 'No users yet. Add one with the button above.' : 'No matches.'}
                  </td>
                </tr>
              ) : (
                pagedRows.map((r) => {
                  const isSelf = r.username === selfName || r.nic === selfName;
                  return (
                    <tr
                      key={r.id}
                      {...detailRowAttrs(() => setDetailUser(r), 'text-slate-700')}
                      aria-label={`User ${r.name || r.username || ''}`}
                    >
                      <td className={`py-3.5 pl-4 pr-3 font-semibold text-slate-900 ${stickyFirstTd}`}>
                        {r.name || r.username}
                        {isSelf ? (
                          <span className="ml-2 text-xs font-normal text-slate-400">(you, if staff)</span>
                        ) : null}
                      </td>
                      <td className="py-3.5 pr-3 text-slate-700">{r.role || '—'}</td>
                      <td className="py-3.5 pr-3 tabular-nums text-slate-600">{r.contact || '—'}</td>
                      <td className="py-3.5 pr-4 text-right">
                        <div className="inline-flex flex-wrap items-center justify-end gap-1">
                          {renderRowActions(r, { stopPropagation: true })}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {rows.length > 0 ? (
          <TablePaginationBar
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            totalCount={filteredRows.length}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        ) : null}
        </div>
      )}

      {modalMode ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="users-modal-title"
        >
          <ModalBackdrop onClose={closeModal} />
          <div className={modalPanelClassMd}>
            <h2 id="users-modal-title" className="text-lg font-bold text-slate-900">
              {isEdit ? 'Edit user' : 'Add user'}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {isEdit
                ? 'Update details below. Use Show to view the password. Changing it updates their sign-in password.'
                : 'Users sign in with their NIC and password. Admins get full system access. Password must be at least 6 characters.'}
            </p>
            <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
              {saveError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">
                  {saveError}
                </p>
              ) : null}
              <div>
                <label className="block text-sm font-medium text-slate-600" htmlFor="nu-role">
                  Role
                </label>
                <select
                  id="nu-role"
                  className={inputClass}
                  value={form.role}
                  onChange={(e) => {
                    const nextRole = e.target.value;
                    setForm((f) => ({
                      ...f,
                      role: nextRole,
                      access:
                        nextRole === 'Manager' && f.access.length === 0
                          ? [...ALL_MANAGER_ACCESS_KEYS]
                          : f.access,
                    }));
                  }}
                  disabled={saving}
                  required
                >
                  {USER_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600" htmlFor="nu-name">
                  Name
                </label>
                <input
                  id="nu-name"
                  className={inputClass}
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  autoComplete="name"
                  disabled={saving}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600" htmlFor="nu-contact">
                  Contact
                </label>
                <input
                  id="nu-contact"
                  type="tel"
                  className={inputClass}
                  value={form.contact}
                  onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
                  autoComplete="tel"
                  disabled={saving}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600" htmlFor="nu-nic">
                  NIC
                </label>
                <input
                  id="nu-nic"
                  className={inputClass}
                  value={form.nic}
                  onChange={(e) => setForm((f) => ({ ...f, nic: e.target.value }))}
                  autoComplete="off"
                  disabled={saving}
                  required
                />
              </div>
              {form.role === 'Driver' ? (
                <div>
                  <label className="block text-sm font-medium text-slate-600" htmlFor="nu-driver-license">
                    Driver license
                  </label>
                  <input
                    id="nu-driver-license"
                    className={inputClass}
                    value={form.driverLicense}
                    onChange={(e) => setForm((f) => ({ ...f, driverLicense: e.target.value }))}
                    autoComplete="off"
                    disabled={saving}
                    required
                    placeholder="License number"
                  />
                </div>
              ) : null}
              {form.role === 'Manager' ? (
                <fieldset className="rounded-xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
                  <legend className="px-1 text-sm font-medium text-slate-600">Dashboard access</legend>
                  <p className="mb-3 text-xs text-slate-500">
                    Tick the sections this manager can view. Unticked sections are hidden from their menu.
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {MANAGER_ACCESS_OPTIONS.map(({ key, label }) => (
                      <label
                        key={key}
                        className="flex cursor-pointer items-center gap-2 rounded-lg bg-white px-2.5 py-2 text-sm text-slate-700 ring-1 ring-slate-200/80"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30"
                          checked={form.access.includes(key)}
                          onChange={() => toggleAccess(key)}
                          disabled={saving}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  {form.access.length === 0 ? (
                    <p className="mt-2 text-xs text-amber-700">Select at least one section.</p>
                  ) : null}
                </fieldset>
              ) : null}
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-sm font-medium text-slate-600" htmlFor="nu-password">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <input
                  id="nu-password"
                  type={showPassword ? 'text' : 'password'}
                  className={inputClass}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  autoComplete="new-password"
                  disabled={saving}
                  required
                  minLength={6}
                  placeholder={isEdit ? 'Current password' : undefined}
                />
                {isEdit && !form.password ? (
                  <p className="mt-1 text-xs text-amber-700">
                    No saved password on this account yet — set one and save.
                  </p>
                ) : null}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || (form.role === 'Manager' && form.access.length === 0)}
                  className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-indigo-700 disabled:opacity-60"
                >
                  {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create user'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <RowDetailModal open={!!detailUser} row={detailUser} variant="user" onClose={() => setDetailUser(null)} />
    </div>
  );
}
